use image::{imageops, DynamicImage, ImageBuffer, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::config::path_manager::PathManager;

static GENERATION_CANCELLED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameAnalysisTexture {
    hash: String,
    file_name: String,
    path: String,
    width: u32,
    height: u32,
    format: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    width: u32,
    height: u32,
    fps: Option<f64>,
    duration: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureModRequest {
    target_path: String,
    texture_hash: String,
    source_kind: String,
    source_path: Option<String>,
    sequence_files: Vec<String>,
    sequence_directory: Option<String>,
    sequence_regex: Option<String>,
    output_directory: String,
    mod_name: String,
    fit_mode: String,
    flip_vertical: bool,
    flip_horizontal: bool,
    rotation: u16,
    fps: Option<f64>,
    frame_step: u32,
    size_percent: u32,
    video_quality: u8,
    loop_mode: String,
    trim_start_frame: Option<u64>,
    trim_end_frame: Option<u64>,
}

fn texture_hash(name: &str) -> Option<String> {
    let start = if let Some(index) = name.find("!S!=").or_else(|| name.find("!U!=")) {
        index + 4
    } else {
        name.find('=')? + 1
    };
    let value = name.get(start..start + 8)?;
    value
        .chars()
        .all(|c| c.is_ascii_hexdigit())
        .then(|| value.to_ascii_lowercase())
}

fn dds_size(path: &Path) -> Option<(u32, u32)> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() < 20 || &bytes[0..4] != b"DDS " {
        return None;
    }
    let height = u32::from_le_bytes(bytes[12..16].try_into().ok()?);
    let width = u32::from_le_bytes(bytes[16..20].try_into().ok()?);
    (width > 0 && height > 0).then_some((width, height))
}

fn dds_format(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() < 128 || &bytes[0..4] != b"DDS " {
        return None;
    }
    let four_cc = &bytes[84..88];
    if four_cc == b"DX10" && bytes.len() >= 132 {
        let dxgi = u32::from_le_bytes(bytes[128..132].try_into().ok()?);
        return Some(
            match dxgi {
                2 => "R32G32B32A32_FLOAT",
                10 => "R16G16B16A16_FLOAT",
                11 => "R16G16B16A16_UNORM",
                24 => "R10G10B10A2_UNORM",
                28 => "R8G8B8A8_UNORM",
                29 => "R8G8B8A8_UNORM_SRGB",
                41 => "R32_FLOAT",
                49 => "R8G8_UNORM",
                61 => "R8_UNORM",
                71 => "BC1_UNORM",
                72 => "BC1_UNORM_SRGB",
                74 => "BC2_UNORM",
                75 => "BC2_UNORM_SRGB",
                77 => "BC3_UNORM",
                78 => "BC3_UNORM_SRGB",
                80 => "BC4_UNORM",
                81 => "BC4_SNORM",
                83 => "BC5_UNORM",
                84 => "BC5_SNORM",
                87 => "B8G8R8A8_UNORM",
                91 => "B8G8R8A8_UNORM_SRGB",
                95 => "BC6H_UF16",
                96 => "BC6H_SF16",
                98 => "BC7_UNORM",
                99 => "BC7_UNORM_SRGB",
                _ => return None,
            }
            .to_string(),
        );
    }
    Some(
        match four_cc {
            b"DXT1" => "BC1_UNORM",
            b"DXT3" => "BC2_UNORM",
            b"DXT5" => "BC3_UNORM",
            b"ATI1" | b"BC4U" => "BC4_UNORM",
            b"BC4S" => "BC4_SNORM",
            b"ATI2" | b"BC5U" => "BC5_UNORM",
            b"BC5S" => "BC5_SNORM",
            _ => "R8G8B8A8_UNORM",
        }
        .to_string(),
    )
}

fn image_size(path: &Path) -> (u32, u32) {
    dds_size(path)
        .or_else(|| image::image_dimensions(path).ok())
        .unwrap_or((0, 0))
}

#[tauri::command]
pub async fn scan_frame_analysis_textures(
    folder: String,
) -> Result<Vec<FrameAnalysisTexture>, String> {
    let root = PathBuf::from(folder.trim());
    if !root.is_dir() {
        return Err("FrameAnalysis folder does not exist".into());
    }
    let deduped = root.join("deduped");
    let mut deduped_by_hash = HashMap::<String, PathBuf>::new();
    if deduped.is_dir() {
        for entry in fs::read_dir(&deduped).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_file() {
                if let Some(hash) = texture_hash(&format!("={name}")).or_else(|| {
                    name.get(0..8)
                        .filter(|s| s.chars().all(|c| c.is_ascii_hexdigit()))
                        .map(str::to_owned)
                }) {
                    deduped_by_hash.entry(hash).or_insert(path);
                }
            }
        }
    }
    let mut found = HashMap::<String, FrameAnalysisTexture>::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let ext = path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(ext.as_str(), "dds" | "jpg" | "jpeg" | "png") {
            continue;
        }
        let Some(hash) = texture_hash(&name) else {
            continue;
        };
        // A deduped target means the resource was materialised by FrameAnalysis
        // and therefore participated in rendering. Without symlink deduplication,
        // a non-empty dumped texture itself is the rendered resource.
        let resolved = deduped_by_hash.get(&hash).cloned().unwrap_or(path);
        if fs::metadata(&resolved)
            .map(|m| m.len() == 0)
            .unwrap_or(true)
        {
            continue;
        }
        let (width, height) = image_size(&resolved);
        let format = dds_format(&resolved).unwrap_or_else(|| "R8G8B8A8_UNORM".into());
        found.entry(hash.clone()).or_insert(FrameAnalysisTexture {
            hash,
            file_name: name,
            path: resolved.to_string_lossy().to_string(),
            width,
            height,
            format,
        });
    }
    let mut result: Vec<_> = found.into_values().collect();
    result.sort_by(|a, b| a.hash.cmp(&b.hash));
    Ok(result)
}

