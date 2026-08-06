use crate::common::d3d11_gametype::D3D11GameType;
use crate::common::d3d11_gametype_lv2::D3D11GameTypeLv2;
use crate::common::frame_analysis::frameanalysis::FrameAnalysis;
use crate::common::index_buffer_buf_file::IndexBufferBufFile;
use crate::common::index_buffer_txt_file::IndexBufferTxtFile;
use crate::common::vertex_buffer_txt_file::VertexBufferTxtFile;
use crate::config::drawib_config::{DrawIBConfig, DrawIBEntry};
use crate::config::path_manager::PathManager;
use crate::extract_new::extract_services::FullExtractDataTypeFilter;
use crate::helper::mark_texture_helper::{
    get_workspace_component_name_draw_call_index_list_json_path,
    get_workspace_trianglelist_deduped_filename_json_path, ComponentNameDrawCallIndexListJson,
    TrianglelistDedupedFileNameJson, TrianglelistDedupedTextureProperty,
};
use crate::helper::texture_convert_helper::TextureConvertHelper;
use crate::utils::ssmt_binary_utils::SSMTBinaryUtils;
use crate::utils::ssmt_file_utils::SSMTFileUtils;
use crate::utils::ssmt_string_utils::SSMTStringUtils;
use crate::workspace::submesh_json::{
    SubMeshCategoryBuffer, SubMeshD3D11Element, SubMeshIndexBuffer, SubMeshJson,
};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;
use std::path::PathBuf;

pub struct ZZMINewExtractor {
    fa: FrameAnalysis,
    workspace_path: String,
    drawib_config: DrawIBConfig,
    specify_drawib_extract: bool,
    d3d11_gametype_lv2: D3D11GameTypeLv2,
}

impl ZZMINewExtractor {
    fn build_vertex_limit_vb(&self, trianglelist_index: &str) -> String {
        let vb0_file_name = self
            .fa
            .data
            .filter_first_file(&format!("{}-vb0", trianglelist_index), ".txt")
            .unwrap_or_default();
        if vb0_file_name.is_empty() {
            String::new()
        } else {
            vb0_file_name.chars().skip(11).take(8).collect()
        }
    }

    fn build_category_hash_from_buf_file_name(
        &self,
        d3d11_game_type: &D3D11GameType,
        category_name: &str,
        buf_file_name: &str,
    ) -> Result<String, String> {
        let category_slot = d3d11_game_type
            .category_slot_dict
            .get(category_name)
            .ok_or_else(|| format!("Category slot not found for category: {}", category_name))?;
        let start_index = 8usize + category_slot.len();
        let hash: String = buf_file_name.chars().skip(start_index).take(8).collect();
        if hash.len() != 8 {
            return Err(format!(
                "Cannot parse hash from buf file name: {} (category={}, slot={})",
                buf_file_name, category_name, category_slot
            ));
        }
        Ok(hash)
    }

    fn build_submesh_elements_for_category(
        &self,
        d3d11_game_type: &D3D11GameType,
        category_name: &str,
    ) -> Vec<SubMeshD3D11Element> {
        let mut result = Vec::new();
        for element_name in &d3d11_game_type.ordered_full_element_list {
            let Some(element) = d3d11_game_type
                .element_name_d3d11_element_dict
                .get(element_name)
            else {
                continue;
            };
            if element.category == category_name {
                result.push(SubMeshD3D11Element::from_d3d11_element(element));
            }
        }
        result
    }

