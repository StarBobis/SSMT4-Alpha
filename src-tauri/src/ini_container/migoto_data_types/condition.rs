use std::collections::HashMap;

use super::expr_utils::ExprUtils;
use super::ini_core::MigotoAttribute;
use super::variable::Variable;

#[derive(Debug, Clone, Default)]
pub struct ConditionExpression {
    pub var_name: String,
    pub operator: String,
    pub var_value: String,
}

#[derive(Debug, Clone, Default)]
pub struct Condition {
    pub attr: MigotoAttribute,
    pub condition_expression_list: Vec<ConditionExpression>,
    pub logic_list: Vec<String>,
}

impl Condition {
    pub fn new(condition_str: impl Into<String>) -> Self {
        let condition_str = condition_str.into();
        let mut out = Self::default();
        let single_expression = !condition_str.contains("&&") && !condition_str.contains("||");

        if single_expression {
            out.condition_expression_list
                .push(parse_condition_expression(&condition_str));
        } else {
            for condition_segment in ExprUtils::split_logic_get_expression(&condition_str) {
                out.condition_expression_list
                    .push(parse_condition_expression(&condition_segment));
            }
            out.logic_list = ExprUtils::split_logic_get_logic(&condition_str);
        }

        out
    }

    pub fn is_active(
        &self,
        active_key_value_map: &HashMap<String, String>,
        global_variable_map: &HashMap<String, Variable>,
    ) -> bool {
        if self.logic_list.is_empty() {
            let Some(condition_expression) = self.condition_expression_list.first() else {
                return false;
            };

            return evaluate_condition_expression(
                condition_expression,
                active_key_value_map,
                global_variable_map,
            );
        }

        let mut find_or_logic = false;
        for logic in &self.logic_list {
            if logic == "||" {
                find_or_logic = true;
                break;
            }
        }

        if !find_or_logic {
            for condition_expression in &self.condition_expression_list {
                if !evaluate_condition_expression(
                    condition_expression,
                    active_key_value_map,
                    global_variable_map,
                ) {
                    return false;
                }
            }
            return true;
        }

        if self.condition_expression_list.len() == self.logic_list.len() + 1 {
            for condition_expression in &self.condition_expression_list {
                if evaluate_condition_expression(
                    condition_expression,
                    active_key_value_map,
                    global_variable_map,
                ) {
                    return true;
                }
            }
        }

        false
    }

    pub fn show(&self) {
        crate::extract_log!("Condition Show:");
        crate::extract_log!("NameSpace: {}", self.attr.namespace);

        if self.condition_expression_list.is_empty() {
            crate::extract_log!("  <No ConditionExpression>");
        } else {
            for (idx, expr) in self.condition_expression_list.iter().enumerate() {
                crate::extract_log!("  Expression[{}].VarName: {}", idx, expr.var_name);
                crate::extract_log!("  Expression[{}].Operator: {}", idx, expr.operator);
                crate::extract_log!("  Expression[{}].VarValue: {}", idx, expr.var_value);
            }
        }

        if self.logic_list.is_empty() {
            crate::extract_log!("LogicList: <empty>");
        } else {
            crate::extract_log!("LogicList:");
            for (idx, logic) in self.logic_list.iter().enumerate() {
                crate::extract_log!("  [{}]: {}", idx, logic);
            }
        }
    }
}

fn parse_condition_expression(condition_str: &str) -> ConditionExpression {
    let trimmed = condition_str.trim();
    for operator in ["==", "!=", "<=", ">=", "<", ">"] {
        if let Some((left, right)) = trimmed.split_once(operator) {
            return ConditionExpression {
                var_name: left.trim().to_string(),
                operator: operator.to_string(),
                var_value: right.trim().to_string(),
            };
        }
    }

    ConditionExpression {
        var_name: trimmed.to_string(),
        operator: "truthy".to_string(),
        var_value: "1".to_string(),
    }
}

fn evaluate_condition_expression(
    condition_expression: &ConditionExpression,
    active_key_value_map: &HashMap<String, String>,
    global_variable_map: &HashMap<String, Variable>,
) -> bool {
    if condition_expression.var_name == "draw_type" {
        return true;
    }

    let Some(left_value) = resolve_condition_value(
        &condition_expression.var_name,
        active_key_value_map,
        global_variable_map,
    ) else {
        return false;
    };

    match condition_expression.operator.as_str() {
        "==" => left_value.trim() == condition_expression.var_value.trim(),
        "!=" => left_value.trim() != condition_expression.var_value.trim(),
        "<" | ">" | "<=" | ">=" => {
            let Ok(left_number) = left_value.trim().parse::<f64>() else {
                return false;
            };
            let Ok(right_number) = condition_expression.var_value.trim().parse::<f64>() else {
                return false;
            };

            match condition_expression.operator.as_str() {
                "<" => left_number < right_number,
                ">" => left_number > right_number,
                "<=" => left_number <= right_number,
                ">=" => left_number >= right_number,
                _ => false,
            }
        }
        "truthy" => left_value.trim() != "0" && !left_value.trim().is_empty(),
        _ => false,
    }
}

fn resolve_condition_value(
    var_name: &str,
    active_key_value_map: &HashMap<String, String>,
    global_variable_map: &HashMap<String, Variable>,
) -> Option<String> {
    if let Some(active_value) = active_key_value_map.get(var_name) {
        return Some(active_value.clone());
    }

    let key_without_dollar = var_name.strip_prefix('$').unwrap_or(var_name);
    if let Some(variable) = global_variable_map.get(key_without_dollar) {
        if key_without_dollar == "active" {
            return Some("1".to_string());
        }

        if variable.var_type == "expression" {
            return Some(ExprUtils::evaluate_result(
                &variable.expression_value,
                active_key_value_map,
            ));
        }

        if !variable.initialize_value.is_empty() {
            return Some(variable.initialize_value.trim().to_string());
        }
    }

    None
}
