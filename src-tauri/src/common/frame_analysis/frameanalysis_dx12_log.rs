use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default)]
pub struct FrameAnalysisDX12VertexBinding {
    pub slot: u32,
    pub resource: String,
    pub gpu: String,
    pub bytes: usize,
    pub stride: u64,
    pub offset: usize,
    /// file-level offset within the deduped .buf file (new schema, may differ from buffer offset)
    pub file_offset: usize,
    /// file-level byte length within the deduped .buf file (new schema)
    pub file_bytes: usize,
    pub file: String,
    pub hash: String,
    pub hunt_hash: String,
    pub skin_source: String,
    pub producer_call_index: u64,
    pub producer_pso: u64,
    pub producer_cs: String,
    pub producer_bind: String,
    pub producer_root: u32,
    pub producer_reg: u32,
}

#[derive(Debug, Clone, Default)]
pub struct FrameAnalysisDX12IndexBinding {
    pub gpu: String,
    pub bytes: usize,
    pub offset: usize,
    /// file-level offset within the deduped .buf file (new schema, may differ from buffer offset)
    pub file_offset: usize,
    /// file-level byte length within the deduped .buf file (new schema)
    pub file_bytes: usize,
    pub fmt_name: String,
    pub file: String,
    pub hash: String,
    pub hunt_hash: String,
    pub dump_scope: String,
    pub dump_is_draw_slice: bool,
}

#[derive(Debug, Clone, Default)]
pub struct FrameAnalysisDX12DrawCall {
    pub call_index: u64,
    pub pso: u64,
    pub vs: String,
    pub topology: String,
    pub index_count: usize,
    pub start_index: usize,
    pub base_vertex: i32,
    pub vertex_bindings: HashMap<u32, FrameAnalysisDX12VertexBinding>,
    pub index_binding: Option<FrameAnalysisDX12IndexBinding>,
}

#[derive(Debug, Clone, Default)]
pub struct FrameAnalysisDX12ResourceBinding {
    pub call_index: u64,
    pub pso: u64,
    pub cs: String,
    pub ps: String,
    pub bind: String,
    pub root: u32,
    pub reg: u32,
    pub kind: String,
    pub dim: String,
    pub resource: String,
    pub gpu: String,
    pub bytes: usize,
    pub stride: u64,
    pub offset: usize,
    pub file: String,
    pub hash: String,
    pub hunt_hash: String,
}

#[derive(Debug, Clone)]
pub struct FrameAnalysisDX12Log {
    pub dir: String,
    pub log_filename: String,
    pub draw_calls: Vec<FrameAnalysisDX12DrawCall>,
    pub resource_bindings: Vec<FrameAnalysisDX12ResourceBinding>,
    resource_bindings_by_call: HashMap<u64, Vec<FrameAnalysisDX12ResourceBinding>>,
}

impl FrameAnalysisDX12Log {
    pub fn new(frame_analysis_folder: &str) -> Result<Self, String> {
        let folder = Path::new(frame_analysis_folder);
        let log_path = folder.join("log.jsonl");
        if !log_path.exists() {
            return Err(format!("DX12 log.jsonl not found: {}", log_path.display()));
        }

        crate::extract_log!(
            "[ZZMIDX12][DX12Log] Reading DX12 FrameAnalysis log: {}",
            log_path.display()
        );
        let (draw_calls, resource_bindings) = Self::parse_log(&log_path)?;
        let mut resource_bindings_by_call: HashMap<u64, Vec<FrameAnalysisDX12ResourceBinding>> =
            HashMap::new();
        for binding in resource_bindings.iter() {
            resource_bindings_by_call
                .entry(binding.call_index)
                .or_default()
                .push(binding.clone());
        }
        crate::extract_log!(
            "[ZZMIDX12][DX12Log] Parsed draw calls: {}",
            draw_calls.len()
        );
        crate::extract_log!(
            "[ZZMIDX12][DX12Log] Parsed resource bindings: {}",
            resource_bindings.len()
        );

        Ok(Self {
            dir: folder.to_string_lossy().to_string(),
            log_filename: log_path.to_string_lossy().to_string(),
            draw_calls,
            resource_bindings,
            resource_bindings_by_call,
        })
    }