    fn export_category_buffer(
        &self,
        category_name: &str,
        category_buf_filename: &str,
        gpu_pre_skinning: bool,
        category_output_buf_file_path: &Path,
    ) -> Result<(), String> {
        let category_buf_file_path = self.fa.log.get_deduped_filepath(category_buf_filename);
        if category_buf_file_path.is_empty() {
            return Err(format!(
                "Category {} deduped path is empty: {}",
                category_name, category_buf_filename
            ));
        }

        if gpu_pre_skinning {
            fs::copy(&category_buf_file_path, category_output_buf_file_path).map_err(|e| {
                format!(
                    "Failed to copy category buffer file for category {}: {}",
                    category_name, e
                )
            })?;
            return Ok(());
        }

        let category_txt_filename =
            SSMTFileUtils::get_filename_with_new_extension(category_buf_filename, "txt")?;
        let category_txt_file_path = self.fa.log.get_deduped_filepath(&category_txt_filename);
        if !category_txt_file_path.is_empty() && Path::new(&category_txt_file_path).exists() {
            let metadata = SSMTBinaryUtils::read_migoto_buffer_metadata(&category_txt_file_path)?;
            if metadata.stride > 0 && metadata.vertex_count > 0 {
                let category_buf_bytes = fs::read(&category_buf_file_path).map_err(|e| {
                    format!(
                        "Failed to read category buffer file for category {}: {}",
                        category_name, e
                    )
                })?;
                let read_len = metadata
                    .vertex_count
                    .checked_mul(metadata.stride)
                    .ok_or_else(|| {
                        format!(
                            "Category {} slice length overflow: vertex_count={} stride={}",
                            category_name, metadata.vertex_count, metadata.stride
                        )
                    })?;
                let end = metadata.byte_offset.checked_add(read_len).ok_or_else(|| {
                    format!(
                        "Category {} slice end overflow: byte_offset={} read_len={}",
                        category_name, metadata.byte_offset, read_len
                    )
                })?;
                let sliced_bytes = SSMTBinaryUtils::get_range_bytes(
                    &category_buf_bytes,
                    metadata.byte_offset,
                    end,
                )
                .map_err(|e| {
                    format!(
                        "Failed to slice category buffer for category {}: {}",
                        category_name, e
                    )
                })?;
                fs::write(category_output_buf_file_path, sliced_bytes).map_err(|e| {
                    format!(
                        "Failed to write category buffer file for category {}: {}",
                        category_name, e
                    )
                })?;
                return Ok(());
            }
        }

        fs::copy(&category_buf_file_path, category_output_buf_file_path).map_err(|e| {
            format!(
                "Failed to copy category buffer file for category {}: {}",
                category_name, e
            )
        })?;
        Ok(())
    }

    fn collect_match_first_index_ib_map(
        &self,
        trianglelist_index_list: &[String],
    ) -> Result<BTreeMap<u64, String>, String> {
        let mut result: BTreeMap<u64, String> = BTreeMap::new();
        for trianglelist_index in trianglelist_index_list {
            let ib_file_name = self
                .fa
                .data
                .filter_first_file(&format!("{}-ib", trianglelist_index), ".txt")
                .unwrap_or_default();
            if ib_file_name.is_empty() {
                continue;
            }
            let ib_file_path = self.fa.log.get_deduped_filepath(&ib_file_name);
            if ib_file_path.is_empty() {
                continue;
            }
            let ib_txt_file = IndexBufferTxtFile::new(&ib_file_path, false)?;
            let match_first_index = ib_txt_file.first_index.parse::<u64>().unwrap_or(0);
            result.entry(match_first_index).or_insert(ib_file_name);
        }
        Ok(result)
    }

