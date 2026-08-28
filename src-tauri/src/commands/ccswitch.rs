use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use std::env;
use std::fs;
use std::path::PathBuf;
use toml::Value as TomlValue;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcswitchProviderImport {
    pub id: String,
    pub name: String,
    pub app_type: String,
    pub protocol: String,
    pub anthropic_auth: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

fn ccswitch_database_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME")) {
        let home = PathBuf::from(home);
        candidates.push(home.join(".cc-switch").join("cc-switch.db"));
        candidates.push(
            home.join("AppData")
                .join("Roaming")
                .join("cc-switch")
                .join("cc-switch.db"),
        );
    }
    if let Some(app_data) = env::var_os("APPDATA") {
        candidates.push(
            PathBuf::from(app_data)
                .join("cc-switch")
                .join("cc-switch.db"),
        );
    }
    candidates
}

fn string_at(value: &Value, paths: &[&[&str]]) -> String {
    paths
        .iter()
        .filter_map(|path| {
            path.iter()
                .try_fold(value, |current, key| current.get(*key))
        })
        .find_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn toml_string_at(value: &TomlValue, paths: &[&[&str]]) -> String {
    paths
        .iter()
        .filter_map(|path| {
            path.iter()
                .try_fold(value, |current, key| current.get(*key))
        })
        .find_map(TomlValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn extract_provider_fields(
    app_type: &str,
    settings: &Value,
) -> (String, String, String, String, String) {
    if app_type == "claude" || app_type == "claude-desktop" {
        let auth_token = string_at(settings, &[&["env", "ANTHROPIC_AUTH_TOKEN"]]);
        let api_key_env = string_at(settings, &[&["env", "ANTHROPIC_API_KEY"]]);
        let uses_bearer = !auth_token.is_empty();
        let base_url = string_at(
            settings,
            &[
                &["env", "ANTHROPIC_BASE_URL"],
                &["env", "base_url"],
                &["baseUrl"],
                &["baseUrl"],
                &["base_url"],
            ],
        );
        let api_key = if !auth_token.is_empty() {
            auth_token
        } else if !api_key_env.is_empty() {
            api_key_env
        } else {
            string_at(settings, &[&["apiKey"], &["api_key"]])
        };
        let model = string_at(
            settings,
            &[
                &["env", "ANTHROPIC_MODEL"],
                &["env", "ANTHROPIC_DEFAULT_SONNET_MODEL"],
                &["model"],
            ],
        );
        let auth = if uses_bearer { "bearer" } else { "x-api-key" };
        return (
            "anthropic".to_string(),
            auth.to_string(),
            base_url,
            api_key,
            model,
        );
    }

    if app_type == "codex" {
        let config = settings
            .get("config")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let auth = settings.get("auth").unwrap_or(&Value::Null);
        let parsed_config = config.parse::<TomlValue>().ok();
        let active_provider = parsed_config
            .as_ref()
            .and_then(|value| value.get("model_provider"))
            .and_then(TomlValue::as_str);
        let active_provider_config = active_provider.and_then(|provider_id| {
            parsed_config
                .as_ref()
                .and_then(|value| value.get("model_providers"))
                .and_then(|providers| providers.get(provider_id))
        });
        let base_url = active_provider_config
            .map(|value| toml_string_at(value, &[&["base_url"], &["baseURL"]]))
            .unwrap_or_default();
        let base_url = if base_url.is_empty() {
            parsed_config
                .as_ref()
                .map(|value| toml_string_at(value, &[&["base_url"], &["openai_base_url"]]))
                .unwrap_or_default()
        } else {
            base_url
        };
        let config_api_key = active_provider_config
            .map(|value| toml_string_at(value, &[&["experimental_bearer_token"], &["api_key"]]))
            .unwrap_or_default();
        let api_key = string_at(
            auth,
            &[
                &["OPENAI_API_KEY"],
                &["api_key"],
                &["apiKey"],
                &["access_token"],
            ],
        );
        let api_key = if !api_key.is_empty() {
            api_key
        } else if !config_api_key.is_empty() {
            config_api_key
        } else {
            parsed_config
                .as_ref()
                .map(|value| toml_string_at(value, &[&["experimental_bearer_token"]]))
                .unwrap_or_default()
        };
        let model = parsed_config
            .as_ref()
            .map(|value| {
                let top_level = toml_string_at(value, &[&["model"]]);
                if !top_level.is_empty() {
                    return top_level;
                }
                active_provider_config
                    .map(|provider| toml_string_at(provider, &[&["model"]]))
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        return (
            "openai".to_string(),
            "bearer".to_string(),
            base_url,
            api_key,
            model,
        );
    }

    let base_url = string_at(
        settings,
        &[
            &["options", "baseURL"],
            &["options", "baseUrl"],
            &["base_url"],
            &["baseUrl"],
            &["apiEndpoint"],
            &["env", "GOOGLE_GEMINI_BASE_URL"],
            &["env", "GEMINI_BASE_URL"],
        ],
    );
    let api_key = string_at(
        settings,
        &[
            &["options", "apiKey"],
            &["apiKey"],
            &["api_key"],
            &["env", "OPENAI_API_KEY"],
            &["env", "GEMINI_API_KEY"],
        ],
    );
    let model = string_at(
        settings,
        &[
            &["model"],
            &["models", "default"],
            &["env", "OPENAI_MODEL"],
            &["env", "GEMINI_MODEL"],
        ],
    );
    (
        "openai".to_string(),
        "bearer".to_string(),
        base_url,
        api_key,
        model,
    )
}

fn read_ccswitch_database(path: &PathBuf) -> Result<Vec<CcswitchProviderImport>, String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("无法打开 CCSwitch 数据库: {error}"))?;
    let mut statement = connection
        .prepare(
            "SELECT id, app_type, name, settings_config FROM providers ORDER BY app_type, name, id",
        )
        .map_err(|error| format!("无法读取 CCSwitch 供应商表: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let app_type: String = row.get(1)?;
            let name: String = row.get(2)?;
            let settings_raw: String = row.get(3)?;
            Ok((id, app_type, name, settings_raw))
        })
        .map_err(|error| format!("无法读取 CCSwitch 供应商记录: {error}"))?;

    let mut providers = Vec::new();
    for row in rows {
        let (id, app_type, name, settings_raw) = row.map_err(|error| error.to_string())?;
        let settings = serde_json::from_str::<Value>(&settings_raw).unwrap_or(Value::Null);
        let (protocol, anthropic_auth, base_url, api_key, model) =
            extract_provider_fields(&app_type, &settings);
        if base_url.is_empty() && api_key.is_empty() && model.is_empty() {
            continue;
        }
        providers.push(CcswitchProviderImport {
            id,
            name,
            app_type,
            protocol,
            anthropic_auth,
            base_url,
            api_key,
            model,
        });
    }
    Ok(providers)
}

#[tauri::command]
pub fn import_ccswitch_providers() -> Result<Vec<CcswitchProviderImport>, String> {
    let path = ccswitch_database_candidates()
        .into_iter()
        .find(|candidate| {
            fs::metadata(candidate)
                .map(|metadata| metadata.is_file())
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            "未找到 CCSwitch 数据库（默认位置：用户目录/.cc-switch/cc-switch.db）".to_string()
        })?;
    read_ccswitch_database(&path)
}

#[cfg(test)]
mod tests {
    use super::extract_provider_fields;
    use serde_json::json;

    #[test]
    fn extracts_nested_codex_provider_credentials() {
        let settings = json!({
            "auth": {},
            "config": r#"
model_provider = "relay"
model = "client-model"

[model_providers.other]
base_url = "https://other.example/v1"

[model_providers.relay]
name = "Relay"
base_url = "https://relay.example/v1"
model = "relay-model"
experimental_bearer_token = "relay-key"
"#
        });

        let (protocol, auth, base_url, api_key, model) =
            extract_provider_fields("codex", &settings);
        assert_eq!(protocol, "openai");
        assert_eq!(auth, "bearer");
        assert_eq!(base_url, "https://relay.example/v1");
        assert_eq!(api_key, "relay-key");
        assert_eq!(model, "client-model");
    }

    #[test]
    fn prefers_anthropic_auth_token_over_api_key() {
        let settings = json!({
            "env": {
                "ANTHROPIC_AUTH_TOKEN": "bearer-key",
                "ANTHROPIC_API_KEY": "api-key",
                "ANTHROPIC_BASE_URL": "https://claude.example",
                "ANTHROPIC_MODEL": "claude-model"
            }
        });

        let (protocol, auth, base_url, api_key, model) =
            extract_provider_fields("claude", &settings);
        assert_eq!(protocol, "anthropic");
        assert_eq!(auth, "bearer");
        assert_eq!(base_url, "https://claude.example");
        assert_eq!(api_key, "bearer-key");
        assert_eq!(model, "claude-model");
    }
}
