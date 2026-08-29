// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod native_texture_encoder;

fn main() {
    ssmt4_lib::run()
}
