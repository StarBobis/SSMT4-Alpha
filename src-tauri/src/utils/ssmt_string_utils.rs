pub struct SSMTStringUtils;

impl SSMTStringUtils {
    pub fn trim_owned(input: &str) -> String {
        input.trim().to_string()
    }

    pub fn remove_dollar_prefix(input: &str) -> String {
        if let Some(rest) = input.strip_prefix('$') {
            rest.to_string()
        } else {
            input.to_string()
        }
    }

    pub fn split_once_owned(input: &str, delimiter: &str) -> Option<(String, String)> {
        let (left, right) = input.split_once(delimiter)?;
        Some((left.to_string(), right.to_string()))
    }

    pub fn is_valid_filename(name: &str) -> bool {
        let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
        !name.chars().any(|ch| invalid.contains(&ch))
    }

    /// C#-style substring by character index and length.
    ///
    /// - `start`: 0-based character index.
    /// - `len`: number of characters to take.
    pub fn substring(input: &str, start: usize, len: usize) -> Result<String, String> {
        let char_count = input.chars().count();

        if start > char_count {
            return Err(format!(
                "substring start out of range: start={}, char_count={}",
                start, char_count
            ));
        }

        let end = start
            .checked_add(len)
            .ok_or_else(|| "substring end overflow".to_string())?;
        if end > char_count {
            return Err(format!(
                "substring length out of range: start={}, len={}, char_count={}",
                start, len, char_count
            ));
        }

        Ok(input.chars().skip(start).take(len).collect::<String>())
    }

    /// Parse pixel slot fragment from texture filename, e.g. `ps-t3` from `...-ps-t3=...`.
    pub fn get_pixel_slot_from_texture_file_name(
        texture_file_name: &str,
    ) -> Result<String, String> {
        let start_pos = texture_file_name.find('-').ok_or_else(|| {
            format!(
                "Invalid texture filename (missing '-'): {}",
                texture_file_name
            )
        })?;
        let end_pos = texture_file_name.find('=').ok_or_else(|| {
            format!(
                "Invalid texture filename (missing '='): {}",
                texture_file_name
            )
        })?;

        if end_pos <= start_pos + 1 {
            return Err(format!(
                "Invalid texture filename slot segment: {}",
                texture_file_name
            ));
        }

        let mut pixel_slot = texture_file_name[start_pos + 1..end_pos].to_string();

        if pixel_slot.contains("-vs") {
            if let Some(last_dash) = pixel_slot.rfind('-') {
                pixel_slot = pixel_slot[..last_dash].to_string();
            }
        }

        Ok(pixel_slot)
    }

    /// Parse pixel slot number from texture filename, e.g. `3` from `ps-t3`.
    pub fn get_pixel_slot_number_from_texture_file_name(
        texture_file_name: &str,
    ) -> Result<i32, String> {
        let pixel_slot = Self::get_pixel_slot_from_texture_file_name(texture_file_name)?;
        let marker = "-t";
        let start = pixel_slot
            .find(marker)
            .ok_or_else(|| format!("Pixel slot missing '-t' marker: {}", pixel_slot))?
            + marker.len();

        let number = &pixel_slot[start..];
        number.parse::<i32>().map_err(|e| {
            format!(
                "Failed to parse pixel slot number from '{}': {}",
                texture_file_name, e
            )
        })
    }

    /// Get file hash from a migoto dump filename.
    ///
    /// Priority is `!S!=` -> `!U!=` -> first `=` and then take the following 8 chars.
    pub fn get_file_hash_from_file_name(input_migoto_file_name: &str) -> String {
        fn take_after_marker(input: &str, marker: &str, len: usize) -> Option<String> {
            let pos = input.find(marker)?;
            let start = pos + marker.len();
            let end = start + len;
            if end <= input.len() {
                Some(input[start..end].to_string())
            } else {
                None
            }
        }

        if input_migoto_file_name.contains("!S!=") {
            return take_after_marker(input_migoto_file_name, "!S!=", 8).unwrap_or_default();
        }

        if input_migoto_file_name.contains("!U!=") {
            return take_after_marker(input_migoto_file_name, "!U!=", 8).unwrap_or_default();
        }

        if let Some(pos) = input_migoto_file_name.find('=') {
            let start = pos + 1;
            let end = start + 8;
            if end <= input_migoto_file_name.len() {
                return input_migoto_file_name[start..end].to_string();
            }
        }

        String::new()
    }

    /// Get 16-char PS hash from `-ps=` segment in filename.
    pub fn get_ps_hash_from_file_name(input: &str) -> String {
        if let Some(pos) = input.find("-ps=") {
            let start = pos + 4;
            let end = start + 16;
            if end <= input.len() {
                return input[start..end].to_string();
            }
        }

        String::new()
    }

    /// Get 16-char VS hash from `-vs=` segment in filename.
    pub fn get_vs_hash_from_file_name(input: &str) -> String {
        if let Some(pos) = input.find("-vs=") {
            let start = pos + 4;
            let end = start + 16;
            if end <= input.len() {
                return input[start..end].to_string();
            }
        }

        String::new()
    }
}
