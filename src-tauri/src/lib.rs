pub mod commands;
pub mod common;
pub mod config;
pub mod constants;
pub mod extract_new;
pub mod gametype;
pub mod helper;
pub mod ini_container;
pub mod utils;
pub mod workspace;

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const SHOW_WINDOW_SHORTCUT_LABEL: &str = "Alt+F";

fn reveal_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[GlobalShortcut] Main window is unavailable");
        return;
    };

    if let Err(error) = window.show() {
        eprintln!("[GlobalShortcut] Failed to show main window: {error}");
    }
    if let Err(error) = window.unminimize() {
        eprintln!("[GlobalShortcut] Failed to restore main window: {error}");
    }
    if let Err(error) = window.set_focus() {
        eprintln!("[GlobalShortcut] Failed to focus main window: {error}");
    }
}

// 我们的 run 函数现在主要负责组装（Wiring）
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            reveal_main_window(app);
        }))
        .setup(|app| {
            // 初始化 ModWatcher 状态
            app.manage(commands::mod_manager::ModWatcher(Mutex::new(None)));
            app.manage(commands::mod_library::ModLibraryWatcher(Mutex::new(None)));

            if let Err(error) = app.global_shortcut().on_shortcut(
                Shortcut::new(Some(Modifiers::ALT), Code::KeyF),
                |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        reveal_main_window(app);
                    }
                },
            ) {
                // A shortcut collision must not prevent SSMT from starting.
                eprintln!(
                    "[GlobalShortcut] Failed to register {SHOW_WINDOW_SHORTCUT_LABEL}: {error}"
                );
            }

            Ok(())
        })
        // 从各个子模块中注册命令
        .invoke_handler(tauri::generate_handler![
            commands::game_launcher::configure_zzmi_launch_settings,
            commands::game_launcher::configure_wwmi_launch_settings,
            commands::game_launcher::execute_external_program,
            commands::game_launcher::launch_programs,
            commands::game_launcher::file_md5,
            commands::mod_manager::watch_mods,
            commands::mod_manager::unwatch_mods,
            commands::mod_manager::preview_mod_archive,
            commands::mod_manager::mod_install_target_exists,
            commands::mod_manager::install_mod_archive,
            commands::mod_manager::gamebanana_download_and_install_mod,
            commands::mod_manager::cancel_gamebanana_download_and_install_mod,
            commands::mod_manager::export_mod_archive,
            commands::mod_manager::scan_directory,
            commands::mod_manager::get_mod_key_list,
            commands::mod_library::mod_library_stream_scan,
            commands::mod_library::mod_library_scan_group,
            commands::mod_library::mod_library_refresh_group,
            commands::mod_library::mod_library_refresh_all,
            commands::mod_library::mod_library_all_mods,
            commands::mod_library::watch_mod_library,
            commands::mod_library::unwatch_mod_library,
            commands::mod_library::find_nested_ini_files,
            commands::extract_model::extract_models_new,
            commands::extract_model::full_extract,
            commands::extract_model::analyze_draw_ib_submeshes,
            commands::vscheck::update_vscheck,
            commands::vscheck::generate_vscheck,
            commands::extract_textures::extract_deduped_textures,
            commands::extract_textures::extract_trianglelist_textures,
            commands::compress::extract_zip_archive,
            commands::compress::create_rar_archive,
            commands::compress::create_mod_archive,
            commands::recycle_bin::move_file_to_recycle_bin,
            commands::recycle_bin::move_dir_to_recycle_bin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
