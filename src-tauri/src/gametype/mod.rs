use std::fs;
use std::path::PathBuf;

use crate::common::d3d11_gametype::D3D11GameType;
use crate::config::path_manager::PathManager;

pub mod type_ailimit;
pub mod type_apmi;
pub mod type_doav;
pub mod type_efmi;
pub mod type_gf2;
pub mod type_gimi;
pub mod type_himi;
pub mod type_hok;
pub mod type_identityv;
pub mod type_identityv2;
pub mod type_miside;
pub mod type_naraka;
pub mod type_narakam;
pub mod type_neirr;
pub mod type_nioh2;
pub mod type_ntemi;
pub mod type_snowbreak;
pub mod type_srmi;
pub mod type_theoutcast;
pub mod type_wwmi;
pub mod type_yysls;
pub mod type_zzmi;
pub mod type_zzmidx12;

pub const GAME_NAME_LIST: &[&str] = &[
    "AILIMIT",
    "APMI",
    "DOAV",
    "EFMI",
    "GF2",
    "GIMI",
    "HIMI",
    "HOK",
    "IDENTITYV",
    "MISIDE",
    "NARAKA",
    "NARAKAM",
    "NEIRR",
    "NIOH2",
    "NTEMI",
    "SNOWBREAK",
    "SRMI",
    "THEOUTCAST",
    "WUWA",
    "WWMI",
    "YYSLS",
    "ZZMI",
    "ZZMIDX12",
];

fn external_game_type_folder(game_name: &str) -> Option<PathBuf> {
    let normalized = game_name.trim().to_ascii_uppercase();
    let root = PathManager::ssmt_gametype_folder();

    // IDENTITYV 预设沿用 IdentityV2 目录，避免与旧版 IdentityV 目录混淆。
    if normalized == "IDENTITYV" {
        return Some(root.join("IdentityV2"));
    }

    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let Some(folder_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if folder_name.eq_ignore_ascii_case(&normalized) {
                return Some(path);
            }
        }
    }

    let exact = root.join(&normalized);
    exact.is_dir().then_some(exact)
}

fn load_external_game_type_list(game_name: &str) -> Result<Vec<D3D11GameType>, String> {
    let Some(folder) = external_game_type_folder(game_name) else {
        return Ok(Vec::new());
    };

    if !folder.is_dir() {
        return Ok(Vec::new());
    }

    let mut json_paths = Vec::new();
    for entry in fs::read_dir(&folder).map_err(|e| format!("Failed to read GameType folder {}: {e}", folder.display()))? {
        let path = entry
            .map_err(|e| format!("Failed to read GameType entry in {}: {e}", folder.display()))?
            .path();
        let is_json = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("json"))
            .unwrap_or(false);
        if path.is_file() && is_json {
            json_paths.push(path);
        }
    }

    json_paths.sort();

    let mut game_type_list = Vec::new();
    for json_path in json_paths {
        game_type_list.push(D3D11GameType::from_json_file(&json_path)?);
    }

    if game_type_list.is_empty() {
        return Ok(Vec::new());
    }

    println!(
        "Loaded {} D3D11GameType entries from external files for {}",
        game_type_list.len(),
        game_name
    );
    Ok(game_type_list)
}

