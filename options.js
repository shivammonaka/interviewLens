// options.js — handles mic permission + Groq API key

// ── Mic permission ────────────────────────────────────────────────────────
const allowBtn  = document.getElementById('allowBtn');
const micStatus = document.getElementById('micStatus');

function showMicSuccess() {
  micStatus.className = 'status success';
  micStatus.textContent = '✓ Microphone access granted. You can start recording.';
  allowBtn.disabled = true;
  allowBtn.textContent = '✓ Granted';
}
function showMicError(msg) {
  micStatus.className = 'status error';
  micStatus.textContent = msg;
  allowBtn.disabled = false;
  allowBtn.textContent = 'Try Again';
}

navigator.permissions.query({ name: 'microphone' }).then(p => {
  if (p.state === 'granted') showMicSuccess();
  p.onchange = () => { if (p.state === 'granted') showMicSuccess(); };
}).catch(() => {});

allowBtn.addEventListener('click', async () => {
  allowBtn.disabled = true;
  allowBtn.textContent = 'Waiting…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach(t => t.stop());
    showMicSuccess();
  } catch(e) {
    if (e.name === 'NotAllowedError') {
      showMicError('Permission denied. Click the lock icon in the address bar → set Microphone to Allow → Try Again.');
    } else if (e.name === 'NotFoundError') {
      showMicError('No microphone found. Connect a mic and try again.');
    } else {
      showMicError('Error: ' + e.message);
    }
  }
});

// ── Groq API key ──────────────────────────────────────────────────────────
const apiInput   = document.getElementById('apiInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const keyStatus  = document.getElementById('keyStatus');
const keyPreview = document.getElementById('keyPreview');

function maskKey(k) {
  if (!k || k.length < 8) return k;
  return k.slice(0, 6) + '…' + k.slice(-4);
}

async function loadKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (apiKey) {
    keyPreview.innerHTML = `Saved key: <span>${maskKey(apiKey)}</span> <button class="clear-key" id="clearKeyBtn">Remove</button>`;
    document.getElementById('clearKeyBtn').addEventListener('click', clearKey);
  } else {
    keyPreview.textContent = '';
  }
}

async function clearKey() {
  await chrome.storage.local.remove('apiKey');
  apiInput.value = '';
  keyPreview.textContent = '';
  keyStatus.className = 'status info';
  keyStatus.textContent = 'API key removed.';
}

saveKeyBtn.addEventListener('click', async () => {
  const key = apiInput.value.trim();
  if (!key) {
    keyStatus.className = 'status error';
    keyStatus.textContent = 'Please enter an API key.';
    return;
  }
  if (!key.startsWith('gsk_')) {
    keyStatus.className = 'status error';
    keyStatus.textContent = 'Groq API keys start with "gsk_". Please check your key.';
    return;
  }
  await chrome.storage.local.set({ apiKey: key });
  apiInput.value = '';
  keyStatus.className = 'status success';
  keyStatus.textContent = '✓ API key saved. Transcription is now available.';
  loadKey();
});

loadKey();