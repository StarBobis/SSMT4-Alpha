use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::common::d3d11_element::D3D11Element;
use crate::common::d3d11_gametype::D3D11GameType;
use crate::common::element_buffer::ElementBuffer;
use crate::common::fmt_file::FmtFile;
use crate::constants::gametype::ElementName;
use crate::utils::ssmt_binary_utils::SSMTBinaryUtils;

/// A higher-level vertex model that combines VB bytes and fmt metadata.
///
/// It supports dynamic vertex manipulation (for example POSITION scaling)
/// and can export both `.vb` and `.fmt` output files.
#[derive(Debug, Clone, Default)]
pub struct MigotoModel {
    pub category_buf_file_path_dict: HashMap<String, String>,
    pub d3d11_game_type: D3D11GameType,
    pub element_buffer_list: Vec<ElementBuffer>,
    pub vertex_count: usize,
    pub logic_name: String,
}

impl MigotoModel {
    pub fn new(
        in_category_buf_file_path_dict: HashMap<String, String>,
        in_d3d11_game_type: D3D11GameType,
        logic_name: String,
    ) -> Result<Self, String> {
        let mut element_buffer_list: Vec<ElementBuffer> = Vec::new();

        for category_name in &in_d3d11_game_type.ordered_category_name_list {
            let buf_file_path = in_category_buf_file_path_dict
                .get(category_name)
                .ok_or_else(|| {
                    format!(
                        "Category '{}' is missing in CategoryBufFilePathDict",
                        category_name
                    )
                })?;

            let category_element_buffers = Self::build_category_element_buffers(
                buf_file_path,
                category_name,
                &in_d3d11_game_type,
            )?;
            element_buffer_list.extend(category_element_buffers);
        }

        let vertex_count = element_buffer_list
            .first()
            .map(|eb| eb.element_byte_dict.len())
            .unwrap_or(0);

        Ok(Self {
            category_buf_file_path_dict: in_category_buf_file_path_dict,
            d3d11_game_type: in_d3d11_game_type,
            element_buffer_list,
            vertex_count,
            logic_name,
        })
    }

    fn build_category_element_buffers(
        buf_file_path: &str,
        category_name: &str,
        d3d11_game_type: &D3D11GameType,
    ) -> Result<Vec<ElementBuffer>, String> {
        let category_stride = d3d11_game_type
            .category_stride_dict
            .get(category_name)
            .ok_or_else(|| format!("Category stride not found for '{}'", category_name))?;

        let stride = usize::try_from(*category_stride)
            .map_err(|_| format!("Category stride too large for usize: {}", category_stride))?;

        if stride == 0 {
            return Err(format!(
                "Category '{}' stride must be greater than 0",
                category_name
            ));
        }

        let category_vertex_dict =
            SSMTBinaryUtils::read_binary_file_by_stride(buf_file_path, stride, false)?;

        let category_elements: Vec<D3D11Element> = d3d11_game_type
            .d3d11_element_list
            .iter()
            .filter(|e| e.category == category_name)
            .cloned()
            .collect();

        if category_elements.is_empty() {
            return Err(format!(
                "No D3D11Element found for category '{}' in game type '{}'",
                category_name, d3d11_game_type.game_type_name
            ));
        }

        let mut element_buffers: Vec<ElementBuffer> = Vec::with_capacity(category_elements.len());
        let mut element_maps: Vec<HashMap<usize, Vec<u8>>> =
            vec![HashMap::new(); category_elements.len()];

        for (vertex_index, vertex_bytes) in &category_vertex_dict {
            let mut offset = 0usize;
            for (i, element) in category_elements.iter().enumerate() {
                let bw = usize::try_from(element.byte_width_int()).map_err(|_| {
                    format!("ByteWidth too large for usize: {}", element.byte_width)
                })?;
                let end = offset
                    .checked_add(bw)
                    .ok_or_else(|| "element byte range overflow".to_string())?;

                if end > vertex_bytes.len() {
                    return Err(format!(
						"Element '{}' byte range [{}, {}) out of bounds for category '{}' vertex {} with stride {}",
						element.element_name,
						offset,
						end,
						category_name,
						vertex_index,
						vertex_bytes.len()
					));
                }

                element_maps[i].insert(*vertex_index, vertex_bytes[offset..end].to_vec());
                offset = end;
            }
        }

        for (element, dict) in category_elements.into_iter().zip(element_maps.into_iter()) {
            element_buffers.push(ElementBuffer::new(element, dict));
        }

        Ok(element_buffers)
    }

    pub fn save_to_vb_and_fmt_file<P: AsRef<Path>>(
        &self,
        prefix: &str,
        output_folder: P,
    ) -> Result<(), String> {
        let output_folder_ref = output_folder.as_ref();
        if !output_folder_ref.exists() {
            fs::create_dir_all(output_folder_ref).map_err(|e| e.to_string())?;
        }

        let vb_output_path = output_folder_ref.join(format!("{}.vb", prefix));
        let mut buf_dict_list: Vec<HashMap<usize, Vec<u8>>> = Vec::new();

        for element_buffer in &self.element_buffer_list {
            buf_dict_list.push(element_buffer.element_byte_dict.clone());
        }

        if !buf_dict_list.is_empty() {
            crate::extract_log!("分割后的顶点数: {}", buf_dict_list[0].len());
        }

        let merged_vb0_dict = SSMTBinaryUtils::merge_byte_dicts(buf_dict_list)?;
        let final_vb0 = SSMTBinaryUtils::merge_dictionary_values(merged_vb0_dict);
        fs::write(&vb_output_path, final_vb0).map_err(|e| e.to_string())?;

        let fmt_output_path = output_folder_ref.join(format!("{}.fmt", prefix));
        let mut fmt_file = FmtFile::new(self.d3d11_game_type.clone());
        fmt_file.logic_name = self.logic_name.clone();
        fmt_file.d3d11_element_list = self
            .element_buffer_list
            .iter()
            .map(|eb| eb.d3d11_element.clone())
            .collect();
        fmt_file.output_fmt_file_by_d3d11_element_list(&fmt_output_path)?;

        Ok(())
    }

