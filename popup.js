// popup.js

// ── DOM ───────────────────────────────────────────────────────────────────
const tabRecord    = document.getElementById('tabRecord');
const tabPlayer    = document.getElementById('tabPlayer');
const panelRecord  = document.getElementById('panelRecord');
const panelReview  = document.getElementById('panelReview');
const panelPlayer  = document.getElementById('panelPlayer');
const recordBtn    = document.getElementById('recordBtn');
const recordLbl    = document.getElementById('recordLabel');
const pauseBtn     = document.getElementById('pauseBtn');
const pauseLbl     = document.getElementById('pauseLabel');
const pauseIcon    = document.getElementById('pauseIcon');
const timerEl      = document.getElementById('timer');
const timerLabel   = document.getElementById('timerLabel');
const statusDot    = document.getElementById('statusDot');
const canvas       = document.getElementById('waveCanvas');
const idleLine     = document.getElementById('idleLine');
const listEl       = document.getElementById('recordingsList');
const emptyState   = document.getElementById('emptyState');
const clearBtn     = document.getElementById('clearBtn');
const notifEl      = document.getElementById('notif');
const settingsBtn  = document.getElementById('settingsBtn');
const floatBtn     = document.getElementById('floatBtn');
// Review panel
const reviewDur    = document.getElementById('reviewDuration');
const mpBtn        = document.getElementById('mpBtn');
const mpIcon       = document.getElementById('mpIcon');
const mpProgress   = document.getElementById('mpProgress');
const mpFill       = document.getElementById('mpFill');
const mpTime       = document.getElementById('mpTime');
const nameInput    = document.getElementById('nameInput');
const saveBtn      = document.getElementById('saveBtn');
const discardBtn   = document.getElementById('discardBtn');
const reviewTranscribeBtn = document.getElementById('reviewTranscribeBtn');
// Library player
const nowPlaying   = document.getElementById('nowPlaying');
const npName       = document.getElementById('npName');
const npStop       = document.getElementById('npStop');
const npProgress   = document.getElementById('npProgress');
const npFill       = document.getElementById('npFill');
const npTime       = document.getElementById('npTime');
// Transcript modal
const transcriptModal = document.getElementById('transcriptModal');
const modalClose   = document.getElementById('modalClose');
const modalRecName = document.getElementById('modalRecName');
const modalBody    = document.getElementById('modalBody');
const transcriptText = document.getElementById('transcriptText');
const modalActions = document.getElementById('modalActions');
const copyBtn      = document.getElementById('copyBtn');
const copyLlmBtn   = document.getElementById('copyLlmBtn');

const ctx = canvas.getContext('2d');

// ── State ─────────────────────────────────────────────────────────────────
let uiState      = 'idle';
let elapsed      = 0;
let timerInterval= null;
let pollInterval = null;
let animFrameId  = null;
let liveWaveform = new Array(128).fill(128);
let currentRecs  = [];
let libAudio     = null;
let libIndex     = -1;
let reviewAudio  = null;
// Modal state
let modalRecIndex = -1;   // -1 = pending review recording

// ── Canvas ────────────────────────────────────────────────────────────────
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.scale(dpr, dpr);
}
resizeCanvas();

// ── Settings ──────────────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

// Open as a detached floating window — stays open when you click away
floatBtn.addEventListener('click', () => {
  chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 380,
    height: 600,
  });
});

// ── Tabs ──────────────────────────────────────────────────────────────────
function switchTab(tab) {
  [panelRecord, panelReview, panelPlayer].forEach(p => p.classList.remove('active'));
  [tabRecord, tabPlayer].forEach(t => t.classList.remove('active'));
  if (tab === 'record')  { panelRecord.classList.add('active');  tabRecord.classList.add('active'); }
  if (tab === 'review')  { panelReview.classList.add('active');  tabRecord.classList.add('active'); }
  if (tab === 'player')  { panelPlayer.classList.add('active');  tabPlayer.classList.add('active'); }
}
tabRecord.addEventListener('click', () => {
  if (pendingRec) switchTab('review');
  else switchTab('record');
});
tabPlayer.addEventListener('click', () => switchTab('player'));

