use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

pub fn connection(app: &AppHandle) -> Result<Connection, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("journal.db");
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS trades (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL DEFAULT 'default',
            pair TEXT NOT NULL,
            direction TEXT NOT NULL,
            entry REAL NOT NULL,
            stop_loss REAL NOT NULL,
            take_profit REAL NOT NULL,
            lot_size REAL NOT NULL,
            capital REAL NOT NULL DEFAULT 0,
            enable_commission INTEGER NOT NULL DEFAULT 0,
            commission_per_lot REAL NOT NULL DEFAULT 0,
            risk_percent REAL NOT NULL,
            pnl REAL NOT NULL,
            return_percent REAL NOT NULL,
            status TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            mistakes_json TEXT NOT NULL DEFAULT '[]',
            setup TEXT,
            chart_image_data TEXT,
            notes_html TEXT NOT NULL,
            opened_at TEXT NOT NULL,
            closed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS ai_analyses (
            id TEXT PRIMARY KEY,
            trade_id TEXT NOT NULL,
            summary TEXT NOT NULL,
            mistakes_json TEXT NOT NULL,
            setup_classification TEXT NOT NULL,
            risk_feedback TEXT NOT NULL,
            confidence REAL NOT NULL,
            created_at TEXT NOT NULL
        );",
    )
    .map_err(|e| e.to_string())?;

    // Migration: add mistakes_json column to existing trades tables that lack it
    let has_mistakes: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('trades') WHERE name='mistakes_json'")
        .and_then(|mut s| s.query_row([], |r| r.get::<_, i64>(0)))
        .unwrap_or(0)
        > 0;
    if !has_mistakes {
        conn.execute_batch(
            "ALTER TABLE trades ADD COLUMN mistakes_json TEXT NOT NULL DEFAULT '[]';",
        )
        .map_err(|e| e.to_string())?;
    }

    // Migration: add account_id column to existing trades tables that lack it
    let has_account_id: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('trades') WHERE name='account_id'")
        .and_then(|mut s| s.query_row([], |r| r.get::<_, i64>(0)))
        .unwrap_or(0)
        > 0;
    if !has_account_id {
        conn.execute_batch(
            "ALTER TABLE trades ADD COLUMN account_id TEXT NOT NULL DEFAULT 'default';",
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn save_ai(
    conn: &Connection,
    trade_id: &str,
    summary: &str,
    mistakes_json: &str,
    setup_classification: &str,
    risk_feedback: &str,
    confidence: f64,
    created_at: &str,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO ai_analyses (id,trade_id,summary,mistakes_json,setup_classification,risk_feedback,confidence,created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![id, trade_id, summary, mistakes_json, setup_classification, risk_feedback, confidence, created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}
