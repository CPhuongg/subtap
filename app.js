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
        
        // Detect beats
        beatTimes = [];
        const avg = energy.reduce((a, b) => a + b, 0) / energy.length;
        const threshold = avg * 1.5;
        
        for (let i = 2; i < energy.length - 2; i++) {
            if (energy[i] > threshold &&
                energy[i] > energy[i - 1] && energy[i] > energy[i - 2] &&
                energy[i] > energy[i + 1] && energy[i] > energy[i + 2]) {
                
                const time = (i * hopSize) / sampleRate;
                if (beatTimes.length === 0 || time - beatTimes[beatTimes.length - 1] > 0.1) {
                    beatTimes.push(time);
                }
            }
        }
        
        // Show results
        if (analyzeBeatBtn) analyzeBeatBtn.textContent = `🎵 ${beatTimes.length} beats`;
        renderTimestamps();
        
        if (beatTimes.length > 1) {
            const avgInterval = (beatTimes[beatTimes.length - 1] - beatTimes[0]) / (beatTimes.length - 1);
            const bpm = Math.round(60 / avgInterval);
            alert(`Found ${beatTimes.length} beats\nEstimated BPM: ~${bpm}`);
        } else {
            alert(`Found ${beatTimes.length} beats`);
        }
        
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