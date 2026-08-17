use std::collections::{HashMap, HashSet};

use crate::ini_container::migoto_data_types::condition::Condition;
use crate::ini_container::migoto_data_types::domain::{
    CommandList, DrawIndexed, Key, Resource, ResourceReplace, TextureOverride,
};
use crate::ini_container::migoto_data_types::ini_core::{
    ExpressionValue, IniLineObject, IniSection,
};
use crate::ini_container::migoto_data_types::variable::Variable;

pub struct SectionParsers;

impl SectionParsers {
    fn normalize_command_list_reference(value: String) -> String {
        value.trim().replace('/', "\\").to_ascii_lowercase()
    }

    fn normalize_resource_reference(value: String) -> String {
        let trimmed = value
            .split(';')
            .next()
            .unwrap_or_default()
            .split('#')
            .next()
            .unwrap_or_default()
            .split(',')
            .next()
            .unwrap_or_default()
            .trim();
        trimmed
            .strip_prefix("ref ")
            .or_else(|| trimmed.strip_prefix("copy "))
            .unwrap_or(trimmed)
            .trim()
            .to_string()
    }

    fn normalize_command_key(value: &str) -> String {
        let mut normalized = value.trim().to_string();
        loop {
            let next = normalized
                .strip_prefix("pre ")
                .or_else(|| normalized.strip_prefix("post "))
                .unwrap_or(&normalized)
                .trim()
                .to_string();
            if next == normalized {
                return normalized;
            }
            normalized = next;
        }
    }

    fn parse_command_assignment(read_line: &str) -> Option<(String, String)> {
        let line = IniLineObject::with_delimiter(read_line.to_string(), "=");
        if !line.valid {
            return None;
        }
        Some((
            Self::normalize_command_key(&line.left_str_trim),
            line.right_str_trim,
        ))
    }

