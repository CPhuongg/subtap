# Subtap

A browser-based subtitle timing tool for syncing lyrics to video, with automatic beat detection and snap-to-beat support.

## Features

- **Timestamp marking** — Mark subtitle start times in real-time while the video plays
- **Beat detection** — Analyzes the audio track to detect beat positions
- **Snap to beat** — Automatically snaps marked timestamps to the nearest beat (configurable sensitivity)
- **Snap all** — Retroactively snaps all existing timestamps to the nearest beats
- **Dual lyrics track** — Enter two lyric lines per segment (e.g. original + translation)
- **Display modes** — Show Lyrics 1 only, Lyrics 2 only, or merge both
- **SRT export** — Export synced subtitles as a standard `.srt` file
- **SRT import** — Load an existing `.srt` file to edit timestamps
- **Dark / Light theme** — Toggle via the Theme button
- **Keyboard shortcuts** — `Space` to play/pause, `Enter` to mark, `Z` to undo

## Getting Started

No build step required. Open `index.html` directly in a browser.

```
subtap/
├── index.html
├── app.js
└── styles.css
```

## Usage

1. Click the file input and load a video file
2. Paste your lyrics into the **Lyrics track 1** textarea (one line per subtitle segment)
3. (Optional) Paste a second language or harmony into **Lyrics track 2**
4. Play the video and press **Enter** (or click **Mark**) at the start of each line
5. Click **Export** to download the `.srt` file

### Beat Snap

1. Load a video, then click **Analyze** to detect beats from the audio
2. Enable the **Snap to beat** checkbox to automatically snap new marks to nearby beats
3. Choose sensitivity: `Very tight (±0.05s)`, `Normal (±0.1s)`, or `Loose (±0.2s)`
4. Use **Snap all** to re-snap all existing timestamps at once

### Keyboard Shortcuts

| Key     | Action        |
|---------|---------------|
| `Space` | Play / Pause  |
| `Enter` | Mark timestamp |
| `Z`     | Undo last mark |

## SRT Format

Exported files follow the standard SRT format:

```
1
00:00:01,200 --> 00:00:03,400
First line of lyrics

2
00:00:03,400 --> 00:00:05,600
Second line of lyrics
```

## Browser Compatibility

Requires a browser with support for the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) for beat detection (Chrome, Edge, Firefox, Safari all supported).