// ── Notification ──────────────────────────────────────────────────────────
function showNotif(text, bg) {
  notifEl.textContent = text;
  notifEl.style.background = bg || 'var(--accent)';
  notifEl.style.color = bg ? '#fff' : '#000';
  notifEl.classList.add('show');
  setTimeout(() => notifEl.classList.remove('show'), 3000);
}

// ── Timer ─────────────────────────────────────────────────────────────────
function fmt(s) { return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function startTimer(init=0) {
  elapsed = init; timerEl.textContent = fmt(elapsed);
  clearInterval(timerInterval);
  timerInterval = setInterval(() => { elapsed++; timerEl.textContent = fmt(elapsed); }, 1000);
}
function stopTimer()  { clearInterval(timerInterval); timerInterval = null; }
function resetTimer() { stopTimer(); elapsed = 0; timerEl.textContent = '00:00'; }

// ── Waveform ──────────────────────────────────────────────────────────────
function drawWaveform() {
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const color = uiState === 'paused' ? '#ff9500' : '#e8ff00';
  ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.shadowBlur = 12; ctx.shadowColor = color;
  ctx.beginPath();
  const pts = liveWaveform.length;
  for (let i = 0; i < pts; i++) {
    const x = (i / (pts-1)) * W;
    const y = H/2 + ((liveWaveform[i] - 128) / 128) * (H * 0.42);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke(); ctx.shadowBlur = 0;
  animFrameId = requestAnimationFrame(drawWaveform);
}
function stopWaveform() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  liveWaveform = new Array(128).fill(128);
}

// ── Polling ───────────────────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  pollInterval = setInterval(async () => {
    const s = await bgMsg({ type: 'GET_STATE' });
    if (!s) return;
    if (s.waveform) liveWaveform = s.waveform;
    if (s.isRecording && !s.isPaused) { elapsed = s.elapsed; timerEl.textContent = fmt(elapsed); }

    if (uiState !== 'idle' && !s.isRecording) {
      setUI('idle');
      resetTimer();
      currentRecs = s.recordings || [];
    }

    if (uiState === 'idle' && s.pending && !pendingRec) {
      stopPolling();
      showReview(s.pending);
    }
  }, 50);
}
function stopPolling() { if (pollInterval) { clearInterval(pollInterval); pollInterval = null; } }

// ── Review screen ─────────────────────────────────────────────────────────
let pendingRec = null;

function showReview(rec) {
  stopPolling();
  pendingRec = rec;
  reviewDur.textContent = rec.duration;
  nameInput.value = rec.name;
  mpFill.style.width = '0%';
  mpTime.textContent = '0:00';
  mpIcon.innerHTML = PLAY_PATH;
  mpBtn.classList.remove('playing');
  reviewTranscribeBtn.classList.remove('loading');
  reviewTranscribeBtn.querySelector('span').textContent = rec.transcript
    ? '✓ Transcribed — view'
    : '⚡ Transcribe with Groq';
  if (reviewAudio) { reviewAudio.pause(); reviewAudio = null; }
  switchTab('review');
}

// Mini player in review
mpBtn.addEventListener('click', () => {
  if (!pendingRec?.dataUrl) return;
  if (reviewAudio && !reviewAudio.paused) {
    reviewAudio.pause();
    mpIcon.innerHTML = PLAY_PATH;
    mpBtn.classList.remove('playing');
    return;
  }
  if (!reviewAudio) {
    reviewAudio = new Audio(pendingRec.dataUrl);
    reviewAudio.ontimeupdate = () => {
      if (!reviewAudio) return;
      const pct = (reviewAudio.currentTime / reviewAudio.duration) * 100 || 0;
      mpFill.style.width = pct + '%';
      mpTime.textContent = fmt(Math.floor(reviewAudio.currentTime));
    };
    reviewAudio.onended = () => {
      mpIcon.innerHTML = PLAY_PATH;
      mpBtn.classList.remove('playing');
    };
  }
  reviewAudio.play();
  mpIcon.innerHTML = PAUSE_PATH_ICON;
  mpBtn.classList.add('playing');
});

