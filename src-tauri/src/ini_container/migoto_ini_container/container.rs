use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::section_parsers::SectionParsers;
use crate::ini_container::migoto_data_types::domain::{
    CommandList, Key, Resource, TextureOverride,
};
use crate::ini_container::migoto_data_types::ini_core::IniSection;
use crate::ini_container::migoto_data_types::variable::Variable;

#[derive(Debug, Clone, Default)]
pub struct MigotoIniContainer {
    pub migoto_section_line_list: Vec<IniSection>,

    pub global_m_variable_list: Vec<Variable>,
    pub global_variable_name_m_variable_map: HashMap<String, Variable>,

    pub global_m_key_list: Vec<Key>,

    pub global_m_resource_list: Vec<Resource>,
    pub global_resource_name_resource_map: HashMap<String, Resource>,

    pub global_m_command_list_list: Vec<CommandList>,
    pub global_command_list_name_command_list_map: HashMap<String, CommandList>,

    pub global_m_texture_override_list: Vec<TextureOverride>,
}

impl MigotoIniContainer {
    fn section_reference_aliases(prefix: &str, namespace: &str, name: &str) -> Vec<String> {
        let name = name.trim().to_ascii_lowercase();
        if name.is_empty() {
            return Vec::new();
        }

        let mut aliases = vec![name.clone()];
        let namespace = namespace.trim().to_ascii_lowercase();
        if !namespace.is_empty() {
            aliases.push(format!("{}\\{}\\{}", prefix, namespace, name));
            if let Some(short_name) = name.strip_prefix(prefix) {
                if !short_name.is_empty() {
                    aliases.push(format!("{}\\{}\\{}", prefix, namespace, short_name));
                }
            }
        }

        aliases
    }

    fn resource_aliases(resource: &Resource) -> Vec<String> {
        Self::section_reference_aliases(
            "resource",
            &resource.attr.logical_namespace,
            &resource.resource_name,
        )
    }

    fn command_list_aliases(command_list: &CommandList) -> Vec<String> {
        let name = command_list.command_list_name.trim();
        if name.is_empty() {
            return Vec::new();
        }

        let prefix = if name.starts_with("customshader") {
            "customshader"
        } else {
            "commandlist"
        };
        Self::section_reference_aliases(prefix, &command_list.attr.logical_namespace, name)
    }

    pub fn from_ini_file(ini_file_path: impl AsRef<Path>) -> Result<Self, String> {
        let ini_file_path = ini_file_path.as_ref();
        let migoto_section_line_list =
            Self::parse_basic_parse_migoto_section_line_list(ini_file_path)?;
        Self::from_section_list(migoto_section_line_list)
    }

    pub fn from_ini_files(ini_file_paths: &[PathBuf]) -> Result<Self, String> {
        let mut section_list = Vec::new();
        for ini_file_path in ini_file_paths {
            section_list.extend(Self::parse_basic_parse_migoto_section_line_list(
                ini_file_path,
            )?);
        }

        Self::from_section_list(section_list)
    }

    pub fn from_section_list(migoto_section_line_list: Vec<IniSection>) -> Result<Self, String> {
        let mut out = Self::default();
        out.migoto_section_line_list = migoto_section_line_list.clone();

        for section in &migoto_section_line_list {
            if section.section_name == "constants" {
                let vars = SectionParsers::parse_basic_variable_section(section);
                out.global_m_variable_list.extend(vars);
            }
        }

        for section in &migoto_section_line_list {
            if section.section_name == "present" {
                let vars = SectionParsers::parse_basic_variable_section(section);
                out.global_m_variable_list.extend(vars);
            }
        }

        for var in &out.global_m_variable_list {
            out.global_variable_name_m_variable_map
                .insert(var.variable_name.clone(), var.clone());
        }

        for section in &migoto_section_line_list {
            if section.section_name.starts_with("key") {
                let key = SectionParsers::parse_basic_key_section(section);
                out.global_m_key_list.push(key);
            }
        }

        for section in &migoto_section_line_list {
            if section.section_name.starts_with("resource") {
                let resource = SectionParsers::parse_basic_resource_section(section);
                for alias in Self::resource_aliases(&resource) {
                    out.global_resource_name_resource_map
                        .insert(alias, resource.clone());
                }
                out.global_m_resource_list.push(resource);
            }
        }

        for section in &migoto_section_line_list {
            if section.section_name.starts_with("commandlist")
                || section.section_name.starts_with("customshader")
            {
                let command_list = SectionParsers::parse_basic_commandlist_section(section);
                for alias in Self::command_list_aliases(&command_list) {
                    out.global_command_list_name_command_list_map
                        .insert(alias, command_list.clone());
                }
                out.global_m_command_list_list.push(command_list);
            }
        }

        for section in &migoto_section_line_list {
            if section.section_name.starts_with("textureoverride") {
                let texture_override = SectionParsers::parse_basic_texture_override_section(
                    section,
                    &out.global_command_list_name_command_list_map,
                );
                out.global_m_texture_override_list.push(texture_override);
            }
        }

        Ok(out)
    }

