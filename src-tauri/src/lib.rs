mod ai;
mod commands;
mod db;
mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![
      commands::list_trades,
      commands::upsert_trade,
      commands::delete_trade,
      commands::get_calendar_month,
      commands::get_analytics,
      commands::analyze_trade_image,
      commands::list_trade_analyses,
      commands::proxy_yf_quote,
      commands::proxy_tv_search,
      commands::proxy_ff_calendar
    ])
    .setup(|app| {
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