mpProgress.addEventListener('click', e => {
  if (!reviewAudio) return;
  reviewAudio.currentTime = (e.offsetX / mpProgress.offsetWidth) * reviewAudio.duration;
});

// Transcribe button in review panel
reviewTranscribeBtn.addEventListener('click', async () => {
  if (!pendingRec?.dataUrl) return;
  reviewTranscribeBtn.disabled = true;
  reviewTranscribeBtn.classList.add('loading');
  reviewTranscribeBtn.querySelector('span').textContent = 'Transcribing…';

  const res = await bgMsg({ type: 'TRANSCRIBE', dataUrl: pendingRec.dataUrl, isPending: true });

  reviewTranscribeBtn.disabled = false;
  reviewTranscribeBtn.classList.remove('loading');

  if (res.ok) {
    pendingRec.transcript = res.text;
    reviewTranscribeBtn.querySelector('span').textContent = '✓ Transcribed — view';
    // Open modal immediately so user can view/copy
    openTranscriptModal(-1, pendingRec.name, res.text);
  } else {
    reviewTranscribeBtn.querySelector('span').textContent = '⚡ Transcribe with Groq';
    if (res.error?.includes('No API key')) {
      showNotif('Add Groq API key in Settings', '#ff9500');
      chrome.runtime.openOptionsPage();
    } else {
      showNotif(res.error || 'Transcription failed', '#ff3c3c');
    }
  }
});

// Save
saveBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim() || pendingRec.name;
  const res = await bgMsg({ type: 'SAVE_RECORDING', name });
  if (res.ok) {
    currentRecs = res.recordings || [];
    // If we had a transcript on pending, save it to the now-saved recording
    if (pendingRec?.transcript && currentRecs.length > 0) {
      await bgMsg({ type: 'SAVE_TRANSCRIPT', index: 0, text: pendingRec.transcript });
      currentRecs[0].transcript = pendingRec.transcript;
    }
    if (reviewAudio) { reviewAudio.pause(); reviewAudio = null; }
    pendingRec = null;
    renderList(currentRecs);
    switchTab('player');
    showNotif('✓ Saved to Downloads/AudioRecordings/');
  }
});

// Discard
discardBtn.addEventListener('click', async () => {
  await bgMsg({ type: 'DISCARD_RECORDING' });
  if (reviewAudio) { reviewAudio.pause(); reviewAudio = null; }
  pendingRec = null;
  switchTab('record');
  showNotif('Discarded', '#555');
});

// ── Transcript Modal ───────────────────────────────────────────────────────

// ── LLM prompt builder ────────────────────────────────────────────────────
const DEFAULT_LLM_TEMPLATE =
`You are an expert technical interview coach. Analyze the following interview transcript and give me brutally honest, actionable feedback.

---

{{transcript}}

---
{{problem}}{{code}}
Evaluate me on these dimensions:

**Communication**
- Did I explain my thought process out loud before coding?
- Did I walk through my approach step by step?
- Did I talk while coding or go silent?
- Did I ask clarifying questions?

**Technical Reasoning**
- Did I discuss the algorithm and why I chose it?
- Did I mention time and space complexity?
- Did I consider edge cases?
- Did I propose brute force first then optimize?

**Problem Solving Approach**
- Did I break the problem down before jumping to code?
- Did I get stuck and how did I recover?
- Did I validate my solution with examples?

**Strong Points**
List what I did well. Be specific with moments from the transcript.

**Weak Points & What to Improve**
List exactly where I fumbled. Be direct — no sugarcoating. For each weak point, tell me specifically what I should have said or done instead.

**Overall Assessment**
One short paragraph summary. End with the single most important habit I need to build before my next interview.`;

