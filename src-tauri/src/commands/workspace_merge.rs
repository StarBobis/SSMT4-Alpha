use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMergePreview {
    pub conflicting_hashes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMergeLod {
    pub name: String,
    pub first_lod_name: Option<String>,
    pub second_lod_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMergeResult {
    pub workspace_name: String,
    pub lods: Vec<WorkspaceMergeLod>,
    pub copied_file_count: usize,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceMergeMode {
    Chain,
    Zip,
}

fn workspace_path(base: &Path, name: &str) -> Result<PathBuf, String> {
    let path = Path::new(name.trim());
    if name.trim().is_empty()
        || path.components().count() != 1
        || !matches!(path.components().next(), Some(Component::Normal(_)))
    {
        return Err("Invalid workspace name".to_string());
    }

    let result = base.join(path);
    if !result.is_dir() {
        return Err(format!("Workspace does not exist: {}", name.trim()));
    }
    Ok(result)
}

fn lod_directories(workspace: &Path) -> Result<Vec<String>, String> {
    let mut lods = fs::read_dir(workspace)
        .map_err(|error| format!("Failed to read workspace: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| !name.eq_ignore_ascii_case("Config"))
        .collect::<BTreeSet<_>>();

    let tabs_path = workspace.join("Config").join("WorkPageTabs.json");
    if let Ok(content) = fs::read_to_string(tabs_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(tabs) = json.get("tabs").and_then(serde_json::Value::as_array) {
                for tab in tabs {
                    let Some(name) = tab.get("name").and_then(serde_json::Value::as_str) else {
                        continue;
                    };
                    let path = Path::new(name);
                    if path.components().count() == 1
                        && matches!(path.components().next(), Some(Component::Normal(_)))
                        && !name.eq_ignore_ascii_case("Config")
                    {
                        lods.insert(name.to_string());
                    }
                }
            }
        }
    }

    Ok(lods.into_iter().collect())
}

fn hash_from_file_name(name: &str) -> Option<String> {
    let bytes = name.as_bytes();
    let mut start = 0;
    while start < bytes.len() {
        if !bytes[start].is_ascii_hexdigit() {
            start += 1;
            continue;
        }

        let end = bytes[start..]
            .iter()
            .position(|byte| !byte.is_ascii_hexdigit())
            .map(|length| start + length)
            .unwrap_or(bytes.len());
        if end - start == 8 {
            return Some(name[start..end].to_ascii_lowercase());
        }
        start = end + 1;
    }
    None
}

fn collect_hashes_from_text(text: &str, output: &mut HashSet<String>) {
    let bytes = text.as_bytes();
    let mut start = 0;
    while start < bytes.len() {
        if !bytes[start].is_ascii_hexdigit() {
            start += 1;
            continue;
        }
        let end = bytes[start..]
            .iter()
            .position(|byte| !byte.is_ascii_hexdigit())
            .map(|length| start + length)
            .unwrap_or(bytes.len());
        if end - start == 8 {
            output.insert(text[start..end].to_ascii_lowercase());
        }
        start = end + 1;
    }
}

fn collect_draw_ib_hashes_from_json(value: &serde_json::Value, output: &mut HashSet<String>) {
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                collect_draw_ib_hashes_from_json(item, output);
            }
        }
        serde_json::Value::Object(fields) => {
            for (key, value) in fields {
                let normalized_key = key.replace(['_', '-'], "").to_ascii_lowercase();
                if normalized_key == "drawib" {
                    if let serde_json::Value::String(hash) = value {
                        collect_hashes_from_text(hash, output);
                    }
                }
                collect_draw_ib_hashes_from_json(value, output);
            }
        }
        _ => {}
    }
}

fn collect_draw_ib_hashes(root: &Path, output: &mut HashSet<String>) -> Result<(), String> {
    for entry in
        fs::read_dir(root).map_err(|error| format!("Failed to read workspace files: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Failed to read workspace entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to read file type: {error}"))?;
        if file_type.is_dir() {
            collect_draw_ib_hashes(&entry.path(), output)?;
        } else if file_type.is_file() {
            if source_path_extension_is_json(&entry.path()) {
                if let Ok(content) = fs::read_to_string(entry.path()) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        collect_draw_ib_hashes_from_json(&json, output);
                    }
                }
            }
        }
    }
    Ok(())
}

fn source_path_extension_is_json(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
}

fn workspace_draw_ib_hashes(workspace: &Path) -> Result<HashSet<String>, String> {
    let mut hashes = HashSet::new();
    collect_draw_ib_hashes(workspace, &mut hashes)?;
    Ok(hashes)
}

