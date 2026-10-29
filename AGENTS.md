# Repository Guidelines

## Project Structure

- `src/main.rs` contains the Axum server, library scan, track metadata extraction, and route setup.
- `web/` contains the static browser client: `index.html`, `styles.css`, and `app.js`. No frontend package manager or build step is currently used.
- `Cargo.toml` and `Cargo.lock` define and lock Rust dependencies. Keep the lockfile committed when dependencies change.
- There is no test directory yet. Add Rust unit or integration tests alongside new behavior where practical.

## Build and Development

- `cargo run` starts the server in development mode at `127.0.0.1:3000`.
- `cargo run --release` builds and runs an optimized server.
- `cargo check` checks Rust code without producing a release binary.
- `cargo fmt --check` verifies standard Rust formatting; run `cargo fmt` to apply it.
- `cargo test` runs the Rust test suite (currently no project tests are defined).

Set `MUSIC_DIR` to the local or mounted Samba music directory; the current Windows default is `C:\Users\jocel\Music`. Set `BIND_ADDR=0.0.0.0:3000` only when devices on the local network need to connect.

## Code Style

Use `rustfmt` defaults, four-space Rust indentation, `snake_case` for functions and variables, and `PascalCase` for types. Keep route handlers focused and move blocking filesystem scans off the async runtime. Use semantic HTML, accessible labels, and consistent two-space indentation in HTML, CSS, and JavaScript. Escape user-visible metadata inserted into the DOM.

## Testing

For Rust changes, run `cargo fmt --check`, `cargo check`, and `cargo test`. For UI changes, start the app and manually verify library loading, search, playback, and responsive layout in a browser. Test against a small local music folder before using a mounted share. Include regression coverage when fixing a reproducible bug.

## Commits and Pull Requests

Git history was unavailable during guide preparation, so no established commit convention could be confirmed. Use short imperative commit subjects, optionally with a scope, such as `feat(player): add queue controls`. Pull requests should describe the user-visible change, note configuration changes, link related issues when available, and include screenshots for visual updates. Mention checks run and any limitations.

## Configuration and Safety

Keep local credentials and machine-specific settings out of commits. Do not commit music files or generated `target/` output. The server has no authentication; keep it on a trusted network and do not expose it directly to the public internet.
