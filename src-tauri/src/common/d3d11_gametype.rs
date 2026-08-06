use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::common::d3d11_element::D3D11Element;
use crate::constants::gametype::{ElementName, ExtractTechnique};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct D3D11GameType {
    #[serde(rename = "GameTypeName")]
    pub game_type_name: String,

    #[serde(rename = "GPUPreSkinning")]
    pub gpu_pre_skinning: bool,

    #[serde(rename = "D3D11ElementList")]
    pub d3d11_element_list: Vec<D3D11Element>,

    #[serde(skip_serializing, skip_deserializing)]
    pub category_draw_category_dict: HashMap<String, String>,

    #[serde(skip_serializing, skip_deserializing)]
    pub ordered_category_name_list: Vec<String>,

    #[serde(skip_serializing, skip_deserializing)]
    pub category_slot_dict: HashMap<String, String>,

    #[serde(skip_serializing, skip_deserializing)]
    pub category_topology_dict: HashMap<String, String>,

    #[serde(skip_serializing, skip_deserializing)]
    pub category_stride_dict: HashMap<String, u64>,

    #[serde(skip_serializing, skip_deserializing)]
    pub ordered_full_element_list: Vec<String>,

    #[serde(skip_serializing, skip_deserializing)]
    pub element_name_d3d11_element_dict: HashMap<String, D3D11Element>,
}

impl D3D11GameType {
    pub fn from_parts(
        game_type_name: impl Into<String>,
        d3d11_element_list: Vec<D3D11Element>,
    ) -> Self {
        let mut game_type = Self {
            game_type_name: game_type_name.into(),
            gpu_pre_skinning: false,
            d3d11_element_list,
            category_draw_category_dict: HashMap::new(),
            ordered_category_name_list: Vec::new(),
            category_slot_dict: HashMap::new(),
            category_topology_dict: HashMap::new(),
            category_stride_dict: HashMap::new(),
            ordered_full_element_list: Vec::new(),
            element_name_d3d11_element_dict: HashMap::new(),
        };

        game_type.initialize();
        game_type
    }

    /// 从 JSON 文件加载并初始化。
    pub fn from_json_file<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        println!(
            "Loading D3D11GameType from file: {}",
            path.as_ref().display()
        );

        let path_ref = path.as_ref();
        if !path_ref.exists() {
            return Err(format!("GameType json not found: {}", path_ref.display()));
        }

        let fallback_game_type_name = path_ref
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let content = fs::read_to_string(path_ref).map_err(|e| e.to_string())?;

        #[derive(Deserialize)]
        struct Wrapper {
            #[serde(rename = "GameTypeName", default)]
            game_type_name: Option<String>,
            #[serde(rename = "D3D11ElementList")]
            d3d11_element_list: Vec<D3D11Element>,
        }
        println!(
            "Parsing D3D11GameType JSON content for: {}",
            fallback_game_type_name
        );
        let wrapper: Wrapper = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let game_type_name = wrapper
            .game_type_name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(fallback_game_type_name);
        println!(
            "Parsed {} D3D11Element entries for GameType: {}",
            wrapper.d3d11_element_list.len(),
            game_type_name
        );

        let mut game_type = D3D11GameType {
            game_type_name,
            gpu_pre_skinning: false,
            d3d11_element_list: wrapper.d3d11_element_list,
            category_draw_category_dict: HashMap::new(),
            ordered_category_name_list: Vec::new(),
            category_slot_dict: HashMap::new(),
            category_topology_dict: HashMap::new(),
            category_stride_dict: HashMap::new(),
            ordered_full_element_list: Vec::new(),
            element_name_d3d11_element_dict: HashMap::new(),
        };

        game_type.initialize();
        println!("Initialized D3D11GameType: {}", game_type.game_type_name);
        Ok(game_type)
    }

    /// 初始化各类派生字段（顺序、索引、步长等）。
    pub fn initialize(&mut self) {
        //判定 GPUPreSkinning
        //有BLENDINDICES的一定是GPU-PreSkinning
        //没有BLENDINDICES但有POINTLIST的，也是GPU-PreSkinning，例如APMI中的特殊情况
        self.gpu_pre_skinning = if self.d3d11_element_list.iter().any(|element| {
            element
                .semantic_name
                .trim()
                .eq_ignore_ascii_case(ElementName::BLENDINDICES)
        }) {
            true
        } else {
            self.d3d11_element_list.iter().any(|element| {
                element
                    .extract_technique
                    .trim()
                    .eq_ignore_ascii_case(ExtractTechnique::POINTLIST)
            })
        };

        // 填充分类基础信息
        for element in &self.d3d11_element_list {
            if !self.ordered_category_name_list.contains(&element.category) {
                self.ordered_category_name_list
                    .push(element.category.clone());
            }

            self.category_slot_dict
                .insert(element.category.clone(), element.extract_slot.clone());
            self.category_topology_dict
                .insert(element.category.clone(), element.extract_technique.clone());
            self.category_draw_category_dict
                .insert(element.category.clone(), element.draw_category.clone());
        }

        // 处理 SemanticIndex、ElementName、ByteWidth 填充等
        let mut semantic_name_index: HashMap<String, u64> = HashMap::new();
        let mut updated_elements: Vec<D3D11Element> =
            Vec::with_capacity(self.d3d11_element_list.len());

        for mut element in self.d3d11_element_list.drain(..) {
            let semantic_index = semantic_name_index
                .entry(element.semantic_name.clone())
                .and_modify(|idx| *idx += 1)
                .or_insert(0);
            let semantic_index = *semantic_index;
            element.semantic_index = semantic_index;

            if element.byte_width.is_empty() {
                let bw = get_byte_width_from_format(&element.format);
                element.byte_width = bw.to_string();
            }

            element.element_name = if semantic_index == 0 {
                element.semantic_name.clone()
            } else {
                format!("{}{}", element.semantic_name, semantic_index)
            };

            self.ordered_full_element_list
                .push(element.element_name.clone());
            self.element_name_d3d11_element_dict
                .insert(element.element_name.clone(), element.clone());

            let stride_entry = self
                .category_stride_dict
                .entry(element.category.clone())
                .or_insert(0u64);
            *stride_entry += element.byte_width_int();

            updated_elements.push(element);
        }

        self.d3d11_element_list = updated_elements;
    }

    pub fn get_self_stride(&self) -> u64 {
        self.get_element_list_total_stride(&self.ordered_full_element_list)
    }

    pub fn get_element_list_total_stride(&self, element_name_list: &[String]) -> u64 {
        let mut total = 0;
        for name in element_name_list {
            if let Some(elem) = self.element_name_d3d11_element_dict.get(name) {
                total += elem.byte_width_int();
            }
        }
        total
    }
}

/// 按通道数字解析 ByteWidth，总和所有通道位宽；未知返回 0。
fn get_byte_width_from_format(format: &str) -> u64 {
    let fmt = format.to_lowercase();
    let bytes: u64 = fmt.as_bytes().windows(3).fold(0, |acc, w| {
        if w[1] == b'8' {
            acc + 1
        } else if w[1] == b'3' && w[2] == b'2' {
            acc + 4
        } else if w[1] == b'1' && w[2] == b'6' {
            acc + 2
        } else {
            acc
        }
    });

    if bytes > 0 {
        bytes
    } else {
        0
    }
}