    pub fn resolve_binding_path(&self, relative_path: &str) -> PathBuf {
        let normalized = relative_path.replace('\\', std::path::MAIN_SEPARATOR_STR);
        if normalized.contains(std::path::MAIN_SEPARATOR) {
            Path::new(&self.dir).join(normalized)
        } else {
            Path::new(&self.dir).join("deduped").join(normalized)
        }
    }

    pub fn resource_bindings_for_call(
        &self,
        call_index: u64,
    ) -> &[FrameAnalysisDX12ResourceBinding] {
        self.resource_bindings_by_call
            .get(&call_index)
            .map(|bindings| bindings.as_slice())
            .unwrap_or(&[])
    }

    fn parse_log(
        log_path: &Path,
    ) -> Result<
        (
            Vec<FrameAnalysisDX12DrawCall>,
            Vec<FrameAnalysisDX12ResourceBinding>,
        ),
        String,
    > {
        let content = fs::read_to_string(log_path)
            .map_err(|e| format!("Failed to read DX12 log {}: {}", log_path.display(), e))?;
        let mut draws: BTreeMap<u64, FrameAnalysisDX12DrawCall> = BTreeMap::new();
        let mut resource_bindings = Vec::new();

        for (line_index, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let obj: Value = match serde_json::from_str(line) {
                Ok(obj) => obj,
                Err(e) => {
                    if !Self::is_required_event_line(line) {
                        crate::extract_log!(
                            "[ZZMIDX12][DX12Log] Skipping non-JSON auxiliary line {} in {}: {}",
                            line_index + 1,
                            log_path.display(),
                            e
                        );
                        continue;
                    }

                    return Err(format!(
                        "Failed to parse DX12 log line {} in {}: {}",
                        line_index + 1,
                        log_path.display(),
                        e
                    ));
                }
            };

            let func = obj.get("func").and_then(|v| v.as_str()).unwrap_or_default();
            let type_str = obj.get("type").and_then(|v| v.as_str()).unwrap_or_default();

            if func == "DrawIndexedInstanced" || func == "DrawInstanced" || type_str == "call.draw"
            {
                let call_index = Self::call_index(&obj);
                let ib_bytes = Self::parse_u64(obj.get("ib_bytes")) as usize;
                let ib_fmt = Self::parse_ib_format_name(obj.get("ib_fmt"));
                draws.insert(
                    call_index,
                    FrameAnalysisDX12DrawCall {
                        call_index,
                        pso: Self::parse_u64(obj.get("pso")),
                        vs: Self::parse_string(obj.get("vs")),
                        topology: Self::parse_string(obj.get("topology")),
                        index_count: Self::parse_u64(obj.get("index_count")) as usize,
                        start_index: Self::parse_u64(obj.get("start_index")) as usize,
                        base_vertex: Self::parse_i32(obj.get("base_vertex")),
                        vertex_bindings: HashMap::new(),
                        index_binding: if ib_bytes > 0 && !ib_fmt.is_empty() {
                            Some(FrameAnalysisDX12IndexBinding {
                                gpu: Self::parse_string(obj.get("ib_gpu")),
                                bytes: ib_bytes,
                                offset: 0,
                                file_offset: 0,
                                file_bytes: 0,
                                fmt_name: ib_fmt,
                                file: String::new(),
                                hash: String::new(),
                                hunt_hash: String::new(),
                                dump_scope: "draw_call_metadata".to_string(),
                                dump_is_draw_slice: false,
                            })
                        } else {
                            None
                        },
                    },
                );
                continue;
            }

            if func == "BindResource" {
                resource_bindings.push(FrameAnalysisDX12ResourceBinding {
                    call_index: Self::call_index(&obj),
                    pso: Self::parse_u64(obj.get("pso")),
                    cs: Self::parse_string(obj.get("cs")),
                    ps: Self::parse_string(obj.get("ps")),
                    bind: Self::parse_string(obj.get("bind")),
                    root: Self::parse_u64(obj.get("root")) as u32,
                    reg: Self::parse_u64(obj.get("reg")) as u32,
                    kind: Self::parse_string(obj.get("kind")),
                    dim: Self::parse_string(obj.get("dim")),
                    resource: Self::parse_string(obj.get("resource")),
                    gpu: Self::parse_string(obj.get("gpu")),
                    bytes: Self::parse_u64(obj.get("bytes")) as usize,
                    stride: Self::parse_u64(obj.get("structure_byte_stride")),
                    offset: Self::parse_u64(obj.get("offset")) as usize,
                    file: Self::parse_string(obj.get("file")),
                    hash: Self::parse_string(obj.get("hash")),
                    hunt_hash: Self::parse_string(obj.get("hunt_hash")),
                });
                continue;
            }

            if func != "BindIA" && type_str != "bind.ia" {
                continue;
            }

            let call_index = Self::call_index(&obj);
            let Some(draw) = draws.get_mut(&call_index) else {
                continue;
            };
            let role = obj.get("role").and_then(|v| v.as_str()).unwrap_or_default();
            if role == "VB" {
                let file_bytes = Self::parse_u64(obj.get("file_bytes")) as usize;
                let binding = FrameAnalysisDX12VertexBinding {
                    slot: Self::parse_u64(obj.get("slot")) as u32,
                    resource: Self::parse_string(obj.get("resource")),
                    gpu: Self::parse_string(obj.get("gpu")),
                    bytes: Self::parse_u64(obj.get("bytes")) as usize,
                    stride: Self::parse_u64(obj.get("stride")),
                    offset: Self::parse_u64(obj.get("offset")) as usize,
                    file_offset: Self::parse_u64(obj.get("file_offset")) as usize,
                    file_bytes: if file_bytes > 0 {
                        file_bytes
                    } else {
                        Self::parse_u64(obj.get("bytes")) as usize
                    },
                    file: Self::parse_string(obj.get("file")),
                    hash: Self::parse_string(obj.get("hash")),
                    hunt_hash: Self::parse_string(obj.get("hunt_hash")),
                    skin_source: Self::parse_string(obj.get("skin_source")),
                    producer_call_index: Self::parse_u64(obj.get("producer_call_index")),
                    producer_pso: Self::parse_u64(obj.get("producer_pso")),
                    producer_cs: Self::parse_string(obj.get("producer_cs")),
                    producer_bind: Self::parse_string(obj.get("producer_bind")),
                    producer_root: Self::parse_u64(obj.get("producer_root")) as u32,
                    producer_reg: Self::parse_u64(obj.get("producer_reg")) as u32,
                };
                draw.vertex_bindings.insert(binding.slot, binding);
            } else if role == "IB" {
                let file_bytes = Self::parse_u64(obj.get("file_bytes")) as usize;
                draw.index_binding = Some(FrameAnalysisDX12IndexBinding {
                    gpu: Self::parse_string(obj.get("gpu")),
                    bytes: Self::parse_u64(obj.get("bytes")) as usize,
                    offset: Self::parse_u64(obj.get("offset")) as usize,
                    file_offset: Self::parse_u64(obj.get("file_offset")) as usize,
                    file_bytes: if file_bytes > 0 {
                        file_bytes
                    } else {
                        Self::parse_u64(obj.get("bytes")) as usize
                    },
                    fmt_name: Self::normalize_ib_format_name(&Self::parse_string(
                        obj.get("fmt_name"),
                    )),
                    file: Self::parse_string(obj.get("file")),
                    hash: Self::parse_string(obj.get("hash")),
                    hunt_hash: Self::parse_string(obj.get("hunt_hash")),
                    dump_scope: Self::parse_string(obj.get("dump_scope")),
                    dump_is_draw_slice: Self::parse_bool(obj.get("dump_is_draw_slice")),
                });
            }
        }

        Self::resolve_metadata_index_bindings(&mut draws, &resource_bindings);

        Ok((draws.into_values().collect(), resource_bindings))
    }