fn tools_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("SSMT4Tools")
        .join("ffmpeg");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn resolve_tool(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let bundled = PathManager::ssmt_resources_folder().join(name);
    if bundled.is_file() {
        return Some(bundled);
    }
    let installed = tools_dir(app)
        .ok()
        .map(|p| p.join(name))
        .filter(|p| p.is_file());
    if installed.is_some() {
        return installed;
    }
    let command_name = name.strip_suffix(".exe").unwrap_or(name);
    let mut command = Command::new(command_name);
    command.arg("-version");
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|_| PathBuf::from(command_name))
}

#[tauri::command]
pub fn texture_mod_ffmpeg_status(app: AppHandle) -> bool {
    resolve_tool(&app, "ffmpeg.exe").is_some() && resolve_tool(&app, "ffprobe.exe").is_some()
}

#[tauri::command]
pub async fn install_texture_mod_ffmpeg(app: AppHandle) -> Result<(), String> {
    let url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
    let bytes = reqwest::get(url)
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    let output = tools_dir(&app)?;
    for tool in ["ffmpeg.exe", "ffprobe.exe"] {
        let index = (0..archive.len())
            .find(|index| {
                archive
                    .by_index(*index)
                    .ok()
                    .and_then(|f| {
                        Path::new(f.name())
                            .file_name()
                            .map(|n| n.eq_ignore_ascii_case(tool))
                    })
                    .unwrap_or(false)
            })
            .ok_or_else(|| format!("{tool} was not found in the downloaded archive"))?;
        let mut source = archive.by_index(index).map_err(|e| e.to_string())?;
        let mut target = fs::File::create(output.join(tool)).map_err(|e| e.to_string())?;
        std::io::copy(&mut source, &mut target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn run_tool(path: &Path, args: &[String]) -> Result<std::process::Output, String> {
    let mut command = Command::new(path);
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = command.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(output)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn ensure_generation_active() -> Result<(), String> {
    if GENERATION_CANCELLED.load(Ordering::Relaxed) {
        Err("Texture mod generation cancelled".into())
    } else {
        Ok(())
    }
}

fn run_generation_tool(path: &Path, args: &[String]) -> Result<(), String> {
    ensure_generation_active()?;
    let mut command = Command::new(path);
    command.args(args).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    loop {
        if GENERATION_CANCELLED.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Texture mod generation cancelled".into());
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return if status.success() {
                Ok(())
            } else {
                Err(format!("{} exited with status {status}", path.display()))
            };
        }
        thread::sleep(Duration::from_millis(80));
    }
}

#[tauri::command]
pub fn cancel_texture_mod_generation() {
    GENERATION_CANCELLED.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub async fn texture_mod_media_info(app: AppHandle, path: String) -> Result<MediaInfo, String> {
    let source = PathBuf::from(path.trim());
    if !source.is_file() {
        return Err("Media source does not exist".into());
    }
    if source
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("dds"))
    {
        let (width, height) =
            dds_size(&source).ok_or("The selected source is not a valid DDS texture")?;
        return Ok(MediaInfo {
            width,
            height,
            fps: None,
            duration: None,
        });
    }
    if let Ok((width, height)) = image::image_dimensions(&source) {
        return Ok(MediaInfo {
            width,
            height,
            fps: None,
            duration: None,
        });
    }
    let ffprobe = resolve_tool(&app, "ffprobe.exe").ok_or("ffprobe is not installed")?;
    let args = vec![
        "-v".into(),
        "error".into(),
        "-select_streams".into(),
        "v:0".into(),
        "-show_entries".into(),
        "stream=width,height,avg_frame_rate:format=duration".into(),
        "-of".into(),
        "json".into(),
        source.to_string_lossy().to_string(),
    ];
    let value: serde_json::Value =
        serde_json::from_slice(&run_tool(&ffprobe, &args)?.stdout).map_err(|e| e.to_string())?;
    let stream = value["streams"]
        .as_array()
        .and_then(|v| v.first())
        .ok_or("No video stream found")?;
    let rate = stream["avg_frame_rate"]
        .as_str()
        .unwrap_or("0/1")
        .split_once('/')
        .and_then(|(a, b)| Some(a.parse::<f64>().ok()? / b.parse::<f64>().ok()?))
        .filter(|v| v.is_finite() && *v > 0.0);
    Ok(MediaInfo {
        width: stream["width"].as_u64().unwrap_or(0) as u32,
        height: stream["height"].as_u64().unwrap_or(0) as u32,
        fps: rate,
        duration: value["format"]["duration"]
            .as_str()
            .and_then(|v| v.parse().ok()),
    })
}

#[tauri::command]
pub async fn prepare_texture_mod_preview(
    app: AppHandle,
    source_path: String,
) -> Result<String, String> {
    let source = PathBuf::from(source_path.trim());
    if !source.is_file() {
        return Err("Preview source does not exist".into());
    }
    if source
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("dds"))
    {
        let cache = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("texture-mod-preview");
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let args = vec![
            source.to_string_lossy().to_string(),
            "-ft".into(),
            "png".into(),
            "-o".into(),
            cache.to_string_lossy().to_string(),
            "-y".into(),
        ];
        run_tool(
            &PathManager::ssmt_resources_folder().join("texconv.exe"),
            &args,
        )?;
        return Ok(cache
            .join(source.file_stem().unwrap())
            .with_extension("png")
            .to_string_lossy()
            .to_string());
    }
    Ok(source.to_string_lossy().to_string())
}

fn transform(
    mut image: DynamicImage,
    width: u32,
    height: u32,
    mode: &str,
    flip_h: bool,
    flip_v: bool,
    rotation: u16,
) -> RgbaImage {
    if flip_h {
        image = image.fliph();
    }
    if flip_v {
        image = image.flipv();
    }
    image = match rotation % 360 {
        90 => image.rotate90(),
        180 => image.rotate180(),
        270 => image.rotate270(),
        _ => image,
    };
    let source = image.to_rgba8();
    let (sw, sh) = source.dimensions();
    if mode == "stretch" {
        return imageops::resize(&source, width, height, imageops::FilterType::Lanczos3);
    }
    if mode == "tile" {
        let mut out = ImageBuffer::from_pixel(width, height, Rgba([0, 0, 0, 0]));
        for y in (0..height).step_by(sh.max(1) as usize) {
            for x in (0..width).step_by(sw.max(1) as usize) {
                imageops::overlay(&mut out, &source, x as i64, y as i64);
            }
        }
        return out;
    }
    let scale = if mode == "cover" {
        (width as f64 / sw as f64).max(height as f64 / sh as f64)
    } else if mode == "center" {
        1.0
    } else {
        (width as f64 / sw as f64).min(height as f64 / sh as f64)
    };
    let rw = ((sw as f64 * scale).round() as u32).max(1);
    let rh = ((sh as f64 * scale).round() as u32).max(1);
    let resized = if rw == sw && rh == sh {
        source
    } else {
        imageops::resize(&source, rw, rh, imageops::FilterType::Lanczos3)
    };
    if mode == "cover" {
        return imageops::crop_imm(
            &resized,
            (rw.saturating_sub(width)) / 2,
            (rh.saturating_sub(height)) / 2,
            width.min(rw),
            height.min(rh),
        )
        .to_image();
    }
    let mut out = ImageBuffer::from_pixel(width, height, Rgba([0, 0, 0, 0]));
    imageops::overlay(
        &mut out,
        &resized,
        (width as i64 - rw as i64) / 2,
        (height as i64 - rh as i64) / 2,
    );
    out
}

fn collect_sequence(request: &TextureModRequest) -> Result<Vec<PathBuf>, String> {
    if !request.sequence_files.is_empty() {
        return Ok(request.sequence_files.iter().map(PathBuf::from).collect());
    }
    let directory = PathBuf::from(request.sequence_directory.as_deref().unwrap_or_default());
    if !directory.is_dir() {
        return Err("Image sequence directory does not exist".into());
    }
    let pattern = request.sequence_regex.as_deref().unwrap_or_default();
    let regex = if pattern.is_empty() {
        None
    } else {
        Some(regex::Regex::new(pattern).map_err(|e| format!("Invalid frame filename regex: {e}"))?)
    };
    let mut files: Vec<_> = fs::read_dir(directory)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && regex.as_ref().map_or(true, |r| {
                    r.is_match(&p.file_name().unwrap_or_default().to_string_lossy())
                })
        })
        .filter(|p| {
            matches!(
                p.extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase()
                    .as_str(),
                "dds" | "png" | "jpg" | "jpeg" | "bmp" | "webp"
            )
        })
        .collect();
    files.sort_by_key(|p| natural_key(&p.file_name().unwrap_or_default().to_string_lossy()));
    Ok(files)
}

