use std::collections::HashMap;

use crate::common::index_buffer_buf_file::IndexBufferBufFile;

use super::condition::Condition;
use super::ini_core::MigotoAttribute;

#[derive(Debug, Clone, Default)]
pub struct Key {
    pub attr: MigotoAttribute,
    pub condition: Condition,
    pub key_name: String,
    pub back_name: String,
    pub key_type: String,
    pub cycle_variable_name_possible_value_list_map: HashMap<String, Vec<String>>,
    pub active_variable_name_active_value_map: HashMap<String, String>,
}

#[derive(Debug, Clone, Default)]
pub struct DrawIndexed {
    pub auto_draw: bool,
    pub is_instanced: bool,
    pub draw_number: String,
    pub draw_offset_index: String,
    pub draw_start_index: String,
    pub instance_count: String,
    pub start_instance_location: String,
    pub last_line_comment: String,
    pub alias_name: String,
    pub active_condition_list: Vec<Condition>,
}

impl DrawIndexed {
    pub fn to_draw_str(&self) -> String {
        if self.is_instanced {
            return format!(
                "drawindexedinstanced = {},{},{},{},{}",
                self.draw_number,
                self.instance_count,
                self.draw_offset_index,
                self.draw_start_index,
                self.start_instance_location
            );
        }

        format!(
            "drawindexed = {},{},{}",
            self.draw_number, self.draw_offset_index, self.draw_start_index
        )
    }
}

#[derive(Debug, Clone, Default)]
pub struct ResourceReplace {
    pub replace_target: String,
    pub replace_resource_name: String,
    pub active_condition_list: Vec<Condition>,
}

#[derive(Debug, Clone, Default)]
pub struct TextureOverride {
    pub attr: MigotoAttribute,
    pub section_name: String,
    pub index_buffer_hash: String,
    pub resource_replace_list: Vec<ResourceReplace>,
    pub match_priority: String,
    pub handling: String,
    pub match_first_index: String,
    pub draw_indexed_list: Vec<DrawIndexed>,
    pub active_draw_indexed_list: Vec<DrawIndexed>,
    pub ib_resource_name: String,
    pub ib_file_name: String,
    pub ib_file_path: String,
    pub ib_format: String,
    pub ib_buf_file: IndexBufferBufFile,
    pub active_resource_replace_list: Vec<ResourceReplace>,
}

impl TextureOverride {
    pub fn match_first_index_as_i32(&self) -> i32 {
        self.match_first_index.parse::<i32>().unwrap_or(0)
    }
}

#[derive(Debug, Clone, Default)]
pub struct Resource {
    pub attr: MigotoAttribute,
    pub resource_name: String,
    pub resource_type: String,
    pub stride: String,
    pub format: String,
    pub file_name: String,
    pub file_path: String,
}

impl Resource {
    pub fn show(&self) {
        crate::extract_log!("ResourceStride: {}", self.stride);
        crate::extract_log!("ResourceFileName: {}", self.file_name);
        crate::extract_log!("ResourceFilePath: {}", self.file_path);
    }
}

#[derive(Debug, Clone, Default)]
pub struct CommandList {
    pub attr: MigotoAttribute,
    pub command_list_name: String,
    pub resource_replace_list: Vec<ResourceReplace>,
    pub draw_indexed_list: Vec<DrawIndexed>,
    pub run_command_list_name_list: Vec<String>,
}
