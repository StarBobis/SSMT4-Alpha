use std::cell::RefCell;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Language {
    Chinese,
    English,
}

struct Session {
    language: Language,
    lines: Vec<String>,
}

thread_local! {
    static SESSION: RefCell<Option<Session>> = const { RefCell::new(None) };
}

pub fn begin(language: Option<&str>) {
    SESSION.with(|slot| {
        *slot.borrow_mut() = Some(Session {
            language: if language == Some("en") {
                Language::English
            } else {
                Language::Chinese
            },
            lines: Vec::new(),
        })
    });
}

fn translate_to_english(message: &str) -> String {
    const REPLACEMENTS: &[(&str, &str)] = &[
        ("开始新提取流程", "Starting the new extraction flow"),
        ("开始提取", "Starting extraction"),
        ("提取正常执行完成", "Extraction completed successfully"),
        ("FrameAnalysis 文件夹路径", "FrameAnalysis folder"),
        ("当前LOD工作空间路径", "Current LOD workspace path"),
        ("当前游戏预设", "Current game preset"),
        ("是否全量提取", "Full extraction"),
        ("数据类型筛选", "Data-type filter"),
        ("所有数据类型", "All data types"),
        (
            "仅 GPU-PreSkinning 数据类型",
            "GPU-PreSkinning data types only",
        ),
        (
            "仅 CPU-PreSkinning 数据类型",
            "CPU-PreSkinning data types only",
        ),
        ("当前DrawIB", "Current DrawIB"),
        ("当前数据类型", "Current data type"),
        ("读取数据类型", "Loaded data type"),
        ("识别到数据类型", "Detected data type"),
        ("输出数据类型", "Output data type"),
        ("尝试匹配数据类型", "Trying data type"),
        (
            "自动优化:已经找到了满足条件的GPU类型，所以这个CPU类型就不用判断了",
            "Optimization: a matching GPU type was found; skipping this CPU type",
        ),
        ("无法识别", "Unable to identify"),
        (
            "当前识别到的PointlistIndex为空，此DrawIB可能为CPU-PreSkinning类型",
            "PointlistIndex is empty; this DrawIB may use CPU-PreSkinning",
        ),
        (
            "未找到对应PointlistIndex，该DrawIB可能为CPU-PreSkinning类型",
            "No PointlistIndex found; this DrawIB may use CPU-PreSkinning",
        ),
        ("当前识别到的PointlistIndex", "Detected PointlistIndex"),
        ("槽位匹配成功", "Slot matched"),
        ("槽位匹配失败", "Slot did not match"),
        ("匹配成功", "Matched"),
        ("匹配失败", "Did not match"),
        ("跳过此数据类型识别", "skipping this data type"),
        ("跳过此数据类型", "skipping this data type"),
        ("跳过当前DrawIB", "skipping current DrawIB"),
        ("跳过提取", "skipping extraction"),
        (
            "对应Buffer文件未找到,此数据类型无效",
            "Required buffer file was not found; this data type is invalid",
        ),
        (
            "当前数据类型的部分槽位文件无法找到",
            "Some slot files for the current data type were not found",
        ),
        (
            "当前数据类型并非所有的槽位Buffer文件都存在，不满足",
            "Not every slot buffer required by this data type exists",
        ),
        ("槽位的文件大小不能为0", "Slot file size cannot be zero"),
        (
            "文件步长除以类别步长不能含有余数",
            "file stride is not divisible by category stride",
        ),
        ("余数不为0", "Remainder is not zero"),
        ("槽位的txt文件不存在", "Slot txt file does not exist"),
        ("槽位的txt文件路径不存在", "Slot txt path does not exist"),
        (
            "槽位的txt文件Stride与数据类型Stride不符",
            "Slot txt stride does not match the data-type stride",
        ),
        (
            "文件中显示步长与数据类型步长不符",
            "Displayed stride does not match the data-type stride",
        ),
        (
            "未检测到当前CategorySlot文件",
            "Current CategorySlot file was not found",
        ),
        (
            "未找到当前CategorySlot对应文件",
            "No file was found for the current CategorySlot",
        ),
        (
            "从各个Buffer文件中读取数据",
            "Reading data from buffer files",
        ),
        ("文件不存在", "file does not exist"),
        ("路径不存在", "path does not exist"),
    ];
    REPLACEMENTS
        .iter()
        .fold(message.to_string(), |text, (from, to)| {
            text.replace(from, to)
        })
}

fn record(level: &str, message: &str) {
    SESSION.with(|slot| {
        let mut session = slot.borrow_mut();
        let Some(session) = session.as_mut() else {
            return;
        };
        let rendered = if session.language == Language::English {
            translate_to_english(message)
        } else {
            message.to_string()
        };
        session.lines.push(format!(
            "{} [{}] {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            level,
            rendered
        ));
    });
}

pub fn info(message: &str) {
    std::println!("{}", message);
    record("INFO", message);
}
pub fn error(message: &str) {
    std::eprintln!("{}", message);
    record("ERROR", message);
}
pub fn take() -> Vec<String> {
    SESSION.with(|slot| {
        slot.borrow_mut()
            .take()
            .map(|session| session.lines)
            .unwrap_or_default()
    })
}

#[macro_export]
macro_rules! extract_log {
    () => { $crate::utils::extraction_log::info("") };
    ($($arg:tt)*) => { $crate::utils::extraction_log::info(&format!($($arg)*)) };
}

#[macro_export]
macro_rules! extract_error {
    () => { $crate::utils::extraction_log::error("") };
    ($($arg:tt)*) => { $crate::utils::extraction_log::error(&format!($($arg)*)) };
}