#[tauri::command]
pub async fn list_texture_mod_sequence(
    folder: String,
    pattern: String,
) -> Result<Vec<String>, String> {
    let request = TextureModRequest {
        target_path: String::new(),
        texture_hash: String::new(),
        source_kind: "sequence".into(),
        source_path: None,
        sequence_files: vec![],
        sequence_directory: Some(folder),
        sequence_regex: Some(pattern),
        output_directory: String::new(),
        mod_name: String::new(),
        fit_mode: "contain".into(),
        flip_vertical: false,
        flip_horizontal: false,
        rotation: 0,
        fps: None,
        frame_step: 1,
        size_percent: 100,
        video_quality: 90,
        loop_mode: "loop".into(),
        trim_start_frame: None,
        trim_end_frame: None,
    };
    Ok(collect_sequence(&request)?
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

fn natural_key(value: &str) -> (String, u64) {
    let number = value
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .unwrap_or(0);
    (
        value
            .chars()
            .filter(|c| !c.is_ascii_digit())
            .collect::<String>(),
        number,
    )
}

fn video_qscale(quality: u8) -> u8 {
    let quality = quality.clamp(1, 100) as u16;
    (31_u16.saturating_sub((quality * 29) / 100)).clamp(2, 31) as u8
}

#[tauri::command]
pub async fn generate_texture_mod(
    app: AppHandle,
    request: TextureModRequest,
) -> Result<String, String> {
    GENERATION_CANCELLED.store(false, Ordering::Relaxed);
    let target = PathBuf::from(request.target_path.trim());
    let (base_width, base_height) =
        dds_size(&target).ok_or("The selected target is not a valid DDS texture")?;
    let target_format = dds_format(&target).ok_or("Unable to determine the target DDS format")?;
    let scale = request.size_percent.clamp(10, 100) as f64 / 100.0;
    let width = ((base_width as f64 * scale).round() as u32).max(1);
    let height = ((base_height as f64 * scale).round() as u32).max(1);
    let output = PathBuf::from(request.output_directory.trim()).join(request.mod_name.trim());
    if output.exists() {
        return Err(format!(
            "Output folder already exists: {}",
            output.display()
        ));
    }
    fs::create_dir_all(&output).map_err(|e| e.to_string())?;
    let temp = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join(format!(
            "texture-mod-{}",
            chrono::Utc::now().timestamp_millis()
        ));
    fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        let mut sources = match request.source_kind.as_str() {
            "sequence" => collect_sequence(&request)?,
            "video" => {
                let ffmpeg = resolve_tool(&app, "ffmpeg.exe").ok_or("ffmpeg is not installed")?;
                let fps = request
                    .fps
                    .filter(|v| *v > 0.0)
                    .ok_or("A positive frame rate is required")?;
                let pattern = temp.join("source_%07d.jpg");
                let start = request.trim_start_frame.unwrap_or(0);
                let end = request.trim_end_frame.unwrap_or(u64::MAX).max(start);
                let filter = format!(
                    "fps={fps},trim=start_frame={start}:end_frame={},setpts=PTS-STARTPTS,select=not(mod(n\\,{}))",
                    end.saturating_add(1),
                    request.frame_step.max(1)
                );
                let args = vec![
                    "-i".into(),
                    request.source_path.clone().unwrap_or_default(),
                    "-vf".into(),
                    filter,
                    "-vsync".into(),
                    "vfr".into(),
                    "-q:v".into(),
                    video_qscale(request.video_quality).to_string(),
                    pattern.to_string_lossy().to_string(),
                    "-y".into(),
                ];
                run_generation_tool(&ffmpeg, &args)?;
                let mut paths: Vec<_> = fs::read_dir(&temp)
                    .map_err(|e| e.to_string())?
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("jpg")))
                    .collect();
                paths.sort();
                paths
            }
            _ => vec![PathBuf::from(
                request.source_path.as_deref().unwrap_or_default(),
            )],
        };
        if request.source_kind == "sequence" {
            sources = sources
                .into_iter()
                .step_by(request.frame_step.max(1) as usize)
                .collect();
        }
        if sources.is_empty() {
            return Err("No source frames matched".into());
        }
        let mut rendered_frames = Vec::with_capacity(sources.len());
        for (index, source) in sources.iter().enumerate() {
            ensure_generation_active()?;
            let readable_source = if source
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("dds"))
            {
                let conversion = temp.join(format!("source-dds-{index:05}"));
                fs::create_dir_all(&conversion).map_err(|e| e.to_string())?;
                let args = vec![
                    source.to_string_lossy().to_string(),
                    "-ft".into(),
                    "png".into(),
                    "-o".into(),
                    conversion.to_string_lossy().to_string(),
                    "-y".into(),
                ];
                run_generation_tool(
                    &PathManager::ssmt_resources_folder().join("texconv.exe"),
                    &args,
                )?;
                conversion
                    .join(source.file_stem().ok_or("DDS source has no filename")?)
                    .with_extension("png")
            } else {
                source.clone()
            };
            let image = image::open(&readable_source)
                .map_err(|e| format!("Failed to read {}: {e}", source.display()))?;
            let rendered = transform(
                image,
                width,
                height,
                &request.fit_mode,
                request.flip_horizontal,
                request.flip_vertical,
                request.rotation,
            );
            let png = temp.join(format!("frame_{:05}.png", index + 1));
            rendered.save(&png).map_err(|e| e.to_string())?;
            rendered_frames.push(png);
        }
        // Starting texconv once per frame dominates short video generation. Batch
        // inputs while keeping each Windows command line comfortably below its limit.
        for frames in rendered_frames.chunks(64) {
            let mut args: Vec<String> = frames
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect();
            args.extend([
                "-ft".into(),
                "dds".into(),
                "-f".into(),
                target_format.clone(),
                "-o".into(),
                output.to_string_lossy().to_string(),
                "-y".into(),
            ]);
            run_generation_tool(
                &PathManager::ssmt_resources_folder().join("texconv.exe"),
                &args,
            )?;
        }
        let animated = sources.len() > 1
            || request.source_kind == "video"
            || request.source_kind == "sequence";
        let ini = if animated {
            dynamic_ini(
                &request.texture_hash,
                sources.len(),
                request.fps.unwrap_or(30.0) / request.frame_step.max(1) as f64,
                &request.loop_mode,
            )
        } else {
            static_ini(&request.texture_hash)
        };
        fs::write(output.join("TextureMod.ini"), ini).map_err(|e| e.to_string())?;
        Ok(())
    })();
    let _ = fs::remove_dir_all(&temp);
    if GENERATION_CANCELLED.load(Ordering::Relaxed) {
        let _ = fs::remove_dir_all(&output);
    }
    result?;
    Ok(output.to_string_lossy().to_string())
}

