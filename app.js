// ===============================
// DOM ELEMENTS
// ===============================

// Video elements
const video = document.getElementById("video");
const videoInput = document.getElementById("videoInput");

// Control buttons
const markBtn = document.getElementById("markBtn");
const undoBtn = document.getElementById("undoBtn");
const clearBtn = document.getElementById("clearBtn");
const exportBtn = document.getElementById("exportBtn");

// Lyrics elements
const lyricsInput1 = document.getElementById("lyricsInput1");
const lyricsInput2 = document.getElementById("lyricsInput2");
const displayMode = document.getElementById("displayMode");

// Timestamp display
const timestampsDiv = document.getElementById("timestamps");

// Import/Export
const srtInput = document.getElementById("srtInput");

// Theme
const themeToggle = document.getElementById("themeToggle");

// Beat detection elements
const snapToBeatCheckbox = document.getElementById("snapToBeat");
const snapSensitivity = document.getElementById("snapSensitivity");
const analyzeBeatBtn = document.getElementById("analyzeBeatBtn");
const snapAllBtn = document.getElementById("snapAllBtn");
const adjustToBeatBtn = document.getElementById("adjustToBeatBtn");
const autoSplitBtn = document.getElementById("autoSplitBtn");
const generateFromBeatsBtn = document.getElementById("generateFromBeatsBtn");

// ===============================
// APPLICATION STATE
// ===============================

let timestamps = [];
let beatTimes = [];
let audioContext = null;
let isAnalyzing = false;

// Waveform state
let waveformData = null;
let waveformSampleRate = 0;
let waveformDuration = 0;
let waveformZoomStart = 0;
let waveformZoomEnd = 0;
let waveformDragIndex = -1;

// Scrollbar drag state
let scrollbarDragging = false;
let scrollbarDragStartX = 0;
let scrollbarDragStartZoom = 0;

// ===============================
// UTILITY FUNCTIONS
// ===============================

function formatTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function srtToSec(timeStr) {
    const [hms, ms] = timeStr.split(",");
    const [h, m, s] = hms.split(":").map(Number);
    return h * 3600 + m * 60 + s + (parseInt(ms) || 0) / 1000;
}

function downloadFile(content, filename) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ===============================
// LYRIC MANAGEMENT
// ===============================

function getLyricsForIndex(index) {
    const lyrics1 = lyricsInput1.value.split("\n");
    const lyrics2 = lyricsInput2.value.split("\n");
    const mode = displayMode.value;
    
    if (mode === "replace") return lyrics1[index] || "";
    if (mode === "second") return lyrics2[index] || "";
    if (mode === "merge") {
        const line1 = lyrics1[index] || "";
        const line2 = lyrics2[index] || "";
        return line2 ? `${line1}\n${line2}` : line1;
    }
    return "";
}

function updateLyricsArray(newLyrics) {
    lyricsInput1.value = newLyrics.map(l => l.lyric1 || "").join("\n");
    lyricsInput2.value = newLyrics.map(l => l.lyric2 || "").join("\n");
}

// ===============================
// TIMESTAMP DISPLAY
// ===============================

