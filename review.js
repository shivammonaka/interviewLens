// review.js — InterviewLens AI Review page
'use strict';

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

// ── DOM ───────────────────────────────────────────────────────────────────
const loadingState      = document.getElementById('loadingState');
const emptyState        = document.getElementById('emptyState');
const mainContent       = document.getElementById('mainContent');
const problemInput      = document.getElementById('problemInput');
const codeInput         = document.getElementById('codeInput');
const analyzeBtn        = document.getElementById('analyzeBtn');
const copyBtn           = document.getElementById('copyBtn');
const openClaudeBtn     = document.getElementById('openClaudeBtn');
const openChatGptBtn    = document.getElementById('openChatGptBtn');
const analysisSection   = document.getElementById('analysisSection');
const analysisOutput    = document.getElementById('analysisOutput');
const analysisMeta      = document.getElementById('analysisMeta');
const analysisModelTag  = document.getElementById('analysisModelTag');
const copyAnalysisBtn   = document.getElementById('copyAnalysisBtn');
const modelHint         = document.getElementById('modelHint');
const btnGroq           = document.getElementById('btnGroq');
const btnGemini         = document.getElementById('btnGemini');
const toast             = document.getElementById('toast');

// ── State ─────────────────────────────────────────────────────────────────
let transcript   = '';
let selectedModel = 'groq'; // 'groq' | 'gemini'

const MODEL_META = {
  groq:   { label: 'llama-3.3-70b · free · fast',      tag: 'Groq / Llama 3.3 70B' },
  gemini: { label: 'gemini-2.0-flash · free · capable', tag: 'Gemini 2.0 Flash'      },
};

// ── Toast ─────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = 'show' + (isError ? ' error' : '');
  toastTimer = setTimeout(() => { toast.className = ''; }, 2600);
}

// ── Model toggle ──────────────────────────────────────────────────────────
function selectModel(m) {
  selectedModel = m;
  btnGroq.classList.toggle('active', m === 'groq');
  btnGemini.classList.toggle('active', m === 'gemini');
  modelHint.textContent = MODEL_META[m].label;
}

btnGroq.addEventListener('click',   () => selectModel('groq'));
btnGemini.addEventListener('click', () => selectModel('gemini'));

// ── Build full prompt ─────────────────────────────────────────────────────
async function buildPrompt() {
  let template = DEFAULT_LLM_TEMPLATE;
  try {
    const r = await chrome.storage.local.get('llmTemplate');
    if (r.llmTemplate && r.llmTemplate.trim()) template = r.llmTemplate.trim();
  } catch (_) {}

  const problem = problemInput.value.trim();
  const code    = codeInput.value.trim();

  const problemSection = problem ? `\n**Problem Statement:**\n${problem}\n` : '';
  const codeSection    = code    ? `\n**My Code:**\n\`\`\`\n${code}\n\`\`\`\n` : '';

  return template
    .replace(/\{\{transcript\}\}/g, transcript)
    .replace(/\{\{problem\}\}/g, problemSection)
    .replace(/\{\{code\}\}/g, codeSection);
}

// ── Copy prompt ───────────────────────────────────────────────────────────
copyBtn.addEventListener('click', async () => {
  if (!transcript) { showToast('No transcript loaded.', true); return; }
  const prompt = await buildPrompt();
  try {
    await navigator.clipboard.writeText(prompt);
    const orig = copyBtn.innerHTML;
    copyBtn.innerHTML = '<span>✓</span> Copied!';
    setTimeout(() => { copyBtn.innerHTML = orig; }, 2000);
    showToast('Prompt copied!');
  } catch (_) { showToast('Copy failed.', true); }
});

openClaudeBtn.addEventListener('click', async () => {
  const prompt = await buildPrompt();
  try { await navigator.clipboard.writeText(prompt); } catch (_) {}
  window.open('https://claude.ai/new', '_blank');
  showToast('Prompt copied — paste it in Claude!');
});

openChatGptBtn.addEventListener('click', async () => {
  const prompt = await buildPrompt();
  try { await navigator.clipboard.writeText(prompt); } catch (_) {}
  window.open('https://chat.openai.com/', '_blank');
  showToast('Prompt copied — paste it in ChatGPT!');
});