    fn export_unity_vs_submeshes(
        &self,
        game_preset: &str,
        draw_ib: &str,
        pointlist_index: &str,
        trianglelist_index_list: &[String],
        possible_d3d11_game_type_list: &[D3D11GameType],
    ) -> Result<bool, String> {
        if possible_d3d11_game_type_list.is_empty() {
            return Ok(false);
        }
        let match_first_index_ib_txt_file_name_dict =
            self.collect_match_first_index_ib_map(trianglelist_index_list)?;
        for (match_first_index, ib_file_name) in &match_first_index_ib_txt_file_name_dict {
            println!(
                "MatchFirstIndex: {} IBFileName: {}",
                match_first_index, ib_file_name
            );
        }
        for d3d11_game_type in possible_d3d11_game_type_list {
            let trianglelist_index = self.d3d11_gametype_lv2.filter_trianglelist_index_unity_vs(
                &self.fa.data,
                trianglelist_index_list,
                d3d11_game_type,
            );
            let vertex_limit_vb = self.build_vertex_limit_vb(&trianglelist_index);
            let game_type_folder_name = format!("TYPE_{}", d3d11_game_type.game_type_name);
            for ib_txt_file_name in match_first_index_ib_txt_file_name_dict.values() {
                let per_ib_trianglelist_index: String = ib_txt_file_name.chars().take(6).collect();
                let ib_buf_file_name =
                    SSMTFileUtils::get_filename_with_new_extension(ib_txt_file_name, "buf")?;
                let ib_txt_file_path = self.fa.log.get_deduped_filepath(ib_txt_file_name);
                let ib_buf_file_path = self.fa.log.get_deduped_filepath(&ib_buf_file_name);
                if ib_txt_file_path.is_empty() || ib_buf_file_path.is_empty() {
                    continue;
                }
                let ib_txt_file = IndexBufferTxtFile::new(&ib_txt_file_path, true)?;
                let mut category_buf_filename_map: HashMap<String, String> = HashMap::new();
                for category_name in &d3d11_game_type.ordered_category_name_list {
                    let topology = d3d11_game_type
                        .category_topology_dict
                        .get(category_name)
                        .cloned()
                        .unwrap_or_default();
                    let mut extract_index = per_ib_trianglelist_index.clone();
                    if topology == "pointlist" && !pointlist_index.is_empty() {
                        extract_index = pointlist_index.to_string();
                    }
                    let category_slot = d3d11_game_type
                        .category_slot_dict
                        .get(category_name)
                        .cloned()
                        .unwrap_or_default();
                    let filename_search_str = format!("{}-{}", extract_index, category_slot);
                    let category_buf_filename = self
                        .fa
                        .data
                        .filter_first_file(&filename_search_str, ".buf")?;
                    category_buf_filename_map.insert(category_name.clone(), category_buf_filename);
                }
                let unique_str_folder_name = format!(
                    "{}-{}-{}",
                    draw_ib, ib_txt_file.index_number_count, ib_txt_file.first_index
                );
                let game_type_output_path = PathBuf::from(&self.workspace_path)
                    .join(&unique_str_folder_name)
                    .join(&game_type_folder_name);
                SSMTFileUtils::create_folder_if_not_exists(&game_type_output_path)?;
                let name_prefix = unique_str_folder_name.clone();
                let output_ib_buf_file_path =
                    game_type_output_path.join(format!("{}.ib", name_prefix));
                let mut ib_buf_file =
                    IndexBufferBufFile::from_file(&ib_buf_file_path, &ib_txt_file.format)?;
                ib_buf_file.self_divide(
                    ib_txt_file.first_index.parse::<usize>().unwrap_or(0),
                    ib_txt_file.index_number_count as usize,
                );
                ib_buf_file.save_to_file_uint32(&output_ib_buf_file_path, 0)?;
                for category_name in &d3d11_game_type.ordered_category_name_list {
                    let category_buf_filename = category_buf_filename_map
                        .get(category_name)
                        .cloned()
                        .unwrap_or_default();
                    let category_output_buf_file_path = game_type_output_path
                        .join(format!("{}-{}.buf", name_prefix, category_name));
                    self.export_category_buffer(
                        category_name,
                        &category_buf_filename,
                        d3d11_game_type.gpu_pre_skinning,
                        &category_output_buf_file_path,
                    )?;
                }
                let mut submesh_json = SubMeshJson::new();
                submesh_json.game_preset = game_preset.to_string();
                submesh_json.vertex_limit_vb = vertex_limit_vb.clone();
                submesh_json.work_game_type = d3d11_game_type.game_type_name.clone();
                submesh_json.gpu_pre_skinning = d3d11_game_type.gpu_pre_skinning;
                submesh_json.index_buffer_list.push(SubMeshIndexBuffer {
                    dxgi_format: "DXGI_FORMAT_R32_UINT".to_string(),
                    file_name: format!("{}.ib", name_prefix),
                });
                for category_name in &d3d11_game_type.ordered_category_name_list {
                    let category_buf_filename = category_buf_filename_map
                        .get(category_name)
                        .cloned()
                        .unwrap_or_default();
                    let category_hash = self.build_category_hash_from_buf_file_name(
                        d3d11_game_type,
                        category_name,
                        &category_buf_filename,
                    )?;
                    submesh_json
                        .category_hash_dict
                        .insert(category_name.clone(), category_hash);
                    submesh_json.category_draw_category_map.insert(
                        category_name.clone(),
                        d3d11_game_type
                            .category_draw_category_dict
                            .get(category_name)
                            .cloned()
                            .unwrap_or_default(),
                    );
                    submesh_json
                        .category_buffer_list
                        .push(SubMeshCategoryBuffer {
                            file_name: format!("{}-{}.buf", name_prefix, category_name),
                            buffer_type: "Normal".to_string(),
                            d3d11_element_list: self.build_submesh_elements_for_category(
                                d3d11_game_type,
                                category_name,
                            ),
                        });
                }
                submesh_json
                    .save_to_file(game_type_output_path.join(name_prefix.to_string() + ".json"))?;
            }
        }
        Ok(true)
    }

    pub fn new(
        frame_analysis_folder: &String,
        workspace_path: &String,
        is_full_extract: bool,
    ) -> Result<Self, String> {
        Self::new_internal(frame_analysis_folder, workspace_path, !is_full_extract)
    }

