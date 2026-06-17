// ===============================
// DOM ELEMENTS
// ===============================

const video = document.getElementById("video");
const videoInput = document.getElementById("videoInput");

const markBtn = document.getElementById("markBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const clearBtn = document.getElementById("clearBtn");
const exportBtn = document.getElementById("exportBtn");
const saveProjectBtn = document.getElementById("saveProjectBtn");
const loadProjectInput = document.getElementById("loadProjectInput");

const lyricsInput1 = document.getElementById("lyricsInput1");
const lyricsInput2 = document.getElementById("lyricsInput2");
const displayMode = document.getElementById("displayMode");

const timestampsDiv = document.getElementById("timestamps");
const srtInput = document.getElementById("srtInput");
const themeToggle = document.getElementById("themeToggle");

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

// Undo/Redo history
let undoStack = [];
let redoStack = [];

// Selection & active tracking
let selectedTimestampIndex = -1;
let activeTimestampIndex = -1;

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

// Spectrogram state
let spectrogramData = null;
let spectrogramSlices = 0;
let spectrogramBins = 0;
let showSpectrogram = false;

// Precomputed spectrogram colour palette (256 entries, 0=quiet, 255=loud)
// spectrogramColor() is a function declaration so it's hoisted — safe to call here
const SPECTRO_PALETTE = Array.from({ length: 256 }, (_, i) => spectrogramColor(i / 255));

// ===============================
// UTILITY FUNCTIONS
// ===============================

function formatTime(sec) {
    const h  = Math.floor(sec / 3600);
    const m  = Math.floor((sec % 3600) / 60);
    const s  = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")},${String(ms).padStart(3,"0")}`;
}

function srtToSec(timeStr) {
    const [hms, ms] = timeStr.split(",");
    const [h, m, s] = hms.split(":").map(Number);
    return h * 3600 + m * 60 + s + (parseInt(ms) || 0) / 1000;
}

function downloadFile(content, filename) {
    const blob = new Blob([content], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename; a.click();
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
    if (mode === "second")  return lyrics2[index] || "";
    if (mode === "merge") {
        const l1 = lyrics1[index] || "";
        const l2 = lyrics2[index] || "";
        return l2 ? `${l1}\n${l2}` : l1;
    }
    return "";
}

function updateLyricsArray(newLyrics) {
    lyricsInput1.value = newLyrics.map(l => l.lyric1 || "").join("\n");
    lyricsInput2.value = newLyrics.map(l => l.lyric2 || "").join("\n");
}

// ===============================
// HISTORY MANAGEMENT
// ===============================

function saveHistory() {
    undoStack.push({
        timestamps: [...timestamps],
        lyrics1: lyricsInput1.value,
        lyrics2: lyricsInput2.value
    });
    redoStack = [];
    if (undoStack.length > 100) undoStack.shift();
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

    for (let i = timestamps.length - 1; i >= 0; i--) {
        let text = "";
        if (mode === "replace") text = lyrics1[i] || "";
        if (mode === "second")  text = lyrics2[i] || "";
        if (mode === "merge")   text = (lyrics1[i] || "") + (lyrics2[i] ? "\n" + lyrics2[i] : "");

        const div = document.createElement("div");
        div.className = "timestamp-item";
        div.dataset.index = i;
        if (i === activeTimestampIndex)   div.classList.add("timestamp-active");
        if (i === selectedTimestampIndex) div.classList.add("timestamp-selected");

        div.addEventListener("click", () => {
            selectedTimestampIndex = i;
            if (video.src) video.currentTime = timestamps[i];
            renderTimestamps();
        });

        const timeSpan = document.createElement("div");
        timeSpan.className = "timestamp-time";
        const isOnBeat = beatTimes.some(b => Math.abs(b - timestamps[i]) < 0.05);
        const beatIcon = isOnBeat ? " 🎵" : "";
        timeSpan.textContent = `${formatTime(timestamps[i])}${beatIcon} → ${timestamps[i + 1] ? formatTime(timestamps[i + 1]) : "..."}`;

        timeSpan.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            startInlineEdit(i, timeSpan);
        });

        const lyricSpan = document.createElement("div");
        lyricSpan.className = "timestamp-text";
        lyricSpan.textContent = text || "(empty)";

        div.appendChild(timeSpan);
        div.appendChild(lyricSpan);
        fragment.appendChild(div);
    }

    timestampsDiv.appendChild(fragment);

    // Next line preview
    const nextIndex = timestamps.length;
    let preview = "";
    if (mode === "replace") preview = lyrics1[nextIndex] || "";
    if (mode === "second")  preview = lyrics2[nextIndex] || "";
    if (mode === "merge")   preview = (lyrics1[nextIndex] || "") + (lyrics2[nextIndex] ? "\n" + lyrics2[nextIndex] : "");

    if (preview) {
        const previewDiv = document.createElement("div");
        previewDiv.className = "timestamp-item next-line";
        previewDiv.innerHTML = `<div class="timestamp-time">NEXT</div><div class="timestamp-text">${preview}</div>`;
        timestampsDiv.prepend(previewDiv);
    }

    // Auto-scroll active row into view
    if (activeTimestampIndex !== -1) {
        const activeEl = timestampsDiv.querySelector(".timestamp-active");
        if (activeEl) activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    if (waveformData) renderWaveform();
}

function startInlineEdit(index, spanEl) {
    selectedTimestampIndex = index;
    const sec = timestamps[index];
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const rawS = sec % 60;
    const sPadded = (rawS < 10 ? "0" : "") + rawS.toFixed(3);
    const editStr = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${sPadded}`;

    const input = document.createElement("input");
    input.type = "text";
    input.value = editStr;
    input.className = "timestamp-inline-edit";

    let committed = false;
    function commit() {
        if (committed) return;
        committed = true;
        const parts = input.value.trim().split(":");
        let newSec = NaN;
        if (parts.length === 3)      newSec = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
        else if (parts.length === 2) newSec = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
        else                         newSec = parseFloat(parts[0]);
        if (!isNaN(newSec) && newSec >= 0) {
            saveHistory();
            timestamps[index] = newSec;
            timestamps.sort((a, b) => a - b);
        }
        renderTimestamps();
    }

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter")  { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { committed = true; renderTimestamps(); }
        e.stopPropagation();
    });

    spanEl.replaceWith(input);
    input.focus();
    input.select();
}

function updateActiveTimestamp() {
    if (!video.src || timestamps.length === 0) {
        if (activeTimestampIndex !== -1) { activeTimestampIndex = -1; renderTimestamps(); }
        return;
    }
    const t = video.currentTime;
    let newActive = -1;
    for (let i = timestamps.length - 1; i >= 0; i--) {
        if (t >= timestamps[i]) { newActive = i; break; }
    }
    if (newActive !== activeTimestampIndex) {
        activeTimestampIndex = newActive;
        renderTimestamps();
    }
}

// ===============================
// WAVEFORM RENDERING
// ===============================

function renderWaveform() {
    const canvas = document.getElementById("waveformCanvas");
    if (!canvas || !waveformData) return;

    const container = document.getElementById("waveformContainer");
    container.classList.remove("waveform-hidden");

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

    const rootStyle = getComputedStyle(document.documentElement);
    const colBg    = rootStyle.getPropertyValue("--surface").trim() || "#111";
    const colWave  = "rgba(99,102,241,0.65)";
    const colBeat  = "rgba(255,200,0,0.45)";
    const colDrag   = "#f97316";
    const colNormal = "rgba(16,185,129,0.55)";
    const colActive = "#10b981";
    const colCursor = document.documentElement.classList.contains("light-theme") ? "#000" : "#fff";

    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = colBg;
    ctx.fillRect(0, 0, cw, ch);

    const visStart = waveformZoomStart;
    const visEnd   = waveformZoomEnd;
    const visDur   = Math.max(visEnd - visStart, 0.001);
    const timeToX  = (t) => ((t - visStart) / visDur) * cw;

    if (showSpectrogram && spectrogramData) {
        renderSpectrogram(ctx, cw, ch, visStart, visEnd);
    } else {
        // Waveform — min/max per pixel column to preserve transients
        const startSample    = Math.floor(visStart * waveformSampleRate);
        const endSample      = Math.min(Math.ceil(visEnd * waveformSampleRate), waveformData.length);
        const samplesPerPixel = Math.max(1, Math.floor((endSample - startSample) / cw));

        ctx.beginPath();
        ctx.strokeStyle = colWave;
        ctx.lineWidth   = 1;
        for (let px = 0; px < cw; px++) {
            const sStart = startSample + Math.floor(px * samplesPerPixel);
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
    }

    // Beat markers
    ctx.strokeStyle = colBeat;
    ctx.lineWidth = 1;
    for (const bt of beatTimes) {
        if (bt < visStart || bt > visEnd) continue;
        const x = timeToX(bt);
        ctx.beginPath();
        ctx.moveTo(x, 0); ctx.lineTo(x, ch);
        ctx.stroke();
    }

    // Timestamp markers
    for (let i = 0; i < timestamps.length; i++) {
        const t = timestamps[i];
        if (t < visStart - 0.5 || t > visEnd + 0.5) continue;
        const x = timeToX(t);
        const isActive = (i === activeTimestampIndex);
        const col = (i === waveformDragIndex) ? colDrag : isActive ? colActive : colNormal;

        if (isActive) {
            ctx.save();
            ctx.shadowColor = "#10b981";
            ctx.shadowBlur  = 14;
            ctx.strokeStyle = col;
            ctx.lineWidth   = 3;
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, ch);
            ctx.stroke();
            ctx.restore();
        }

        ctx.strokeStyle = col;
        ctx.fillStyle   = col;
        ctx.lineWidth   = isActive ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(x, 0); ctx.lineTo(x, ch);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 9);
        ctx.closePath(); ctx.fill();
        ctx.font = "9px monospace";
        ctx.fillText(i + 1, x + 3, 20);
    }

    // Playback cursor
    if (video.src && video.duration) {
        const cursorX = timeToX(video.currentTime);
        if (cursorX >= 0 && cursorX <= cw) {
            ctx.strokeStyle = colCursor;
            ctx.lineWidth   = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(cursorX, 0); ctx.lineTo(cursorX, ch);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    renderScrollbar();
}

function renderScrollbar() {
    const sb = document.getElementById("waveformScrollbar");
    if (!sb || !waveformData) return;

    const dpr  = window.devicePixelRatio || 1;
    const cssW = sb.clientWidth  || sb.offsetWidth  || 800;
    const cssH = sb.clientHeight || sb.offsetHeight || 18;
    if (sb.width  !== Math.round(cssW * dpr) || sb.height !== Math.round(cssH * dpr)) {
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

    ctx.fillStyle = colBg;
    ctx.fillRect(0, 0, W, H);

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
        ctx.moveTo(px + 0.5, y1); ctx.lineTo(px + 0.5, Math.max(y2, y1 + 1));
        ctx.stroke();
    }

    const thumbX1 = (waveformZoomStart / waveformDuration) * W;
    const thumbX2 = (waveformZoomEnd   / waveformDuration) * W;
    const thumbW  = Math.max(4, thumbX2 - thumbX1);
    const fillCol = colThumb.startsWith("#") && colThumb.length === 7 ? colThumb + "40" : "rgba(16,185,129,0.25)";
    ctx.fillStyle = fillCol;
    ctx.fillRect(thumbX1, 0, thumbW, H);
    ctx.strokeStyle = colThumb;
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(thumbX1 + 0.75, 0.75, thumbW - 1.5, H - 1.5);
}

function initScrollbarInteraction() {
    const sb = document.getElementById("waveformScrollbar");
    if (!sb) return;

    function sbX(e) { return e.clientX - sb.getBoundingClientRect().left; }

    function thumbContains(x) {
        const W  = sb.clientWidth || 1;
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
        const W    = sb.clientWidth || 1;
        const dx   = sbX(e) - scrollbarDragStartX;
        const dTime = (dx / W) * waveformDuration;
        const visDur = waveformZoomEnd - waveformZoomStart;
        waveformZoomStart = Math.max(0, scrollbarDragStartZoom + dTime);
        waveformZoomEnd   = Math.min(waveformDuration, waveformZoomStart + visDur);
        if (waveformZoomEnd === waveformDuration)
            waveformZoomStart = Math.max(0, waveformDuration - visDur);
        renderWaveform();
    });

    window.addEventListener("mouseup", () => {
        if (scrollbarDragging) { scrollbarDragging = false; sb.style.cursor = "pointer"; }
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
        const x   = waveformCanvasX(e);
        const hit = hitTestMarker(x);
        if (hit !== -1) {
            saveHistory();
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
            const c = document.getElementById("waveformCanvas");
            if (c) c.style.cursor = "crosshair";
            timestamps.sort((a, b) => a - b);
            renderTimestamps();
        }
    }

    canvas.addEventListener("mouseup", (e) => {
        if (!waveformData) return;
        if (waveformDragIndex !== -1) {
            commitDrag();
        } else {
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
                const pan = visDur * 0.1 * (e.deltaY > 0 ? 1 : -1);
                waveformZoomStart = Math.max(0, waveformZoomStart + pan);
                waveformZoomEnd   = Math.min(waveformDuration, waveformZoomEnd + pan);
                renderWaveform();
            }
        }, { passive: false });

        // Pinch-to-zoom (touch devices / trackpads)
        let pinchStartDist      = null;
        let pinchStartZoomStart = 0;
        let pinchStartZoomEnd   = 0;
        let pinchStartMidTime   = 0;

        function getPinchDist(e) {
            return Math.hypot(
                e.touches[1].clientX - e.touches[0].clientX,
                e.touches[1].clientY - e.touches[0].clientY
            );
        }

        canvas.addEventListener("touchstart", (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                pinchStartDist      = getPinchDist(e);
                pinchStartZoomStart = waveformZoomStart;
                pinchStartZoomEnd   = waveformZoomEnd;
                const rect   = canvas.getBoundingClientRect();
                const midX   = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
                const origDur = pinchStartZoomEnd - pinchStartZoomStart;
                pinchStartMidTime = pinchStartZoomStart + (midX / (canvas.clientWidth || 1)) * origDur;
            }
        }, { passive: false });

        canvas.addEventListener("touchmove", (e) => {
            if (e.touches.length === 2 && pinchStartDist !== null) {
                e.preventDefault();
                const scale  = pinchStartDist / getPinchDist(e);
                const origDur = pinchStartZoomEnd - pinchStartZoomStart;
                const newDur  = Math.max(1, Math.min(waveformDuration, origDur * scale));
                waveformZoomStart = Math.max(0, pinchStartMidTime - newDur / 2);
                waveformZoomEnd   = Math.min(waveformDuration, waveformZoomStart + newDur);
                if (waveformZoomEnd === waveformDuration)
                    waveformZoomStart = Math.max(0, waveformDuration - newDur);
                renderWaveform();
            }
        }, { passive: false });

        canvas.addEventListener("touchend", (e) => {
            if (e.touches.length < 2) pinchStartDist = null;
        });
    }
}

// ===============================
// TIMESTAMP OPERATIONS
// ===============================

function markTime() {
    if (!video.src) { alert("Load video first"); return; }

    let time = video.currentTime;
    if (snapToBeatCheckbox && snapToBeatCheckbox.checked && beatTimes.length > 0) {
        const sensitivity = parseFloat(snapSensitivity.value) || 0.1;
        let minDiff = sensitivity;
        for (const beat of beatTimes) {
            const diff = Math.abs(beat - time);
            if (diff < minDiff) { minDiff = diff; time = beat; }
        }
    }

    saveHistory();
    timestamps.push(time);
    renderTimestamps();
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push({ timestamps: [...timestamps], lyrics1: lyricsInput1.value, lyrics2: lyricsInput2.value });
    const prev = undoStack.pop();
    timestamps = prev.timestamps;
    lyricsInput1.value = prev.lyrics1;
    lyricsInput2.value = prev.lyrics2;
    renderTimestamps();
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push({ timestamps: [...timestamps], lyrics1: lyricsInput1.value, lyrics2: lyricsInput2.value });
    const next = redoStack.pop();
    timestamps = next.timestamps;
    lyricsInput1.value = next.lyrics1;
    lyricsInput2.value = next.lyrics2;
    renderTimestamps();
}

function clearTimestamps() {
    saveHistory();
    timestamps = [];
    renderTimestamps();
}

// ===============================
// PROJECT SAVE / LOAD
// ===============================

function saveProject() {
    const data = {
        version: 1,
        timestamps: [...timestamps],
        lyrics1: lyricsInput1.value,
        lyrics2: lyricsInput2.value
    };
    downloadFile(JSON.stringify(data, null, 2), "subtap-project.json");
}

function loadProject(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data.timestamps)) throw new Error("Invalid format");
            saveHistory();
            timestamps = data.timestamps;
            lyricsInput1.value = data.lyrics1 || "";
            lyricsInput2.value = data.lyrics2 || "";
            renderTimestamps();
            alert(`Loaded ${timestamps.length} timestamps`);
        } catch (err) {
            alert("Failed to load project: " + err.message);
        }
    };
    reader.readAsText(file);
}

// ===============================
// SRT EXPORT/IMPORT
// ===============================

function generateSRT() {
    if (timestamps.length === 0) { alert("No timestamps to export!"); return; }
    let srt = "";
    for (let i = 0; i < timestamps.length; i++) {
        const start = timestamps[i];
        const end   = timestamps[i + 1] || video.duration;
        const text  = getLyricsForIndex(i);
        if (!text.trim()) continue;
        srt += `${i + 1}\n${formatTime(start)} --> ${formatTime(end)}\n${text}\n\n`;
    }
    if (srt) downloadFile(srt, "subtitle.srt");
    else alert("No content to export!");
}

function importSRT(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const blocks = e.target.result.trim().split("\n\n");
        const newTimestamps = [], lyrics = [];
        blocks.forEach(block => {
            const lines = block.split("\n");
            if (lines.length >= 3) {
                newTimestamps.push(srtToSec(lines[1].split(" --> ")[0]));
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
    if (isAnalyzing) { alert("Analysis already in progress..."); return; }
    const file = videoInput.files[0];
    if (!file) { alert("Please select a video file first!"); return; }

    isAnalyzing = true;
    if (analyzeBeatBtn) { analyzeBeatBtn.textContent = "⏳ Analyzing..."; analyzeBeatBtn.disabled = true; }

    try {
        const arrayBuffer = await file.arrayBuffer();
        if (audioContext) await audioContext.close();
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const buffer = await audioContext.decodeAudioData(arrayBuffer);
        const data = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;

        waveformData       = new Float32Array(data);
        waveformSampleRate = sampleRate;
        waveformDuration   = buffer.duration;
        waveformZoomStart  = 0;
        waveformZoomEnd    = buffer.duration;

        const windowSize = 1024, hopSize = 512;
        const energy = [];
        for (let i = 0; i < data.length - windowSize; i += hopSize) {
            let sum = 0;
            for (let j = 0; j < windowSize; j++) { const s = data[i + j] || 0; sum += s * s; }
            energy.push(Math.sqrt(sum / windowSize));
            if (i % (windowSize * 100) === 0) {
                const progress = Math.round((i / (data.length - windowSize)) * 100);
                if (analyzeBeatBtn) analyzeBeatBtn.textContent = `⏳ ${progress}%`;
                await new Promise(r => setTimeout(r, 0));
            }
        }

        const onset = new Float32Array(energy.length);
        for (let i = 1; i < energy.length; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);

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

        let bestPhase = 0, bestPhaseScore = -1;
        for (let phaseOffset = 0; phaseOffset < bestLag; phaseOffset++) {
            let score = 0;
            for (let k = phaseOffset; k < onset.length; k += bestLag) score += onset[k];
            if (score > bestPhaseScore) { bestPhaseScore = score; bestPhase = phaseOffset / frameRate; }
        }

        beatTimes = [];
        for (let t = bestPhase; t <= buffer.duration; t += beatInterval) beatTimes.push(t);
        for (let t = bestPhase - beatInterval; t >= 0; t -= beatInterval) beatTimes.unshift(t);
        beatTimes = beatTimes.filter(t => t >= 0 && t <= buffer.duration);

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
    if (beatTimes.length === 0) { alert("Please analyze beats first!"); return; }
    const lyrics1 = lyricsInput1.value.split("\n").filter(l => l.trim());
    const lyrics2 = lyricsInput2.value.split("\n").filter(l => l.trim());
    if (lyrics1.length === 0 && lyrics2.length === 0) { alert("Please enter some lyrics first!"); return; }

    const targetCount = Math.max(lyrics1.length, lyrics2.length, Math.floor(beatTimes.length / 2));
    const actualCount = Math.min(targetCount, beatTimes.length);

    saveHistory();
    timestamps = [];
    if (actualCount <= 1) {
        timestamps.push(beatTimes[0]);
    } else {
        const step = Math.floor(beatTimes.length / actualCount);
        for (let i = 0; i < actualCount; i++)
            timestamps.push(beatTimes[Math.min(i * step, beatTimes.length - 1)]);
    }
    timestamps.sort((a, b) => a - b);
    renderTimestamps();
    alert(`Generated ${timestamps.length} timestamps from ${beatTimes.length} beats`);
}

function snapAllTimestamps() {
    if (timestamps.length === 0) { alert("No timestamps to snap!"); return; }
    if (beatTimes.length === 0)  { alert("Please analyze beats first!"); return; }

    const sensitivity = parseFloat(snapSensitivity.value) || 0.1;
    const lyrics1 = lyricsInput1.value.split("\n");
    const lyrics2 = lyricsInput2.value.split("\n");

    const segments = timestamps.map((time, index) => ({
        time, lyric1: lyrics1[index] || "", lyric2: lyrics2[index] || "", originalIndex: index
    }));

    const usedBeats = new Set();
    for (const seg of segments) {
        let bestBeat = seg.time, minDiff = Infinity;
        for (const beat of beatTimes) {
            if (usedBeats.has(beat)) continue;
            const diff = Math.abs(beat - seg.time);
            if (diff < minDiff && diff <= sensitivity) { minDiff = diff; bestBeat = beat; }
        }
        if (bestBeat !== seg.time) { seg.time = bestBeat; seg.snapped = true; }
        if (minDiff !== Infinity)  usedBeats.add(bestBeat);
    }

    segments.sort((a, b) => a.time - b.time);

    saveHistory();
    timestamps = segments.map(s => s.time);
    lyricsInput1.value = segments.map(s => s.lyric1).join("\n");
    lyricsInput2.value = segments.map(s => s.lyric2).join("\n");
    renderTimestamps();
    alert(`Snapped ${segments.filter(s => s.snapped).length} timestamps to beats`);
}

function autoSplitLyricsByBeats() {
    if (beatTimes.length === 0) { alert("Please analyze beats first!"); return; }
    const lyrics1 = lyricsInput1.value.split("\n").filter(l => l.trim());
    const lyrics2 = lyricsInput2.value.split("\n").filter(l => l.trim());
    const text = lyrics1.length > 0 ? lyrics1.join(" ") : lyrics2.join(" ");
    if (!text.trim()) { alert("No lyrics to split!"); return; }

    const words = text.split(/\s+/);
    const wordsPerSegment = Math.max(1, Math.ceil(words.length / beatTimes.length));
    const newLyrics = [];
    for (let i = 0; i < beatTimes.length; i++) {
        const start = i * wordsPerSegment;
        const end   = Math.min(start + wordsPerSegment, words.length);
        if (start < words.length) newLyrics.push(words.slice(start, end).join(" "));
    }

    saveHistory();
    lyricsInput1.value = newLyrics.join("\n");
    lyricsInput2.value = "";
    timestamps = [...beatTimes];
    renderTimestamps();
    alert(`Split into ${timestamps.length} segments based on beats`);
}

// ===============================
// SPECTROGRAM
// ===============================

function spectrogramColor(v) {
    const stops = [
        [0,    [0,   0,   0  ]],
        [0.2,  [0,   0,   180]],
        [0.5,  [0,   180, 180]],
        [0.75, [200, 200, 0  ]],
        [1.0,  [255, 80,  80 ]]
    ];
    for (let i = 1; i < stops.length; i++) {
        const [t0, c0] = stops[i - 1];
        const [t1, c1] = stops[i];
        if (v <= t1) {
            const f  = (v - t0) / (t1 - t0);
            const r  = Math.round(c0[0] + f * (c1[0] - c0[0]));
            const g  = Math.round(c0[1] + f * (c1[1] - c0[1]));
            const bv = Math.round(c0[2] + f * (c1[2] - c0[2]));
            return `rgb(${r},${g},${bv})`;
        }
    }
    return "rgb(255,80,80)";
}

function computeFFTMagnitude(frame, N) {
    const re = new Float32Array(frame);
    const im = new Float32Array(N);

    // Bit-reversal permutation
    let j = 0;
    for (let i = 1; i < N; i++) {
        let bit = N >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }

    // Butterfly
    for (let len = 2; len <= N; len <<= 1) {
        const ang = -2 * Math.PI / len;
        const wRe = Math.cos(ang), wIm = Math.sin(ang);
        for (let i = 0; i < N; i += len) {
            let curRe = 1, curIm = 0;
            for (let k = 0; k < len / 2; k++) {
                const uRe = re[i + k], uIm = im[i + k];
                const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
                const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
                re[i + k]           = uRe + vRe; im[i + k]           = uIm + vIm;
                re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
                const tmpRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = tmpRe;
            }
        }
    }

    const mag = new Float32Array(N / 2);
    for (let k = 0; k < N / 2; k++)
        mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (N / 2);
    return mag;
}

async function computeSpectrogram() {
    if (!waveformData) { alert("Analyze beats first to load audio"); return; }

    const btn = document.getElementById("spectrogramBtn");
    if (btn) { btn.textContent = "Computing..."; btn.disabled = true; }

    try {
        const FFT_SIZE = 2048, HOP = 512;
        const data     = waveformData;
        const numSlices = Math.floor((data.length - FFT_SIZE) / HOP) + 1;
        const numBins   = FFT_SIZE / 2;

        spectrogramData   = new Float32Array(numSlices * numBins);
        spectrogramSlices = numSlices;
        spectrogramBins   = numBins;

        const BATCH = 200;
        for (let slice = 0; slice < numSlices; slice++) {
            const offset = slice * HOP;
            const frame  = new Float32Array(FFT_SIZE);
            for (let k = 0; k < FFT_SIZE && offset + k < data.length; k++) {
                // Hann window
                frame[k] = data[offset + k] * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / (FFT_SIZE - 1)));
            }
            const mag = computeFFTMagnitude(frame, FFT_SIZE);
            for (let b = 0; b < numBins; b++) spectrogramData[slice * numBins + b] = mag[b];

            if (slice % BATCH === 0) {
                if (btn) btn.textContent = `${Math.round((slice / numSlices) * 100)}%`;
                await new Promise(r => setTimeout(r, 0));
            }
        }

        if (btn) { btn.textContent = "Waveform"; btn.disabled = false; }
        showSpectrogram = true;
        renderWaveform();

    } catch (err) {
        console.error("Spectrogram error:", err);
        alert("Spectrogram error: " + err.message);
        if (btn) { btn.textContent = "Spectrogram"; btn.disabled = false; }
    }
}

function renderSpectrogram(ctx, cw, ch, visStart, visEnd) {
    if (!spectrogramData) return;
    const visDur      = Math.max(visEnd - visStart, 0.001);
    const HOP         = 512;
    const sliceTimeDur = HOP / waveformSampleRate;

    for (let px = 0; px < cw; px++) {
        const t        = visStart + (px / cw) * visDur;
        const sliceIdx = Math.floor(t / sliceTimeDur);
        if (sliceIdx < 0 || sliceIdx >= spectrogramSlices) continue;

        for (let b = 0; b < spectrogramBins; b++) {
            const amp  = spectrogramData[sliceIdx * spectrogramBins + b];
            const db   = Math.max(-80, 20 * Math.log10(amp + 1e-9));
            const norm = (db + 80) / 80;
            ctx.fillStyle = SPECTRO_PALETTE[Math.min(255, Math.round(norm * 255))];
            const binH = Math.max(1, ch / spectrogramBins);
            const y    = ch - ((b + 1) / spectrogramBins) * ch;
            ctx.fillRect(px, y, 1, binH);
        }
    }
}

// ===============================
// THEME MANAGEMENT
// ===============================

function initTheme() {
    if (localStorage.getItem("theme") === "light")
        document.documentElement.classList.add("light-theme");
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

// Video loading — reset all state
videoInput.addEventListener("change", function () {
    if (video.src) URL.revokeObjectURL(video.src);
    video.src = URL.createObjectURL(this.files[0]);
    const nameEl = document.getElementById("videoInputName");
    if (nameEl) nameEl.textContent = this.files[0].name;
    timestamps = []; beatTimes = [];
    undoStack = []; redoStack = [];
    selectedTimestampIndex = -1; activeTimestampIndex = -1;
    waveformData = null; waveformSampleRate = 0; waveformDuration = 0;
    waveformZoomStart = 0; waveformZoomEnd = 0; waveformDragIndex = -1;
    scrollbarDragging = false;
    spectrogramData = null; spectrogramSlices = 0; spectrogramBins = 0; showSpectrogram = false;
    const wc = document.getElementById("waveformContainer");
    if (wc) wc.classList.add("waveform-hidden");
    const sBtn = document.getElementById("spectrogramBtn");
    if (sBtn) sBtn.textContent = "Spectrogram";
    renderTimestamps();
});

// Controls
markBtn.addEventListener("click", markTime);
undoBtn.addEventListener("click", undo);
if (redoBtn) redoBtn.addEventListener("click", redo);
clearBtn.addEventListener("click", clearTimestamps);
exportBtn.addEventListener("click", generateSRT);
srtInput.addEventListener("change", () => importSRT(srtInput.files[0]));
if (saveProjectBtn) saveProjectBtn.addEventListener("click", saveProject);
if (loadProjectInput) loadProjectInput.addEventListener("change", () => loadProject(loadProjectInput.files[0]));

// Lyrics
lyricsInput1.addEventListener("input", renderTimestamps);
lyricsInput2.addEventListener("input", renderTimestamps);
displayMode.addEventListener("change", renderTimestamps);

// Theme
initTheme();
if (themeToggle) themeToggle.addEventListener("click", toggleTheme);

// Beat controls
if (analyzeBeatBtn)     analyzeBeatBtn.addEventListener    ("click", analyzeBeats);
if (snapAllBtn)         snapAllBtn.addEventListener        ("click", snapAllTimestamps);
if (adjustToBeatBtn)    adjustToBeatBtn.addEventListener   ("click", generateTimestampsFromBeats);
if (autoSplitBtn)       autoSplitBtn.addEventListener      ("click", autoSplitLyricsByBeats);
if (generateFromBeatsBtn) generateFromBeatsBtn.addEventListener("click", generateTimestampsFromBeats);

// Spectrogram toggle
const spectrogramBtn = document.getElementById("spectrogramBtn");
if (spectrogramBtn) {
    spectrogramBtn.addEventListener("click", () => {
        if (!spectrogramData) {
            computeSpectrogram();
        } else {
            showSpectrogram = !showSpectrogram;
            spectrogramBtn.textContent = showSpectrogram ? "Waveform" : "Spectrogram";
            renderWaveform();
        }
    });
}

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
    // Let the inline-edit input handle its own keys
    if (["TEXTAREA", "INPUT", "SELECT"].includes(document.activeElement.tagName)) return;

    // Play / pause
    if (e.code === "Space") {
        e.preventDefault();
        video.paused ? video.play() : video.pause();
    }

    // Mark
    if (e.key === "Enter") markTime();

    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); }

    // Seek ±5s
    if (e.key === "ArrowLeft")  { e.preventDefault(); if (video.src) video.currentTime = Math.max(0, video.currentTime - 5); }
    if (e.key === "ArrowRight") { e.preventDefault(); if (video.src) video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); }

    // Fine-tune selected timestamp ±0.05s
    if (e.key === "[" && selectedTimestampIndex !== -1) {
        e.preventDefault();
        saveHistory();
        timestamps[selectedTimestampIndex] = Math.max(0, timestamps[selectedTimestampIndex] - 0.05);
        renderTimestamps();
    }
    if (e.key === "]" && selectedTimestampIndex !== -1) {
        e.preventDefault();
        saveHistory();
        timestamps[selectedTimestampIndex] = Math.min(video.duration || Infinity, timestamps[selectedTimestampIndex] + 0.05);
        renderTimestamps();
    }
});

// Waveform updates
video.addEventListener("timeupdate", () => {
    updateActiveTimestamp();
    if (waveformData) renderWaveform();
});
window.addEventListener("resize", () => { if (waveformData) renderWaveform(); });
initWaveformInteraction();
initWaveformZoom();
initScrollbarInteraction();
