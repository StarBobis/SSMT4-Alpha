use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::utils::ssmt_command_utils::SSMTCommandUtils;
use crate::utils::ssmt_file_utils::SSMTFileUtils;

pub struct TextureConvertHelper;

const JPG_CHANNEL_EXPORTS: [(&str, &str); 4] = [
    ("_R", "rrr1"),
    ("_G", "ggg1"),
    ("_B", "bbb1"),
    ("_A", "aaa1"),
];

const RGBA_CHANNEL_PREVIEW_SIZE: u32 = 256;

static RGBA_CHANNEL_TEXTURE_EXPORT_ENABLED: AtomicBool = AtomicBool::new(true);

impl TextureConvertHelper {
    pub fn set_rgba_channel_texture_export_enabled(enabled: bool) -> bool {
        RGBA_CHANNEL_TEXTURE_EXPORT_ENABLED.swap(enabled, Ordering::SeqCst)
    }

    pub fn is_rgba_channel_texture_export_enabled() -> bool {
        RGBA_CHANNEL_TEXTURE_EXPORT_ENABLED.load(Ordering::SeqCst)
    }

    pub fn collect_texture_files_recursive(folder: &Path, output: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(folder) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_dir() {
                Self::collect_texture_files_recursive(&path, output);
                continue;
            }

            if !path.is_file() {
                continue;
            }

            if SSMTFileUtils::is_texture_file(&path) {
                output.push(path);
            }
        }
    }

    pub fn convert_all_texture_files_to_target_folder(
        source_folder_path: &str,
        target_folder_path: &str,
    ) -> Result<(), String> {
        let source_folder_path = source_folder_path.replace('\\', "/");
        let target_folder_path = target_folder_path.replace('\\', "/");

        let source_folder = Path::new(&source_folder_path);
        if !source_folder.exists() || !source_folder.is_dir() {
            return Err(format!(
                "Source folder does not exist or is not a directory: {}",
                source_folder_path
            ));
        }

        SSMTFileUtils::create_folder_if_not_exists(&target_folder_path)?;

        let entries = fs::read_dir(source_folder)
            .map_err(|e| format!("Failed to read source folder {}: {}", source_folder_path, e))?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let file_path = entry.path();

            if !file_path.is_file() {
                continue;
            }

            let extension = file_path
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();

            let file_path_str = file_path.to_string_lossy().replace('\\', "/");
            let file_name_lower = file_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();

            if extension == "dds" {
                if file_name_lower.ends_with("typeless.dds") {
                    println!("Skip TYPELESS DDS: {}", file_path_str);
                    continue;
                }

                if let Err(err) =
                    Self::convert_texture_to_jpg_with_channels(&file_path_str, &target_folder_path)
                {
                    // Texconv failure should not break overall extraction progress.
                    println!(
                        "[TextureConvert] texconv failed, skip file: {}\nreason: {}",
                        file_path_str, err
                    );
                }
            } else if extension == "jpg" || extension == "png" {
                let file_name = file_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or_else(|| {
                        format!(
                            "Failed to get file name from path: {}",
                            file_path.to_string_lossy()
                        )
                    })?;

                let target_file_path = Path::new(&target_folder_path).join(file_name);
                let target_file_path_str = target_file_path.to_string_lossy().replace('\\', "/");

                SSMTFileUtils::copy_to_file_if_not_exists(&file_path_str, &target_file_path_str)?;
            }
        }

        Ok(())
    }

    fn convert_texture_to_jpg_with_channels(
        input_file_path: &str,
        output_texture_path: &str,
    ) -> Result<(), String> {
        Self::convert_texture_to_target_fmt(input_file_path, output_texture_path, "jpg")?;

        if !Self::is_rgba_channel_texture_export_enabled() {
            return Ok(());
        }

        for (suffix, swizzle) in JPG_CHANNEL_EXPORTS {
            if let Err(err) = Self::convert_texture_to_target_fmt_with_options(
                input_file_path,
                output_texture_path,
                "jpg",
                Some(suffix),
                Some(swizzle),
                Some((RGBA_CHANNEL_PREVIEW_SIZE, RGBA_CHANNEL_PREVIEW_SIZE)),
            ) {
                println!(
                    "[TextureConvert] texconv channel failed, skip derived file: {}{}.jpg\nreason: {}",
                    input_file_path, suffix, err
                );
            }
        }

        Ok(())
    }

    pub fn convert_texture_to_target_fmt(
        input_file_path: &str,
        output_texture_path: &str,
        target_format: &str,
    ) -> Result<(), String> {
        Self::convert_texture_to_target_fmt_with_options(
            input_file_path,
            output_texture_path,
            target_format,
            None,
            None,
            None,
        )
    }

    pub fn convert_texture_to_target_fmt_with_size(
        input_file_path: &str,
        output_texture_path: &str,
        target_format: &str,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        Self::convert_texture_to_target_fmt_with_options(
            input_file_path,
            output_texture_path,
            target_format,
            None,
            None,
            Some((width, height)),
        )
    }

    fn convert_texture_to_target_fmt_with_options(
        input_file_path: &str,
        output_texture_path: &str,
        target_format: &str,
        file_suffix: Option<&str>,
        swizzle: Option<&str>,
        size: Option<(u32, u32)>,
    ) -> Result<(), String> {
        let source_texture_file_path = input_file_path.replace('\\', "/");
        let target_output_directory = output_texture_path.replace('\\', "/");

        if !Path::new(&source_texture_file_path).exists() {
            return Err(format!(
                "Source texture file does not exist: {}",
                source_texture_file_path
            ));
        }

        if !Path::new(&target_output_directory).exists() {
            fs::create_dir_all(&target_output_directory).map_err(|e| {
                format!(
                    "Failed to create output directory {}: {}",
                    target_output_directory, e
                )
            })?;
        }

        let mut arguments = vec![
            source_texture_file_path.clone(),
            "-ft".to_string(),
            target_format.to_string(),
        ];

        if let Some(file_suffix) = file_suffix {
            arguments.push("-sx".to_string());
            arguments.push(file_suffix.to_string());
        }

        // Match original behavior: for jpg, only keep rgba when source includes BC5_UNORM.
        let use_rgba_channels = if target_format.eq_ignore_ascii_case("jpg") {
            source_texture_file_path.contains("BC5_UNORM")
        } else {
            true
        };

        if use_rgba_channels {
            arguments.push("-f".to_string());
            arguments.push("rgba".to_string());
        }

        if let Some(swizzle) = swizzle {
            arguments.push("-swizzle".to_string());
            arguments.push(swizzle.to_string());
        }

        if let Some((width, height)) = size {
            arguments.push("-w".to_string());
            arguments.push(width.to_string());
            arguments.push("-h".to_string());
            arguments.push(height.to_string());
        }

        arguments.push("-o".to_string());
        arguments.push(target_output_directory);
        arguments.push("-y".to_string());

        SSMTCommandUtils::run_resources_program("texconv.exe", &arguments)?;

        Ok(())
    }
}