    fn new_internal(
        frame_analysis_folder: &String,
        workspace_path: &String,
        specify_drawib_extract: bool,
    ) -> Result<Self, String> {
        let frame_analysis_dir = PathBuf::from(frame_analysis_folder);
        if !frame_analysis_dir.exists() {
            return Err(format!(
                "FrameAnalysis 文件夹未找到: {}",
                frame_analysis_folder
            ));
        }

        let fa = FrameAnalysis::new(frame_analysis_folder)?;
        let drawib_config = if specify_drawib_extract {
            DrawIBConfig::new_from_workspace(workspace_path)
                .map_err(|e| format!("Failed to read DrawIB config: {}", e))?
        } else {
            DrawIBConfig {
                path: String::new(),
                entries: Vec::new(),
            }
        };

        let gametype_folder_path = PathManager::ssmt_gametype_folder();
        let current_gametype_folder_path = gametype_folder_path.join("ZZMI");
        let d3d11_gametype_lv2 = D3D11GameTypeLv2::new(current_gametype_folder_path)?;

        Ok(Self {
            fa,
            workspace_path: workspace_path.clone(),
            drawib_config,
            specify_drawib_extract,
            d3d11_gametype_lv2,
        })
    }

    pub fn get_possible_gametype_list_unity_vs(
        &self,
        draw_ib: &str,
        pointlist_index: &str,
        trianglelist_index_list: &[String],
    ) -> Result<Vec<D3D11GameType>, String> {
        let mut possible_gametype_list: Vec<D3D11GameType> = Vec::new();
        let mut find_at_least_one_gpu_type = false;

        for d3d11_game_type in self
            .d3d11_gametype_lv2
            .ordered_gpu_cpu_d3d11_gametype_list
            .iter()
        {
            if find_at_least_one_gpu_type && !d3d11_game_type.gpu_pre_skinning {
                println!("自动优化:已经找到了满足条件的GPU类型，所以这个CPU类型就不用判断了");
                continue;
            }

            println!("当前数据类型: {}", d3d11_game_type.game_type_name);

            let trianglelist_index = self.d3d11_gametype_lv2.filter_trianglelist_index_unity_vs(
                &self.fa.data,
                trianglelist_index_list,
                d3d11_game_type,
            );
            println!("TrianglelistIndex: {}", trianglelist_index);

            if trianglelist_index.is_empty() {
                println!("当前GameType无法找到符合槽位存在条件的TrianglelistIndex，跳过此项");
                continue;
            }

            let mut category_buf_filesize_map: HashMap<String, u64> = HashMap::new();
            let mut all_file_exists = true;

            for category_name in d3d11_game_type.ordered_category_name_list.iter() {
                let topology = d3d11_game_type
                    .category_topology_dict
                    .get(category_name)
                    .cloned()
                    .unwrap_or_default();
                let mut extract_index = trianglelist_index.clone();
                if topology == "pointlist" && !pointlist_index.is_empty() {
                    extract_index = pointlist_index.to_string();
                }

                let category_slot = d3d11_game_type
                    .category_slot_dict
                    .get(category_name)
                    .cloned()
                    .unwrap_or_default();

                println!(
                    "当前分类: {} 提取Index: {} 提取槽位: {}",
                    category_name, extract_index, category_slot
                );

                let search_key = format!("{}-{}", extract_index, category_slot);
                let category_buf_file_name = self
                    .fa
                    .data
                    .filter_first_file(&search_key, ".buf")
                    .unwrap_or_default();
                let category_buf_txt_file_name = self
                    .fa
                    .data
                    .filter_first_file(&search_key, ".txt")
                    .unwrap_or_default();
                println!("CategoryBufFileName: {}", category_buf_file_name);

                let category_buf_file_path =
                    self.fa.log.get_deduped_filepath(&category_buf_file_name);
                println!(
                    "Category: {} File: {}",
                    category_name, category_buf_file_path
                );

                if category_buf_file_path.is_empty() || !Path::new(&category_buf_file_path).exists()
                {
                    println!("对应Buffer文件未找到,此数据类型无效。");
                    all_file_exists = false;
                    break;
                }

                let category_buf_txt_file_path = self
                    .fa
                    .log
                    .get_deduped_filepath(&category_buf_txt_file_name);
                if !category_buf_txt_file_name.is_empty() && category_buf_txt_file_path.is_empty() {
                    return Err(format!(
                        "Category {} txt file path is empty: {}",
                        category_name, category_buf_txt_file_name
                    ));
                }
                let file_size = if category_buf_txt_file_name.is_empty()
                    || category_buf_txt_file_path.is_empty()
                {
                    SSMTFileUtils::get_file_size(&category_buf_file_path)?
                } else {
                    if d3d11_game_type.gpu_pre_skinning {
                        SSMTFileUtils::get_file_size(&category_buf_file_path)?
                    } else {
                        SSMTBinaryUtils::get_file_size_from_migoto_txt(&category_buf_txt_file_path)?
                    }
                };
                category_buf_filesize_map.insert(category_name.clone(), file_size);
            }

            if !all_file_exists {
                println!("当前数据类型的部分槽位文件无法找到，跳过此数据类型识别。");
                continue;
            }

            let mut vertex_number: u64 = 0;
            let mut all_match = true;

            for category_name in d3d11_game_type.ordered_category_name_list.iter() {
                let category_stride = d3d11_game_type
                    .category_stride_dict
                    .get(category_name)
                    .copied()
                    .unwrap_or(0);
                let file_size = category_buf_filesize_map
                    .get(category_name)
                    .copied()
                    .unwrap_or(0);

                let tmp_number = if category_stride > 0 {
                    file_size / category_stride
                } else {
                    0
                };

                if tmp_number == 0 {
                    println!("槽位的文件大小不能为0，槽位匹配失败，跳过此数据类型");
                    all_match = false;
                    break;
                }

                if !d3d11_game_type.gpu_pre_skinning {
                    let yu_shu = file_size % category_stride;
                    if yu_shu != 0 {
                        println!("余数不为0: {}，槽位匹配失败", yu_shu);
                        all_match = false;
                        break;
                    }
                }

                if vertex_number == 0 {
                    vertex_number = tmp_number;
                } else if vertex_number != tmp_number {
                    println!(
                        "VertexNumber: {} 当前槽位数量: {}",
                        vertex_number, tmp_number
                    );
                    println!("槽位匹配失败");
                    all_match = false;
                    break;
                } else {
                    println!("{} Match!", category_name);

                    if d3d11_game_type.gpu_pre_skinning
                        && category_name == "Texcoord"
                        && !pointlist_index.is_empty()
                    {
                        let category_slot = d3d11_game_type
                            .category_slot_dict
                            .get(category_name)
                            .cloned()
                            .unwrap_or_default();
                        let txt_search_key = format!("{}-{}", pointlist_index, category_slot);
                        let category_txt_file_name = self
                            .fa
                            .data
                            .filter_first_file(&txt_search_key, ".txt")
                            .unwrap_or_default();

                        if category_txt_file_name.is_empty() {
                            println!("GPU Texcoord 校验失败：txt 文件不存在");
                            all_match = false;
                            break;
                        }

                        let category_txt_file_path =
                            self.fa.log.get_deduped_filepath(&category_txt_file_name);
                        if category_txt_file_path.is_empty()
                            || !Path::new(&category_txt_file_path).exists()
                        {
                            println!("GPU Texcoord 校验失败：txt 路径不存在");
                            all_match = false;
                            break;
                        }

                        let vb_txt_file = VertexBufferTxtFile::new(&category_txt_file_path)?;

                        let mut all_byte_width_match = true;
                        for (element_name, original_element) in
                            d3d11_game_type.element_name_d3d11_element_dict.iter()
                        {
                            if original_element.category != "Texcoord" {
                                continue;
                            }

                            if let Some(txt_element) = vb_txt_file
                                .element_name_d3d11_element_dict
                                .get(element_name)
                            {
                                if original_element.byte_width != txt_element.byte_width {
                                    all_byte_width_match = false;
                                    break;
                                }
                            }
                        }

                        if !all_byte_width_match {
                            let mut vbtxt_data_element_length: u64 = 0;
                            let mut vbtxt_element_number: u64 = 0;

                            for element_name in vb_txt_file.vertex_data_show_element_list.iter() {
                                if let Some(d3d11_element) = vb_txt_file
                                    .element_name_d3d11_element_dict
                                    .get(element_name)
                                {
                                    vbtxt_data_element_length += d3d11_element.byte_width_int();
                                    vbtxt_element_number += 1;
                                }
                            }

                            let mut game_type_element_length: u64 = 0;
                            let mut game_type_element_number: u64 = 0;

                            for original_element in
                                d3d11_game_type.element_name_d3d11_element_dict.values()
                            {
                                if original_element.category != "Texcoord" {
                                    continue;
                                }

                                game_type_element_length += original_element.byte_width_int();
                                game_type_element_number += 1;
                            }

                            if vbtxt_data_element_length != game_type_element_length
                                || vbtxt_element_number != game_type_element_number
                            {
                                println!(
                                    "GPU Texcoord 校验失败：元素ByteWidth和总长度校验均未通过"
                                );
                                all_match = false;
                                break;
                            }
                        }
                    }
                }
            }

            if !d3d11_game_type.gpu_pre_skinning && d3d11_game_type.category_slot_dict.len() == 1 {
                let first_category_name = d3d11_game_type
                    .ordered_category_name_list
                    .get(0)
                    .cloned()
                    .unwrap_or_default();
                let category_slot = d3d11_game_type
                    .category_slot_dict
                    .get(&first_category_name)
                    .cloned()
                    .unwrap_or_default();

                let txt_search_key = format!("{}-{}", trianglelist_index, category_slot);
                let category_txt_file_name = self
                    .fa
                    .data
                    .filter_first_file(&txt_search_key, ".txt")
                    .unwrap_or_default();

                if category_txt_file_name.is_empty() {
                    println!("单分类CPU校验失败：txt 文件不存在");
                    all_match = false;
                } else {
                    let category_txt_file_path =
                        self.fa.log.get_deduped_filepath(&category_txt_file_name);
                    if category_txt_file_path.is_empty()
                        || !Path::new(&category_txt_file_path).exists()
                    {
                        all_match = false;
                    } else {
                        let show_stride = SSMTFileUtils::find_migoto_ini_attribute_in_file(
                            Path::new(&category_txt_file_path),
                            "stride",
                        )?;
                        if !show_stride.trim().is_empty() {
                            let show_stride_count = show_stride.parse::<u64>().unwrap_or(0);
                            let game_type_stride = d3d11_game_type.get_self_stride();
                            if show_stride_count != game_type_stride {
                                println!("单分类CPU校验失败：txt stride 与 GameType stride 不一致");
                                all_match = false;
                            }
                        }
                    }
                }
            }

            if all_match {
                println!("MatchGameType: {}", d3d11_game_type.game_type_name);
                possible_gametype_list.push(d3d11_game_type.clone());
            }

            if !find_at_least_one_gpu_type {
                for gt in possible_gametype_list.iter() {
                    if gt.gpu_pre_skinning {
                        find_at_least_one_gpu_type = true;
                        break;
                    }
                }
            }
        }

        let all_cpu_type = !possible_gametype_list.iter().any(|gt| gt.gpu_pre_skinning);
        if all_cpu_type && !possible_gametype_list.is_empty() {
            let max_category_number = possible_gametype_list
                .iter()
                .map(|gt| gt.category_slot_dict.len())
                .max()
                .unwrap_or(0);

            possible_gametype_list = possible_gametype_list
                .into_iter()
                .filter(|gt| gt.category_slot_dict.len() == max_category_number)
                .collect();
        }

        if possible_gametype_list.is_empty() {
            println!("无法识别 DrawIB {} 对应的数据类型", draw_ib);
        } else {
            println!("All Matched GameType:");
            for gt in possible_gametype_list.iter() {
                println!("{}", gt.game_type_name);
            }
        }

        Ok(possible_gametype_list)
    }

