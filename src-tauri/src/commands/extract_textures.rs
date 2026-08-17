use crate::common::frame_analysis::frameanalysis::FrameAnalysis;
use crate::extract_new::extract_services::ExtractNewService;
use crate::helper::texture_convert_helper::TextureConvertHelper;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn resolve_lod_workspace_path(workspace_root_path: &str, lod_name: &str) -> Result<String, String> {
    let trimmed_workspace_root_path = workspace_root_path.trim();
    if trimmed_workspace_root_path.is_empty() {
        return Err("workspace_root_path is empty".to_string());
    }

    let trimmed_lod_name = lod_name.trim();
    if trimmed_lod_name.is_empty() {
        return Err("lod_name is empty".to_string());
    }

    Ok(PathBuf::from(trimmed_workspace_root_path)
        .join(trimmed_lod_name)
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub async fn extract_deduped_textures(
    _app: AppHandle,
    frame_analysis_folder: String,
    game_preset: String,
    workspace_root_path: String,
    lod_name: String,
) -> Result<(), String> {
    let fa = FrameAnalysis::new(&frame_analysis_folder)
        .map_err(|e| format!("Failed to read FrameAnalysis data: {}", e))?;

    let lod_workspace_path = resolve_lod_workspace_path(&workspace_root_path, &lod_name)?;

    ExtractNewService::extract_deduped_textures(
        &fa,
        &game_preset,
        &workspace_root_path,
        &lod_workspace_path,
    )?;

    Ok(())
}

#[tauri::command]
pub async fn extract_trianglelist_textures(
    _app: AppHandle,
    frame_analysis_folder: String,
    game_preset: String,
    workspace_root_path: String,
    lod_name: String,
) -> Result<(), String> {
    let fa = FrameAnalysis::new(&frame_analysis_folder)
        .map_err(|e| format!("Failed to read FrameAnalysis data: {}", e))?;

    let lod_workspace_path = resolve_lod_workspace_path(&workspace_root_path, &lod_name)?;

    ExtractNewService::extract_trianglelist_textures(
        &fa,
        &game_preset,
        &workspace_root_path,
        &lod_workspace_path,
    )?;

    Ok(())
}

#[tauri::command]
pub async fn prepare_dds_webgl_preview(
    app: AppHandle,
    source_path: String,
) -> Result<String, String> {
    let source = Path::new(source_path.trim());
    if !source.is_file() || !source.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("dds")) {
        return Err("DDS preview source does not exist or is not a DDS file".to_string());
    }

    let metadata = std::fs::metadata(source).map_err(|error| error.to_string())?;
    let mut hasher = DefaultHasher::new();
    source.to_string_lossy().hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    metadata.modified().ok().hash(&mut hasher);
    let cache_key = format!("{:016x}", hasher.finish());
    let cache_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("SSMT4CachedFolder")
        .join("DdsWebglPreview")
        .join(cache_key);
    std::fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    let output = cache_dir.join(
        source.file_name().ok_or_else(|| "DDS source has no file name".to_string())?,
    );
    if !output.is_file() {
        TextureConvertHelper::convert_texture_to_rgba_dds(
            &source.to_string_lossy(),
            &cache_dir.to_string_lossy(),
        )?;
    }
    if !output.is_file() {
        return Err("DirectXTex did not create the DDS preview cache".to_string());
    }
    Ok(output.to_string_lossy().to_string())
}
