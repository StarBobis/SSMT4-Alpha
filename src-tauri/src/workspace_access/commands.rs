use std::path::PathBuf;

use crate::workspace_access::archive::{
    create_workspace_archive, validate_workspace_archive, ArchiveBuildResult,
    ArchiveValidationReport,
};
use crate::workspace_access::library::{
    download_entry, fetch_index, fetch_metadata, LibraryDownloadResult, LibraryIndexV1,
    PublicMetadataDocument,
};
use crate::workspace_access::models::{
    WorkspaceAccessArchiveRequest, WorkspaceAccessPreflightRequest, WorkspaceAccessPublishRequest,
    WorkspacePreflightReport, WorkspacePublishResult,
};
use crate::workspace_access::transfer::{
    download_archive, import_archive, import_metadata_skeleton, DownloadResult, ImportResult,
};
use crate::workspace_access::upload::{cancel_upload, publish_workspace};
use crate::workspace_access::validate::preflight_workspace;

#[tauri::command]
pub fn workspace_access_preflight(
    request: WorkspaceAccessPreflightRequest,
) -> WorkspacePreflightReport {
    preflight_workspace(&request)
}

#[tauri::command]
pub fn workspace_access_create_archive(
    request: WorkspaceAccessArchiveRequest,
) -> Result<ArchiveBuildResult, String> {
    let output_path = PathBuf::from(request.output_path);
    create_workspace_archive(
        &WorkspaceAccessPreflightRequest {
            workspace_path: request.workspace_path,
            game_preset: request.game_preset,
            workspace_name: request.workspace_name,
        },
        &output_path,
    )
}

#[tauri::command]
pub fn workspace_access_validate_archive(path: String) -> ArchiveValidationReport {
    validate_workspace_archive(&PathBuf::from(path))
}

#[tauri::command]
pub async fn workspace_access_download_archive(
    url: String,
    destination: String,
    expected_sha256: String,
) -> Result<DownloadResult, String> {
    download_archive(&url, &PathBuf::from(destination), &expected_sha256).await
}

#[tauri::command]
pub fn workspace_access_import_archive(
    archive_path: String,
    workspace_base: String,
    workspace_name: String,
    game_preset: String,
) -> Result<ImportResult, String> {
    import_archive(
        &PathBuf::from(archive_path),
        &PathBuf::from(workspace_base),
        &workspace_name,
        &game_preset,
    )
}

#[tauri::command]
pub fn workspace_access_import_metadata_skeleton(
    metadata: crate::workspace_access::models::PortableWorkspaceMetadataV1,
    workspace_base: String,
    workspace_name: String,
) -> Result<ImportResult, String> {
    import_metadata_skeleton(&metadata, &PathBuf::from(workspace_base), &workspace_name)
}

#[tauri::command]
pub async fn workspace_access_publish(
    app: tauri::AppHandle,
    request: WorkspaceAccessPublishRequest,
) -> Result<WorkspacePublishResult, String> {
    use tauri::Emitter;
    publish_workspace(&request, |progress| {
        let _ = app.emit("workspace-access-upload-progress", progress);
    })
    .await
}

#[tauri::command]
pub async fn workspace_access_cancel_upload(
    worker_url: String,
    archive_path: String,
) -> Result<(), String> {
    cancel_upload(&worker_url, &PathBuf::from(archive_path)).await
}

#[tauri::command]
pub async fn workspace_access_fetch_index(
    raw_base_url: Option<String>,
    game_preset: String,
) -> Result<LibraryIndexV1, String> {
    fetch_index(raw_base_url.as_deref(), &game_preset).await
}

#[tauri::command]
pub async fn workspace_access_fetch_metadata(
    raw_base_url: Option<String>,
    metadata_path: String,
) -> Result<PublicMetadataDocument, String> {
    fetch_metadata(raw_base_url.as_deref(), &metadata_path).await
}

#[tauri::command]
pub async fn workspace_access_download_entry(
    worker_url: String,
    entry_id: String,
    destination: String,
    expected_sha256: String,
) -> Result<LibraryDownloadResult, String> {
    download_entry(
        &worker_url,
        &entry_id,
        &PathBuf::from(destination),
        &expected_sha256,
    )
    .await
}
