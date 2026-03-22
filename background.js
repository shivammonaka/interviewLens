// background.js — Service Worker
// Stores latest waveform in memory so popup can poll it via GET_STATE.
// No two-step blob fetch — offscreen sends dataUrl directly in RECORDING_DONE.

let state = {
  isRecording:   false,
  isPaused:      false,
  startTime:     null,
  pausedElapsed: 0,
  recordings:    [],
  waveform:      new Array(128).fill(128),
  pending:       null,   // recording awaiting user review
};

let storageLoaded = false;

// ── Storage ───────────────────────────────────────────────────────────────
async function loadStorage() {
  if (storageLoaded) return;
  storageLoaded = true;
  try {
    const r = await chrome.storage.local.get('recordings');
    if (Array.isArray(r.recordings)) state.recordings = r.recordings;
  } catch(e) { console.warn('[bg] storage load failed', e); }
}

async function saveStorage() {
  try { await chrome.storage.local.set({ recordings: state.recordings }); }
  catch(e) { console.warn('[bg] storage save failed', e); }
}

// ── Keep SW alive ─────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'keepAlive' && state.isRecording) {
    chrome.alarms.create('keepAlive', { delayInMinutes: 1/3 });
  }
});
function startKeepAlive() { chrome.alarms.create('keepAlive', { delayInMinutes: 1/3 }); }
function stopKeepAlive()  { chrome.alarms.clear('keepAlive'); }

// ── Offscreen ─────────────────────────────────────────────────────────────
async function ensureOffscreen() {
  let has = false;
  try { has = await chrome.offscreen.hasDocument(); } catch(_) {}
  if (has) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Microphone recording that must continue in background'
  });
}
async function closeOffscreen() {
  try { await chrome.offscreen.closeDocument(); } catch(_) {}
}

// Fire-and-forget to offscreen — we never wait for a response back because
// Chrome MV3 closes the message channel before the async sendResponse arrives,
// causing "message channel closed before response was received" errors.
// Offscreen signals completion via its own sendMessage (RECORDING_DONE, AUDIO_LEVEL).
function msgOffscreen(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {});
}

// ── Elapsed time helper ───────────────────────────────────────────────────
function calcElapsed() {
  let e = state.pausedElapsed;
  if (state.isRecording && !state.isPaused && state.startTime) {
    e += Math.floor((Date.now() - state.startTime) / 1000);
  }
  return e;
}

function fmt(s) {
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

// ── Groq Transcription ────────────────────────────────────────────────────
async function transcribeWithGroq(dataUrl, apiKey) {
  // Convert dataUrl to Blob
  const res     = await fetch(dataUrl);
  const blob    = await res.blob();

  // Groq Whisper accepts webm — build multipart form
  const form = new FormData();
  form.append('file', blob, 'audio.webm');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'json');
  form.append('language', 'en');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(err?.error?.message || `Groq API error ${response.status}`);
  }

  const data = await response.json();
  return data.text || '';
}

