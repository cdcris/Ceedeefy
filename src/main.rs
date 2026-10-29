use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use serde::Serialize;
use std::{
    env,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::Arc,
};
use tower_http::services::ServeDir;
use walkdir::WalkDir;

#[derive(Clone)]
struct AppState {
    music_root: Arc<PathBuf>,
}

#[derive(Serialize)]
struct Track {
    id: String,
    title: String,
    artist: String,
    album: String,
    format: String,
    bitrate_kbps: Option<u32>,
    duration: Option<u64>,
    src: String,
}

async fn tracks(State(state): State<AppState>) -> Result<Json<Vec<Track>>, (StatusCode, String)> {
    let root = state.music_root.clone();
    let items = tokio::task::spawn_blocking(move || scan_library(&root))
        .await
        .map_err(internal_error)??;
    Ok(Json(items))
}

fn scan_library(root: &Path) -> Result<Vec<Track>, (StatusCode, String)> {
    let mut tracks = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Some(mime) = mime_guess::from_path(path).first() else {
            continue;
        };
        if !mime.type_().as_str().eq_ignore_ascii_case("audio") {
            continue;
        }

        let relative = path.strip_prefix(root).map_err(internal_error)?;
        let id = relative.to_string_lossy().replace('\\', "/");
        let stem = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let (artist, title) = stem
            .split_once(" - ")
            .map_or(("Unknown Artist".to_owned(), stem.clone()), |(a, t)| {
                (a.to_owned(), t.to_owned())
            });
        let album = relative
            .parent()
            .and_then(Path::file_name)
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Local Files".to_owned());
        let format = path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_uppercase)
            .unwrap_or_else(|| "AUDIO".to_owned());
        let bitrate_kbps = if format == "MP3" {
            mp3_average_bitrate(path)
        } else {
            None
        };
        tracks.push(Track {
            src: format!("/media/{}", encode_path(&id)),
            id,
            title,
            artist,
            album,
            format,
            bitrate_kbps,
            duration: None,
        });
    }
    tracks.sort_by(|a, b| {
        a.artist
            .to_lowercase()
            .cmp(&b.artist.to_lowercase())
            .then(a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    Ok(tracks)
}

fn mp3_average_bitrate(path: &Path) -> Option<u32> {
    let mut file = File::open(path).ok()?;
    let mut prefix = [0; 10];
    let prefix_len = file.read(&mut prefix).ok()?;
    if prefix_len >= 10 && &prefix[..3] == b"ID3" {
        let tag_size = prefix[6..10]
            .iter()
            .fold(0_u64, |size, byte| (size << 7) | u64::from(byte & 0x7f));
        let footer_size = if prefix[5] & 0x10 != 0 { 10 } else { 0 };
        file.seek(SeekFrom::Start(10 + tag_size + footer_size))
            .ok()?;
    } else {
        file.seek(SeekFrom::Start(0)).ok()?;
    }

    let mut frame_bytes = 0_u64;
    let mut duration_seconds = 0.0_f64;
    loop {
        let mut header = [0; 4];
        if file.read_exact(&mut header).is_err() {
            break;
        }
        if let Some((length, sample_rate, samples)) = mp3_frame_info(header) {
            frame_bytes += length as u64;
            duration_seconds += f64::from(samples) / f64::from(sample_rate);
            if file.seek(SeekFrom::Current((length - 4) as i64)).is_err() {
                break;
            }
        } else if file.seek(SeekFrom::Current(-3)).is_err() {
            break;
        }
    }

    (duration_seconds > 0.0)
        .then(|| (frame_bytes as f64 * 8.0 / duration_seconds / 1000.0).round() as u32)
}

fn mp3_frame_info(header: [u8; 4]) -> Option<(usize, u32, u16)> {
    let bits = u32::from_be_bytes(header);
    if bits >> 21 != 0x7ff {
        return None;
    }
    let version = (bits >> 19) & 0b11;
    let layer = (bits >> 17) & 0b11;
    let bitrate_index = ((bits >> 12) & 0b1111) as usize;
    let sample_rate_index = ((bits >> 10) & 0b11) as usize;
    if version == 1
        || layer == 0
        || bitrate_index == 0
        || bitrate_index == 15
        || sample_rate_index == 3
    {
        return None;
    }

    const MPEG1_LAYER1: [u16; 14] = [
        32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448,
    ];
    const MPEG1_LAYER2: [u16; 14] = [
        32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384,
    ];
    const MPEG1_LAYER3: [u16; 14] = [
        32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
    ];
    const MPEG2_LAYER1: [u16; 14] = [
        32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256,
    ];
    const MPEG2_LAYER23: [u16; 14] = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    let bitrate = match (version, layer) {
        (3, 3) => MPEG1_LAYER1[bitrate_index - 1],
        (3, 2) => MPEG1_LAYER2[bitrate_index - 1],
        (3, 1) => MPEG1_LAYER3[bitrate_index - 1],
        (_, 3) => MPEG2_LAYER1[bitrate_index - 1],
        (_, _) => MPEG2_LAYER23[bitrate_index - 1],
    };
    let mut sample_rate = [44_100_u32, 48_000, 32_000][sample_rate_index];
    if version == 2 {
        sample_rate /= 2;
    }
    if version == 0 {
        sample_rate /= 4;
    }
    let padding = ((bits >> 9) & 1) as usize;
    let is_layer1 = layer == 3;
    let is_mpeg1 = version == 3;
    let coefficient = if is_layer1 {
        12
    } else if layer == 1 && !is_mpeg1 {
        72
    } else {
        144
    };
    let length = coefficient * usize::from(bitrate) * 1000 / sample_rate as usize
        + if is_layer1 { padding * 4 } else { padding };
    let samples = if is_layer1 {
        384
    } else if layer == 1 && !is_mpeg1 {
        576
    } else {
        1152
    };
    Some((length, sample_rate, samples))
}

#[cfg(test)]
mod tests {
    use super::mp3_frame_info;

    #[test]
    fn reads_mpeg1_layer3_frame_properties() {
        assert_eq!(
            mp3_frame_info([0xff, 0xfb, 0x90, 0x64]),
            Some((417, 44_100, 1_152))
        );
    }

    #[test]
    fn rejects_invalid_mp3_frame_headers() {
        assert_eq!(mp3_frame_info([0, 0, 0, 0]), None);
    }
}

fn encode_path(path: &str) -> String {
    path.split('/')
        .map(|part| {
            part.bytes()
                .map(|b| {
                    if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                        (b as char).to_string()
                    } else {
                        format!("%{b:02X}")
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn internal_error<E: std::fmt::Display>(error: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

#[tokio::main]
async fn main() {
    let music_path = env::var_os("MUSIC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Users\jocel\Music"));
    let web_root = PathBuf::from("./web");
    let state = AppState {
        music_root: Arc::new(music_path.clone()),
    };
    let app = Router::new()
        .route("/api/tracks", get(tracks))
        .nest_service("/media", ServeDir::new(&music_path))
        .fallback_service(ServeDir::new(web_root).append_index_html_on_directories(true))
        .with_state(state);
    let address = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_owned());
    let listener = tokio::net::TcpListener::bind(&address)
        .await
        .expect("bind address");
    println!(
        "Ceedeefy listening at http://{address}; music directory: {}",
        music_path.display()
    );
    axum::serve(listener, app).await.expect("serve app");
}