    fn resolve_metadata_index_bindings(
        draws: &mut BTreeMap<u64, FrameAnalysisDX12DrawCall>,
        resource_bindings: &[FrameAnalysisDX12ResourceBinding],
    ) {
        let mut ia_bindings_by_gpu: HashMap<String, Vec<(u64, FrameAnalysisDX12IndexBinding)>> =
            HashMap::new();
        for draw in draws.values() {
            let Some(binding) = draw.index_binding.as_ref() else {
                continue;
            };
            if !Self::index_binding_has_dump(binding) {
                continue;
            }

            let gpu_key = Self::normalize_gpu_key(&binding.gpu);
            if gpu_key.is_empty() {
                continue;
            }

            ia_bindings_by_gpu
                .entry(gpu_key)
                .or_default()
                .push((draw.call_index, binding.clone()));
        }

        for bindings in ia_bindings_by_gpu.values_mut() {
            bindings.sort_by_key(|(call_index, _)| *call_index);
        }

        let mut resource_bindings_by_gpu: HashMap<String, Vec<&FrameAnalysisDX12ResourceBinding>> =
            HashMap::new();
        for binding in resource_bindings.iter() {
            let gpu_key = Self::normalize_gpu_key(&binding.gpu);
            if gpu_key.is_empty() || binding.file.is_empty() || !binding.file.ends_with(".buf") {
                continue;
            }
            resource_bindings_by_gpu
                .entry(gpu_key)
                .or_default()
                .push(binding);
        }

        for bindings in resource_bindings_by_gpu.values_mut() {
            bindings.sort_by_key(|binding| binding.call_index);
        }

        for draw in draws.values_mut() {
            let Some(index_binding) = draw.index_binding.as_mut() else {
                continue;
            };
            if !index_binding.file.is_empty() {
                continue;
            }

            let gpu_key = Self::normalize_gpu_key(&index_binding.gpu);
            if gpu_key.is_empty() {
                continue;
            }

            if let Some(binding) = ia_bindings_by_gpu
                .get(&gpu_key)
                .and_then(|candidates| {
                    Self::find_matching_index_binding(candidates, index_binding, draw.call_index)
                })
                .cloned()
            {
                Self::copy_index_binding_dump(index_binding, &binding);
                continue;
            }

            let Some(candidates) = resource_bindings_by_gpu.get(&gpu_key) else {
                continue;
            };

            let resolved = candidates
                .iter()
                .rev()
                .copied()
                .find(|binding| binding.bytes == index_binding.bytes)
                .or_else(|| {
                    candidates
                        .iter()
                        .rev()
                        .copied()
                        .find(|binding| binding.bytes >= index_binding.bytes)
                });

            let Some(binding) = resolved else {
                continue;
            };

            index_binding.offset = binding.offset;
            index_binding.file = binding.file.clone();
            index_binding.hash = binding.hash.clone();
            index_binding.hunt_hash = binding.hunt_hash.clone();
        }
    }