function renderTimestamps() {
    if (!timestampsDiv) return;
    
    timestampsDiv.innerHTML = "";
    
    const lyrics1 = lyricsInput1.value.split("\n");
    const lyrics2 = lyricsInput2.value.split("\n");
    const mode = displayMode.value;
    
    const fragment = document.createDocumentFragment();
    
    // Display timestamps from newest to oldest
    for (let i = timestamps.length - 1; i >= 0; i--) {
        let text = "";
        if (mode === "replace") text = lyrics1[i] || "";
        if (mode === "second") text = lyrics2[i] || "";
        if (mode === "merge") text = (lyrics1[i] || "") + (lyrics2[i] ? "\n" + lyrics2[i] : "");
        
        const div = document.createElement("div");
        div.className = "timestamp-item";
        
        const timeSpan = document.createElement("div");
        timeSpan.className = "timestamp-time";
        
        const isOnBeat = beatTimes.some(b => Math.abs(b - timestamps[i]) < 0.05);
        const beatIcon = isOnBeat ? " 🎵" : "";
        
        timeSpan.textContent = `${formatTime(timestamps[i])}${beatIcon} → ${timestamps[i + 1] ? formatTime(timestamps[i + 1]) : "..."}`;
        
        const lyricSpan = document.createElement("div");
        lyricSpan.className = "timestamp-text";
        lyricSpan.textContent = text || "(empty)";
        
        div.appendChild(timeSpan);
        div.appendChild(lyricSpan);
        fragment.appendChild(div);
    }
    
    timestampsDiv.appendChild(fragment);
    
    // Show next line preview
    const nextIndex = timestamps.length;
    let preview = "";
    if (mode === "replace") preview = lyrics1[nextIndex] || "";
    if (mode === "second") preview = lyrics2[nextIndex] || "";
    if (mode === "merge") preview = (lyrics1[nextIndex] || "") + (lyrics2[nextIndex] ? "\n" + lyrics2[nextIndex] : "");
    
    if (preview) {
        const previewDiv = document.createElement("div");
        previewDiv.className = "timestamp-item next-line";
        previewDiv.innerHTML = `
            <div class="timestamp-time">NEXT</div>
            <div class="timestamp-text">${preview}</div>
        `;
        timestampsDiv.prepend(previewDiv);
    }

    if (waveformData) renderWaveform();
}

// ===============================
// WAVEFORM RENDERING
// ===============================