pub fn get_game_type_list(game_name: &str) -> Result<Vec<D3D11GameType>, String> {
    let normalized_game_name = game_name.trim().to_ascii_uppercase();

    if let Ok(external_list) = load_external_game_type_list(&normalized_game_name) {
        if !external_list.is_empty() {
            return Ok(external_list);
        }
    }

    match normalized_game_name.as_str() {
        "AILIMIT" => Ok(type_ailimit::AILIMITGameType::initialize()),
        "APMI" => Ok(type_apmi::APMIGameType::initialize()),
        "DOAV" => Ok(type_doav::DOAVGameType::initialize()),
        "EFMI" => Ok(type_efmi::EFMIGameType::initialize()),
        "GF2" => Ok(type_gf2::GF2GameType::initialize()),
        "GIMI" => Ok(type_gimi::GIMIGameType::initialize()),
        "HIMI" => Ok(type_himi::HIMIGameType::initialize()),
        "HOK" => Ok(type_hok::HOKGameType::initialize()),
        "IDENTITYV" => Ok(type_identityv2::IdentityV2GameType::initialize()),
        "MISIDE" => Ok(type_miside::MiSideGameType::initialize()),
        "NARAKA" => Ok(type_naraka::NarakaGameType::initialize()),
        "NARAKAM" => Ok(type_narakam::NarakaMGameType::initialize()),
        "NEIRR" => Ok(type_neirr::NeirRGameType::initialize()),
        "NIOH2" => Ok(type_nioh2::Nioh2GameType::initialize()),
        "NTEMI" => Ok(type_ntemi::NTEMIGameType::initialize()),
        "SNOWBREAK" => Ok(type_snowbreak::SnowBreakGameType::initialize()),
        "SRMI" => Ok(type_srmi::SRMIGameType::initialize()),
        "THEOUTCAST" => Ok(type_theoutcast::TheOutcastGameType::initialize()),
        "WUWA" => Ok(type_wwmi::WWMIGameType::initialize()),
        "WWMI" => Ok(type_wwmi::WWMIGameType::initialize()),
        "YYSLS" => Ok(type_yysls::YYSLSGameType::initialize()),
        "ZZMI" => Ok(type_zzmi::ZZMIGameType::initialize()),
        "ZZMIDX12" => Ok(type_zzmidx12::ZZMIDX12GameType::initialize()),
        other => Err(format!("Unsupported GameType preset: {}", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::d3d11_element::D3D11Element;

    fn internal_game_type_list(game_name: &str) -> Vec<D3D11GameType> {
        match game_name {
            "AILIMIT" => super::type_ailimit::AILIMITGameType::initialize(),
            "APMI" => super::type_apmi::APMIGameType::initialize(),
            "DOAV" => super::type_doav::DOAVGameType::initialize(),
            "EFMI" => super::type_efmi::EFMIGameType::initialize(),
            "GF2" => super::type_gf2::GF2GameType::initialize(),
            "GIMI" => super::type_gimi::GIMIGameType::initialize(),
            "HIMI" => super::type_himi::HIMIGameType::initialize(),
            "HOK" => super::type_hok::HOKGameType::initialize(),
            "IDENTITYV" => super::type_identityv2::IdentityV2GameType::initialize(),
            "MISIDE" => super::type_miside::MiSideGameType::initialize(),
            "NARAKA" => super::type_naraka::NarakaGameType::initialize(),
            "NARAKAM" => super::type_narakam::NarakaMGameType::initialize(),
            "NEIRR" => super::type_neirr::NeirRGameType::initialize(),
            "NIOH2" => super::type_nioh2::Nioh2GameType::initialize(),
            "NTEMI" => super::type_ntemi::NTEMIGameType::initialize(),
            "SNOWBREAK" => super::type_snowbreak::SnowBreakGameType::initialize(),
            "SRMI" => super::type_srmi::SRMIGameType::initialize(),
            "THEOUTCAST" => super::type_theoutcast::TheOutcastGameType::initialize(),
            "WUWA" | "WWMI" => super::type_wwmi::WWMIGameType::initialize(),
            "YYSLS" => super::type_yysls::YYSLSGameType::initialize(),
            "ZZMI" => super::type_zzmi::ZZMIGameType::initialize(),
            "ZZMIDX12" => super::type_zzmidx12::ZZMIDX12GameType::initialize(),
            other => panic!("missing internal GameType registry for {other}"),
        }
    }

    fn same_d3d11_element(left: &D3D11Element, right: &D3D11Element) -> bool {
        left.semantic_name == right.semantic_name
            && left.format == right.format
            && left.extract_slot == right.extract_slot
            && left.extract_technique == right.extract_technique
            && left.category == right.category
            && left.draw_category == right.draw_category
            && left.byte_width == right.byte_width
    }

    fn same_game_type(left: &D3D11GameType, right: &D3D11GameType) -> bool {
        if left.game_type_name != right.game_type_name
            || left.d3d11_element_list.len() != right.d3d11_element_list.len()
        {
            return false;
        }

        left.d3d11_element_list
            .iter()
            .zip(right.d3d11_element_list.iter())
            .all(|(left_element, right_element)| {
                same_d3d11_element(left_element, right_element)
            })
    }

    #[test]
    fn external_json_matches_internal_registry() {
        for game_name in GAME_NAME_LIST {
            let external =
                load_external_game_type_list(game_name).expect("external GameType JSON should load");
            let internal = internal_game_type_list(game_name);
            assert_eq!(
                external.len(),
                internal.len(),
                "{game_name} external JSON count should match internal registry"
            );

            let mut matched_internal = vec![false; internal.len()];
            for external_type in &external {
                let matched_index = internal
                    .iter()
                    .enumerate()
                    .position(|(index, internal_type)| {
                        !matched_internal[index] && same_game_type(external_type, internal_type)
                    })
                    .unwrap_or_else(|| {
                        panic!(
                            "{game_name} external type {} has no internal match",
                            external_type.game_type_name
                        )
                    });
                matched_internal[matched_index] = true;
            }
            assert!(
                matched_internal.iter().all(|matched| *matched),
                "{game_name} internal registry has types without external JSON"
            );
        }
    }

    #[test]
    fn external_game_type_json_is_loaded() {
        let game_types = get_game_type_list("GIMI").expect("GIMI types should load");
        assert!(!game_types.is_empty(), "GIMI external types should not be empty");
        assert!(
            game_types.iter().any(|gt| gt.game_type_name == "CPU_P12_N12_C4_T8_T1-8_T2-8_"),
            "expected GIMI type from external JSON"
        );
    }

    #[test]
    fn all_external_game_type_folders_load() {
        for game_name in GAME_NAME_LIST {
            let game_types = load_external_game_type_list(game_name)
                .unwrap_or_else(|error| panic!("{game_name}: {error}"));
            assert!(
                !game_types.is_empty(),
                "{game_name} should load external GameType JSON"
            );
        }
    }

    #[test]
    fn duplicate_game_type_variants_are_preserved() {
        let apmi_external =
            load_external_game_type_list("APMI").expect("APMI external types should load");
        let apmi_internal = super::type_apmi::APMIGameType::initialize();
        assert_eq!(apmi_external.len(), apmi_internal.len());
        assert_eq!(
            apmi_external
                .iter()
                .filter(|gt| gt.game_type_name == "GPU_P12_N12_TA16_C4_T4_T1-8_BI4_")
                .count(),
            2,
            "APMI duplicate GameType variants should both load"
        );

        let himi_external =
            load_external_game_type_list("HIMI").expect("HIMI external types should load");
        let himi_internal = super::type_himi::HIMIGameType::initialize();
        assert_eq!(himi_external.len(), himi_internal.len());
        assert_eq!(
            himi_external
                .iter()
                .filter(|gt| gt.game_type_name == "CPU_P12_N12_TA16_C4_T8_")
                .count(),
            2,
            "HIMI duplicate GameType variants should both load"
        );
    }
}
