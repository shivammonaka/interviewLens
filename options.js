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
// ── Gemini API key ────────────────────────────────────────────────────────
const geminiInput   = document.getElementById('geminiInput');
const saveGeminiBtn = document.getElementById('saveGeminiBtn');
const geminiStatus  = document.getElementById('geminiStatus');
const geminiPreview = document.getElementById('geminiPreview');

async function loadGeminiKey() {
  const { geminiKey } = await chrome.storage.local.get('geminiKey');
  if (geminiKey) {
    geminiPreview.innerHTML = `Saved key: <span>${maskKey(geminiKey)}</span> <button class="clear-key" id="clearGeminiBtn">Remove</button>`;
    document.getElementById('clearGeminiBtn').addEventListener('click', async () => {
      await chrome.storage.local.remove('geminiKey');
      geminiInput.value = '';
      geminiPreview.textContent = '';
      geminiStatus.className = 'status info';
      geminiStatus.textContent = 'Gemini API key removed.';
    });
  } else {
    geminiPreview.textContent = '';
  }
}

saveGeminiBtn.addEventListener('click', async () => {
  const key = geminiInput.value.trim();
  if (!key) {
    geminiStatus.className = 'status error';
    geminiStatus.textContent = 'Please enter an API key.';
    return;
  }
  if (!key.startsWith('AIza')) {
    geminiStatus.className = 'status error';
    geminiStatus.textContent = 'Gemini API keys start with "AIza". Please check your key.';
    return;
  }
  await chrome.storage.local.set({ geminiKey: key });
  geminiInput.value = '';
  geminiStatus.className = 'status success';
  geminiStatus.textContent = '✓ Gemini API key saved.';
  loadGeminiKey();
});

loadGeminiKey();
const decoratorInput    = document.getElementById('decoratorInput');
const saveDecoratorBtn  = document.getElementById('saveDecoratorBtn');
const resetDecoratorBtn = document.getElementById('resetDecoratorBtn');
const decoratorStatus   = document.getElementById('decoratorStatus');

// Keep in sync with DEFAULT_LLM_TEMPLATE in popup.js
const DEFAULT_DECORATOR =
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

async function loadDecorator() {
  const { llmTemplate } = await chrome.storage.local.get('llmTemplate');
  // Show saved template, or leave blank (placeholder explains the default is used)
  decoratorInput.value = llmTemplate || '';
}

saveDecoratorBtn.addEventListener('click', async () => {
  const val = decoratorInput.value.trim();
  if (val && !val.includes('{{transcript}}')) {
    decoratorStatus.className = 'status error';
    decoratorStatus.textContent = 'Template must include {{transcript}} so the transcription is inserted.';
    return;
  }
  // Save empty string as null so popup knows to use the default
  if (val) {
    await chrome.storage.local.set({ llmTemplate: val });
  } else {
    await chrome.storage.local.remove('llmTemplate');
  }
  decoratorStatus.className = 'status success';
  decoratorStatus.textContent = val ? '✓ Template saved.' : '✓ Cleared — default template will be used.';
  setTimeout(() => { decoratorStatus.className = 'status'; }, 3000);
});

resetDecoratorBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove('llmTemplate');
  decoratorInput.value = '';
  decoratorStatus.className = 'status info';
  decoratorStatus.textContent = 'Reset to default template.';
  setTimeout(() => { decoratorStatus.className = 'status'; }, 3000);
});

loadDecorator();