// ── Copy analysis ─────────────────────────────────────────────────────────
copyAnalysisBtn.addEventListener('click', async () => {
  const text = analysisOutput.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const orig = copyAnalysisBtn.textContent;
    copyAnalysisBtn.textContent = '✓ Copied!';
    setTimeout(() => { copyAnalysisBtn.textContent = orig; }, 2000);
  } catch (_) { showToast('Copy failed.', true); }
});

// ── Analyze — Groq (streaming) ────────────────────────────────────────────
async function* analyzeWithGroq(prompt, apiKey) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq error ${response.status}`);
  }

  yield* streamSSE(response);
}

// ── Analyze — Gemini (streaming) ─────────────────────────────────────────
async function* analyzeWithGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2048 },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini error ${response.status}`);
  }

  yield* streamSSE(response, 'gemini');
}

// ── SSE reader — yields text chunks ──────────────────────────────────────
async function* streamSSE(response, provider = 'groq') {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let   buf     = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split('\n');
    buf = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;

      try {
        const json = JSON.parse(data);
        let chunk = '';
        if (provider === 'gemini') {
          chunk = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
          chunk = json?.choices?.[0]?.delta?.content || '';
        }
        if (chunk) yield chunk;
      } catch (_) {}
    }
  }
}

// ── Main analyze handler ──────────────────────────────────────────────────
analyzeBtn.addEventListener('click', async () => {
  if (!transcript) { showToast('No transcript loaded.', true); return; }

  // Check key
  const storageKeys = selectedModel === 'groq'
    ? ['apiKey']
    : ['geminiKey'];

  const stored = await chrome.storage.local.get(storageKeys);
  const apiKey = selectedModel === 'groq' ? stored.apiKey : stored.geminiKey;

  if (!apiKey) {
    if (selectedModel === 'gemini') {
      showToast('Gemini API key not set — opening Settings…', true);
      setTimeout(() => chrome.runtime.openOptionsPage(), 1200);
    } else {
      showToast('Groq API key not set — opening Settings…', true);
      setTimeout(() => chrome.runtime.openOptionsPage(), 1200);
    }
    return;
  }

  // Build prompt
  const prompt = await buildPrompt();

  // Show output section
  analysisSection.style.display = 'block';
  analysisOutput.textContent = '';
  analysisOutput.className = 'streaming';
  analysisModelTag.textContent = MODEL_META[selectedModel].tag;
  analysisMeta.textContent = '';
  copyAnalysisBtn.style.display = 'none';
  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = '<span>⏳</span> Analyzing…';

  // Add blinking cursor
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  analysisOutput.appendChild(cursor);

  const start = Date.now();
  let fullText = '';

  try {
    const stream = selectedModel === 'groq'
      ? analyzeWithGroq(prompt, apiKey)
      : analyzeWithGemini(prompt, apiKey);

    for await (const chunk of stream) {
      fullText += chunk;
      // Update text before cursor
      analysisOutput.textContent = fullText;
      analysisOutput.appendChild(cursor);
      // Auto-scroll
      analysisOutput.scrollTop = analysisOutput.scrollHeight;
    }

    // Done
    cursor.remove();
    analysisOutput.textContent = fullText;
    analysisOutput.className = '';

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    analysisMeta.textContent = `${MODEL_META[selectedModel].tag} · ${elapsed}s`;
    copyAnalysisBtn.style.display = '';
    showToast('Analysis complete!');

  } catch (e) {
    cursor.remove();
    analysisOutput.textContent = `Error: ${e.message}`;
    analysisOutput.className = '';
    showToast(e.message, true);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = '<span>⚡</span> Analyze with AI';
  }

  // Scroll to analysis
  analysisSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  try {
    const r = await chrome.storage.local.get('llmTranscript');
    transcript = (r.llmTranscript || '').trim();
  } catch (e) {
    console.error('[review] storage error', e);
  }

  loadingState.style.display = 'none';

  if (!transcript) {
    emptyState.style.display = '';
    return;
  }

  mainContent.style.display = '';
  selectModel('groq');
}

init();