    pub fn parse_basic_parse_migoto_section_line_list(
        ini_file_path: impl AsRef<Path>,
    ) -> Result<Vec<IniSection>, String> {
        let ini_file_path = ini_file_path.as_ref();
        let content = fs::read_to_string(ini_file_path)
            .map_err(|e| format!("Failed to read ini file {}: {}", ini_file_path.display(), e))?;

        let default_namespace = ini_file_path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let mut out: Vec<IniSection> = Vec::new();
        let mut current_section: Option<IniSection> = None;
        let mut logical_namespace = String::new();

        for read_line in content.lines() {
            let line = read_line.trim_end_matches('\r').to_string();
            let lower_trim = line.trim().to_ascii_lowercase();

            if current_section.is_none()
                && !lower_trim.starts_with(';')
                && !lower_trim.starts_with('#')
                && lower_trim.starts_with("namespace")
            {
                let namespace_line =
                    crate::ini_container::migoto_data_types::ini_core::IniLineObject::with_delimiter(
                        line.trim().to_string(),
                        "=",
                    );
                if namespace_line.valid {
                    logical_namespace = namespace_line.right_str_trim.replace('/', "\\");
                }
                continue;
            }

            if lower_trim.starts_with('[') && lower_trim.ends_with(']') {
                if let Some(section) = current_section.take() {
                    out.push(section);
                }

                let mut sec = IniSection::default();
                sec.attr.namespace = default_namespace.clone();
                sec.attr.logical_namespace = logical_namespace.clone();
                sec.section_name = lower_trim[1..lower_trim.len() - 1].to_string();
                if !line.trim().is_empty() {
                    sec.section_line_list.push(line);
                }
                current_section = Some(sec);
                continue;
            }

            if let Some(sec) = current_section.as_mut() {
                if !line.trim().is_empty() {
                    sec.section_line_list.push(line);
                }
            }
        }

        if let Some(section) = current_section.take() {
            out.push(section);
        }

        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn resolves_namespaced_command_list_runs_across_ini_files() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ssmt4_migoto_ini_container_{suffix}"));
        let ul_dir = root.join("UL");
        let modular_dir = root.join("KatModular");
        fs::create_dir_all(&ul_dir).expect("create UL temp dir");
        fs::create_dir_all(&modular_dir).expect("create modular temp dir");

        let ul_ini = ul_dir.join("KATTHEDEV.ini");
        let command_ini = modular_dir.join("ComponentDrawUL.ini");
        fs::write(
            &ul_ini,
            r#"
namespace = LuciUL

[TextureOverrideComponent3]
hash = 356cc2a3
match_first_index = 51963
run = CommandList\LuciCompDrawUL\DrawComp3
"#,
        )
        .expect("write UL ini");
        fs::write(
            &command_ini,
            r#"
namespace = LuciCompDrawUL

[CommandListDrawComp3]
drawindexed = 12636,51963,0
"#,
        )
        .expect("write commandlist ini");

        let container = MigotoIniContainer::from_ini_files(&[command_ini, ul_ini])
            .expect("parse temp ini files");
        let texture_override = container
            .global_m_texture_override_list
            .iter()
            .find(|item| item.match_first_index == "51963")
            .expect("texture override should be parsed");

        assert_eq!(texture_override.draw_indexed_list.len(), 1);
        assert_eq!(texture_override.draw_indexed_list[0].draw_number, "12636");

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn parses_3dmigoto_command_prefixes_extended_slots_and_nested_runs() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ssmt4_migoto_ini_container_compat_{suffix}"));
        fs::create_dir_all(&root).expect("create temp dir");

        let ini = root.join("compat.ini");
        fs::write(
            &ini,
            r#"
[TextureOverrideMain]
hash = 15fb50a9
match_first_index = 123
pre run = CommandListRoot

[CommandListRoot]
ib = ResourceIndexBuffer
cs-u5 = ResourceCustomShapeKeyValuesRW
Resource\WWMIv1\ModName = ref ResourceModName
run = CommandListNested

[CommandListNested]
; Draw Component 0
drawindexed = 3, 4, 5

[ResourceIndexBuffer]
type = Buffer
format = DXGI_FORMAT_R32_UINT
filename = Meshes/Index.buf

[ResourceCustomShapeKeyValuesRW]
type = RWBuffer

[ResourceModName]
type = Buffer
data = "Name"
"#,
        )
        .expect("write compat ini");

        let container = MigotoIniContainer::from_ini_files(&[ini]).expect("parse compat ini");
        let texture_override = container
            .global_m_texture_override_list
            .iter()
            .find(|item| item.match_first_index == "123")
            .expect("texture override should be parsed");

        assert_eq!(texture_override.draw_indexed_list.len(), 1);
        assert_eq!(texture_override.draw_indexed_list[0].draw_number, "3");
        assert_eq!(texture_override.draw_indexed_list[0].draw_offset_index, "4");
        assert!(texture_override.resource_replace_list.iter().any(|item| {
            item.replace_target == "ib" && item.replace_resource_name == "resourceindexbuffer"
        }));
        assert!(texture_override.resource_replace_list.iter().any(|item| {
            item.replace_target == "cs-u5"
                && item.replace_resource_name == "resourcecustomshapekeyvaluesrw"
        }));
        assert!(texture_override.resource_replace_list.iter().any(|item| {
            item.replace_target == "resource\\wwmiv1\\modname"
                && item.replace_resource_name == "resourcemodname"
        }));

        fs::remove_dir_all(root).ok();
    }
}