    fn index_binding_has_dump(binding: &FrameAnalysisDX12IndexBinding) -> bool {
        !binding.file.is_empty() && binding.file.to_ascii_lowercase().ends_with(".buf")
    }

    fn index_binding_matches(
        source: &FrameAnalysisDX12IndexBinding,
        target: &FrameAnalysisDX12IndexBinding,
        require_exact_bytes: bool,
    ) -> bool {
        if !Self::index_binding_has_dump(source) {
            return false;
        }
        if !source.fmt_name.is_empty()
            && !target.fmt_name.is_empty()
            && !source.fmt_name.eq_ignore_ascii_case(&target.fmt_name)
        {
            return false;
        }
        if require_exact_bytes {
            source.bytes == target.bytes
        } else {
            source.bytes >= target.bytes
        }
    }

    fn find_matching_index_binding<'a>(
        candidates: &'a [(u64, FrameAnalysisDX12IndexBinding)],
        target: &FrameAnalysisDX12IndexBinding,
        target_call_index: u64,
    ) -> Option<&'a FrameAnalysisDX12IndexBinding> {
        Self::find_matching_index_binding_by_time(candidates, target, target_call_index, true, true)
            .or_else(|| {
                Self::find_matching_index_binding_by_time(
                    candidates,
                    target,
                    target_call_index,
                    true,
                    false,
                )
            })
            .or_else(|| {
                Self::find_matching_index_binding_by_time(
                    candidates,
                    target,
                    target_call_index,
                    false,
                    true,
                )
            })
            .or_else(|| {
                Self::find_matching_index_binding_by_time(
                    candidates,
                    target,
                    target_call_index,
                    false,
                    false,
                )
            })
    }

    fn find_matching_index_binding_by_time<'a>(
        candidates: &'a [(u64, FrameAnalysisDX12IndexBinding)],
        target: &FrameAnalysisDX12IndexBinding,
        target_call_index: u64,
        require_exact_bytes: bool,
        require_prior_call: bool,
    ) -> Option<&'a FrameAnalysisDX12IndexBinding> {
        candidates
            .iter()
            .rev()
            .filter(|(call_index, _)| !require_prior_call || *call_index <= target_call_index)
            .map(|(_, binding)| binding)
            .find(|binding| Self::index_binding_matches(binding, target, require_exact_bytes))
    }

    fn copy_index_binding_dump(
        target: &mut FrameAnalysisDX12IndexBinding,
        source: &FrameAnalysisDX12IndexBinding,
    ) {
        target.offset = source.offset;
        target.file_offset = source.file_offset;
        target.file_bytes = source.file_bytes;
        target.file = source.file.clone();
        target.hash = source.hash.clone();
        target.hunt_hash = source.hunt_hash.clone();
        target.dump_scope = source.dump_scope.clone();
        target.dump_is_draw_slice = source.dump_is_draw_slice;
        if target.fmt_name.is_empty() {
            target.fmt_name = source.fmt_name.clone();
        }
    }

    fn normalize_gpu_key(gpu: &str) -> String {
        gpu.trim().to_ascii_lowercase()
    }

    fn is_required_event_line(line: &str) -> bool {
        line.contains("\"func\":\"DrawIndexedInstanced\"")
            || line.contains("\"func\":\"DrawInstanced\"")
            || line.contains("\"type\":\"call.draw\"")
            || line.contains("\"func\":\"BindResource\"")
            || line.contains("\"func\":\"BindIA\"")
            || line.contains("\"type\":\"bind.ia\"")
    }

    fn call_index(obj: &Value) -> u64 {
        Self::parse_u64(
            obj.get("call_index")
                .or_else(|| obj.get("event"))
                .or_else(|| obj.get("index")),
        )
    }

    fn parse_u64(value: Option<&Value>) -> u64 {
        match value {
            Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
            Some(Value::String(s)) => {
                let text = s.trim();
                if let Some(hex) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
                    u64::from_str_radix(hex, 16).unwrap_or(0)
                } else {
                    text.parse::<u64>().unwrap_or(0)
                }
            }
            Some(Value::Bool(v)) => u64::from(*v),
            _ => 0,
        }
    }

    fn parse_i32(value: Option<&Value>) -> i32 {
        match value {
            Some(Value::Number(n)) => n.as_i64().unwrap_or(0) as i32,
            Some(Value::String(s)) => s.trim().parse::<i32>().unwrap_or(0),
            _ => 0,
        }
    }

    fn parse_string(value: Option<&Value>) -> String {
        match value {
            Some(Value::String(s)) => s.clone(),
            Some(v) => v.to_string(),
            None => String::new(),
        }
    }

    fn parse_bool(value: Option<&Value>) -> bool {
        match value {
            Some(Value::Bool(v)) => *v,
            Some(Value::Number(n)) => n.as_u64().unwrap_or(0) != 0,
            Some(Value::String(s)) => {
                let text = s.trim();
                text.eq_ignore_ascii_case("true") || text == "1"
            }
            _ => false,
        }
    }

    fn parse_ib_format_name(value: Option<&Value>) -> String {
        match Self::parse_u64(value) {
            57 => "DXGI_FORMAT_R16_UINT".to_string(),
            42 => "DXGI_FORMAT_R32_UINT".to_string(),
            _ => String::new(),
        }
    }

    fn normalize_ib_format_name(value: &str) -> String {
        match value.trim().to_ascii_uppercase().as_str() {
            "R16_UINT" | "DXGI_FORMAT_R16_UINT" => "DXGI_FORMAT_R16_UINT".to_string(),
            "R32_UINT" | "DXGI_FORMAT_R32_UINT" => "DXGI_FORMAT_R32_UINT".to_string(),
            other => other.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::FrameAnalysisDX12Log;
    use std::fs;
    use std::path::Path;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn parses_dx12_compute_resource_bindings_when_sample_dump_exists() {
        let sample =
            Path::new("D:/SSMTCacheFolder/3Dmigoto/ZZMIDX12/FrameAnalysis-2026-06-22-223229");
        if !sample.join("log.jsonl").exists() {
            return;
        }

        let log = FrameAnalysisDX12Log::new(sample.to_string_lossy().as_ref()).unwrap();
        let call_41 = log.resource_bindings_for_call(41);

        assert!(call_41.iter().any(|binding| {
            binding.kind == "UAV"
                && binding.root == 1
                && binding.reg == 0
                && binding.hash == "a5b70fe9"
        }));
        assert!(call_41.iter().any(|binding| {
            binding.kind == "SRV"
                && binding.reg == 0
                && binding.stride == 40
                && binding.hash == "b403adf2"
        }));
        assert!(call_41.iter().any(|binding| {
            binding.kind == "SRV"
                && binding.reg == 1
                && binding.stride == 32
                && binding.hash == "433794dd"
        }));
    }

    #[test]
    fn parses_dx12_schema3_ia_bindings_when_sample_dump_exists() {
        let sample =
            Path::new("D:/SSMTCacheFolder/3Dmigoto/ZZMIDX12/FrameAnalysis-2026-06-28-161958");
        if !sample.join("log.jsonl").exists() {
            return;
        }

        let log = FrameAnalysisDX12Log::new(sample.to_string_lossy().as_ref()).unwrap();
        let draw_161 = log
            .draw_calls
            .iter()
            .find(|draw| draw.call_index == 161)
            .expect("call 161 should be parsed from schema 3 log");

        assert_eq!(draw_161.index_count, 3438);
        assert_eq!(draw_161.vertex_bindings.len(), 4);
        assert_eq!(draw_161.vertex_bindings.get(&0).unwrap().stride, 40);
        assert_eq!(draw_161.vertex_bindings.get(&1).unwrap().stride, 20);
        assert_eq!(draw_161.vertex_bindings.get(&2).unwrap().stride, 32);
        assert_eq!(draw_161.vertex_bindings.get(&3).unwrap().stride, 40);

        let ib = draw_161.index_binding.as_ref().unwrap();
        assert_eq!(ib.bytes, 6876);
        assert_eq!(ib.fmt_name, "DXGI_FORMAT_R16_UINT");

        let call_161 = log.resource_bindings_for_call(161);
        assert!(call_161.iter().any(|binding| {
            binding.kind == "CBV" && binding.root == 0 && binding.reg == 0 && binding.bytes == 3584
        }));
    }

    #[test]
    fn parses_dx12_draw_slice_scope_when_sample_dump_exists() {
        let sample =
            Path::new("D:/SSMTCacheFolder/3Dmigoto/ZZMIDX12/FrameAnalysis-2026-06-28-172703");
        if !sample.join("log.jsonl").exists() {
            return;
        }

        let log = FrameAnalysisDX12Log::new(sample.to_string_lossy().as_ref()).unwrap();
        let draw_181 = log
            .draw_calls
            .iter()
            .find(|draw| draw.call_index == 181)
            .expect("call 181 should be parsed from draw-slice log");
        let ib = draw_181.index_binding.as_ref().unwrap();

        assert_eq!(draw_181.start_index, 6630);
        assert_eq!(draw_181.index_count, 31062);
        assert_eq!(ib.dump_scope, "draw_slice");
        assert!(ib.dump_is_draw_slice);
        assert_eq!(ib.bytes, 62124);
    }

    #[test]
    fn parses_dx12_resource_handles_when_sample_dump_exists() {
        let sample =
            Path::new("D:/SSMTCacheFolder/3Dmigoto/ZZMIDX12/FrameAnalysis-2026-06-30-165238");
        if !sample.join("log.jsonl").exists() {
            return;
        }

        let log = FrameAnalysisDX12Log::new(sample.to_string_lossy().as_ref()).unwrap();
        let draw_3497 = log
            .draw_calls
            .iter()
            .find(|draw| draw.call_index == 3497)
            .expect("call 3497 should be parsed from resource-handle sample");
        let vb3 = draw_3497.vertex_bindings.get(&3).unwrap();

        assert_eq!(vb3.skin_source, "gpu_preskinning");
        assert_eq!(vb3.resource, "000001F14E01D2F0");
        assert_eq!(vb3.gpu, "0x10f05c0000");

        let call_1697 = log.resource_bindings_for_call(1697);
        assert!(call_1697.iter().any(|binding| {
            binding.kind == "UAV"
                && binding.bind == "compute_cbv_srv_uav"
                && binding.resource == "000001F14E01D2F0"
                && binding.stride == 40
        }));
    }

    #[test]
    fn parses_dx12_draw_metadata_ib_when_sample_dump_exists() {
        let sample =
            Path::new("D:/SSMTCacheFolder/3Dmigoto/ZZMIDX12/FrameAnalysis-2026-07-01-205407");
        if !sample.join("log.jsonl").exists() {
            return;
        }

        let log = FrameAnalysisDX12Log::new(sample.to_string_lossy().as_ref()).unwrap();
        let draw_195 = log
            .draw_calls
            .iter()
            .find(|draw| draw.call_index == 195)
            .expect("call 195 should be parsed from draw-metadata sample");
        let draw_200 = log
            .draw_calls
            .iter()
            .find(|draw| draw.call_index == 200)
            .expect("call 200 should be parsed from draw-metadata sample");

        assert_eq!(draw_195.index_count, 31062);
        assert_eq!(draw_195.start_index, 6630);
        assert!(draw_195.vertex_bindings.is_empty());
        let ib_195 = draw_195.index_binding.as_ref().unwrap();
        assert_eq!(ib_195.gpu, "0x10a9580000");
        assert_eq!(ib_195.bytes, 75384);
        assert_eq!(ib_195.fmt_name, "DXGI_FORMAT_R16_UINT");
        assert_eq!(ib_195.dump_scope, "draw_call_metadata");
        assert!(ib_195.file.is_empty());

        assert_eq!(draw_200.index_count, 60159);
        let ib_200 = draw_200.index_binding.as_ref().unwrap();
        assert_eq!(ib_200.gpu, "0x10a49d0000");
        assert_eq!(ib_200.bytes, 120318);
        assert_eq!(ib_200.fmt_name, "DXGI_FORMAT_R16_UINT");
    }

    #[test]
    fn resolves_metadata_ib_file_from_matching_gpu_binding() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ssmt4-dx12-metadata-ib-{}", unique));
        fs::create_dir_all(&dir).unwrap();

        let log_path = dir.join("log.jsonl");
        fs::write(
            &log_path,
            concat!(
                "{\"func\":\"DrawIndexedInstanced\",\"call_index\":1,\"pso\":10,\"vs\":\"vs\",\"topology\":\"TRIANGLELIST\",\"index_count\":6,\"start_index\":0,\"base_vertex\":0,\"ib_gpu\":\"0x1234\",\"ib_bytes\":12,\"ib_fmt\":57}\n",
                "{\"func\":\"BindResource\",\"call_index\":1,\"pso\":10,\"cs\":\"-\",\"bind\":\"graphics_cbv_srv_uav\",\"root\":0,\"reg\":0,\"kind\":\"SRV\",\"resource\":\"res\",\"gpu\":\"0x1234\",\"bytes\":12,\"structure_byte_stride\":0,\"offset\":24,\"file\":\"resolved-ib.buf\",\"hash\":\"abc\",\"hunt_hash\":\"def\"}\n"
            ),
        )
        .unwrap();

        let log = FrameAnalysisDX12Log::new(dir.to_string_lossy().as_ref()).unwrap();
        let draw = log.draw_calls.first().unwrap();
        let ib = draw.index_binding.as_ref().unwrap();

        assert_eq!(ib.gpu, "0x1234");
        assert_eq!(ib.file, "resolved-ib.buf");
        assert_eq!(ib.offset, 24);
        assert_eq!(ib.hash, "abc");
        assert_eq!(ib.hunt_hash, "def");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn resolves_metadata_ib_file_from_canonical_ia_binding() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ssmt4-dx12-canonical-ia-{}", unique));
        fs::create_dir_all(&dir).unwrap();

        let log_path = dir.join("log.jsonl");
        fs::write(
            &log_path,
            concat!(
                "{\"func\":\"DrawIndexedInstanced\",\"call_index\":10,\"pso\":20,\"vs\":\"vs\",\"topology\":\"TRIANGLELIST\",\"index_count\":60,\"start_index\":0,\"base_vertex\":0,\"ib_gpu\":\"0xabc\",\"ib_bytes\":120,\"ib_fmt\":57}\n",
                "{\"func\":\"DrawIndexedInstanced\",\"call_index\":11,\"pso\":20,\"vs\":\"vs\",\"topology\":\"TRIANGLELIST\",\"index_count\":6,\"start_index\":12,\"base_vertex\":0,\"ib_gpu\":\"0xabc\",\"ib_bytes\":120,\"ib_fmt\":57}\n",
                "{\"func\":\"DrawIndexedInstanced\",\"call_index\":12,\"pso\":20,\"vs\":\"vs\",\"topology\":\"TRIANGLELIST\",\"index_count\":6,\"start_index\":18,\"base_vertex\":0,\"ib_gpu\":\"0xabc\",\"ib_bytes\":120,\"ib_fmt\":57}\n",
                "{\"func\":\"BindIA\",\"call_index\":10,\"role\":\"IB\",\"gpu\":\"0xabc\",\"offset\":48,\"bytes\":120,\"file_offset\":48,\"file_bytes\":120,\"fmt_name\":\"DXGI_FORMAT_R16_UINT\",\"file\":\"canonical-ib.buf\",\"hash\":\"abc\",\"hunt_hash\":\"def\",\"dump_scope\":\"full_view\",\"dump_is_draw_slice\":false}\n",
                "{\"func\":\"BindIA\",\"call_index\":12,\"role\":\"IB\",\"gpu\":\"0xabc\",\"offset\":96,\"bytes\":120,\"file_offset\":96,\"file_bytes\":120,\"fmt_name\":\"DXGI_FORMAT_R16_UINT\",\"file\":\"future-ib.buf\",\"hash\":\"future\",\"hunt_hash\":\"future\",\"dump_scope\":\"full_view\",\"dump_is_draw_slice\":false}\n"
            ),
        )
        .unwrap();

        let log = FrameAnalysisDX12Log::new(dir.to_string_lossy().as_ref()).unwrap();
        let draw = log
            .draw_calls
            .iter()
            .find(|draw| draw.call_index == 11)
            .unwrap();
        let ib = draw.index_binding.as_ref().unwrap();

        assert_eq!(ib.file, "canonical-ib.buf");
        assert_eq!(ib.offset, 48);
        assert_eq!(ib.file_offset, 48);
        assert_eq!(ib.file_bytes, 120);
        assert_eq!(ib.hash, "abc");
        assert_eq!(ib.hunt_hash, "def");
        assert_eq!(ib.dump_scope, "full_view");

        fs::remove_dir_all(&dir).unwrap();
    }
}
