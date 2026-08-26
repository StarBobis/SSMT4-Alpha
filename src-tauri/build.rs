use std::{env, fs, path::PathBuf};

fn main() {
    build_directxtex_bridge();
    configure_windows_delay_load();
    copy_windivert_runtime_files();
    tauri_build::build()
}

fn build_directxtex_bridge() {
    if env::var("CARGO_CFG_WINDOWS").is_err() {
        return;
    }
    println!("cargo:rustc-check-cfg=cfg(directxtex_native)");
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let sibling_root = manifest
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("vcpkg"));
    let candidates = env::var_os("VCPKG_ROOT")
        .map(PathBuf::from)
        .into_iter()
        .chain(sibling_root)
        .collect::<Vec<_>>();
    let Some((root, installed)) = candidates.iter().find_map(|root| {
        let installed = root.join("installed").join("x64-windows-static-md");
        (installed.join("include").join("DirectXTex.h").is_file()
            && installed.join("lib").join("DirectXTex.lib").is_file())
        .then(|| (root, installed))
    }) else {
        let preferred = candidates
            .last()
            .cloned()
            .unwrap_or_else(|| PathBuf::from("vcpkg"));
        panic!(
            "Native DirectXTex is required. Run: {} install directxtex[dx11]:x64-windows-static-md",
            preferred.join("vcpkg.exe").display()
        );
    };
    println!("cargo:warning=Using DirectXTex from {}", root.display());
    let include = installed.join("include");
    let mut build = cc::Build::new();
    build
        .cpp(true)
        .file("native/texture_encoder.cpp")
        .flag_if_supported("/std:c++17")
        .include(&include);
    build.compile("ssmt_texture_encoder");
    println!(
        "cargo:rustc-link-search=native={}",
        installed.join("lib").display()
    );
    println!("cargo:rustc-link-lib=DirectXTex");
    println!("cargo:rustc-cfg=directxtex_native");
    for lib in ["d3d11", "dxgi", "windowscodecs", "ole32"] {
        println!("cargo:rustc-link-lib={lib}");
    }
    println!("cargo:rerun-if-changed=native/texture_encoder.cpp");
}

fn configure_windows_delay_load() {
    if env::var("CARGO_CFG_WINDOWS").is_ok() {
        println!("cargo:rustc-link-lib=delayimp");
        println!("cargo:rustc-link-arg=/DELAYLOAD:WinDivert.dll");
    }
}

fn copy_windivert_runtime_files() {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("missing CARGO_MANIFEST_DIR"));
    let windivert_dir = manifest_dir.join("resources").join("WinDivert");
    let runtime_files = [
        windivert_dir.join("WinDivert.dll"),
        windivert_dir.join("WinDivert64.sys"),
    ];

    for runtime_file in &runtime_files {
        println!("cargo:rerun-if-changed={}", runtime_file.display());
    }

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("missing OUT_DIR"));
    let Some(profile_dir) = out_dir
        .parent()
        .and_then(|path| path.parent())
        .and_then(|path| path.parent())
    else {
        return;
    };

    for runtime_file in runtime_files {
        if !runtime_file.exists() {
            continue;
        }

        let file_name = runtime_file
            .file_name()
            .expect("runtime file missing file name");
        let target_file = profile_dir.join(file_name);
        if let Err(error) = fs::copy(&runtime_file, &target_file) {
            panic!(
                "failed to copy {} to {}: {}",
                runtime_file.display(),
                target_file.display(),
                error
            );
        }
    }
}