function renderWaveform() {
    const canvas = document.getElementById("waveformCanvas");
    if (!canvas || !waveformData) return;

    const container = document.getElementById("waveformContainer");
    container.classList.remove("waveform-hidden");

    // Resize canvas backing-store to match display size (DPR-aware)
    const dpr = window.devicePixelRatio || 1;
    const cssWidth  = canvas.clientWidth  || canvas.offsetWidth  || 800;
    const cssHeight = canvas.clientHeight || canvas.offsetHeight || 100;
    if (canvas.width  !== Math.round(cssWidth  * dpr) ||
        canvas.height !== Math.round(cssHeight * dpr)) {
        canvas.width  = Math.round(cssWidth  * dpr);
        canvas.height = Math.round(cssHeight * dpr);
    }

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = cssWidth;
    const ch = cssHeight;

    // Read theme colours from CSS variables
    const rootStyle = getComputedStyle(document.documentElement);
    const colBg    = rootStyle.getPropertyValue("--surface").trim()       || "#111";
    const colWave  = "rgba(99, 102, 241, 0.65)";  // indigo — phân biệt với stamp palette
    const colBeat  = "rgba(255,200,0,0.45)";
    const colDrag  = "#f97316";
    const STAMP_PALETTE = ["#10b981","#3b82f6","#f59e0b","#ec4899","#8b5cf6","#06b6d4","#ef4444","#84cc16"];
    const colCursor = document.documentElement.classList.contains("light-theme") ? "#000" : "#fff";

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = colBg;
    ctx.fillRect(0, 0, cw, ch);

    const visStart = waveformZoomStart;
    const visEnd   = waveformZoomEnd;
    const visDur   = Math.max(visEnd - visStart, 0.001);

    const timeToX = (t) => ((t - visStart) / visDur) * cw;

    // Draw waveform — min/max per pixel column to preserve transients
    const startSample = Math.floor(visStart * waveformSampleRate);
    const endSample   = Math.min(Math.ceil(visEnd * waveformSampleRate), waveformData.length);
    const samplesPerPixel = Math.max(1, Math.floor((endSample - startSample) / cw));

    ctx.beginPath();
    ctx.strokeStyle = colWave;
    ctx.lineWidth   = 1;
    for (let px = 0; px < cw; px++) {
        const sStart = startSample + Math.floor(px       * samplesPerPixel);
        const sEnd   = Math.min(startSample + Math.floor((px + 1) * samplesPerPixel), waveformData.length);
        let mn = 0, mx = 0;
        for (let s = sStart; s < sEnd; s++) {
            const v = waveformData[s];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        const y1 = ((1 - mx) / 2) * ch;
        const y2 = ((1 - mn) / 2) * ch;
        ctx.moveTo(px + 0.5, y1);
        ctx.lineTo(px + 0.5, Math.max(y2, y1 + 1));
    }
    ctx.stroke();

    // Draw beat markers
    ctx.strokeStyle = colBeat;
    ctx.lineWidth = 1;
    for (const bt of beatTimes) {
        if (bt < visStart || bt > visEnd) continue;
        const x = timeToX(bt);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ch);
        ctx.stroke();
    }

    // Draw timestamp markers
    for (let i = 0; i < timestamps.length; i++) {
        const t = timestamps[i];
        if (t < visStart - 0.5 || t > visEnd + 0.5) continue;
        const x = timeToX(t);
        const col = (i === waveformDragIndex) ? colDrag : STAMP_PALETTE[i % STAMP_PALETTE.length];
        ctx.strokeStyle = col;
        ctx.fillStyle   = col;
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ch);
        ctx.stroke();
        // Triangle handle at top
        ctx.beginPath();
        ctx.moveTo(x - 5, 0);
        ctx.lineTo(x + 5, 0);
        ctx.lineTo(x,      9);
        ctx.closePath();
        ctx.fill();
        // Index label
        ctx.font = "9px monospace";
        ctx.fillText(i + 1, x + 3, 20);
    }

    // Draw playback cursor
    if (video.src && video.duration) {
        const cursorX = timeToX(video.currentTime);
        if (cursorX >= 0 && cursorX <= cw) {
            ctx.strokeStyle = colCursor;
            ctx.lineWidth   = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(cursorX, 0);
            ctx.lineTo(cursorX, ch);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    renderScrollbar();
}

function renderScrollbar() {
    const sb = document.getElementById("waveformScrollbar");
    if (!sb || !waveformData) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = sb.clientWidth  || sb.offsetWidth  || 800;
    const cssH = sb.clientHeight || sb.offsetHeight || 18;
    if (sb.width  !== Math.round(cssW * dpr) ||
        sb.height !== Math.round(cssH * dpr)) {
        sb.width  = Math.round(cssW * dpr);
        sb.height = Math.round(cssH * dpr);
    }

    const ctx = sb.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cssW, H = cssH;

    const rootStyle = getComputedStyle(document.documentElement);
    const colBg    = rootStyle.getPropertyValue("--surface-light").trim() || "#1a1a1a";
    const colTrack = rootStyle.getPropertyValue("--border").trim()        || "#2a2a2a";
    const colThumb = rootStyle.getPropertyValue("--primary").trim()       || "#10b981";

    // Background
    ctx.fillStyle = colBg;
    ctx.fillRect(0, 0, W, H);

    // Mini-waveform (full audio overview)
    const totalSamples = waveformData.length;
    const spPerPx = Math.max(1, Math.floor(totalSamples / W));
    ctx.strokeStyle = colTrack;
    ctx.lineWidth = 1;
    for (let px = 0; px < W; px++) {
        const sStart = Math.floor(px * spPerPx);
        const sEnd   = Math.min(Math.floor((px + 1) * spPerPx), totalSamples);
        let mn = 0, mx = 0;
        for (let s = sStart; s < sEnd; s++) {
            if (waveformData[s] < mn) mn = waveformData[s];
            if (waveformData[s] > mx) mx = waveformData[s];
        }
        const y1 = ((1 - mx) / 2) * H;
        const y2 = ((1 - mn) / 2) * H;
        ctx.beginPath();
        ctx.moveTo(px + 0.5, y1);
        ctx.lineTo(px + 0.5, Math.max(y2, y1 + 1));
        ctx.stroke();
    }

    // Thumb (current visible window)
    const thumbX1 = (waveformZoomStart / waveformDuration) * W;
    const thumbX2 = (waveformZoomEnd   / waveformDuration) * W;
    const thumbW  = Math.max(4, thumbX2 - thumbX1);
    // Fill (25% opacity) — append "40" hex to 6-char color
    const fillCol = colThumb.startsWith("#") && colThumb.length === 7
        ? colThumb + "40"
        : "rgba(16,185,129,0.25)";
    ctx.fillStyle = fillCol;
    ctx.fillRect(thumbX1, 0, thumbW, H);
    ctx.strokeStyle = colThumb;
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(thumbX1 + 0.75, 0.75, thumbW - 1.5, H - 1.5);
}

function initScrollbarInteraction() {
    const sb = document.getElementById("waveformScrollbar");
    if (!sb) return;

    function sbX(e) {
        return e.clientX - sb.getBoundingClientRect().left;
    }

    function thumbContains(x) {
        const W = sb.clientWidth || 1;
        const x1 = (waveformZoomStart / waveformDuration) * W;
        const x2 = (waveformZoomEnd   / waveformDuration) * W;
        return x >= x1 - 4 && x <= x2 + 4;
    }

    sb.addEventListener("mousedown", (e) => {
        if (!waveformData) return;
        const x = sbX(e);
        if (thumbContains(x)) {
            scrollbarDragging    = true;
            scrollbarDragStartX  = x;
            scrollbarDragStartZoom = waveformZoomStart;
            sb.style.cursor      = "grabbing";
        } else {
            // Click outside thumb — center view on clicked position
            const W = sb.clientWidth || 1;
            const clickTime = (x / W) * waveformDuration;
            const visDur = waveformZoomEnd - waveformZoomStart;
            waveformZoomStart = Math.max(0, clickTime - visDur / 2);
            waveformZoomEnd   = Math.min(waveformDuration, waveformZoomStart + visDur);
            if (waveformZoomEnd === waveformDuration)
                waveformZoomStart = Math.max(0, waveformDuration - visDur);
            renderWaveform();
        }
        e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
        if (!scrollbarDragging) return;
        const W = sb.clientWidth || 1;
        const dx    = sbX(e) - scrollbarDragStartX;
        const dTime = (dx / W) * waveformDuration;
        const visDur = waveformZoomEnd - waveformZoomStart;
        waveformZoomStart = Math.max(0, scrollbarDragStartZoom + dTime);
        waveformZoomEnd   = Math.min(waveformDuration, waveformZoomStart + visDur);
        if (waveformZoomEnd === waveformDuration)
            waveformZoomStart = Math.max(0, waveformDuration - visDur);
        renderWaveform();
    });

    window.addEventListener("mouseup", () => {
        if (scrollbarDragging) {
            scrollbarDragging = false;
            sb.style.cursor   = "pointer";
        }
    });

    sb.addEventListener("mousemove", (e) => {
        if (!waveformData || scrollbarDragging) return;
        sb.style.cursor = thumbContains(sbX(e)) ? "grab" : "pointer";
    });
}

// ===============================
// WAVEFORM INTERACTION
// ===============================

function waveformCanvasX(e) {
    const canvas = document.getElementById("waveformCanvas");
    return e.clientX - canvas.getBoundingClientRect().left;
}

function initWaveformInteraction() {
    const canvas = document.getElementById("waveformCanvas");
    if (!canvas) return;

    const HIT_RADIUS = 8;

    function hitTestMarker(x) {
        const cw = canvas.clientWidth || 1;
        const visDur = Math.max(waveformZoomEnd - waveformZoomStart, 0.001);
        let best = -1, bestDist = HIT_RADIUS + 1;
        for (let i = 0; i < timestamps.length; i++) {
            const markerX = ((timestamps[i] - waveformZoomStart) / visDur) * cw;
            const dist = Math.abs(markerX - x);
            if (dist < bestDist) { bestDist = dist; best = i; }
        }
        return best;
    }

    canvas.addEventListener("mousedown", (e) => {
        if (!waveformData) return;
        const x = waveformCanvasX(e);
        const hit = hitTestMarker(x);
        if (hit !== -1) {
            waveformDragIndex = hit;
            canvas.style.cursor = "ew-resize";
            e.preventDefault();
        }
    });

    canvas.addEventListener("mousemove", (e) => {
        if (!waveformData) return;
        const x = waveformCanvasX(e);
        if (waveformDragIndex !== -1) {
            const cw = canvas.clientWidth || 1;
            const visDur = Math.max(waveformZoomEnd - waveformZoomStart, 0.001);
            let newTime = waveformZoomStart + (x / cw) * visDur;
            newTime = Math.max(0, Math.min(waveformDuration, newTime));
            timestamps[waveformDragIndex] = newTime;
            const label = document.getElementById("waveformTimeLabel");
            if (label) label.textContent = formatTime(newTime);
            renderWaveform();
        } else {
            canvas.style.cursor = hitTestMarker(x) !== -1 ? "ew-resize" : "crosshair";
        }
    });

    function commitDrag() {
        if (waveformDragIndex !== -1) {
            waveformDragIndex = -1;
            const canvas2 = document.getElementById("waveformCanvas");
            if (canvas2) canvas2.style.cursor = "crosshair";
            timestamps.sort((a, b) => a - b);
            renderTimestamps();
        }
    }

    canvas.addEventListener("mouseup", (e) => {
        if (!waveformData) return;
        if (waveformDragIndex !== -1) {
            commitDrag();
        } else {
            // Click-to-seek
            const x = waveformCanvasX(e);
            const cw = canvas.clientWidth || 1;
            const visDur = Math.max(waveformZoomEnd - waveformZoomStart, 0.001);
            const t = waveformZoomStart + (x / cw) * visDur;
            if (video.src) video.currentTime = Math.max(0, Math.min(video.duration || 0, t));
        }
    });

    canvas.addEventListener("mouseleave", () => {
        if (waveformDragIndex !== -1) commitDrag();
    });
}

function initWaveformZoom() {
    const zoomIn    = document.getElementById("waveformZoomInBtn");
    const zoomOut   = document.getElementById("waveformZoomOutBtn");
    const zoomReset = document.getElementById("waveformZoomResetBtn");
    const canvas    = document.getElementById("waveformCanvas");

    function zoom(factor, centerTime) {
        const visDur = waveformZoomEnd - waveformZoomStart;
        const newDur = Math.max(1, Math.min(waveformDuration, visDur * factor));
        const anchor = (centerTime !== undefined) ? centerTime : (waveformZoomStart + visDur / 2);
        waveformZoomStart = Math.max(0, anchor - newDur / 2);
        waveformZoomEnd   = Math.min(waveformDuration, waveformZoomStart + newDur);
        if (waveformZoomEnd === waveformDuration)
            waveformZoomStart = Math.max(0, waveformDuration - newDur);
        renderWaveform();
    }

    if (zoomIn)    zoomIn.addEventListener   ("click", () => { if (waveformData) zoom(0.5); });
    if (zoomOut)   zoomOut.addEventListener  ("click", () => { if (waveformData) zoom(2.0); });
    if (zoomReset) zoomReset.addEventListener("click", () => {
        if (!waveformData) return;
        waveformZoomStart = 0;
        waveformZoomEnd   = waveformDuration;
        renderWaveform();
    });

    if (canvas) {
        canvas.addEventListener("wheel", (e) => {
            e.preventDefault();
            if (!waveformData) return;
            if (e.ctrlKey) {
                const cw = canvas.clientWidth || 1;
                const visDur = Math.max(waveformZoomEnd - waveformZoomStart, 0.001);
                const mouseTime = waveformZoomStart + (waveformCanvasX(e) / cw) * visDur;
                zoom(e.deltaY > 0 ? 1.25 : 0.8, mouseTime);
            } else {
                const visDur = waveformZoomEnd - waveformZoomStart;
                const panAmount = visDur * 0.1 * (e.deltaY > 0 ? 1 : -1);
                waveformZoomStart = Math.max(0, waveformZoomStart + panAmount);
                waveformZoomEnd   = Math.min(waveformDuration, waveformZoomEnd + panAmount);
                renderWaveform();
            }
        }, { passive: false });
    }
}

// ===============================
// TIMESTAMP OPERATIONS
// ===============================

function markTime() {
    if (!video.src) {
        alert("Load video first");
        return;
    }
    
    let time = video.currentTime;
    
    if (snapToBeatCheckbox && snapToBeatCheckbox.checked && beatTimes.length > 0) {
        const sensitivity = parseFloat(snapSensitivity.value) || 0.1;
        let minDiff = sensitivity;
        
        for (const beat of beatTimes) {
            const diff = Math.abs(beat - time);
            if (diff < minDiff) {
                minDiff = diff;
                time = beat;
            }
        }
    }
    
    timestamps.push(time);
    renderTimestamps();
}

function undo() {
    timestamps.pop();
    renderTimestamps();
}

function clearTimestamps() {
    timestamps = [];
    renderTimestamps();
}

// ===============================
// SRT EXPORT/IMPORT
// ===============================

function generateSRT() {
    if (timestamps.length === 0) {
        alert("No timestamps to export!");
        return;
    }
    
    let srt = "";
    
    for (let i = 0; i < timestamps.length; i++) {
        const start = timestamps[i];
        const end = timestamps[i + 1] || video.duration;
        const text = getLyricsForIndex(i);
        
        if (!text.trim()) continue;
        
        srt += `${i + 1}\n${formatTime(start)} --> ${formatTime(end)}\n${text}\n\n`;
    }
    
    if (srt) {
        downloadFile(srt, "subtitle.srt");
    } else {
        alert("No content to export!");
    }
}

function importSRT(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const blocks = e.target.result.trim().split("\n\n");
        const newTimestamps = [];
        const lyrics = [];
        
        blocks.forEach(block => {
            const lines = block.split("\n");
            if (lines.length >= 3) {
                const timeStr = lines[1].split(" --> ")[0];
                newTimestamps.push(srtToSec(timeStr));
                lyrics.push(lines.slice(2).join("\n"));
            }
        });
        
        timestamps = newTimestamps;
        lyricsInput1.value = lyrics.join("\n");
        renderTimestamps();
        alert(`Imported ${timestamps.length} timestamps`);
    };
    reader.readAsText(file);
}