#[tauri::command]
pub fn workspace_merge_preview(
    workspace_base: String,
    first_workspace_name: String,
    second_workspace_name: String,
) -> Result<WorkspaceMergePreview, String> {
    let base = PathBuf::from(workspace_base);
    let first = workspace_path(&base, &first_workspace_name)?;
    let second = workspace_path(&base, &second_workspace_name)?;
    if first == second {
        return Err("Select two different workspaces".to_string());
    }

    let first_hashes = workspace_draw_ib_hashes(&first)?;
    let second_hashes = workspace_draw_ib_hashes(&second)?;
    let conflicting_hashes = first_hashes
        .intersection(&second_hashes)
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    Ok(WorkspaceMergePreview { conflicting_hashes })
}

fn copy_lod(
    source: &Path,
    target: &Path,
    source_key: &str,
    preferences: &HashMap<String, String>,
    conflicting_hashes: &HashSet<String>,
    copied_paths: &mut HashSet<PathBuf>,
    copied_file_count: &mut usize,
) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|error| format!("Failed to create merged LOD: {error}"))?;
    for entry in fs::read_dir(source).map_err(|error| format!("Failed to read LOD: {error}"))? {
        let entry = entry.map_err(|error| format!("Failed to read LOD entry: {error}"))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to read file type: {error}"))?;
        if file_type.is_dir() {
            copy_lod(
                &source_path,
                &target_path,
                source_key,
                preferences,
                conflicting_hashes,
                copied_paths,
                copied_file_count,
            )?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }

        if let Some(hash) = hash_from_file_name(&entry.file_name().to_string_lossy()) {
            if conflicting_hashes.contains(&hash)
                && preferences.get(&hash).map(String::as_str) != Some(source_key)
            {
                continue;
            }
        }

        // Common metadata files can exist in both sources. The first source to
        // claim a relative path wins; the UI regenerates the merged LOD configs.
        if !copied_paths.insert(target_path.clone()) {
            continue;
        }
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create output folder: {error}"))?;
        }
        fs::copy(&source_path, &target_path)
            .map_err(|error| format!("Failed to copy workspace file: {error}"))?;
        *copied_file_count += 1;
    }
    Ok(())
}

fn copy_lod_if_present(
    source: &Path,
    target: &Path,
    source_key: &str,
    preferences: &HashMap<String, String>,
    conflicting_hashes: &HashSet<String>,
    copied_paths: &mut HashSet<PathBuf>,
    copied_file_count: &mut usize,
) -> Result<(), String> {
    if source.is_dir() {
        return copy_lod(
            source,
            target,
            source_key,
            preferences,
            conflicting_hashes,
            copied_paths,
            copied_file_count,
        );
    }
    fs::create_dir_all(target).map_err(|error| format!("Failed to create merged LOD: {error}"))
}

