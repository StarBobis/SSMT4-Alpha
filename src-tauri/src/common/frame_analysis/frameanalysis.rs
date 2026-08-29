use crate::common::frame_analysis::frameanalysis_data::FrameAnalysisData;
use crate::common::frame_analysis::frameanalysis_log::FrameAnalysisSingleLog;
use crate::common::shader_resource::ShaderResource;

pub struct FrameAnalysis {
    pub folder_path: String,
    pub data: FrameAnalysisData,
    pub log: FrameAnalysisSingleLog,
}

impl FrameAnalysis {
    pub fn new(frame_analysis_folder: &str) -> Result<Self, String> {
        let fa_log = FrameAnalysisSingleLog::new(frame_analysis_folder)?;
        let fa_data = FrameAnalysisData::new(frame_analysis_folder)?;
        Ok(Self {
            folder_path: frame_analysis_folder.to_string(),
            data: fa_data,
            log: fa_log,
        })
    }

    /// 通过首个 TrianglelistIndex 对应的 vb0 hash，向前查找最早写入该缓冲区的 PointlistIndex。
    ///
    /// 与 `FrameAnalysisSingleLog::get_last_pointlist_index_by_hash` 不同：
    /// 这里返回的是第一个匹配到的索引，而不是最后一个。
    /// NarakaM 已验证该逻辑可用，Naraka 也使用同一套逻辑。
    pub fn get_first_pointlist_index_by_hash(&self, draw_ib: &str) -> String {
        let drawcall_index_list = self.data.get_trianglelist_index_list(draw_ib);
        if drawcall_index_list.is_empty() {
            return String::new();
        }

        let first_trianglelist_index = &drawcall_index_list[0];
        let trianglelist_index_line_list =
            self.log.get_line_list_by_index(first_trianglelist_index);

        let mut vb0_hash = String::new();
        let mut find_ia_set_vb = false;

        for call_line in trianglelist_index_line_list {
            if call_line.contains("IASetVertexBuffers") && !find_ia_set_vb {
                find_ia_set_vb = true;
                continue;
            }

            if find_ia_set_vb {
                if !call_line.starts_with("00") {
                    let ia_resource = ShaderResource::new(&call_line);
                    if ia_resource.index == "0" {
                        vb0_hash = ia_resource.hash.clone();
                    }
                } else {
                    break;
                }
            }
        }

        if vb0_hash.is_empty() {
            return String::new();
        }

        let find_str = format!("hash={}", vb0_hash);
        let mut current_index = String::new();
        let trianglelist_index_number = match first_trianglelist_index.parse::<i32>() {
            Ok(n) => n,
            Err(_) => return String::new(),
        };

        let mut possible_index_list: Vec<String> = Vec::new();
        for log_line in self.log.lines.iter() {
            if log_line.starts_with("00") {
                current_index = log_line.get(0..6).unwrap_or("").to_string();
            }

            if log_line.contains(&find_str) && !log_line.to_lowercase().contains("dst") {
                let pointlist_index_number = match current_index.parse::<i32>() {
                    Ok(n) => n,
                    Err(_) => continue,
                };

                if pointlist_index_number < trianglelist_index_number
                    && !possible_index_list.contains(&current_index)
                {
                    possible_index_list.push(current_index.clone());
                }
            }
        }

        if !possible_index_list.is_empty() {
            return possible_index_list.first().cloned().unwrap_or_default();
        }

        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::FrameAnalysis;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ssmt4-frameanalysis-{}-{}", name, unique));
        fs::create_dir_all(&dir).expect("failed to create temp dir");
        dir
    }

    #[test]
    fn get_first_pointlist_index_by_hash_returns_first_not_last() {
        let dir = create_temp_dir("first-pointlist");
        fs::write(dir.join("000009-ib=6c751ecd-vs=abc-ps=def.txt"), b"").expect("write ib txt");
        let log = "\\
000005 CSSetUnorderedAccessViews(StartSlot:0, NumUAVs:1, ppUnorderedAccessViews:0x1)\\n
       0: view=0x1 resource=0x2 hash=43cad7d1\\n
000006 CSSetUnorderedAccessViews(StartSlot:0, NumUAVs:1, ppUnorderedAccessViews:0x1)\\n
       0: view=0x1 resource=0x2 hash=43cad7d1\\n
000009 IASetVertexBuffers(StartSlot:0, NumBuffers:1, ppVertexBuffers:0x1, pStrides:0x1, pOffsets:0x1)\\n
       0: resource=0x1 hash=43cad7d1\\n
000009 IASetIndexBuffer(pIndexBuffer:0x1, Format:57, Offset:0) hash=6c751ecd\\n
";
        fs::write(dir.join("log.txt"), log).expect("write log");
        let fa = FrameAnalysis::new(dir.to_string_lossy().as_ref()).expect("frame analysis");
        assert_eq!(fa.get_first_pointlist_index_by_hash("6c751ecd"), "000005");
        fs::remove_dir_all(&dir).expect("remove temp dir");
    }
}