async function buildLlmPrompt(transcript, problem = '', code = '') {
  const { llmTemplate } = await chrome.storage.local.get('llmTemplate');
  const template = (llmTemplate && llmTemplate.trim()) || DEFAULT_LLM_TEMPLATE;

  // Build optional sections — only included if the user provided them
  const problemSection = problem.trim()
    ? `\n**Problem Statement:**\n${problem.trim()}\n` : '';
  const codeSection = code.trim()
    ? `\n**My Code:**\n\`\`\`\n${code.trim()}\n\`\`\`\n` : '';

  return template
    .replace(/\{\{transcript\}\}/g, transcript)
    .replace(/\{\{problem\}\}/g, problemSection)
    .replace(/\{\{code\}\}/g, codeSection);
}

function openTranscriptModal(index, name, text) {
  modalRecIndex = index;
  modalRecName.textContent = name;
  transcriptText.textContent = text || '';
  modalBody.innerHTML = '';
  modalBody.appendChild(transcriptText);
  modalActions.removeAttribute('style');
  modalActions.style.display = 'flex';
  copyBtn.textContent = 'Copy text';
  copyBtn.classList.remove('copied');
  transcriptModal.classList.add('open');
}

function showModalLoading(name) {
  modalRecName.textContent = name;
  modalBody.innerHTML = `<div class="modal-loading"><div class="spin"></div><span>Transcribing audio…</span></div>`;
  modalActions.style.display = 'none';
  transcriptModal.classList.add('open');
}

function showModalError(msg) {
  modalBody.innerHTML = `<div class="modal-error">${msg}</div>`;
  modalActions.style.display = 'none';
}

modalClose.addEventListener('click', () => transcriptModal.classList.remove('open'));
transcriptModal.addEventListener('click', e => {
  if (e.target === transcriptModal) transcriptModal.classList.remove('open');
  if (e.target.classList.contains('open-settings')) chrome.runtime.openOptionsPage();
});

// Copy raw transcript
copyBtn.addEventListener('click', () => {
  const text = transcriptText.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = '✓ Copied!';
    copyBtn.classList.add('copied');
    setTimeout(() => { copyBtn.textContent = 'Copy text'; copyBtn.classList.remove('copied'); }, 2000);
  });
});

// Generate LLM Prompt — saves via background service worker (survives popup close)
// then opens review.html which polls storage until it finds the transcript
copyLlmBtn.addEventListener('click', async () => {
  const text = transcriptText.textContent;
  if (!text) return;
  await bgMsg({ type: 'SAVE_LLM_TRANSCRIPT', text });
  chrome.tabs.create({ url: chrome.runtime.getURL('review.html') });
});

// ── Record UI state ───────────────────────────────────────────────────────
const PAUSE_PATH      = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
const RESUME_PATH     = `<path d="M8 5v14l11-7z"/>`;
const PLAY_PATH       = `<path d="M8 5v14l11-7z"/>`;
const PAUSE_PATH_ICON = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;

// SVG icons for list buttons
const TRANSCRIPT_SVG = `<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v1.5H8V13zm0 3h5v1.5H8V16zm0-6h2v1.5H8V10z"/></svg>`;
const SPIN_SVG       = `<svg viewBox="0 0 24 24"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z"/></svg>`;

