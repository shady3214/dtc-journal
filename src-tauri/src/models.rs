use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Trade {
    pub id: String,
    pub pair: String,
    pub direction: String,
    pub entry: f64,
    pub stop_loss: f64,
    pub take_profit: f64,
    pub lot_size: f64,
    pub capital: f64,
    pub enable_commission: bool,
    pub commission_per_lot: f64,
    pub risk_percent: f64,
    pub pnl: f64,
    pub return_percent: f64,
    pub status: String,
    pub tags: Vec<String>,
    pub mistakes: Vec<String>,
    pub setup: Option<String>,
    pub chart_image_data: Option<String>,
    pub notes_html: String,
    pub opened_at: String,
    pub closed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDayStat {
    pub date: String,
    pub trades: i64,
    pub pnl: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquityPoint {
    pub date: String,
    pub value: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSummary {
    pub win_rate: f64,
    pub avg_win: f64,
    pub avg_loss: f64,
    pub total_pnl: f64,
    pub risk_reward: f64,
    pub equity_curve: Vec<EquityPoint>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAnalysis {
    pub id: String,
    pub trade_id: String,
    pub summary: String,
    pub mistakes: Vec<String>,
    pub setup_classification: String,
    pub risk_feedback: String,
    pub confidence: f64,
    pub created_at: String,
}