    pub fn extract_fee307b98a965c16(
        &self,
        draw_ib: &str,
        pointlist_index: &str,
        trianglelist_index_list: &[String],
        data_type_filter: FullExtractDataTypeFilter,
    ) -> Result<bool, String> {
        let mut possible_d3d11_game_type_list = self.get_possible_gametype_list_unity_vs(
            draw_ib,
            pointlist_index,
            trianglelist_index_list,
        )?;

        possible_d3d11_game_type_list.retain(|gt| data_type_filter.allows(gt.gpu_pre_skinning));

        self.export_unity_vs_submeshes(
            "ZZMI",
            draw_ib,
            pointlist_index,
            trianglelist_index_list,
            &possible_d3d11_game_type_list,
        )
    }

    pub fn run_extract(
        &mut self,
        data_type_filter: FullExtractDataTypeFilter,
    ) -> Result<(), String> {
        let draw_ib_list = if self.specify_drawib_extract {
            self.drawib_config
                .entries
                .iter()
                .map(|entry| entry.draw_ib.clone())
                .collect::<Vec<String>>()
        } else {
            self.fa.data.get_all_drawib_list()
        };

        for draw_ib in draw_ib_list.iter() {
            println!("DrawIB: {}", draw_ib);

            let pointlist_index = self
                .fa
                .log
                .get_last_pointlist_index_by_hash(&draw_ib)
                .unwrap_or_default();
            println!("PointlistIndex: {:?}", pointlist_index);

            if pointlist_index.is_empty() {
                println!("未找到对应PointlistIndex，该DrawIB可能为CPU-PreSkinning类型");
            }

            let trianglelist_index_list = self.fa.data.get_trianglelist_index_list(&draw_ib);
            for trianglelist_index in trianglelist_index_list.iter() {
                println!("TriangleListIndex: {}", trianglelist_index);
            }

            let extract_success = self.extract_fee307b98a965c16(
                &draw_ib,
                &pointlist_index,
                &trianglelist_index_list,
                data_type_filter,
            )?;

            if !extract_success {
                crate::extract_new::log_skipped_drawib(
                    draw_ib,
                    format!(
                        "no valid data type matched. PointlistIndex: {} TrianglelistIndex: {:?}",
                        pointlist_index, trianglelist_index_list
                    ),
                );
                continue;
            }
        }

        self.sync_zzmi_textures_and_json(draw_ib_list)?;
        Ok(())
    }