    pub fn save_vb_overlap<P: AsRef<Path>>(
        &self,
        start_vertex: u64,
        end_vertex: u64,
        prefix: &str,
        output_folder: P,
    ) -> Result<(), String> {
        let output_folder_ref = output_folder.as_ref();
        if !output_folder_ref.exists() {
            fs::create_dir_all(output_folder_ref).map_err(|e| e.to_string())?;
        }

        let mut buf_dict_list: Vec<HashMap<usize, Vec<u8>>> = Vec::new();
        for element_buffer in &self.element_buffer_list {
            let mut overlap_dict: HashMap<usize, Vec<u8>> = HashMap::new();
            for vertex_index in start_vertex..=end_vertex {
                let source_index = vertex_index as usize;
                if let Some(bytes) = element_buffer.element_byte_dict.get(&source_index) {
                    overlap_dict.insert((vertex_index - start_vertex) as usize, bytes.clone());
                }
            }
            buf_dict_list.push(overlap_dict);
        }

        let merged_vb0_dict = SSMTBinaryUtils::merge_byte_dicts(buf_dict_list)?;
        let final_vb0 = SSMTBinaryUtils::merge_dictionary_values(merged_vb0_dict);
        let vb_output_path = output_folder_ref.join(format!("{}.vb", prefix));
        fs::write(&vb_output_path, final_vb0).map_err(|e| e.to_string())?;

        let fmt_output_path = output_folder_ref.join(format!("{}.fmt", prefix));
        let mut fmt_file = FmtFile::new(self.d3d11_game_type.clone());
        fmt_file.logic_name = self.logic_name.clone();
        fmt_file.d3d11_element_list = self
            .element_buffer_list
            .iter()
            .map(|eb| eb.d3d11_element.clone())
            .collect();
        fmt_file.output_fmt_file_by_d3d11_element_list(&fmt_output_path)?;

        Ok(())
    }

    pub fn set_scale(&mut self, scale_x: f32, scale_y: f32, scale_z: f32) -> Result<(), String> {
        let pos_index = self
            .element_buffer_list
            .iter()
            .position(|eb| eb.d3d11_element.semantic_name == ElementName::POSITION)
            .ok_or_else(|| "POSITION element buffer not found".to_string())?;

        let position_buffer = self
            .element_buffer_list
            .get_mut(pos_index)
            .ok_or_else(|| "Failed to access POSITION element buffer".to_string())?;

        let mut new_element_byte_dict: HashMap<usize, Vec<u8>> = HashMap::new();
        for (index, original_position_bytes) in &position_buffer.element_byte_dict {
            if original_position_bytes.len() < 12 {
                return Err(format!(
                    "POSITION bytes length {} is smaller than 12 at index {}",
                    original_position_bytes.len(),
                    index
                ));
            }

            let mut x_bytes = [0u8; 4];
            x_bytes.copy_from_slice(&original_position_bytes[0..4]);
            let mut y_bytes = [0u8; 4];
            y_bytes.copy_from_slice(&original_position_bytes[4..8]);
            let mut z_bytes = [0u8; 4];
            z_bytes.copy_from_slice(&original_position_bytes[8..12]);

            let ox = f32::from_le_bytes(x_bytes) * scale_x;
            let oy = f32::from_le_bytes(y_bytes) * scale_y;
            let oz = f32::from_le_bytes(z_bytes) * scale_z;

            let mut packed = Vec::with_capacity(12);
            packed.extend_from_slice(&ox.to_le_bytes());
            packed.extend_from_slice(&oy.to_le_bytes());
            packed.extend_from_slice(&oz.to_le_bytes());

            new_element_byte_dict.insert(*index, packed);
        }

        position_buffer.element_byte_dict = new_element_byte_dict;
        Ok(())
    }

    pub fn self_divide(&mut self, min_number: i32, max_number: i32) {
        let mut new_element_buffer_list: Vec<ElementBuffer> = Vec::new();

        for element_buffer in &self.element_buffer_list {
            let mut new_dict: HashMap<usize, Vec<u8>> = HashMap::new();

            let start = min_number.max(0) as usize;
            let max_existing = element_buffer.element_byte_dict.len().saturating_sub(1);
            let end = (max_number.max(0) as usize).min(max_existing);

            let mut new_index = 0usize;
            for i in start..=end {
                if let Some(bytes) = element_buffer.element_byte_dict.get(&i) {
                    new_dict.insert(new_index, bytes.clone());
                    new_index += 1;
                }
            }

            new_element_buffer_list.push(ElementBuffer::new(
                element_buffer.d3d11_element.clone(),
                new_dict,
            ));
        }

        self.element_buffer_list = new_element_buffer_list;
        self.vertex_count = self
            .element_buffer_list
            .first()
            .map(|eb| eb.element_byte_dict.len())
            .unwrap_or(0);
    }
}
