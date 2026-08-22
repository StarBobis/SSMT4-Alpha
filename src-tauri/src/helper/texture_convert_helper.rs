use std::fs;
use std::path::{Path, PathBuf};

use crate::utils::ssmt_command_utils::SSMTCommandUtils;
use crate::utils::ssmt_file_utils::SSMTFileUtils;

pub struct TextureConvertHelper;

impl TextureConvertHelper {
    pub fn collect_texture_files_recursive(folder: &Path, output: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(folder) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_dir() {
                Self::collect_texture_files_recursive(&path, output);
                continue;
            }

            if !path.is_file() {
                continue;
            }

            if SSMTFileUtils::is_texture_file(&path) {
                output.push(path);
            }
        }
    }

    pub fn convert_texture_to_target_fmt(
        input_file_path: &str,
        output_texture_path: &str,
        target_format: &str,
    ) -> Result<(), String> {
        Self::convert_texture_to_target_fmt_with_options(
            input_file_path,
            output_texture_path,
            target_format,
            None,
            None,
            None,
        )
    }

    pub fn convert_texture_to_target_fmt_with_size(
        input_file_path: &str,
        output_texture_path: &str,
        target_format: &str,
        width: u32,
        height: u32,
    ) -> Result<(), String> {
        Self::convert_texture_to_target_fmt_with_options(
            input_file_path,
            output_texture_path,
            target_format,
            None,
            None,
            Some((width, height)),
        )
    }

    pub fn convert_texture_to_rgba_dds(
        input_file_path: &str,
        output_texture_path: &str,
    ) -> Result<(), String> {
        Self::convert_texture_to_target_fmt_with_options(
            input_file_path,
            output_texture_path,
            "dds",
            None,
            None,
            None,
        )
    }

    fn convert_texture_to_target_fmt_with_options(
        input_file_path: &str,
        output_texture_path: &str,
        target_format: &str,
        file_suffix: Option<&str>,
        swizzle: Option<&str>,
        size: Option<(u32, u32)>,
    ) -> Result<(), String> {
        let source_texture_file_path = input_file_path.replace('\\', "/");
        let target_output_directory = output_texture_path.replace('\\', "/");

        if !Path::new(&source_texture_file_path).exists() {
            return Err(format!(
                "Source texture file does not exist: {}",
                source_texture_file_path
            ));
        }

        if !Path::new(&target_output_directory).exists() {
            fs::create_dir_all(&target_output_directory).map_err(|e| {
                format!(
                    "Failed to create output directory {}: {}",
                    target_output_directory, e
                )
            })?;
        }

        let mut arguments = vec![
            source_texture_file_path.clone(),
            "-ft".to_string(),
            target_format.to_string(),
        ];

        if let Some(file_suffix) = file_suffix {
            arguments.push("-sx".to_string());
            arguments.push(file_suffix.to_string());
        }

        arguments.push("-f".to_string());
        arguments.push("rgba".to_string());

        if let Some(swizzle) = swizzle {
            arguments.push("-swizzle".to_string());
            arguments.push(swizzle.to_string());
        }

        if let Some((width, height)) = size {
            arguments.push("-w".to_string());
            arguments.push(width.to_string());
            arguments.push("-h".to_string());
            arguments.push(height.to_string());
            // Authored alpha channels are masks/semantic data, not coverage
            // to be averaged. Point filtering preserves the source texel
            // exactly when a preview-sized DDS is required.
            arguments.push("-if".to_string());
            arguments.push("POINT".to_string());
            // Keep straight-alpha color data independent while filtering.
            // Otherwise transparent texels can bleed black into the RGB
            // channels and make an overlay disappear after downscaling.
            arguments.push("-sepalpha".to_string());
        }

        arguments.push("-o".to_string());
        arguments.push(target_output_directory);
        arguments.push("-y".to_string());

        SSMTCommandUtils::run_resources_program("texconv.exe", &arguments)?;

        Ok(())
    }
}
