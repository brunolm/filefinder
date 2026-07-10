use chrono::NaiveDate;
use clap::Parser;
use serde::Serialize;
use std::io::{BufWriter, Write};
use std::time::UNIX_EPOCH;
use walkdir::{DirEntry, WalkDir};

const VIDEO_EXTS: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "3gp", "ts", "vob",
];
const IMAGE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff", "tif", "svg", "heic", "heif", "raw",
    "cr2", "nef", "arw", "ico",
];
const DOCUMENT_EXTS: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "odt", "ods", "odp", "csv",
    "md", "epub",
];
const AUDIO_EXTS: &[&str] = &[
    "mp3", "wav", "flac", "m4a", "aac", "ogg", "wma", "opus", "mid", "midi",
];
const ARCHIVE_EXTS: &[&str] = &["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"];

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "$RECYCLE.BIN",
    "System Volume Information",
    "AppData",
];

#[derive(Parser)]
struct Args {
    /// Directory to search from
    #[arg(long)]
    root: String,
    /// Space-separated terms; every term must appear in the file name
    #[arg(long, default_value = "")]
    query: String,
    /// all | video | image | document | audio | archive | folder
    #[arg(long, default_value = "all")]
    category: String,
    /// YYYY-MM-DD (inclusive, start of day)
    #[arg(long)]
    modified_after: Option<String>,
    /// YYYY-MM-DD (inclusive, end of day)
    #[arg(long)]
    modified_before: Option<String>,
    /// Also walk into hidden and system folders
    #[arg(long, default_value_t = false)]
    include_hidden: bool,
    /// Stop after this many matches
    #[arg(long, default_value_t = 5000)]
    limit: usize,
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum Record<'a> {
    #[serde(rename = "file")]
    File {
        path: &'a str,
        name: &'a str,
        ext: &'a str,
        size: u64,
        modified: i64,
        is_dir: bool,
    },
    #[serde(rename = "done")]
    Done {
        scanned: u64,
        matched: u64,
        truncated: bool,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

fn main() {
    let args = Args::parse();
    let stdout = std::io::stdout();
    let mut out = BufWriter::new(stdout.lock());

    let after = match parse_day_bound(&args.modified_after, false) {
        Ok(v) => v,
        Err(e) => return emit_error(&mut out, e),
    };
    let before = match parse_day_bound(&args.modified_before, true) {
        Ok(v) => v,
        Err(e) => return emit_error(&mut out, e),
    };
    if !std::path::Path::new(&args.root).is_dir() {
        return emit_error(&mut out, format!("Not a folder: {}", args.root));
    }

    let terms: Vec<String> = args
        .query
        .split_whitespace()
        .map(|t| t.to_lowercase())
        .collect();
    let category = args.category.to_lowercase();
    let include_hidden = args.include_hidden;

    let mut scanned: u64 = 0;
    let mut matched: u64 = 0;
    let mut truncated = false;

    let walker = WalkDir::new(&args.root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| include_hidden || !is_skipped(e));

    for entry in walker {
        let Ok(entry) = entry else { continue };
        if entry.depth() == 0 {
            continue;
        }
        scanned += 1;

        let name = entry.file_name().to_string_lossy();
        if !matches_terms(&name, &terms) {
            continue;
        }
        let is_dir = entry.file_type().is_dir();
        let ext = if is_dir {
            String::new()
        } else {
            entry
                .path()
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default()
        };
        if !matches_category(&category, &ext, is_dir) {
            continue;
        }

        let Ok(meta) = entry.metadata() else { continue };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        if let Some(after) = after {
            if modified < after {
                continue;
            }
        }
        if let Some(before) = before {
            if modified > before {
                continue;
            }
        }

        matched += 1;
        let record = Record::File {
            path: &entry.path().to_string_lossy(),
            name: &name,
            ext: &ext,
            size: if is_dir { 0 } else { meta.len() },
            modified,
            is_dir,
        };
        let _ = serde_json::to_writer(&mut out, &record);
        let _ = out.write_all(b"\n");
        let _ = out.flush();

        if matched >= args.limit as u64 {
            truncated = true;
            break;
        }
    }

    let _ = serde_json::to_writer(
        &mut out,
        &Record::Done {
            scanned,
            matched,
            truncated,
        },
    );
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

fn matches_terms(name: &str, terms: &[String]) -> bool {
    if terms.is_empty() {
        return true;
    }
    let lower = name.to_lowercase();
    terms.iter().all(|t| lower.contains(t))
}

fn matches_category(category: &str, ext: &str, is_dir: bool) -> bool {
    match category {
        "all" => true,
        "folder" => is_dir,
        _ if is_dir => false,
        "video" => VIDEO_EXTS.contains(&ext),
        "image" => IMAGE_EXTS.contains(&ext),
        "document" => DOCUMENT_EXTS.contains(&ext),
        "audio" => AUDIO_EXTS.contains(&ext),
        "archive" => ARCHIVE_EXTS.contains(&ext),
        _ => true,
    }
}

fn is_skipped(entry: &DirEntry) -> bool {
    if !entry.file_type().is_dir() {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    name.starts_with('.') || SKIP_DIRS.iter().any(|d| name.eq_ignore_ascii_case(d))
}

/// Returns epoch millis; end=true maps the date to 23:59:59.999 of that day.
fn parse_day_bound(input: &Option<String>, end: bool) -> Result<Option<i64>, String> {
    let Some(input) = input else { return Ok(None) };
    let date = NaiveDate::parse_from_str(input, "%Y-%m-%d")
        .map_err(|_| format!("Invalid date (expected YYYY-MM-DD): {input}"))?;
    let millis = date
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_utc()
        .timestamp_millis();
    Ok(Some(if end {
        millis + 24 * 60 * 60 * 1000 - 1
    } else {
        millis
    }))
}

fn emit_error<W: Write>(out: &mut W, message: String) {
    let _ = serde_json::to_writer(&mut *out, &Record::Error { message });
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}