#[tauri::command]
pub fn workspace_merge(
    workspace_base: String,
    first_workspace_name: String,
    second_workspace_name: String,
    output_workspace_name: String,
    mode: WorkspaceMergeMode,
    hash_preferences: HashMap<String, String>,
) -> Result<WorkspaceMergeResult, String> {
    let base = PathBuf::from(workspace_base);
    let first = workspace_path(&base, &first_workspace_name)?;
    let second = workspace_path(&base, &second_workspace_name)?;
    if first == second {
        return Err("Select two different workspaces".to_string());
    }

    let output_name = output_workspace_name.trim();
    let output_component = Path::new(output_name);
    if output_name.is_empty()
        || output_component.components().count() != 1
        || !matches!(
            output_component.components().next(),
            Some(Component::Normal(_))
        )
    {
        return Err("Invalid output workspace name".to_string());
    }
    let output = base.join(output_component);
    if output.exists() {
        return Err(format!("Workspace already exists: {output_name}"));
    }

    let first_hashes = workspace_draw_ib_hashes(&first)?;
    let second_hashes = workspace_draw_ib_hashes(&second)?;
    let conflicting_hashes = first_hashes
        .intersection(&second_hashes)
        .cloned()
        .collect::<HashSet<_>>();
    for hash in &conflicting_hashes {
        match hash_preferences.get(hash).map(String::as_str) {
            Some("first") | Some("second") => {}
            _ => return Err(format!("Choose a source for hash {hash}")),
        }
    }

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock error: {error}"))?
        .as_nanos();
    let temporary = base.join(format!(".ssmt-merge-{nonce}"));
    fs::create_dir(&temporary)
        .map_err(|error| format!("Failed to create merge workspace: {error}"))?;

    let build_result = (|| {
        let first_lods = lod_directories(&first)?;
        let second_lods = lod_directories(&second)?;
        let mut lods = Vec::new();
        let mut copied_paths = HashSet::new();
        let mut copied_file_count = 0;

        match mode {
            WorkspaceMergeMode::Chain => {
                for (index, source_lod) in first_lods.iter().enumerate() {
                    let name = format!("LOD{index}");
                    copy_lod_if_present(
                        &first.join(source_lod),
                        &temporary.join(&name),
                        "first",
                        &hash_preferences,
                        &conflicting_hashes,
                        &mut copied_paths,
                        &mut copied_file_count,
                    )?;
                    lods.push(WorkspaceMergeLod {
                        name,
                        first_lod_name: Some(source_lod.clone()),
                        second_lod_name: None,
                    });
                }
                let offset = lods.len();
                for (index, source_lod) in second_lods.iter().enumerate() {
                    let name = format!("LOD{}", offset + index);
                    copy_lod_if_present(
                        &second.join(source_lod),
                        &temporary.join(&name),
                        "second",
                        &hash_preferences,
                        &conflicting_hashes,
                        &mut copied_paths,
                        &mut copied_file_count,
                    )?;
                    lods.push(WorkspaceMergeLod {
                        name,
                        first_lod_name: None,
                        second_lod_name: Some(source_lod.clone()),
                    });
                }
            }
            WorkspaceMergeMode::Zip => {
                let names = first_lods
                    .iter()
                    .chain(second_lods.iter())
                    .cloned()
                    .collect::<BTreeSet<_>>();
                for name in names {
                    let first_lod_name = first_lods
                        .iter()
                        .find(|lod| lod.eq_ignore_ascii_case(&name))
                        .cloned();
                    let second_lod_name = second_lods
                        .iter()
                        .find(|lod| lod.eq_ignore_ascii_case(&name))
                        .cloned();
                    if let Some(source_lod) = &first_lod_name {
                        copy_lod_if_present(
                            &first.join(source_lod),
                            &temporary.join(&name),
                            "first",
                            &hash_preferences,
                            &conflicting_hashes,
                            &mut copied_paths,
                            &mut copied_file_count,
                        )?;
                    }
                    if let Some(source_lod) = &second_lod_name {
                        copy_lod_if_present(
                            &second.join(source_lod),
                            &temporary.join(&name),
                            "second",
                            &hash_preferences,
                            &conflicting_hashes,
                            &mut copied_paths,
                            &mut copied_file_count,
                        )?;
                    }
                    lods.push(WorkspaceMergeLod {
                        name,
                        first_lod_name,
                        second_lod_name,
                    });
                }
            }
        }
        Ok::<_, String>((lods, copied_file_count))
    })();

    let (lods, copied_file_count) = match build_result {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_dir_all(&temporary);
            return Err(error);
        }
    };
    fs::rename(&temporary, &output).map_err(|error| {
        let _ = fs::remove_dir_all(&temporary);
        format!("Failed to finalize merged workspace: {error}")
    })?;

    Ok(WorkspaceMergeResult {
        workspace_name: output_name.to_string(),
        lods,
        copied_file_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_merge_keeps_the_selected_hash_source() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is available")
            .as_nanos();
        let base = std::env::temp_dir().join(format!("ssmt-workspace-merge-test-{nonce}"));
        let first_lod = base.join("first").join("LOD0");
        let second_lod = base.join("second").join("LOD0");
        fs::create_dir_all(&first_lod).expect("create first workspace");
        fs::create_dir_all(&second_lod).expect("create second workspace");
        fs::write(
            first_lod.join("DrawIBConfig.json"),
            r#"[{"DrawIB":"aaaaaaaa"}]"#,
        )
        .expect("write first DrawIB config");
        fs::write(
            second_lod.join("DrawIBConfig.json"),
            r#"[{"DrawIB":"aaaaaaaa"}]"#,
        )
        .expect("write second DrawIB config");
        fs::write(first_lod.join("first_aaaaaaaa.buf"), b"first").expect("write first file");
        fs::write(second_lod.join("second_aaaaaaaa.buf"), b"second").expect("write second file");
        fs::write(second_lod.join("second_bbbbbbbb.buf"), b"unique").expect("write unique file");

        let preview = workspace_merge_preview(
            base.to_string_lossy().into_owned(),
            "first".to_string(),
            "second".to_string(),
        )
        .expect("preview merge");
        assert_eq!(preview.conflicting_hashes, vec!["aaaaaaaa"]);

        let result = workspace_merge(
            base.to_string_lossy().into_owned(),
            "first".to_string(),
            "second".to_string(),
            "merged".to_string(),
            WorkspaceMergeMode::Zip,
            HashMap::from([("aaaaaaaa".to_string(), "second".to_string())]),
        )
        .expect("merge workspaces");

        assert_eq!(result.lods.len(), 1);
        assert!(!base.join("merged/LOD0/first_aaaaaaaa.buf").exists());
        assert_eq!(
            fs::read(base.join("merged/LOD0/second_aaaaaaaa.buf")).expect("read selected file"),
            b"second"
        );
        assert!(base.join("merged/LOD0/second_bbbbbbbb.buf").exists());
        fs::remove_dir_all(base).expect("remove test workspace");
    }
}
