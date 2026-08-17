use std::collections::HashMap;

use super::domain::DrawIndexed;
use super::ini_core::ExpressionValue;
use super::variable::Variable;

pub struct ExprUtils;

impl ExprUtils {
    fn is_magic_numeric_token(token: &str) -> bool {
        token.eq_ignore_ascii_case("INSTANCE_COUNT") || token.eq_ignore_ascii_case("FIRST_INSTANCE")
    }

    pub fn evaluate_result(
        expression_value: &ExpressionValue,
        active_key_value_map: &HashMap<String, String>,
    ) -> String {
        let mut expression_result = 0.0_f32;
        let mut last_expr_val = String::new();

        for expr_name in &expression_value.expression_list {
            let key = format!("${}", expr_name);
            if let Some(expr_val) = active_key_value_map.get(&key) {
                let parsed = expr_val.parse::<f32>().unwrap_or(0.0);
                if last_expr_val.is_empty() || last_expr_val == "+" {
                    expression_result += parsed;
                } else if last_expr_val == "-" {
                    expression_result -= parsed;
                }
            }
            last_expr_val = expr_name.clone();
        }

        (expression_result as i32).to_string()
    }

    pub fn split_logic_get_expression(expression: &str) -> Vec<String> {
        let mut result: Vec<String> = Vec::new();
        let mut current = String::new();
        let chars: Vec<char> = expression.chars().collect();

        let mut i = 0;
        while i < chars.len() {
            if i + 1 < chars.len() && chars[i] == '&' && chars[i + 1] == '&' {
                if !current.is_empty() {
                    result.push(current.trim().to_string());
                    current.clear();
                }
                i += 2;
                continue;
            }
            if i + 1 < chars.len() && chars[i] == '|' && chars[i + 1] == '|' {
                if !current.is_empty() {
                    result.push(current.trim().to_string());
                    current.clear();
                }
                i += 2;
                continue;
            }

            if chars[i] != '|' && chars[i] != '&' {
                current.push(chars[i]);
            }
            i += 1;
        }

        if !current.is_empty() {
            result.push(current.trim().to_string());
        }

        result
    }

    pub fn split_logic_get_logic(expression: &str) -> Vec<String> {
        let mut result: Vec<String> = Vec::new();
        let chars: Vec<char> = expression.chars().collect();

        let mut i = 0;
        while i < chars.len() {
            if i + 1 < chars.len() && chars[i] == '&' && chars[i + 1] == '&' {
                result.push("&&".to_string());
                i += 2;
                continue;
            }
            if i + 1 < chars.len() && chars[i] == '|' && chars[i + 1] == '|' {
                result.push("||".to_string());
                i += 2;
                continue;
            }
            i += 1;
        }

        result
    }

    pub fn resolve_numeric_token(
        token: &str,
        active_key_value_map: &HashMap<String, String>,
        global_variable_map: &HashMap<String, Variable>,
    ) -> Result<String, String> {
        let token_trim = token.trim();
        if token_trim.is_empty() {
            return Err("Numeric token is empty".to_string());
        }

        if let Ok(n) = token_trim.parse::<i64>() {
            crate::extract_log!(
                "[Expr][ResolveToken] token='{}' source=literal value={}",
                token_trim, n
            );
            return Ok(n.to_string());
        }

        if !token_trim.starts_with('$') {
            return Err(format!("Unsupported numeric token: {}", token_trim));
        }

        if let Some(active_value) = active_key_value_map.get(token_trim) {
            let parsed = active_value.trim().parse::<i64>().map_err(|_| {
                format!(
                    "Active variable {} value is not numeric: {}",
                    token_trim, active_value
                )
            })?;
            crate::extract_log!(
                "[Expr][ResolveToken] token='{}' source=active value={}",
                token_trim, parsed
            );
            return Ok(parsed.to_string());
        }

        let variable_name = token_trim.trim_start_matches('$');
        if let Some(global_var) = global_variable_map.get(variable_name) {
            if global_var.var_type == "expression" {
                let expr_result =
                    Self::evaluate_result(&global_var.expression_value, active_key_value_map);
                let parsed = expr_result.trim().parse::<i64>().map_err(|_| {
                    format!(
                        "Expression variable {} evaluated to non-numeric value: {}",
                        token_trim, expr_result
                    )
                })?;
                crate::extract_log!(
                    "[Expr][ResolveToken] token='{}' source=global-expression value={}",
                    token_trim, parsed
                );
                return Ok(parsed.to_string());
            }

            let parsed = global_var
                .initialize_value
                .trim()
                .parse::<i64>()
                .map_err(|_| {
                    format!(
                        "Global variable {} has non-numeric value: {}",
                        token_trim, global_var.initialize_value
                    )
                })?;
            crate::extract_log!(
                "[Expr][ResolveToken] token='{}' source=global-init value={}",
                token_trim, parsed
            );
            return Ok(parsed.to_string());
        }

        Err(format!("Variable {} is not defined", token_trim))
    }

    pub fn resolve_numeric_token_or_magic(
        token: &str,
        active_key_value_map: &HashMap<String, String>,
        global_variable_map: &HashMap<String, Variable>,
    ) -> Result<String, String> {
        let token_trim = token.trim();
        if Self::is_magic_numeric_token(token_trim) {
            return Ok(token_trim.to_string());
        }

        Self::resolve_numeric_token(token_trim, active_key_value_map, global_variable_map)
    }

    pub fn resolve_drawindexed(
        draw: &DrawIndexed,
        active_key_value_map: &HashMap<String, String>,
        global_variable_map: &HashMap<String, Variable>,
    ) -> Result<DrawIndexed, String> {
        let mut resolved = draw.clone();

        if resolved.auto_draw {
            return Ok(resolved);
        }

        resolved.draw_number = Self::resolve_numeric_token(
            &resolved.draw_number,
            active_key_value_map,
            global_variable_map,
        )?;
        resolved.draw_offset_index = Self::resolve_numeric_token(
            &resolved.draw_offset_index,
            active_key_value_map,
            global_variable_map,
        )?;
        resolved.draw_start_index = Self::resolve_numeric_token(
            &resolved.draw_start_index,
            active_key_value_map,
            global_variable_map,
        )?;

        if resolved.is_instanced {
            resolved.instance_count = Self::resolve_numeric_token_or_magic(
                &resolved.instance_count,
                active_key_value_map,
                global_variable_map,
            )?;
            resolved.start_instance_location = Self::resolve_numeric_token_or_magic(
                &resolved.start_instance_location,
                active_key_value_map,
                global_variable_map,
            )?;
        }

        Ok(resolved)
    }
}