// ===============================
// BEAT DETECTION
// ===============================

async function analyzeBeats() {
    if (isAnalyzing) {
        alert("Analysis already in progress...");
        return;
    }
    
    const file = videoInput.files[0];
    if (!file) {
        alert("Please select a video file first!");
        return;
    }
    
    isAnalyzing = true;
    if (analyzeBeatBtn) {
        analyzeBeatBtn.textContent = "⏳ Analyzing...";
        analyzeBeatBtn.disabled = true;
    }
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        
        if (audioContext) await audioContext.close();
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const buffer = await audioContext.decodeAudioData(arrayBuffer);
        const data = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;

        // Persist PCM for waveform rendering (copy — buffer may be GC'd after this scope)
        waveformData = new Float32Array(data);
        waveformSampleRate = sampleRate;
        waveformDuration = buffer.duration;
        waveformZoomStart = 0;
        waveformZoomEnd = buffer.duration;

        // Calculate energy
        const windowSize = 1024;
        const hopSize = 512;
        const energy = [];
        
        for (let i = 0; i < data.length - windowSize; i += hopSize) {
            let sum = 0;
            for (let j = 0; j < windowSize; j++) {
                const s = data[i + j] || 0;
                sum += s * s;
            }
            energy.push(Math.sqrt(sum / windowSize));
            
            if (i % (windowSize * 100) === 0) {
                const progress = Math.round((i / (data.length - windowSize)) * 100);
                if (analyzeBeatBtn) analyzeBeatBtn.textContent = `⏳ ${progress}%`;
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        // Onset strength: positive energy change (sensitive to transients, not sustained sound)
        const onset = new Float32Array(energy.length);
        for (let i = 1; i < energy.length; i++) {
            onset[i] = Math.max(0, energy[i] - energy[i - 1]);
        }

        // Autocorrelation BPM estimation (60–200 BPM range)
        const frameRate = sampleRate / hopSize;
        const minLag = Math.max(1, Math.round(frameRate * 60 / 200));
        const maxLag = Math.round(frameRate * 60 / 60);

        let bestLag = minLag, bestCorr = -1;
        for (let lag = minLag; lag <= maxLag; lag++) {
            let corr = 0;
            const n = onset.length - lag;
            for (let i = 0; i < n; i++) corr += onset[i] * onset[i + lag];
            corr /= n;
            if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
        }

        // Double-tempo check: if half-lag has good correlation → prefer BPM × 2
        // Fixes sub-harmonic detection (e.g. 93 detected instead of 149 BPM)
        const halfLag = Math.round(bestLag / 2);
        if (halfLag >= minLag) {
            let halfCorr = 0;
            const hn = onset.length - halfLag;
            for (let i = 0; i < hn; i++) halfCorr += onset[i] * onset[i + halfLag];
            halfCorr /= hn;
            if (halfCorr >= bestCorr * 0.65) { bestLag = halfLag; bestCorr = halfCorr; }
        }

        const beatInterval = bestLag / frameRate;
        const bpm = Math.round(60 / beatInterval);

        // Phase estimation: find offset that best aligns beat grid to strong onsets
        let bestPhase = 0, bestPhaseScore = -1;
        for (let phaseOffset = 0; phaseOffset < bestLag; phaseOffset++) {
            let score = 0;
            for (let k = phaseOffset; k < onset.length; k += bestLag) score += onset[k];
            if (score > bestPhaseScore) { bestPhaseScore = score; bestPhase = phaseOffset / frameRate; }
        }

        // Generate evenly spaced beat grid
        beatTimes = [];
        for (let t = bestPhase; t <= buffer.duration; t += beatInterval) beatTimes.push(t);
        for (let t = bestPhase - beatInterval; t >= 0; t -= beatInterval) beatTimes.unshift(t);
        beatTimes = beatTimes.filter(t => t >= 0 && t <= buffer.duration);

        // Show results
        if (analyzeBeatBtn) analyzeBeatBtn.textContent = `🎵 ${beatTimes.length} beats`;
        renderTimestamps();
        alert(`BPM: ${bpm}\nBeats: ${beatTimes.length} (evenly spaced)`);
        
    } catch (error) {
        console.error("Beat analysis error:", error);
        alert("Error analyzing beats: " + error.message);
        if (analyzeBeatBtn) analyzeBeatBtn.textContent = "🎵 Analyze";
    } finally {
        isAnalyzing = false;
        if (analyzeBeatBtn) analyzeBeatBtn.disabled = false;
    }
}

// ===============================
// BEAT-BASED OPERATIONS
// ===============================

function generateTimestampsFromBeats() {
    if (beatTimes.length === 0) {
        alert("Please analyze beats first!");
        return;
    }
    
    const lyrics1 = lyricsInput1.value.split("\n").filter(l => l.trim());
    const lyrics2 = lyricsInput2.value.split("\n").filter(l => l.trim());
    
    if (lyrics1.length === 0 && lyrics2.length === 0) {
        alert("Please enter some lyrics first!");
        return;
    }
    
    const targetCount = Math.max(lyrics1.length, lyrics2.length, Math.floor(beatTimes.length / 2));
    const actualCount = Math.min(targetCount, beatTimes.length);
    
    timestamps = [];
    if (actualCount <= 1) {
        timestamps.push(beatTimes[0]);
    } else {
        const step = Math.floor(beatTimes.length / actualCount);
        for (let i = 0; i < actualCount; i++) {
            timestamps.push(beatTimes[Math.min(i * step, beatTimes.length - 1)]);
        }
    }
    
    timestamps.sort((a, b) => a - b);
    renderTimestamps();
    alert(`Generated ${timestamps.length} timestamps from ${beatTimes.length} beats`);
}

function snapAllTimestamps() {
    if (timestamps.length === 0) {
        alert("No timestamps to snap!");
        return;
    }
    
    if (beatTimes.length === 0) {
        alert("Please analyze beats first!");
        return;
    }
    
    const sensitivity = parseFloat(snapSensitivity.value) || 0.1;
    const lyrics1 = lyricsInput1.value.split("\n");
    const lyrics2 = lyricsInput2.value.split("\n");
    
    const segments = timestamps.map((time, index) => ({
        time,
        lyric1: lyrics1[index] || "",
        lyric2: lyrics2[index] || "",
        originalIndex: index
    }));
    
    const usedBeats = new Set();
    const snappedSegments = [];
    
    for (const segment of segments) {
        let bestBeat = segment.time;
        let minDiff = Infinity;
        
        for (const beat of beatTimes) {
            if (usedBeats.has(beat)) continue;
            
            const diff = Math.abs(beat - segment.time);
            if (diff < minDiff && diff <= sensitivity) {
                minDiff = diff;
                bestBeat = beat;
            }
        }
        
        if (bestBeat !== segment.time) {
            segment.time = bestBeat;
            segment.snapped = true;
        }
        if (minDiff !== Infinity) {
            usedBeats.add(bestBeat);
        }
        
        snappedSegments.push(segment);
    }
    
    snappedSegments.sort((a, b) => a.time - b.time);
    
    timestamps = snappedSegments.map(s => s.time);
    lyricsInput1.value = snappedSegments.map(s => s.lyric1).join("\n");
    lyricsInput2.value = snappedSegments.map(s => s.lyric2).join("\n");
    
    renderTimestamps();
    alert(`Snapped ${snappedSegments.filter(s => s.snapped).length} timestamps to beats`);
}

function autoSplitLyricsByBeats() {
    if (beatTimes.length === 0) {
        alert("Please analyze beats first!");
        return;
    }
    
    const lyrics1 = lyricsInput1.value.split("\n").filter(l => l.trim());
    const lyrics2 = lyricsInput2.value.split("\n").filter(l => l.trim());
    const text = lyrics1.length > 0 ? lyrics1.join(" ") : lyrics2.join(" ");
    
    if (!text.trim()) {
        alert("No lyrics to split!");
        return;
    }
    
    const words = text.split(/\s+/);
    const beatsCount = beatTimes.length;
    const wordsPerSegment = Math.max(1, Math.ceil(words.length / beatsCount));
    
    const newLyrics = [];
    for (let i = 0; i < beatsCount; i++) {
        const start = i * wordsPerSegment;
        const end = Math.min(start + wordsPerSegment, words.length);
        if (start < words.length) {
            newLyrics.push(words.slice(start, end).join(" "));
        }
    }
    
    lyricsInput1.value = newLyrics.join("\n");
    lyricsInput2.value = "";
    
    timestamps = [...beatTimes];
    renderTimestamps();
    alert(`Split into ${timestamps.length} segments based on beats`);
}

// ===============================
// THEME MANAGEMENT
// ===============================

function initTheme() {
    const saved = localStorage.getItem("theme");
    if (saved === "light") {
        document.documentElement.classList.add("light-theme");
    }
}

function toggleTheme() {
    if (document.documentElement.classList.contains("light-theme")) {
        document.documentElement.classList.remove("light-theme");
        localStorage.setItem("theme", "dark");
    } else {
        document.documentElement.classList.add("light-theme");
        localStorage.setItem("theme", "light");
    }
    if (waveformData) renderWaveform();
}

// ===============================
// EVENT LISTENERS
// ===============================

// Video loading
videoInput.addEventListener("change", function() {
    if (video.src) URL.revokeObjectURL(video.src);
    video.src = URL.createObjectURL(this.files[0]);
    timestamps = [];
    beatTimes = [];
    waveformData = null;
    waveformSampleRate = 0;
    waveformDuration = 0;
    waveformZoomStart = 0;
    waveformZoomEnd = 0;
    waveformDragIndex = -1;
    scrollbarDragging = false;
    const wc = document.getElementById("waveformContainer");
    if (wc) wc.classList.add("waveform-hidden");
    renderTimestamps();
});

// Controls
markBtn.addEventListener("click", markTime);
undoBtn.addEventListener("click", undo);
clearBtn.addEventListener("click", clearTimestamps);
exportBtn.addEventListener("click", generateSRT);
srtInput.addEventListener("change", () => importSRT(srtInput.files[0]));

// Lyrics inputs
lyricsInput1.addEventListener("input", renderTimestamps);
lyricsInput2.addEventListener("input", renderTimestamps);
displayMode.addEventListener("change", renderTimestamps);

// Theme
initTheme();
if (themeToggle) themeToggle.addEventListener("click", toggleTheme);

// Beat controls
if (analyzeBeatBtn) analyzeBeatBtn.addEventListener("click", analyzeBeats);
if (snapAllBtn) snapAllBtn.addEventListener("click", snapAllTimestamps);
if (adjustToBeatBtn) adjustToBeatBtn.addEventListener("click", generateTimestampsFromBeats);
if (autoSplitBtn) autoSplitBtn.addEventListener("click", autoSplitLyricsByBeats);
if (generateFromBeatsBtn) generateFromBeatsBtn.addEventListener("click", generateTimestampsFromBeats);

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
    if (["TEXTAREA", "INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
    
    if (e.code === "Space") {
        e.preventDefault();
        video.paused ? video.play() : video.pause();
    }
    if (e.key === "Enter") markTime();
    if (e.key === "z" || e.key === "Z") undo();
});

// Waveform
video.addEventListener("timeupdate", () => { if (waveformData) renderWaveform(); });
window.addEventListener("resize", () => { if (waveformData) renderWaveform(); });
initWaveformInteraction();
initWaveformZoom();
initScrollbarInteraction();