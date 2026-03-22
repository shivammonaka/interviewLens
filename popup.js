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
// Library player
const nowPlaying   = document.getElementById('nowPlaying');
const npName       = document.getElementById('npName');
const npStop       = document.getElementById('npStop');
const npProgress   = document.getElementById('npProgress');
const npFill       = document.getElementById('npFill');
const npTime       = document.getElementById('npTime');
const ctx          = canvas.getContext('2d');

// ── State ─────────────────────────────────────────────────────────────────
let uiState      = 'idle';
let elapsed      = 0;
let timerInterval= null;
let pollInterval = null;
let animFrameId  = null;
let liveWaveform = new Array(128).fill(128);
let currentRecs  = [];
let libAudio     = null;   // library playback
let libIndex     = -1;
let reviewAudio  = null;   // review panel playback

// ── Canvas ────────────────────────────────────────────────────────────────
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.scale(dpr, dpr);
}
resizeCanvas();

// ── Tabs ──────────────────────────────────────────────────────────────────
function switchTab(tab) {
  [panelRecord, panelReview, panelPlayer].forEach(p => p.classList.remove('active'));
  [tabRecord, tabPlayer].forEach(t => t.classList.remove('active'));
  if (tab === 'record')  { panelRecord.classList.add('active');  tabRecord.classList.add('active'); }
  if (tab === 'review')  { panelReview.classList.add('active');  tabRecord.classList.add('active'); }
  if (tab === 'player')  { panelPlayer.classList.add('active');  tabPlayer.classList.add('active'); }
}
tabRecord.addEventListener('click', () => {
  if (pendingRec) switchTab('review'); // stay on review if pending
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

    // Step 1 — wait for recording to stop
    if (uiState !== 'idle' && !s.isRecording) {
      setUI('idle');
      resetTimer();
      currentRecs = s.recordings || [];
      // Don't stop polling yet — keep waiting for pending to arrive
    }

    // Step 2 — once stopped, wait for pending blob to be ready
    if (uiState === 'idle' && s.pending && !pendingRec) {
      stopPolling();
      showReview(s.pending);
    }

    // Step 3 — safety timeout: if stopped but no pending after 5s, go to player
    // (handled by the poll counter below)
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

// Save
saveBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim() || pendingRec.name;
  const res = await bgMsg({ type: 'SAVE_RECORDING', name });
  if (res.ok) {
    currentRecs = res.recordings || [];
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

// ── Record UI state ───────────────────────────────────────────────────────
const PAUSE_PATH  = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;
const RESUME_PATH = `<path d="M8 5v14l11-7z"/>`;
const PLAY_PATH   = `<path d="M8 5v14l11-7z"/>`;
const PAUSE_PATH_ICON = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`;

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
        <div class="rec-meta">${rec.duration}</div>
      </div>
      <div class="rec-actions">
        <button class="icon-btn ${libIndex===i?'playing':''}" data-idx="${i}" data-action="play">
          ${libIndex===i ? `<svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>` : `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`}
        </button>
        <button class="icon-btn" data-idx="${i}" data-action="dl"><svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg></button>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.icon-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.idx);
      if (btn.dataset.action === 'play') libIndex === i ? stopLib() : playLib(i);
      else reDownload(i);
    });
  });
  listEl.querySelectorAll('.recording-item').forEach(row => {
    row.addEventListener('click', () => {
      const i = parseInt(row.dataset.idx);
      libIndex === i ? stopLib() : playLib(i);
    });
  });
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

// ── Init ──────────────────────────────────────────────────────────────────
(async () => {
  const s = await bgMsg({ type: 'GET_STATE' });
  currentRecs = s.recordings || [];
  renderList(currentRecs);

  if (s.pending) {
    // Was stopped while popup was closed — show review
    showReview(s.pending);
  } else if (s.isRecording && !s.isPaused) {
    setUI('recording'); startTimer(s.elapsed || 0); startPolling(); switchTab('record');
  } else if (s.isRecording && s.isPaused) {
    setUI('paused'); elapsed = s.elapsed || 0; timerEl.textContent = fmt(elapsed); drawWaveform(); switchTab('record');
  } else {
    setUI('idle'); resetTimer();
  }
})();