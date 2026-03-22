// offscreen.js
// Handles mic access, recording, and audio analysis.
// Sends dataUrl DIRECTLY in RECORDING_DONE — no two-step blob fetch.
// Sends AUDIO_LEVEL every 50ms — background stores latest, popup polls it.

let mediaRecorder = null;
let audioChunks   = [];
let stream        = null;
let audioCtx      = null;
let analyser      = null;
let levelTimer    = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'OFFSCREEN_START') {
    startRecording()
      .then(() => sendResponse({ ok: true }))
      .catch(e => {
        console.error('[offscreen] start failed:', e.message);
        sendResponse({ ok: false, error: e.message });
      });
    return true; // async
  }
  if (msg.type === 'OFFSCREEN_STOP')   { stopRecording();   sendResponse({ ok: true }); }
  if (msg.type === 'OFFSCREEN_PAUSE')  { pauseRecording();  sendResponse({ ok: true }); }
  if (msg.type === 'OFFSCREEN_RESUME') { resumeRecording(); sendResponse({ ok: true }); }
});

async function startRecording() {
  // Clean up any leftover state
  cleanup();
  audioChunks = [];

  stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

  // ── Audio analyser ────────────────────────────────────────────────────
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;                 // more samples = smoother waveform shape
  analyser.smoothingTimeConstant = 0.8;    // smooth between frames so it looks natural
  audioCtx.createMediaStreamSource(stream).connect(analyser);

  startLevelTimer();

  // ── MediaRecorder ─────────────────────────────────────────────────────
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
    .find(m => MediaRecorder.isTypeSupported(m)) || '';

  // 32kbps is sufficient for speech — Groq/Whisper resamples to 16kHz mono
  // internally anyway, so anything above ~32kbps is wasted storage.
  // This brings a 2hr interview from ~115MB down to ~28MB, safely under
  // Groq's 25MB limit for most recordings.
  mediaRecorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 32000,
  });
  mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) audioChunks.push(e.data); };

  mediaRecorder.onstop = async () => {
    stopLevelTimer();
    cleanup(); // stop mic light immediately

    const blob    = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    audioChunks   = [];

    // Convert to dataUrl HERE and send directly — no two-step, no size issue for typical recordings
    const dataUrl = await blobToDataUrl(blob);
    chrome.runtime.sendMessage({ type: 'RECORDING_DONE', dataUrl });
  };

  mediaRecorder.start(1000); // flush chunks every 1s
}

function startLevelTimer() {
  stopLevelTimer();
  levelTimer = setInterval(() => {
    if (!analyser) return;
    const td = new Uint8Array(analyser.fftSize / 2);
    analyser.getByteTimeDomainData(td);

    // Find peak deviation from centre (128)
    let peak = 0;
    for (let i = 0; i < td.length; i++) {
      const dev = Math.abs(td[i] - 128);
      if (dev > peak) peak = dev;
    }

    // Gentle fixed gain — loud voice = big waves, quiet = small waves
    const gain = 2.5;
    const scaled = Array.from(td).map(v => {
      const amplified = (v - 128) * gain;
      return Math.round(Math.max(0, Math.min(255, 128 + amplified)));
    });

    chrome.runtime.sendMessage({
      type: 'AUDIO_LEVEL',
      waveform: scaled,
      level: Math.min(1, peak / 64)
    });
  }, 50);
}

function stopLevelTimer() {
  if (levelTimer) { clearInterval(levelTimer); levelTimer = null; }
}

function cleanup() {
  if (stream)   { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (audioCtx) { try { audioCtx.close(); } catch(_){} audioCtx = null; }
  analyser = null;
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  else cleanup();
}

function pauseRecording() {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.pause();
    stopLevelTimer();
    // Send flat line so waveform goes quiet
    chrome.runtime.sendMessage({ type: 'AUDIO_LEVEL', waveform: new Array(128).fill(128), level: 0 });
  }
}

function resumeRecording() {
  if (mediaRecorder?.state === 'paused') {
    mediaRecorder.resume();
    startLevelTimer();
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}