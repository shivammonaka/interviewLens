// review.js — InterviewLens AI Review page
// Loaded as an external script from review.html to comply with MV3 CSP
// (inline <script> tags are blocked in Chrome extension pages).

'use strict';

// ── Default LLM template (mirrors popup.js) ────────────────────────────────
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

// ── DOM refs ───────────────────────────────────────────────────────────────
const loadingState      = document.getElementById('loadingState');
const emptyState        = document.getElementById('emptyState');
const mainContent       = document.getElementById('mainContent');
const transcriptBox     = document.getElementById('transcriptBox');
const transcriptChars   = document.getElementById('transcriptChars');
const problemInput      = document.getElementById('problemInput');
const codeInput         = document.getElementById('codeInput');
const promptBox         = document.getElementById('promptBox');
const promptChars       = document.getElementById('promptChars');
const buildBtn          = document.getElementById('buildBtn');
const copyBtn           = document.getElementById('copyBtn');
const openAiBtn         = document.getElementById('openAiBtn');
const openChatGptBtn    = document.getElementById('openChatGptBtn');
const discardBtn        = document.getElementById('discardBtn');
const clearTranscriptBtn= document.getElementById('clearTranscriptBtn');
const toast             = document.getElementById('toast');

// ── State ─────────────────────────────────────────────────────────────────
let transcript = '';
let builtPrompt = '';

// ── Toast ─────────────────────────────────────────────────────────────────
let toastTimer = null;

function showToast(msg, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = 'show' + (isError ? ' error' : '');
  toastTimer = setTimeout(() => { toast.className = ''; }, 2400);
}

// ── Char count helper ─────────────────────────────────────────────────────
function fmtChars(n) {
  if (n === 0) return '';
  if (n >= 1000) return `~${(n / 1000).toFixed(1)}k chars`;
  return `${n} chars`;
}

// ── Build prompt ──────────────────────────────────────────────────────────
async function buildPrompt() {
  if (!transcript.trim()) {
    showToast('No transcript loaded.', true);
    return;
  }

  // Load custom template from storage (if set)
  let template = DEFAULT_LLM_TEMPLATE;
  try {
    const result = await chrome.storage.local.get('llmTemplate');
    if (result.llmTemplate && result.llmTemplate.trim()) {
      template = result.llmTemplate.trim();
    }
  } catch (_) { /* use default */ }

  const problem = problemInput.value.trim();
  const code    = codeInput.value.trim();

  const problemSection = problem
    ? `\n**Problem Statement:**\n${problem}\n` : '';
  const codeSection = code
    ? `\n**My Code:**\n\`\`\`\n${code}\n\`\`\`\n` : '';

  builtPrompt = template
    .replace(/\{\{transcript\}\}/g, transcript)
    .replace(/\{\{problem\}\}/g, problemSection)
    .replace(/\{\{code\}\}/g, codeSection);

  // Display
  promptBox.textContent = builtPrompt;
  promptBox.className = 'has-content';
  promptChars.textContent = fmtChars(builtPrompt.length);

  // Show action buttons
  copyBtn.style.display      = '';
  openAiBtn.style.display    = '';
  openChatGptBtn.style.display = '';

  showToast('Prompt built — ready to copy!');
}

// ── Copy to clipboard ─────────────────────────────────────────────────────
async function copyPrompt() {
  if (!builtPrompt) return;
  try {
    await navigator.clipboard.writeText(builtPrompt);
    const orig = copyBtn.innerHTML;
    copyBtn.innerHTML = '<span class="icon">✓</span> Copied!';
    setTimeout(() => { copyBtn.innerHTML = orig; }, 2000);
    showToast('Copied to clipboard!');
  } catch (e) {
    showToast('Copy failed — try selecting & copying manually.', true);
  }
}

// ── Open AI links (copies prompt first, then opens tab) ───────────────────
async function openWithCopy(url) {
  if (!builtPrompt) { showToast('Build the prompt first.', true); return; }
  try { await navigator.clipboard.writeText(builtPrompt); } catch (_) {}
  window.open(url, '_blank');
  showToast('Prompt copied — paste it in the new tab!');
}

// ── Discard transcript ────────────────────────────────────────────────────
async function discardTranscript() {
  try {
    await chrome.storage.local.remove('llmTranscript');
  } catch (e) {
    console.warn('[review] discard failed', e);
  }
  transcript = '';
  builtPrompt = '';
  transcriptBox.textContent = '';
  transcriptBox.className = 'empty';
  transcriptChars.textContent = '';
  promptBox.textContent = 'Transcript discarded. Close this tab.';
  promptBox.className = 'empty';
  promptChars.textContent = '';
  copyBtn.style.display      = 'none';
  openAiBtn.style.display    = 'none';
  openChatGptBtn.style.display = 'none';
  showToast('Transcript discarded.');
}

// ── Init — load transcript from storage ───────────────────────────────────
async function init() {
  try {
    const result = await chrome.storage.local.get('llmTranscript');
    transcript = (result.llmTranscript || '').trim();
  } catch (e) {
    console.error('[review] storage read failed', e);
  }

  loadingState.style.display = 'none';

  if (!transcript) {
    emptyState.style.display = '';
    return;
  }

  // Populate
  transcriptBox.textContent = transcript;
  transcriptBox.className = transcript ? '' : 'empty';
  transcriptChars.textContent = fmtChars(transcript.length);

  mainContent.style.display = '';
}

// ── Event listeners ───────────────────────────────────────────────────────
buildBtn.addEventListener('click', buildPrompt);
copyBtn.addEventListener('click', copyPrompt);

openAiBtn.addEventListener('click', () =>
  openWithCopy('https://claude.ai/new'));

openChatGptBtn.addEventListener('click', () =>
  openWithCopy('https://chat.openai.com/'));

discardBtn.addEventListener('click', () => {
  if (confirm('Discard the transcript from storage? Your saved recordings are not affected.')) {
    discardTranscript();
  }
});

clearTranscriptBtn.addEventListener('click', () => {
  if (!transcript) return;
  transcript = '';
  transcriptBox.textContent = 'Transcript cleared from this view.';
  transcriptBox.className = 'empty';
  transcriptChars.textContent = '';
  // Reset prompt area too
  builtPrompt = '';
  promptBox.textContent = 'Click "Build Prompt" to generate your LLM prompt…';
  promptBox.className = 'empty';
  promptChars.textContent = '';
  copyBtn.style.display      = 'none';
  openAiBtn.style.display    = 'none';
  openChatGptBtn.style.display = 'none';
});

// Auto-rebuild prompt preview when optional fields change (debounced)
let rebuildTimer = null;
function scheduleRebuild() {
  if (!builtPrompt) return; // don't auto-build if user hasn't clicked yet
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(buildPrompt, 600);
}
problemInput.addEventListener('input', scheduleRebuild);
codeInput.addEventListener('input', scheduleRebuild);

// ── Boot ──────────────────────────────────────────────────────────────────
init();