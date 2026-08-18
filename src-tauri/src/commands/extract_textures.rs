use crate::common::frame_analysis::frameanalysis::FrameAnalysis;
use crate::extract_new::extract_services::ExtractNewService;
use std::path::PathBuf;
use tauri::AppHandle;

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

#[test]
fn tttt() -> Option<i32> {
    Some(1)
}