    /// ZZMI 专用贴图同步方法。
    ///
    /// 与通用 `sync_workspace_deduped_textures_and_json` 不同，
    /// 本方法使用与模型提取阶段完全相同的 IB 文件选取逻辑
    /// （`collect_match_first_index_ib_map` + BOTH txt/buf 存在检查），
    /// 确保生成的子网格文件夹名与模型提取一致。
    fn sync_zzmi_textures_and_json(&self, draw_ib_list: Vec<String>) -> Result<(), String> {
        use std::collections::BTreeMap;

        let drawib_config = DrawIBConfig {
            path: String::new(),
            entries: draw_ib_list
                .into_iter()
                .map(|draw_ib| DrawIBEntry {
                    draw_ib: draw_ib.clone(),
                    alias: draw_ib,
                })
                .collect(),
        };

        let mut component_drawcall_index_list_dict: HashMap<String, Vec<String>> = HashMap::new();

        for entry in drawib_config.entries.iter() {
            let draw_ib = entry.draw_ib.trim();
            if draw_ib.is_empty() {
                continue;
            }

            let trianglelist_index_list = self.fa.data.get_trianglelist_index_list(draw_ib);
            if trianglelist_index_list.is_empty() {
                continue;
            }

            // 使用与模型提取完全相同的 IB 文件选取逻辑
            let match_first_index_ib_map =
                self.collect_match_first_index_ib_map(&trianglelist_index_list)?;

            let mut first_index_index_count_map: BTreeMap<u64, String> = BTreeMap::new();
            let mut first_index_trianglelist_index_map: BTreeMap<u64, Vec<String>> =
                BTreeMap::new();

            for (&first_index, ib_txt_file_name) in match_first_index_ib_map.iter() {
                let ib_buf_file_name =
                    SSMTFileUtils::get_filename_with_new_extension(ib_txt_file_name, "buf")?;
                let ib_txt_file_path = self.fa.log.get_deduped_filepath(ib_txt_file_name);
                let ib_buf_file_path = self.fa.log.get_deduped_filepath(&ib_buf_file_name);

                // 与 export_unity_vs_submeshes 一致：BOTH txt 和 buf 必须存在
                if ib_txt_file_path.is_empty() || ib_buf_file_path.is_empty() {
                    continue;
                }

                let ib_txt_file = IndexBufferTxtFile::new(&ib_txt_file_path, true)?;
                let submesh_index_count = ib_txt_file.index_number_count.to_string();

                first_index_index_count_map.insert(first_index, submesh_index_count);

                // 收集此 first_index 对应的所有 trianglelist_index
                for tl_idx in &trianglelist_index_list {
                    let search_key = format!("{}-ib", tl_idx);
                    let candidate_ib = self
                        .fa
                        .data
                        .filter_first_file(&search_key, ".txt")
                        .unwrap_or_default();
                    if candidate_ib.is_empty() {
                        continue;
                    }
                    let candidate_path = self.fa.log.get_deduped_filepath(&candidate_ib);
                    if candidate_path.is_empty() {
                        continue;
                    }
                    let candidate_ib_file = IndexBufferTxtFile::new(&candidate_path, false)?;
                    let candidate_first_index =
                        candidate_ib_file.first_index.parse::<u64>().unwrap_or(0);
                    if candidate_first_index == first_index {
                        let list = first_index_trianglelist_index_map
                            .entry(first_index)
                            .or_default();
                        if !list.contains(tl_idx) {
                            list.push(tl_idx.clone());
                        }
                    }
                }
            }

            if match_first_index_ib_map.is_empty() {
                component_drawcall_index_list_dict
                    .insert(draw_ib.to_string(), trianglelist_index_list.clone());
                continue;
            }

            for (first_index, submesh_trianglelist_index_list) in first_index_trianglelist_index_map
            {
                let index_count = first_index_index_count_map
                    .get(&first_index)
                    .cloned()
                    .unwrap_or_default();
                let submesh_folder_name = format!("{}-{}-{}", draw_ib, index_count, first_index);
                component_drawcall_index_list_dict
                    .insert(submesh_folder_name, submesh_trianglelist_index_list);
            }
        }

        if component_drawcall_index_list_dict.is_empty() {
            return Ok(());
        }

        let deduped_folder_path = PathBuf::from(&self.workspace_path).join("DedupedTextures");
        let deduped_jpg_folder_path =
            PathBuf::from(&self.workspace_path).join("DedupedTextures_jpg");
        SSMTFileUtils::create_folder_if_not_exists(&deduped_folder_path)?;

        // 复制去重贴图
        for index_list in component_drawcall_index_list_dict.values() {
            for trianglelist_index in index_list.iter() {
                let content_str = format!("{}-ps-t", trianglelist_index);
                let ps_texture_all_filename_list =
                    self.fa.data.filter_texture_filename_list(&content_str);

                for ps_texture_filename in ps_texture_all_filename_list {
                    let deduped_filepath = self.fa.log.get_deduped_filepath(&ps_texture_filename);
                    if deduped_filepath.is_empty() {
                        continue;
                    }

                    let deduped_filename = self.fa.log.get_deduped_filename(&ps_texture_filename);
                    let texture_unique_hash =
                        SSMTStringUtils::get_file_hash_from_file_name(&ps_texture_filename);

                    let target_texture_path = deduped_folder_path
                        .join(format!("{}_{}", texture_unique_hash, deduped_filename));
                    let target_texture_path_str = target_texture_path.to_string_lossy().to_string();
                    let _ = SSMTFileUtils::copy_to_file_if_not_exists(
                        &deduped_filepath,
                        &target_texture_path_str,
                    );
                }
            }
        }

        // 转换为 JPG 预览
        TextureConvertHelper::convert_all_texture_files_to_target_folder(
            deduped_folder_path.to_string_lossy().as_ref(),
            deduped_jpg_folder_path.to_string_lossy().as_ref(),
        )?;

        // 写入 ComponentName_DrawCallIndexList.json
        let component_json_path =
            get_workspace_component_name_draw_call_index_list_json_path(&self.workspace_path)?;
        let component_json = ComponentNameDrawCallIndexListJson::from_map(
            component_drawcall_index_list_dict.clone(),
        );
        if let Err(e) = component_json.save_to_file(&component_json_path) {
            eprintln!(
                "Failed to write {}: {}",
                component_json_path.to_string_lossy(),
                e
            );
        }

        // 构建 TrianglelistDedupedFileName.json
        let mut trianglelist_texture_file_name_list: Vec<String> = Vec::new();
        for index_list in component_drawcall_index_list_dict.values() {
            for trianglelist_index in index_list.iter() {
                let content_str = format!("{}-ps-t", trianglelist_index);
                let ps_texture_all_filename_list =
                    self.fa.data.filter_texture_filename_list(&content_str);
                trianglelist_texture_file_name_list.extend(ps_texture_all_filename_list);
            }
        }

        let mut trianglelist_deduped_map: HashMap<String, TrianglelistDedupedTextureProperty> =
            HashMap::new();

        for trianglelist_texture_file_name in trianglelist_texture_file_name_list {
            let hash =
                SSMTStringUtils::get_file_hash_from_file_name(&trianglelist_texture_file_name);

            let fa_log_deduped_filename = {
                let deduped = self
                    .fa
                    .log
                    .get_deduped_filename(&trianglelist_texture_file_name);
                if deduped.trim().is_empty() {
                    String::new()
                } else {
                    format!("{}_{}", hash, deduped)
                }
            };

            let fa_data_deduped_filename = {
                let mut out = String::new();
                let deduped_dir = Path::new(&self.fa.folder_path).join("deduped");
                if deduped_dir.exists() {
                    if let Ok(entries) = fs::read_dir(&deduped_dir) {
                        for entry in entries.flatten() {
                            let file_name = entry.file_name();
                            if let Some(file_name_str) = file_name.to_str() {
                                if file_name_str.contains(&hash) {
                                    out = format!("{}_{}", hash, file_name_str);
                                    break;
                                }
                            }
                        }
                    }
                }
                out
            };

            trianglelist_deduped_map.insert(
                trianglelist_texture_file_name,
                TrianglelistDedupedTextureProperty {
                    fa_log_deduped_file_name: fa_log_deduped_filename,
                    fa_data_deduped_file_name: fa_data_deduped_filename,
                },
            );
        }

        let trianglelist_json_path =
            get_workspace_trianglelist_deduped_filename_json_path(&self.workspace_path)?;
        let trianglelist_json = TrianglelistDedupedFileNameJson::from_map(trianglelist_deduped_map);
        if let Err(e) = trianglelist_json.save_to_file(&trianglelist_json_path) {
            eprintln!(
                "Failed to write {}: {}",
                trianglelist_json_path.to_string_lossy(),
                e
            );
        }

        Ok(())
    }
}
