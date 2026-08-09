use std::fs;
use std::path::{Path, PathBuf};

use crate::common::d3d11_gametype::D3D11GameType;
use crate::config::path_manager::PathManager;

/// 运行时读取的数据类型根目录（用户配置目录，安装时由 bundle 同步）。
pub fn runtime_gametype_folder() -> PathBuf {
    PathManager::ssmt_gametype_folder()
}

/// 随包发布的 GameType 根目录（安装包 resources/GameType）。
pub fn bundled_gametype_folder() -> PathBuf {
    PathManager::bundled_gametype_folder()
}

/// 将随包发布的 GameType 同步到用户配置目录。
/// 同名文件直接覆盖（保证新版本的数据类型生效），bundle 中没有的用户文件会保留。
pub fn sync_bundled_gametype_to_config() -> Result<usize, String> {
    let source = bundled_gametype_folder();
    let target = runtime_gametype_folder();
    if !source.is_dir() {
        return Err(format!(
            "Bundled GameType folder not found: {}",
            source.display()
        ));
    }
    sync_folder(&source, &target)
}

fn sync_folder(source: &Path, target: &Path) -> Result<usize, String> {
    fs::create_dir_all(target)
        .map_err(|e| format!("Failed to create GameType folder {}: {e}", target.display()))?;

    let mut copied = 0usize;
    for entry in fs::read_dir(source)
        .map_err(|e| format!("Failed to read GameType source {}: {e}", source.display()))?
    {
        let entry = entry.map_err(|e| format!("Failed to read GameType entry: {e}"))?;
        let from = entry.path();
        let to = target.join(entry.file_name());

        if from.is_dir() {
            copied += sync_folder(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| {
                format!(
                    "Failed to copy GameType file {} -> {}: {e}",
                    from.display(),
                    to.display()
                )
            })?;
            copied += 1;
        }
    }

    Ok(copied)
}

/// 根据游戏名定位用户配置目录下的 GameType 文件夹。
fn external_game_type_folder(game_name: &str) -> Option<PathBuf> {
    let normalized = game_name.trim().to_ascii_uppercase();
    let root = PathManager::ssmt_gametype_folder();

    // IDENTITYV 使用 IdentityV 目录，与 IdentityVNewExtractor / 前端 GamePreset 命名一致。
    if normalized == "IDENTITYV" {
        return Some(root.join("IdentityV"));
    }

    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(folder_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if folder_name.eq_ignore_ascii_case(&normalized) {
                return Some(path);
            }
        }
    }

    let exact = root.join(&normalized);
    exact.is_dir().then_some(exact)
}

/// 从指定 GameType 根目录加载一个游戏的全部 JSON 数据类型。
fn load_game_type_list_from_folder(
    folder: &Path,
    game_name: &str,
) -> Result<Vec<D3D11GameType>, String> {
    if !folder.is_dir() {
        return Err(format!("GameType folder not found: {}", folder.display()));
    }

    let mut json_paths = Vec::new();
    for entry in fs::read_dir(folder)
        .map_err(|e| format!("Failed to read GameType folder {}: {e}", folder.display()))?
    {
        let path = entry
            .map_err(|e| format!("Failed to read GameType entry in {}: {e}", folder.display()))?
            .path();
        let is_json = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("json"))
            .unwrap_or(false);
        if path.is_file() && is_json {
            json_paths.push(path);
        }
    }

    json_paths.sort();

    let mut game_type_list = Vec::new();
    for json_path in json_paths {
        game_type_list.push(D3D11GameType::from_json_file(&json_path)?);
    }

    if game_type_list.is_empty() {
        return Err(format!(
            "No GameType JSON files found in {}",
            folder.display()
        ));
    }

    println!(
        "Loaded {} D3D11GameType entries from JSON files for {}",
        game_type_list.len(),
        game_name
    );
    Ok(game_type_list)
}

/// 从用户配置目录读取一个游戏的数据类型列表（JSON 是唯一数据源）。
pub fn get_game_type_list(game_name: &str) -> Result<Vec<D3D11GameType>, String> {
    let normalized_game_name = game_name.trim().to_ascii_uppercase();
    let Some(folder) = external_game_type_folder(&normalized_game_name) else {
        return Err(format!(
            "GameType folder not found for {} under {}",
            normalized_game_name,
            PathManager::ssmt_gametype_folder().display()
        ));
    };
    load_game_type_list_from_folder(&folder, &normalized_game_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled_gametype_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("GameType")
    }

    #[test]
    fn all_game_type_folders_load_from_json() {
        let root = bundled_gametype_root();
        let mut loaded_any = false;

        for entry in fs::read_dir(&root)
            .expect("bundled GameType folder should exist")
            .flatten()
        {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let has_json = fs::read_dir(&path)
                .map(|entries| {
                    entries.flatten().any(|e| {
                        e.path()
                            .extension()
                            .and_then(|ext| ext.to_str())
                            .map(|ext| ext.eq_ignore_ascii_case("json"))
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false);
            if !has_json {
                continue;
            }

            let folder_name = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            let list = load_game_type_list_from_folder(&path, &folder_name)
                .unwrap_or_else(|error| panic!("{folder_name}: {error}"));
            assert!(!list.is_empty(), "{folder_name} should load JSON types");
            loaded_any = true;
        }

        assert!(loaded_any, "no GameType folders found");
    }

    #[test]
    fn identityv_loads_user_added_split2_type() {
        let folder = bundled_gametype_root().join("IdentityV");
        let list = load_game_type_list_from_folder(&folder, "IdentityV")
            .expect("IdentityV JSON should load");
        assert!(
            list.iter()
                .any(|gt| gt.game_type_name == "CPU_P12_N12_TA12_C4_T8_T1-8_Split2"),
            "IdentityV should include the user-added Split2 type"
        );
    }

    #[test]
    fn sync_folder_copies_overwrites_and_preserves_user_files() {
        let base = std::env::temp_dir().join(format!(
            "ssmt4-gametype-sync-test-{}",
            std::process::id()
        ));
        let source = base.join("source").join("GIMI");
        let target = base.join("target").join("GIMI");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();

        let first = source.join("a.json");
        let second = source.join("b.json");
        fs::write(&first, r#"{"D3D11ElementList":[]}"#).unwrap();
        fs::write(&second, r#"{"D3D11ElementList":[]}"#).unwrap();

        fs::write(target.join("a.json"), "old").unwrap();
        fs::write(target.join("keep.json"), "user").unwrap();

        let copied = sync_folder(&source, &target).expect("sync should succeed");
        assert_eq!(copied, 2);
        assert_eq!(
            fs::read_to_string(target.join("a.json")).unwrap(),
            r#"{"D3D11ElementList":[]}"#
        );
        assert!(target.join("b.json").exists());
        assert_eq!(
            fs::read_to_string(target.join("keep.json")).unwrap(),
            "user"
        );

        let _ = fs::remove_dir_all(&base);
    }
}
