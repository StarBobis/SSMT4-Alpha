use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::workspace_access::transfer::{download_archive, DownloadResult};

const DEFAULT_RAW_BASE: &str =
    "https://raw.githubusercontent.com/Perxenic-Acid/SSMT-WorkSpace_Access-Library/main";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndexV1 {
    pub schema_version: u32,
    pub game_preset: String,
    pub generated_at: String,
    pub entries: Vec<LibraryIndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndexEntry {
    pub entry_id: String,
    pub workspace_name: String,
    pub attribution: String,
    pub attribution_verified: bool,
    pub uploaded_at: String,
    pub captured_at: Option<String>,
    pub draw_ib: Vec<String>,
    pub aliases: Vec<String>,
    pub full_data_available: bool,
    pub full_data_size: u64,
    pub availability: String,
    pub review_state: String,
    pub metadata_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicMetadataDocument {
    pub schema_version: u32,
    pub entry_id: String,
    pub game_preset: String,
    pub workspace_name: String,
    pub uploaded_at: String,
    pub captured_at: Option<String>,
    pub attribution: crate::workspace_access::models::PublicAttribution,
    #[serde(default)]
    pub workspace_aliases: Vec<String>,
    pub lods: Vec<crate::workspace_access::models::PortableLodV1>,
    pub full_data: PublicFullData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicFullData {
    pub available: bool,
    pub sha256: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDownloadResult {
    pub entry_id: String,
    pub archive: DownloadResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IndexCache {
    etag: Option<String>,
    last_modified: Option<String>,
    index: LibraryIndexV1,
}

pub async fn fetch_index(
    raw_base_url: Option<&str>,
    game_preset: &str,
) -> Result<LibraryIndexV1, String> {
    let game_preset = game_preset.trim();
    if game_preset.is_empty() || game_preset.contains(['/', '\\']) {
        return Err("LIBRARY_GAME_PRESET_INVALID".to_string());
    }
    let base = normalize_raw_base(raw_base_url.unwrap_or(DEFAULT_RAW_BASE))?;
    let url = format!("{base}/index/v1/{game_preset}.json");
    let cache_path = index_cache_path(&base, game_preset);
    let cache = read_index_cache(&cache_path).ok().flatten();
    let mut request = reqwest::Client::new().get(url);
    if let Some(etag) = cache.as_ref().and_then(|value| value.etag.as_deref()) {
        request = request.header(reqwest::header::IF_NONE_MATCH, etag);
    }
    if let Some(last_modified) = cache
        .as_ref()
        .and_then(|value| value.last_modified.as_deref())
    {
        request = request.header(reqwest::header::IF_MODIFIED_SINCE, last_modified);
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(_) => {
            return cache
                .map(|value| value.index)
                .ok_or_else(|| "LIBRARY_REQUEST_FAILED".to_string())
        }
    };
    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return cache
            .map(|value| value.index)
            .ok_or_else(|| "LIBRARY_INDEX_INVALID".to_string());
    }
    if !response.status().is_success() {
        return cache
            .map(|value| value.index)
            .ok_or_else(|| "LIBRARY_INDEX_NOT_FOUND".to_string());
    }
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let last_modified = response
        .headers()
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let index = response
        .json::<LibraryIndexV1>()
        .await
        .map_err(|_| "LIBRARY_INDEX_INVALID")?;
    if index.schema_version != 1 || index.game_preset != game_preset {
        return Err("LIBRARY_INDEX_UNSUPPORTED".to_string());
    }
    let _ = write_index_cache(
        &cache_path,
        &IndexCache {
            etag,
            last_modified,
            index: index.clone(),
        },
    );
    Ok(index)
}

fn index_cache_path(base: &str, game_preset: &str) -> PathBuf {
    let mut digest = Sha256::new();
    digest.update(base.as_bytes());
    digest.update(b"\0");
    digest.update(game_preset.as_bytes());
    std::env::temp_dir()
        .join("SSMT")
        .join("WorkspaceLibrary")
        .join(format!("{:x}.json", digest.finalize()))
}

fn read_index_cache(path: &Path) -> Result<Option<IndexCache>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "LIBRARY_INDEX_CACHE_INVALID".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("LIBRARY_INDEX_CACHE_READ_FAILED".to_string()),
    }
}

fn write_index_cache(path: &Path, cache: &IndexCache) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "LIBRARY_INDEX_CACHE_WRITE_FAILED".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "LIBRARY_INDEX_CACHE_WRITE_FAILED")?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(cache).map_err(|_| "LIBRARY_INDEX_CACHE_WRITE_FAILED")?;
    fs::write(&temporary, bytes).map_err(|_| "LIBRARY_INDEX_CACHE_WRITE_FAILED")?;
    fs::rename(temporary, path).map_err(|_| "LIBRARY_INDEX_CACHE_WRITE_FAILED".to_string())
}

