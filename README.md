# Ceedeefy

A small, self-hosted music player written in Rust. It reads audio from a directory and serves a responsive browser UI with search, ordered playback, shuffle, repeat, seeking, and volume controls.

## Samba music folder

By default, Ceedeefy reads `C:\Users\jocel\Music`. You can override this with `MUSIC_DIR`. If the app runs on a different machine, point `MUSIC_DIR` at the Samba share as seen by that machine. Mount the share with your operating system first so Samba credentials stay in the OS credential store.

Examples:

- Windows mapped drive or UNC path: `MUSIC_DIR=Z:\Music` or `MUSIC_DIR=\\nas\music`
- Linux mount: `MUSIC_DIR=/mnt/music`
- macOS mount: `MUSIC_DIR=/Volumes/Music`

The server indexes audio files under that directory. Supported formats depend on the browser; MP3, AAC/M4A, Ogg, and WAV are commonly supported. Filenames formatted as `Artist - Title.ext` are displayed with that artist and title. Other filenames appear under “Unknown Artist.”

## Run

Install Rust from [rustup.rs](https://rustup.rs), then from this directory. The default library path is already your Windows Music folder:

```powershell
cargo run --release
```

To let a phone on the same Wi-Fi access Ceedeefy, set the bind address before starting it:

```powershell
$env:BIND_ADDR = "0.0.0.0:3000"
cargo run --release
```

Then open `http://<this-PC's-LAN-IP>:3000` on the phone. Allow Rust/Ceedeefy through Windows Firewall on a private network if prompted.

On Linux/macOS:

```sh
MUSIC_DIR=/mnt/music cargo run --release
```

Open http://127.0.0.1:3000. To access it from other devices on your LAN, set `BIND_ADDR=0.0.0.0:3000` and open that machine's LAN address. The server has no authentication yet, so keep it on a trusted network.

The library is rescanned when the app starts or when the refresh button is clicked.