    fn is_resource_replace_target(key: &str) -> bool {
        let lower = key.trim();
        let digits = |value: &str| !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit());
        lower == "ib"
            || lower == "this"
            || lower.starts_with("resource")
            || lower.starts_with("vb") && digits(&lower[2..])
            || Self::is_shader_resource_target(lower)
            || (lower.starts_with('o') && digits(&lower[1..]))
            || (lower.starts_with("so") && digits(&lower[2..]))
    }

    fn is_shader_resource_target(key: &str) -> bool {
        let Some((stage, binding)) = key.split_once('-') else {
            return false;
        };
        if !matches!(stage, "vs" | "ps" | "gs" | "hs" | "ds" | "cs") {
            return false;
        }

        for prefix in ["t", "s", "u", "cb"] {
            if let Some(index) = binding.strip_prefix(prefix) {
                return !index.is_empty() && index.chars().all(|ch| ch.is_ascii_digit());
            }
        }
        false
    }

    pub(crate) fn parse_basic_variable_section(section: &IniSection) -> Vec<Variable> {
        let mut parsed_variable_list: Vec<Variable> = Vec::new();

        for read_line in &section.section_line_list {
            let lower_read_line = read_line.trim().to_ascii_lowercase();
            if lower_read_line.starts_with('[') {
                continue;
            }

            let Some(variable_index) = lower_read_line.find('$') else {
                continue;
            };
            let variable_assign_str = lower_read_line[variable_index..].to_string();

            if variable_assign_str.contains('=') {
                let mut split = variable_assign_str.splitn(2, '=');
                let left = split.next().unwrap_or_default().trim().to_string();
                let right = split.next().unwrap_or_default().trim().to_string();

                let variable_name = left.trim_start_matches('$').trim().to_string();
                let expression_value = ExpressionValue::new(right.clone());

                if expression_value.is_pure_value {
                    let var_type = if lower_read_line.starts_with("global") {
                        "global"
                    } else if lower_read_line.starts_with("local") {
                        "local"
                    } else {
                        "normal"
                    };

                    parsed_variable_list.push(Variable::with_value(
                        section.attr.namespace.clone(),
                        variable_name,
                        right,
                        var_type,
                    ));
                } else {
                    parsed_variable_list.push(Variable::with_expression(
                        section.attr.namespace.clone(),
                        variable_name,
                        expression_value,
                        "expression",
                    ));
                }
            } else {
                let variable_name = variable_assign_str
                    .trim()
                    .trim_start_matches('$')
                    .to_string();
                let var_type = if lower_read_line.starts_with("global") {
                    "global"
                } else if lower_read_line.starts_with("local") {
                    "local"
                } else {
                    "normal"
                };
                parsed_variable_list.push(Variable::new(
                    section.attr.namespace.clone(),
                    variable_name,
                    var_type,
                ));
            }
        }

        parsed_variable_list
    }

    pub(crate) fn parse_basic_key_section(section: &IniSection) -> Key {
        let mut out = Key::default();
        out.attr.namespace = section.attr.namespace.clone();

        for read_line in &section.section_line_list {
            let lower_read_line = read_line.trim().to_ascii_lowercase();
            if lower_read_line.starts_with('[') {
                continue;
            }

            if lower_read_line.starts_with("condition") {
                let condition_line = IniLineObject::with_delimiter(lower_read_line.clone(), "=");
                if condition_line.valid {
                    let condition_work_line =
                        IniLineObject::with_delimiter(condition_line.right_str_trim.clone(), "==");
                    if condition_work_line.valid || condition_line.right_str_trim.starts_with('$') {
                        let mut condition = Condition::new(condition_line.right_str_trim.clone());
                        condition.attr.namespace = section.attr.namespace.clone();
                        out.condition = condition;
                    }
                }
            } else if lower_read_line.starts_with("key") {
                let key_line = IniLineObject::with_delimiter(lower_read_line.clone(), "=");
                if key_line.valid {
                    out.key_name = key_line.right_str_trim;
                }
            } else if lower_read_line.starts_with("back") {
                let back_line = IniLineObject::with_delimiter(lower_read_line.clone(), "=");
                if back_line.valid {
                    out.back_name = back_line.right_str_trim;
                }
            } else if lower_read_line.starts_with("type") {
                let type_line = IniLineObject::with_delimiter(lower_read_line.clone(), "=");
                if type_line.valid {
                    out.key_type = type_line.right_str_trim;
                }
            } else if lower_read_line.starts_with('$') {
                let var_line = IniLineObject::with_delimiter(lower_read_line.clone(), "=");
                if var_line.valid {
                    let var_name = var_line.left_str_trim;
                    let var_value_list: Vec<String> = var_line
                        .right_str_trim
                        .split(',')
                        .map(|x| x.trim().to_string())
                        .filter(|x| !x.is_empty())
                        .collect();

                    if var_value_list.len() == 1 {
                        out.active_variable_name_active_value_map
                            .insert(var_name, var_value_list[0].clone());
                    } else if !var_value_list.is_empty() {
                        out.cycle_variable_name_possible_value_list_map
                            .insert(var_name, var_value_list);
                    }
                }
            }
        }

        out
    }

    pub(crate) fn parse_basic_resource_section(section: &IniSection) -> Resource {
        let mut out = Resource::default();
        out.resource_name = section.section_name.clone();
        out.attr.namespace = section.attr.namespace.clone();
        out.attr.logical_namespace = section.attr.logical_namespace.clone();

        for read_line in &section.section_line_list {
            let lower_read_line = read_line.trim().to_ascii_lowercase();
            if lower_read_line.starts_with('[') {
                continue;
            }

            if lower_read_line.starts_with("type") {
                let type_line = IniLineObject::with_delimiter(lower_read_line.clone(), "=");
                if type_line.valid {
                    out.resource_type = type_line.right_str_trim;
                }
            } else if lower_read_line.starts_with("stride") {
                let stride_line = IniLineObject::with_delimiter(lower_read_line.clone(), "=");
                if stride_line.valid {
                    out.stride = stride_line.right_str_trim;
                }
            } else if lower_read_line.starts_with("filename") {
                // keep original line for case-sensitive filename
                let filename_line = IniLineObject::with_delimiter(read_line.clone(), "=");
                if filename_line.valid {
                    out.file_name = filename_line.right_str_trim;
                }
            } else if lower_read_line.starts_with("format") {
                let format_line = IniLineObject::with_delimiter(lower_read_line.clone(), "=");
                if format_line.valid {
                    out.format = format_line.right_str_trim;
                }
            }
        }

        out
    }

    pub(crate) fn parse_basic_commandlist_section(section: &IniSection) -> CommandList {
        let mut out = CommandList::default();
        out.command_list_name = section.section_name.clone();
        out.attr.namespace = section.attr.namespace.clone();
        out.attr.logical_namespace = section.attr.logical_namespace.clone();

        let mut if_level: i32 = 0;
        let mut tmp_active_condition_list: Vec<Condition> = Vec::new();
        let mut last_logic = String::new();
        let mut last_line_comment = String::new();

        for read_line in &section.section_line_list {
            let lower_read_line = read_line.trim().to_ascii_lowercase();

            if lower_read_line.starts_with(';') {
                last_line_comment = lower_read_line.clone();
                continue;
            }

            if lower_read_line.starts_with('[') {
                continue;
            }

            if lower_read_line.starts_with("if") {
                if_level += 1;
                let condition_str = lower_read_line
                    .strip_prefix("if")
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                let mut condition = Condition::new(condition_str);
                condition.attr.namespace = section.attr.namespace.clone();
                tmp_active_condition_list.push(condition);
                last_logic = "if".to_string();
            } else if lower_read_line.starts_with("else if") || lower_read_line.starts_with("elif")
            {
                if last_logic == "endif" {
                    if_level += 1;
                }

                let condition_str = if let Some(rest) = lower_read_line.strip_prefix("else if") {
                    rest.trim().to_string()
                } else {
                    lower_read_line
                        .strip_prefix("elif")
                        .unwrap_or_default()
                        .trim()
                        .to_string()
                };

                let mut condition = Condition::new(condition_str);
                condition.attr.namespace = section.attr.namespace.clone();
                tmp_active_condition_list.clear();
                tmp_active_condition_list.push(condition);
                last_logic = "else if".to_string();
            } else if lower_read_line.starts_with("endif") {
                if_level -= 1;
                if if_level == 0 {
                    tmp_active_condition_list.clear();
                }
                last_logic = "endif".to_string();
            } else if lower_read_line == "else" {
                tmp_active_condition_list.clear();
                last_logic = "else".to_string();
            } else if let Some((key, value)) = Self::parse_command_assignment(&lower_read_line) {
                if key == "drawindexedinstanced" {
                    let draw_param_str = value;
                    let draw_params: Vec<String> = draw_param_str
                        .split(',')
                        .map(|x| x.trim().to_string())
                        .collect();

                    let mut draw = DrawIndexed {
                        is_instanced: true,
                        ..DrawIndexed::default()
                    };
                    if draw_params.len() >= 5 {
                        draw.auto_draw = false;
                        draw.draw_number = draw_params[0].clone();
                        draw.instance_count = draw_params[1].clone();
                        draw.draw_offset_index = draw_params[2].clone();
                        draw.draw_start_index = draw_params[3].clone();
                        draw.start_instance_location = draw_params[4].clone();
                    } else if draw_param_str == "skip" {
                        draw.draw_number = "0".to_string();
                        draw.instance_count = "INSTANCE_COUNT".to_string();
                        draw.draw_offset_index = "0".to_string();
                        draw.draw_start_index = "0".to_string();
                        draw.start_instance_location = "FIRST_INSTANCE".to_string();
                    }

                    if if_level != 0 {
                        draw.active_condition_list = tmp_active_condition_list.clone();
                    }

                    draw.last_line_comment = last_line_comment.clone();
                    last_line_comment.clear();
                    out.draw_indexed_list.push(draw);
                } else if key == "drawindexed" {
                    let draw_param_str = value;
                    let draw_params: Vec<String> = draw_param_str
                        .split(',')
                        .map(|x| x.trim().to_string())
                        .collect();

                    let mut draw = DrawIndexed::default();
                    if draw_params.len() >= 3 {
                        draw.auto_draw = false;
                        draw.draw_number = draw_params[0].clone();
                        draw.draw_offset_index = draw_params[1].clone();
                        draw.draw_start_index = draw_params[2].clone();
                    } else if draw_param_str == "auto" {
                        draw.auto_draw = true;
                    } else if draw_param_str == "skip" {
                        draw.draw_number = "0".to_string();
                        draw.draw_offset_index = "0".to_string();
                        draw.draw_start_index = "0".to_string();
                    }

                    if if_level != 0 {
                        draw.active_condition_list = tmp_active_condition_list.clone();
                    }

                    draw.last_line_comment = last_line_comment.clone();
                    last_line_comment.clear();
                    out.draw_indexed_list.push(draw);
                } else if key == "run" {
                    out.run_command_list_name_list
                        .push(Self::normalize_command_list_reference(value));
                } else if Self::is_resource_replace_target(&key) {
                    let replace_resource_name = Self::normalize_resource_reference(value);
                    if !replace_resource_name.is_empty() && replace_resource_name != "null" {
                        let mut replace = ResourceReplace {
                            replace_target: key,
                            replace_resource_name,
                            ..ResourceReplace::default()
                        };

                        if if_level != 0 {
                            replace.active_condition_list = tmp_active_condition_list.clone();
                        }
                        out.resource_replace_list.push(replace);
                    }
                }
            }
        }

        out
    }

    fn append_command_list_recursive(
        command_list_name: &str,
        global_command_list_map: &HashMap<String, CommandList>,
        seen: &mut HashSet<String>,
        draw_indexed_list: &mut Vec<DrawIndexed>,
        resource_replace_list: &mut Vec<ResourceReplace>,
    ) {
        if !seen.insert(command_list_name.to_string()) {
            return;
        }

        let Some(command_list) = global_command_list_map.get(command_list_name) else {
            return;
        };

        draw_indexed_list.extend(command_list.draw_indexed_list.clone());
        resource_replace_list.extend(command_list.resource_replace_list.clone());

        for nested_name in &command_list.run_command_list_name_list {
            Self::append_command_list_recursive(
                nested_name,
                global_command_list_map,
                seen,
                draw_indexed_list,
                resource_replace_list,
            );
        }
    }

    pub(crate) fn parse_basic_texture_override_section(
        section: &IniSection,
        global_command_list_map: &HashMap<String, CommandList>,
    ) -> TextureOverride {
        let mut out = TextureOverride::default();
        out.attr.namespace = section.attr.namespace.clone();
        out.attr.logical_namespace = section.attr.logical_namespace.clone();

        for read_line in &section.section_line_list {
            let lower_read_line = read_line.trim().to_ascii_lowercase();
            if lower_read_line.starts_with('[') {
                continue;
            }

            if let Some((key, value)) = Self::parse_command_assignment(&lower_read_line) {
                if key == "hash" {
                    out.index_buffer_hash = value;
                } else if key == "match_first_index" {
                    out.match_first_index = value;
                } else if key == "match_priority" {
                    out.match_priority = value;
                } else if key == "handling" {
                    out.handling = value;
                }
            }
        }

        let this_command_list = Self::parse_basic_commandlist_section(section);
        for command_list_name in &this_command_list.run_command_list_name_list {
            Self::append_command_list_recursive(
                command_list_name,
                global_command_list_map,
                &mut HashSet::new(),
                &mut out.draw_indexed_list,
                &mut out.resource_replace_list,
            );
        }
        out.draw_indexed_list
            .extend(this_command_list.draw_indexed_list);
        out.resource_replace_list
            .extend(this_command_list.resource_replace_list);

        if !out.draw_indexed_list.is_empty() && out.match_first_index.is_empty() {
            out.match_first_index = "0".to_string();
        }

        out
    }
}
