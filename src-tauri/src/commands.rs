use chrono::Utc;
use rusqlite::params;
use tauri::AppHandle;

use crate::ai::analyze_with_ollama;
use crate::db;
use crate::models::{AiAnalysis, AnalyticsSummary, CalendarDayStat, EquityPoint, Trade};

#[tauri::command]
pub async fn proxy_yf_quote(url_path: String) -> Result<String, String> {
    let target = format!("https://query2.finance.yahoo.com{}", url_path);
    let client = reqwest::Client::new();
    let resp = client
        .get(&target)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn proxy_tv_search(query: String) -> Result<String, String> {
    let target = format!(
        "https://symbol-search.tradingview.com/symbol_search/?{}",
        query
    );
    let client = reqwest::Client::new();
    let resp = client
        .get(&target)
        .header("Origin", "https://www.tradingview.com")
        .header("Referer", "https://www.tradingview.com/")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_trades(app: AppHandle, account_id: String) -> Result<Vec<Trade>, String> {
    let conn = db::connection(&app)?;
    let mut stmt = conn.prepare("SELECT id,pair,direction,entry,stop_loss,take_profit,lot_size,capital,enable_commission,commission_per_lot,risk_percent,pnl,return_percent,status,tags_json,mistakes_json,setup,chart_image_data,notes_html,opened_at,closed_at FROM trades WHERE account_id=?1 ORDER BY opened_at DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![account_id], |row| {
        let tags_json: String = row.get(14)?;
        let mistakes_json: String = row.get(15)?;
        Ok(Trade {
            id: row.get(0)?, pair: row.get(1)?, direction: row.get(2)?, entry: row.get(3)?,
            stop_loss: row.get(4)?, take_profit: row.get(5)?, lot_size: row.get(6)?, capital: row.get(7)?,
            enable_commission: row.get::<_, i64>(8)? != 0, commission_per_lot: row.get(9)?,
            risk_percent: row.get(10)?, pnl: row.get(11)?, return_percent: row.get(12)?, status: row.get(13)?,
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            mistakes: serde_json::from_str(&mistakes_json).unwrap_or_default(),
            setup: row.get(16)?, chart_image_data: row.get(17)?,
            notes_html: row.get(18)?, opened_at: row.get(19)?, closed_at: row.get(20)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn upsert_trade(app: AppHandle, trade: Trade, account_id: String) -> Result<Trade, String> {
    let conn = db::connection(&app)?;
    conn.execute("INSERT INTO trades (id,account_id,pair,direction,entry,stop_loss,take_profit,lot_size,capital,enable_commission,commission_per_lot,risk_percent,pnl,return_percent,status,tags_json,mistakes_json,setup,chart_image_data,notes_html,opened_at,closed_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)
     ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,pair=excluded.pair,direction=excluded.direction,entry=excluded.entry,stop_loss=excluded.stop_loss,take_profit=excluded.take_profit,lot_size=excluded.lot_size,capital=excluded.capital,enable_commission=excluded.enable_commission,commission_per_lot=excluded.commission_per_lot,risk_percent=excluded.risk_percent,pnl=excluded.pnl,return_percent=excluded.return_percent,status=excluded.status,tags_json=excluded.tags_json,mistakes_json=excluded.mistakes_json,setup=excluded.setup,chart_image_data=excluded.chart_image_data,notes_html=excluded.notes_html,opened_at=excluded.opened_at,closed_at=excluded.closed_at",
     params![trade.id,account_id,trade.pair,trade.direction,trade.entry,trade.stop_loss,trade.take_profit,trade.lot_size,trade.capital,if trade.enable_commission {1}else{0},trade.commission_per_lot,trade.risk_percent,trade.pnl,trade.return_percent,trade.status,serde_json::to_string(&trade.tags).map_err(|e| e.to_string())?,serde_json::to_string(&trade.mistakes).map_err(|e| e.to_string())?,trade.setup,trade.chart_image_data,trade.notes_html,trade.opened_at,trade.closed_at]).map_err(|e| e.to_string())?;
    Ok(trade)
}

#[tauri::command]
pub fn delete_trade(app: AppHandle, id: String) -> Result<(), String> {
    db::connection(&app)?.execute("DELETE FROM trades WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_calendar_month(app: AppHandle, year: i32, month: u32, account_id: String) -> Result<Vec<CalendarDayStat>, String> {
    let conn = db::connection(&app)?;
    let month_prefix = format!("{year:04}-{month:02}");
    let mut stmt = conn.prepare("SELECT substr(opened_at,1,10), COUNT(*), COALESCE(SUM(pnl),0) FROM trades WHERE account_id=?1 AND opened_at LIKE ?2 || '%' GROUP BY substr(opened_at,1,10)").map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![account_id, month_prefix], |row| Ok(CalendarDayStat { date: row.get(0)?, trades: row.get(1)?, pnl: row.get(2)? })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_analytics(app: AppHandle, account_id: String) -> Result<AnalyticsSummary, String> {
    let conn = db::connection(&app)?;
    let mut stmt = conn.prepare("SELECT pnl, opened_at FROM trades WHERE account_id=?1 AND status='Closed' ORDER BY opened_at ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![account_id], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
    let mut wins = vec![]; let mut losses = vec![]; let mut total = 0.0; let mut eq = 0.0; let mut curve = vec![];
    for r in rows { let (p, d) = r.map_err(|e| e.to_string())?; if p >= 0.0 { wins.push(p) } else { losses.push(p.abs()) }; total += p; eq += p; curve.push(EquityPoint { date: d.chars().take(10).collect(), value: eq }); }
    let n = wins.len() + losses.len(); let win_rate = if n == 0 {0.0} else {(wins.len() as f64 / n as f64) * 100.0};
    let avg_win = if wins.is_empty() {0.0} else {wins.iter().sum::<f64>() / wins.len() as f64};
    let avg_loss = if losses.is_empty() {0.0} else {losses.iter().sum::<f64>() / losses.len() as f64};
    Ok(AnalyticsSummary { win_rate, avg_win, avg_loss: -avg_loss, total_pnl: total, risk_reward: if avg_loss == 0.0 {0.0} else {avg_win/avg_loss}, equity_curve: curve })
}

#[tauri::command]
pub fn analyze_trade_image(app: AppHandle, trade_id: String, _image_path: String) -> Result<AiAnalysis, String> {
    let conn = db::connection(&app)?;
    // Look up trade directly by ID (no account_id needed — trade IDs are globally unique)
    let mut stmt = conn.prepare("SELECT id,pair,direction,entry,stop_loss,take_profit,lot_size,capital,enable_commission,commission_per_lot,risk_percent,pnl,return_percent,status,tags_json,mistakes_json,setup,chart_image_data,notes_html,opened_at,closed_at FROM trades WHERE id=?1").map_err(|e| e.to_string())?;
    let trade = stmt.query_row(params![trade_id], |row| {
        let tags_json: String = row.get(14)?;
        let mistakes_json: String = row.get(15)?;
        Ok(Trade {
            id: row.get(0)?, pair: row.get(1)?, direction: row.get(2)?, entry: row.get(3)?,
            stop_loss: row.get(4)?, take_profit: row.get(5)?, lot_size: row.get(6)?, capital: row.get(7)?,
            enable_commission: row.get::<_, i64>(8)? != 0, commission_per_lot: row.get(9)?,
            risk_percent: row.get(10)?, pnl: row.get(11)?, return_percent: row.get(12)?, status: row.get(13)?,
            tags: serde_json::from_str(&tags_json).unwrap_or_default(),
            mistakes: serde_json::from_str(&mistakes_json).unwrap_or_default(),
            setup: row.get(16)?, chart_image_data: row.get(17)?,
            notes_html: row.get(18)?, opened_at: row.get(19)?, closed_at: row.get(20)?,
        })
    }).map_err(|_| "Trade not found".to_string())?;
    let img = trade.chart_image_data.as_deref().filter(|v| !v.trim().is_empty()).ok_or("No chart image found for this trade".to_string())?;
    let ai = analyze_with_ollama(&trade, img)?;
    let created_at = Utc::now().to_rfc3339();
    let id = db::save_ai(&conn, &trade_id, &ai.summary, &serde_json::to_string(&ai.mistakes).map_err(|e| e.to_string())?, &ai.setup_classification, &ai.risk_feedback, ai.confidence, &created_at)?;
    Ok(AiAnalysis { id, trade_id, summary: ai.summary, mistakes: ai.mistakes, setup_classification: ai.setup_classification, risk_feedback: ai.risk_feedback, confidence: ai.confidence, created_at })
}

#[tauri::command]
pub fn list_trade_analyses(app: AppHandle, trade_id: String) -> Result<Vec<AiAnalysis>, String> {
    let conn = db::connection(&app)?;
    let mut stmt = conn.prepare("SELECT id,trade_id,summary,mistakes_json,setup_classification,risk_feedback,confidence,created_at FROM ai_analyses WHERE trade_id=?1 ORDER BY created_at DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![trade_id], |row| {
        let m: String = row.get(3)?;
        Ok(AiAnalysis { id: row.get(0)?, trade_id: row.get(1)?, summary: row.get(2)?, mistakes: serde_json::from_str(&m).unwrap_or_default(), setup_classification: row.get(4)?, risk_feedback: row.get(5)?, confidence: row.get(6)?, created_at: row.get(7)? })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
