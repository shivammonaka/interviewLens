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

// DOM
const loadingState   = document.getElementById('loadingState');
const emptyState     = document.getElementById('emptyState');
const mainContent    = document.getElementById('mainContent');
const problemInput   = document.getElementById('problemInput');
const codeInput      = document.getElementById('codeInput');
const copyBtn        = document.getElementById('copyBtn');
const openClaudeBtn  = document.getElementById('openClaudeBtn');
const openChatGptBtn = document.getElementById('openChatGptBtn');
const toast          = document.getElementById('toast');

let transcript = '';

// Toast
let toastTimer;
function showToast(msg, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = 'show' + (isError ? ' error' : '');
  toastTimer = setTimeout(() => { toast.className = ''; }, 2400);
}

// Build full prompt
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

// Copy
copyBtn.addEventListener('click', async () => {
  if (!transcript) { showToast('No transcript loaded.', true); return; }
  const prompt = await buildPrompt();
  try {
    await navigator.clipboard.writeText(prompt);
    const orig = copyBtn.innerHTML;
    copyBtn.innerHTML = '<span>✓</span> Copied!';
    setTimeout(() => { copyBtn.innerHTML = orig; }, 2000);
    showToast('Prompt copied!');
  } catch (_) {
    showToast('Copy failed.', true);
  }
});

// Open Claude
openClaudeBtn.addEventListener('click', async () => {
  const prompt = await buildPrompt();
  try { await navigator.clipboard.writeText(prompt); } catch (_) {}
  window.open('https://claude.ai/new', '_blank');
  showToast('Prompt copied — paste it in Claude!');
});

// Open ChatGPT
openChatGptBtn.addEventListener('click', async () => {
  const prompt = await buildPrompt();
  try { await navigator.clipboard.writeText(prompt); } catch (_) {}
  window.open('https://chat.openai.com/', '_blank');
  showToast('Prompt copied — paste it in ChatGPT!');
});

// Init
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
}

init();