// ── Message hub ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    await loadStorage();

    switch (msg.type) {

      // ── Popup polls this ──────────────────────────────────────────────
      case 'GET_STATE':
        sendResponse({
          isRecording:  state.isRecording,
          isPaused:     state.isPaused,
          elapsed:      calcElapsed(),
          recordings:   state.recordings,
          waveform:     state.waveform,
          pending:      state.pending,
        });
        break;

      // ── Start ─────────────────────────────────────────────────────────
      case 'START_RECORDING':
        if (state.isRecording) { sendResponse({ ok: false, reason: 'already' }); break; }
        try {
          await ensureOffscreen();
          await new Promise(r => setTimeout(r, 300)); // let offscreen page boot
          msgOffscreen({ type: 'OFFSCREEN_START' });
          state.isRecording   = true;
          state.isPaused      = false;
          state.startTime     = Date.now();
          state.pausedElapsed = 0;
          state.waveform      = new Array(128).fill(128);
          startKeepAlive();
          sendResponse({ ok: true });
        } catch(e) {
          console.error('[bg] start failed:', e.message);
          await closeOffscreen();
          sendResponse({ ok: false, error: e.message });
        }
        break;

      // ── Pause ─────────────────────────────────────────────────────────
      case 'PAUSE_RECORDING':
        if (!state.isRecording || state.isPaused) { sendResponse({ ok: false }); break; }
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_PAUSE' });
        state.pausedElapsed += Math.floor((Date.now() - state.startTime) / 1000);
        state.startTime = null;
        state.isPaused  = true;
        state.waveform  = new Array(128).fill(128);
        sendResponse({ ok: true });
        break;

      // ── Resume ────────────────────────────────────────────────────────
      case 'RESUME_RECORDING':
        if (!state.isRecording || !state.isPaused) { sendResponse({ ok: false }); break; }
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_RESUME' });
        state.startTime = Date.now();
        state.isPaused  = false;
        sendResponse({ ok: true });
        break;

      // ── Stop ──────────────────────────────────────────────────────────
      case 'STOP_RECORDING':
        if (!state.isRecording) { sendResponse({ ok: false }); break; }
        state._durationAtStop = calcElapsed(); // capture before async gap
        // Mark stopped IMMEDIATELY so popup timer stops on next poll
        state.isRecording = false;
        state.isPaused    = false;
        state.startTime   = null;
        state.waveform    = new Array(128).fill(128);
        chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' });
        stopKeepAlive();
        sendResponse({ ok: true });
        break;

      // ── Offscreen sends live waveform frames ──────────────────────────
      case 'AUDIO_LEVEL':
        if (msg.waveform) state.waveform = msg.waveform;
        // No sendResponse needed — fire and forget
        break;

      // ── Offscreen finished — store as pending for user review ─────────
      case 'RECORDING_DONE': {
        const duration = fmt(state._durationAtStop || 0);
        const now      = new Date();
        const name     = `Recording_${now.toISOString().slice(0,10)}_${now
          .toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
          .replace(/:/g,'-')}`;

        if (msg.dataUrl) {
          state.pending = { name, dataUrl: msg.dataUrl, duration, timestamp: Date.now() };
        }

        state.isRecording    = false;
        state.isPaused       = false;
        state.startTime      = null;
        state.pausedElapsed  = 0;
        state._durationAtStop= 0;
        state.waveform       = new Array(128).fill(128);

        await closeOffscreen();
        sendResponse({ ok: true });
        break;
      }

      case 'SAVE_RECORDING': {
        if (!state.pending) { sendResponse({ ok: false }); break; }
        const rec = { ...state.pending, name: msg.name || state.pending.name };
        state.recordings.unshift(rec);
        state.pending = null;
        await saveStorage();
        chrome.downloads.download({
          url: rec.dataUrl,
          filename: `AudioRecordings/${rec.name}.webm`,
          saveAs: false, conflictAction: 'uniquify'
        });
        sendResponse({ ok: true, recordings: state.recordings });
        break;
      }

      case 'DISCARD_RECORDING':
        state.pending = null;
        sendResponse({ ok: true });
        break;

      case 'DOWNLOAD_RECORDING': {
        const rec = state.recordings[msg.index];
        if (!rec) { sendResponse({ ok: false }); break; }
        chrome.downloads.download({ url: rec.dataUrl, filename: `AudioRecordings/${rec.name}.webm`, saveAs: false, conflictAction: 'uniquify' });
        sendResponse({ ok: true });
        break;
      }

      case 'DELETE_RECORDING':
        state.recordings.splice(msg.index, 1);
        await saveStorage();
        sendResponse({ ok: true });
        break;

      case 'CLEAR_RECORDINGS':
        state.recordings = [];
        await saveStorage();
        sendResponse({ ok: true });
        break;

      // ── Groq Transcription ─────────────────────────────────────────────
      case 'TRANSCRIBE': {
        try {
          const { apiKey } = await chrome.storage.local.get('apiKey');
          if (!apiKey) {
            sendResponse({ ok: false, error: 'No API key set. Open Settings to add your Groq API key.' });
            break;
          }

          // Get dataUrl from pending or saved recordings
          let dataUrl = msg.dataUrl;
          if (!dataUrl && msg.index !== undefined) {
            dataUrl = state.recordings[msg.index]?.dataUrl;
          }
          if (!dataUrl) {
            sendResponse({ ok: false, error: 'No audio data found.' });
            break;
          }

          const text = await transcribeWithGroq(dataUrl, apiKey);

          // If saving to a recording, persist it
          if (msg.index !== undefined && state.recordings[msg.index]) {
            state.recordings[msg.index].transcript = text;
            await saveStorage();
          }
          if (msg.isPending && state.pending) {
            state.pending.transcript = text;
          }

          sendResponse({ ok: true, text });
        } catch(e) {
          sendResponse({ ok: false, error: e.message });
        }
        break;
      }

      // ── Save transcript to a saved recording ───────────────────────────
      case 'SAVE_TRANSCRIPT': {
        if (msg.index !== undefined && state.recordings[msg.index]) {
          state.recordings[msg.index].transcript = msg.text;
          await saveStorage();
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false });
        }
        break;
      }

      default:
        break;
    }
  })();
  return true;
});