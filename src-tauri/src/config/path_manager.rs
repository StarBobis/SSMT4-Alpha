use std::env;
use std::path::PathBuf;

pub struct PathManager;

impl PathManager {
    /// SSMT 自带的 resources 文件夹路径（优先运行目录旁的 resources，找不到则回退到开发目录）。
    pub fn ssmt_resources_folder() -> PathBuf {
        // 1) 尝试可执行文件所在目录/父目录的 resources（适用于打包/安装后的路径）
        if let Ok(exe_path) = env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let candidate = exe_dir.join("resources");
                if candidate.exists() {
                    return candidate;
                }

                // 某些打包方式下，resources 可能与 exe 同级的上一级目录
                if let Some(parent) = exe_dir.parent() {
                    let candidate = parent.join("resources");
                    if candidate.exists() {
                        return candidate;
                    }
                }
            }
        }

        // 2) 开发环境回退：使用当前工作目录下的 src-tauri/resources
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("src-tauri")
            .join("resources")
    }

    ///SSMT自带的resources目录下的Games文件夹
    pub fn ssmt_games_folder() -> PathBuf {
        Self::ssmt_resources_folder().join("Games")
    }

    ///SSMT自带的resources目录下的GameType文件夹
    ///只作为安装包内的初始来源，启动时会同步到用户配置目录。
    pub fn bundled_gametype_folder() -> PathBuf {
        Self::ssmt_resources_folder().join("GameType")
    }

    pub fn app_data_local_folder() -> PathBuf {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(local);
        }

        // 最后兜底：当前工作目录
        env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    }

    pub fn ssmt_global_config_folder() -> PathBuf {
        Self::app_data_local_folder().join("SSMT4GlobalConfigs")
    }

    pub fn global_config_games_folder() -> PathBuf {
        Self::ssmt_global_config_folder().join("Games")
    }

    ///用户配置目录下的GameType文件夹
    ///与Games文件夹一样位于SSMT4GlobalConfigs下，是运行时唯一的数据类型读取来源。
    pub fn ssmt_gametype_folder() -> PathBuf {
        Self::ssmt_global_config_folder().join("GameType")
    }

    pub fn global_config_games_game_folder(game_name: &str) -> PathBuf {
        Self::global_config_games_folder().join(game_name)
    }
}