pub async fn fetch_metadata(
    raw_base_url: Option<&str>,
    metadata_path: &str,
) -> Result<PublicMetadataDocument, String> {
    if !metadata_path.starts_with("games/")
        || metadata_path.contains(['\\', ':'])
        || metadata_path.contains("..")
    {
        return Err("LIBRARY_METADATA_PATH_INVALID".to_string());
    }
    let base = normalize_raw_base(raw_base_url.unwrap_or(DEFAULT_RAW_BASE))?;
    let response = reqwest::Client::new()
        .get(format!("{base}/{metadata_path}"))
        .send()
        .await
        .map_err(|_| "LIBRARY_REQUEST_FAILED")?;
    if !response.status().is_success() {
        return Err("LIBRARY_METADATA_NOT_FOUND".to_string());
    }
    let metadata = response
        .json::<PublicMetadataDocument>()
        .await
        .map_err(|_| "LIBRARY_METADATA_INVALID")?;
    if metadata.schema_version != 1 {
        return Err("LIBRARY_METADATA_UNSUPPORTED".to_string());
    }
    Ok(metadata)
}

pub async fn download_entry(
    worker_url: &str,
    entry_id: &str,
    destination: &std::path::Path,
    expected_sha256: &str,
) -> Result<LibraryDownloadResult, String> {
    let worker = normalize_worker_url(worker_url)?;
    if !is_uuid_like(entry_id) {
        return Err("LIBRARY_ENTRY_ID_INVALID".to_string());
    }
    let response = reqwest::Client::new()
        .get(format!("{worker}/v1/entries/{entry_id}/download"))
        .send()
        .await
        .map_err(|_| "WORKSPACE_SERVICE_UNAVAILABLE")?;
    if !response.status().is_success() {
        return Err("LIBRARY_ENTRY_NOT_AVAILABLE".to_string());
    }
    let body = response
        .json::<DownloadUrl>()
        .await
        .map_err(|_| "WORKSPACE_SERVICE_INVALID_RESPONSE")?;
    let archive = download_archive(&body.url, destination, expected_sha256).await?;
    Ok(LibraryDownloadResult {
        entry_id: entry_id.to_string(),
        archive,
    })
}

#[derive(Debug, Deserialize)]
struct DownloadUrl {
    url: String,
}

fn normalize_raw_base(value: &str) -> Result<String, String> {
    let value = value.trim().trim_end_matches('/');
    if value.starts_with("https://") {
        Ok(value.to_string())
    } else {
        Err("LIBRARY_BASE_URL_INVALID".to_string())
    }
}

fn normalize_worker_url(value: &str) -> Result<String, String> {
    let value = value.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(value).map_err(|_| "WORKSPACE_SERVICE_URL_INVALID")?;
    let local_host = matches!(parsed.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if parsed.scheme() == "https" || (parsed.scheme() == "http" && local_host) {
        Ok(value.to_string())
    } else {
        Err("WORKSPACE_SERVICE_URL_INVALID".to_string())
    }
}

fn is_uuid_like(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn rejects_paths_that_can_escape_public_library_root() {
        assert!(fetch_path_for_test("games/SRMI/entries/a/metadata.json"));
        assert!(!fetch_path_for_test("games/../secrets.json"));
        assert!(!fetch_path_for_test("games\\SRMI\\metadata.json"));
    }

    #[test]
    fn persists_public_index_validators_without_urls_or_credentials() {
        let root = std::env::temp_dir().join(format!(
            "ssmt-workspace-library-cache-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = root.join("index.json");
        let cache = IndexCache {
            etag: Some("etag-value".to_string()),
            last_modified: Some("Wed, 21 Oct 2015 07:28:00 GMT".to_string()),
            index: LibraryIndexV1 {
                schema_version: 1,
                game_preset: "SRMI".to_string(),
                generated_at: "2026-08-14T00:00:00Z".to_string(),
                entries: Vec::new(),
            },
        };
        write_index_cache(&path, &cache).unwrap();
        let loaded = read_index_cache(&path).unwrap().unwrap();
        assert_eq!(loaded.etag.as_deref(), Some("etag-value"));
        assert_eq!(loaded.index.game_preset, "SRMI");
        std::fs::remove_dir_all(root).unwrap();
    }

    fn fetch_path_for_test(path: &str) -> bool {
        path.starts_with("games/") && !path.contains(['\\', ':']) && !path.contains("..")
    }
}
