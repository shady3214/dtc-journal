use crate::models::Trade;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::env;

#[derive(Debug, Serialize, Deserialize)]
pub struct AiResult {
    pub summary: String,
    pub mistakes: Vec<String>,
    pub setup_classification: String,
    pub risk_feedback: String,
    pub confidence: f64,
}

#[derive(Debug, Serialize)]
struct OllamaMessage {
    role: String,
    content: String,
    images: Vec<String>,
}

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    stream: bool,
    format: String,
    messages: Vec<OllamaMessage>,
    options: Value,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    message: OllamaResponseMessage,
}

#[derive(Debug, Deserialize)]
struct OllamaResponseMessage {
    content: String,
}

pub fn analyze_with_ollama(trade: &Trade, image_data_url: &str) -> Result<AiResult, String> {
    let model = env::var("OLLAMA_VISION_MODEL").unwrap_or_else(|_| "llava-llama3".to_string());
    let image_b64 = image_data_url
        .split_once(',')
        .map(|(_, r)| r.to_string())
        .unwrap_or_else(|| image_data_url.to_string());
    let prompt = format!(
        "Analyze this FX chart screenshot and return strict JSON only with keys: tradeIdeaSummary,mistakes,setupClassification,riskManagementFeedback,recommendations,motivation,confidence.\nTrade context pair={}, direction={}, entry={}, stopLoss={}, takeProfit={}, riskPercent={}",
        trade.pair, trade.direction, trade.entry, trade.stop_loss, trade.take_profit, trade.risk_percent
    );

    let req = OllamaRequest {
        model,
        stream: false,
        format: "json".to_string(),
        messages: vec![OllamaMessage {
            role: "user".to_string(),
            content: prompt,
            images: vec![image_b64],
        }],
        options: serde_json::json!({"temperature": 0.2}),
    };
    let timeout_secs = env::var("OLLAMA_TIMEOUT_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(45);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post("http://127.0.0.1:11434/api/chat")
        .json(&req)
        .send()
        .map_err(|e| e.to_string())?;
    let body: OllamaResponse = resp.json().map_err(|e| e.to_string())?;
    parse_ai_json(&body.message.content)
}

fn parse_ai_json(raw: &str) -> Result<AiResult, String> {
    let v: Value = serde_json::from_str(raw)
        .or_else(|_| serde_json::from_str(extract_json_object(raw).as_deref().unwrap_or("{}")))
        .map_err(|e| format!("Model response was not JSON: {e}; raw={raw}"))?;
    let summary = v
        .get("tradeIdeaSummary")
        .and_then(Value::as_str)
        .or_else(|| v.get("summary").and_then(Value::as_str))
        .unwrap_or("No summary returned")
        .to_string();
    let mistakes = v
        .get("mistakes")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_else(Vec::new);
    let setup = v
        .get("setupClassification")
        .and_then(Value::as_str)
        .or_else(|| v.get("setup").and_then(Value::as_str))
        .unwrap_or("unknown")
        .to_string();
    let risk = v
        .get("riskManagementFeedback")
        .and_then(Value::as_str)
        .or_else(|| v.get("riskFeedback").and_then(Value::as_str))
        .unwrap_or("No risk feedback returned")
        .to_string();
    let confidence = v.get("confidence").and_then(Value::as_f64).unwrap_or(0.5);
    Ok(AiResult {
        summary,
        mistakes,
        setup_classification: setup,
        risk_feedback: risk,
        confidence,
    })
}

fn extract_json_object(input: &str) -> Option<String> {
    let start = input.find('{')?;
    let end = input.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(input[start..=end].to_string())
}