fn static_ini(hash: &str) -> String {
    format!("[TextureOverride_Texture_{hash}]\r\nhash = {hash}\r\nthis = ResourceTexture_{hash}\r\n\r\n[ResourceTexture_{hash}]\r\nfilename = frame_00001.dds\r\n")
}

fn dynamic_ini(hash: &str, count: usize, fps: f64, loop_mode: &str) -> String {
    let mut lines = vec![
        "[Constants]".into(),
        "global $frame = 1".into(),
        "global $active = 0".into(),
        "global $ticks = 0".into(),
        "".into(),
        "[Present]".into(),
        "post $active = 0".into(),
        format!("if $active == 1"),
        format!("  $ticks = $ticks + {:.4}", fps.clamp(0.01, 240.0)),
        "  if $ticks >= 60".into(),
        "    $ticks = $ticks - 60".into(),
        "    $frame = $frame + 1".into(),
    ];
    if loop_mode == "once" {
        lines.push(format!("    if $frame > {count}"));
        lines.push(format!("      $frame = {count}"));
    } else {
        lines.push(format!("    if $frame > {count}"));
        lines.push("      $frame = 1".into());
    }
    lines.extend([
        "    endif".into(),
        "  endif".into(),
        "endif".into(),
        "".into(),
        format!("[TextureOverride_Texture_{hash}]"),
        format!("hash = {hash}"),
        "run = CommandListTextureFrame".into(),
        "$active = 1".into(),
        "".into(),
        "[CommandListTextureFrame]".into(),
    ]);
    for i in 1..=count {
        lines.push(format!(
            "{} $frame == {i}",
            if i == 1 { "if" } else { "else if" }
        ));
        lines.push(format!("  this = Resource_Frame_{i:05}"));
    }
    lines.extend(["endif".into(), "".into()]);
    for i in 1..=count {
        lines.push(format!("[Resource_Frame_{i:05}]"));
        lines.push(format!("filename = frame_{i:05}.dds"));
        lines.push("".into());
    }
    lines.join("\r\n")
}
