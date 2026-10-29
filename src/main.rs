use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use serde::Serialize;
use std::{env, path::{Path, PathBuf}, sync::Arc};
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
    for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() { continue; }
        let path = entry.path();
        let Some(mime) = mime_guess::from_path(path).first() else { continue };
        if !mime.type_().as_str().eq_ignore_ascii_case("audio") { continue; }

        let relative = path.strip_prefix(root).map_err(internal_error)?;
        let id = relative.to_string_lossy().replace('\\', "/");
        let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let (artist, title) = stem.split_once(" - ").map_or(("Unknown Artist".to_owned(), stem.clone()), |(a, t)| (a.to_owned(), t.to_owned()));
        let album = relative.parent().and_then(Path::file_name).map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Local Files".to_owned());
        tracks.push(Track { src: format!("/media/{}", encode_path(&id)), id, title, artist, album, duration: None });
    }
    tracks.sort_by(|a, b| a.artist.to_lowercase().cmp(&b.artist.to_lowercase()).then(a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    Ok(tracks)
}

fn encode_path(path: &str) -> String {
    path.split('/').map(|part| part.bytes().map(|b| {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }
    }).collect::<String>()).collect::<Vec<_>>().join("/")
}

fn internal_error<E: std::fmt::Display>(error: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

#[tokio::main]
async fn main() {
    let music_path = env::var_os("MUSIC_DIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Users\jocel\Music"));
    let web_root = PathBuf::from("./web");
    let state = AppState { music_root: Arc::new(music_path.clone()) };
    let app = Router::new()
        .route("/api/tracks", get(tracks))
        .nest_service("/media", ServeDir::new(&music_path))
        .fallback_service(ServeDir::new(web_root).append_index_html_on_directories(true))
        .with_state(state);
    let address = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_owned());
    let listener = tokio::net::TcpListener::bind(&address).await.expect("bind address");
    println!("Ceedeefy listening at http://{address}; music directory: {}", music_path.display());
    axum::serve(listener, app).await.expect("serve app");
}
