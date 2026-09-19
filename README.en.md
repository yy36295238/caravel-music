# Liusheng · Local MP3 Music Player

[简体中文](README.md) · **English**

**Liusheng (留声 / Caravel Music)** is a lightweight desktop music player for local MP3 collections on macOS and Windows. Import a music folder, browse albums and artists, read synchronized local lyrics, and keep your favorites and tags on your own computer. No account is required for playback.

[Website](https://caravel-music.pages.dev) · [Download for macOS](https://github.com/yy36295238/caravel-music/releases/download/v0.1.0/liusheng_0.1.0_macos_universal.dmg) · [Releases](https://github.com/yy36295238/caravel-music/releases) · [Report an issue](https://github.com/yy36295238/caravel-music/issues)

![Liusheng music library with dark theme, album tracks and synchronized lyrics](site/assets/player-dark.webp)

## Features

| Feature | What it does |
| --- | --- |
| Local music library | Import MP3 folders and their subfolders; refresh metadata and remove missing-file entries |
| Folder-based browsing | Filter by an imported folder's name while keeping the original file structure |
| Albums and artists | Organize tracks using local metadata; distinguish identically named albums by artist |
| Search | Find tracks by title, artist, album, filename or imported folder name |
| Favorites and tags | Save favorite tracks, manage tags and organize multiple tracks together |
| Local lyrics | Read matching LRC files or embedded lyrics, highlight the current line and seek by clicking |
| Lyric timing | Adjust and save a timing offset for each track without editing the source file |
| Playback queue | Sequential playback, shuffle and repeat-one, with a small playback-state indicator |
| macOS menu bar | Pause, skip tracks and switch playback modes from a compact panel |
| Two themes | Dark red and light green, sharing the same playback and library behavior |
| Local storage | Save the library index and playback preferences locally in SQLite |

<details>
<summary>Light green theme</summary>

![Liusheng light green theme](site/assets/player-light.webp)

</details>

## Download and install

| Platform | Requirements | Availability |
| --- | --- | --- |
| macOS Universal | macOS 12+, Apple Silicon or Intel | [v0.1.0 DMG, 7.4 MB](https://github.com/yy36295238/caravel-music/releases/download/v0.1.0/liusheng_0.1.0_macos_universal.dmg) |
| Windows x64 | Windows 10 / 11 and WebView2 | Build from source; no Windows installer is published in this release |

On macOS, open the DMG and drag Liusheng (留声) into Applications. The current build is ad-hoc signed and is **not Apple-notarized**. If macOS blocks it, verify the download source and follow the instructions in System Settings → Privacy & Security.

## Get started

1. Add a folder containing MP3 files. Subfolders are included automatically.
2. Choose a track, album, artist or imported folder to start listening.
3. Click the heart to save a favorite. Manage tags and themes in Settings.
4. Put `song.lrc` next to `song.mp3` to display local lyrics. Embedded lyrics are used when no external LRC is available.

Importing does not copy, move or modify your audio files. Removing a source folder does not delete the music. A successful refresh removes entries for files that no longer exist; offline folders and failed scans retain their entries.

## Scope

- MP3 playback is currently supported. Other audio formats are not advertised as supported.
- Playback, library search, favorites, tags and local lyrics work offline. Downloads require a network connection.
- There is no streaming catalog, online lyric search, cloud sync, equalizer or audio conversion.
- Linux, Android and iOS packages are not provided.
- Library metadata and preferences are stored on the user's computer. There is no required server or account.

## Development

Built with **Tauri 2, Rust, SQLite and vanilla JavaScript / CSS**. The app uses the system WebView instead of bundling Chromium.

Requirements: Node.js 22+, Rust stable, and platform build tools. macOS requires Xcode Command Line Tools; Windows requires Visual Studio C++ Build Tools, Windows SDK and WebView2.

```sh
git clone https://github.com/yy36295238/caravel-music.git
cd caravel-music
./run.sh                     # Start desktop development
./run.sh build universal dmg # Build a universal macOS DMG on macOS
./run.sh build nsis          # Build a Windows installer in Windows Git Bash
./run.sh clean               # Remove build output; keep DMGs in artifacts/
```

For validation, run `npm run check`. See the [detailed guide (Chinese)](docs/guide.md) for application data locations, native checks, packaging and lyric handling.

## Feedback

Please include your operating system, CPU architecture, app version and reproduction steps when opening an [issue](https://github.com/yy36295238/caravel-music/issues). Use a minimal non-private example for metadata or lyric problems; do not upload your personal music library or database.