function setUI(s) {
  uiState = s;
  recordBtn.classList.toggle('recording', s === 'recording');
  recordBtn.classList.toggle('paused',    s === 'paused');
  statusDot.classList.toggle('active',    s === 'recording');
  statusDot.classList.toggle('paused',    s === 'paused');
  timerEl.classList.toggle('recording',   s === 'recording');
  timerEl.classList.toggle('paused',      s === 'paused');
  timerLabel.textContent = s === 'recording' ? 'Recording…' : s === 'paused' ? 'Paused' : 'Ready to record';
  recordLbl.textContent  = s === 'idle' ? 'Click to record' : 'Stop & Save';
  const active = s !== 'idle';
  pauseBtn.classList.toggle('visible', active);
  pauseLbl.classList.toggle('visible', active);
  pauseIcon.innerHTML  = s === 'paused' ? RESUME_PATH : PAUSE_PATH;
  pauseLbl.textContent = s === 'paused' ? 'Resume' : 'Pause';
  idleLine.style.display = s === 'idle' ? 'block' : 'none';
  if (s === 'idle') { stopWaveform(); }
  else if (!animFrameId) drawWaveform();
}

// ── Messaging ─────────────────────────────────────────────────────────────
function bgMsg(payload) {
  return new Promise(resolve =>
    chrome.runtime.sendMessage(payload, r => {
      if (chrome.runtime.lastError) { resolve({}); return; }
      resolve(r || {});
    })
  );
}

// ── Record button ─────────────────────────────────────────────────────────
recordBtn.addEventListener('click', async () => {
  if (uiState !== 'idle') {
    showNotif('Saving…', '#333');
    const res = await bgMsg({ type: 'STOP_RECORDING' });
    if (res.ok) { setUI('idle'); resetTimer(); startPolling(); }
    else showNotif('Nothing to stop', '#ff3c3c');
  } else {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
    } catch(e) {
      chrome.runtime.openOptionsPage();
      showNotif('Allow mic on the page that opened', '#ff9500');
      return;
    }
    showNotif('Starting…', '#333');
    const res = await bgMsg({ type: 'START_RECORDING' });
    if (res.ok) { setUI('recording'); startTimer(0); startPolling(); }
    else showNotif('Could not start', '#ff3c3c');
  }
});

// ── Pause / Resume ────────────────────────────────────────────────────────
pauseBtn.addEventListener('click', async () => {
  if (uiState === 'recording') {
    const res = await bgMsg({ type: 'PAUSE_RECORDING' });
    if (res.ok) { setUI('paused'); stopTimer(); liveWaveform = new Array(128).fill(128); }
  } else if (uiState === 'paused') {
    const res = await bgMsg({ type: 'RESUME_RECORDING' });
    if (res.ok) { setUI('recording'); startTimer(elapsed); }
  }
});

// ── Library player ────────────────────────────────────────────────────────
function playLib(i) {
  stopLib();
  const rec = currentRecs[i];
  if (!rec?.dataUrl) return;
  libAudio = new Audio(rec.dataUrl);
  libIndex = i;
  npName.textContent = rec.name;
  nowPlaying.classList.add('active');
  libAudio.ontimeupdate = () => {
    if (!libAudio) return;
    npFill.style.width = ((libAudio.currentTime / libAudio.duration) * 100 || 0) + '%';
    npTime.textContent = fmt(Math.floor(libAudio.currentTime));
  };
  libAudio.onended = stopLib;
  libAudio.play();
  renderList(currentRecs);
}
function stopLib() {
  if (libAudio) { libAudio.pause(); libAudio = null; }
  libIndex = -1;
  nowPlaying.classList.remove('active');
  npFill.style.width = '0%';
  renderList(currentRecs);
}
npStop.addEventListener('click', stopLib);
npProgress.addEventListener('click', e => {
  if (!libAudio) return;
  libAudio.currentTime = (e.offsetX / npProgress.offsetWidth) * libAudio.duration;
});

// ── Library list ──────────────────────────────────────────────────────────
function renderList(recs) {
  if (!recs || recs.length === 0) {
    listEl.innerHTML = ''; listEl.appendChild(emptyState); emptyState.style.display = 'block'; return;
  }
  emptyState.style.display = 'none';
  listEl.innerHTML = recs.map((rec, i) => `
    <div class="recording-item ${libIndex===i?'active':''}" data-idx="${i}">
      <div class="rec-info">
        <div class="rec-name">${rec.name}</div>
        <div class="rec-meta">
          ${rec.duration}
          ${rec.transcript ? '<span class="transcript-badge">TXT</span>' : ''}
        </div>
      </div>
      <div class="rec-actions">
        <button class="icon-btn ${libIndex===i?'playing':''}" data-idx="${i}" data-action="play" title="${libIndex===i?'Stop':'Play'}">
          ${libIndex===i
            ? `<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>`
            : `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`}
        </button>
        <button class="icon-btn" data-idx="${i}" data-action="transcript" title="${rec.transcript?'View transcript':'Transcribe'}">
          ${TRANSCRIPT_SVG}
        </button>
        <button class="icon-btn" data-idx="${i}" data-action="dl" title="Download">
          <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.icon-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.idx);
      const action = btn.dataset.action;
      if (action === 'play') {
        libIndex === i ? stopLib() : playLib(i);
      } else if (action === 'transcript') {
        handleTranscriptBtn(i, btn);
      } else if (action === 'dl') {
        reDownload(i);
      }
    });
  });
  listEl.querySelectorAll('.recording-item').forEach(row => {
    row.addEventListener('click', () => {
      const i = parseInt(row.dataset.idx);
      libIndex === i ? stopLib() : playLib(i);
    });
  });
}

async function handleTranscriptBtn(i, btn) {
  const rec = currentRecs[i];
  if (!rec) return;

  // If transcript exists, just open modal
  if (rec.transcript) {
    openTranscriptModal(i, rec.name, rec.transcript);
    return;
  }

  // Need to transcribe first — show loading in modal
  showModalLoading(rec.name);
  modalRecIndex = i;

  // Spinning icon on the button
  btn.classList.add('transcribing');
  btn.innerHTML = SPIN_SVG;

  const res = await bgMsg({ type: 'TRANSCRIBE', index: i });

  // Reset button
  btn.classList.remove('transcribing');
  btn.innerHTML = TRANSCRIPT_SVG;

  if (res.ok) {
    currentRecs[i].transcript = res.text;
    renderList(currentRecs);
    openTranscriptModal(i, rec.name, res.text);
  } else {
    if (res.error?.includes('No API key')) {
      showModalError('No Groq API key found.<br><a class="open-settings" style="cursor:pointer;color:var(--accent)">Open Settings to add one.</a>');
    } else {
      showModalError(res.error || 'Transcription failed. Please try again.');
    }
  }
}

async function reDownload(i) {
  await bgMsg({ type: 'DOWNLOAD_RECORDING', index: i });
  showNotif('Saved to Downloads/AudioRecordings/');
}

clearBtn.addEventListener('click', async () => {
  stopLib();
  await bgMsg({ type: 'CLEAR_RECORDINGS' });
  currentRecs = []; renderList([]); showNotif('Cleared');
});

// ── Keyboard shortcut ─────────────────────────────────────────────────────
// Ctrl+Shift+Space — toggle record/stop
// (Ctrl+S = browser save, Ctrl+Shift+R = browser reload — both are reserved)
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
    e.preventDefault();
    recordBtn.click();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────
(async () => {
  const s = await bgMsg({ type: 'GET_STATE' });
  currentRecs = s.recordings || [];
  renderList(currentRecs);

  if (s.pending) {
    showReview(s.pending);
  } else if (s.isRecording && !s.isPaused) {
    setUI('recording'); startTimer(s.elapsed || 0); startPolling(); switchTab('record');
  } else if (s.isRecording && s.isPaused) {
    setUI('paused'); elapsed = s.elapsed || 0; timerEl.textContent = fmt(elapsed); drawWaveform(); switchTab('record');
  } else {
    setUI('idle'); resetTimer();
  }
})();