const btn       = document.getElementById('allowBtn');
const status    = document.getElementById('status');
const closeHint = document.getElementById('closeHint');

function showSuccess() {
  status.className = 'status success';
  status.textContent = '✓ Microphone access granted!';
  closeHint.textContent = '✓ You can now close this tab and start recording.';
  closeHint.style.display = 'block';
  btn.disabled = true;
  btn.textContent = '✓ Access Granted';
}

function showError(msg) {
  status.className = 'status error';
  status.textContent = msg;
  btn.disabled = false;
  btn.textContent = 'Try Again';
}

// Check if already granted on load
navigator.permissions.query({ name: 'microphone' }).then(p => {
  if (p.state === 'granted') showSuccess();
  p.onchange = () => { if (p.state === 'granted') showSuccess(); };
}).catch(() => {});

btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = 'Waiting...';
  status.className = 'status';
  status.style.display = 'none';

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach(t => t.stop());
    showSuccess();
  } catch(e) {
    console.error('mic error:', e.name, e.message);
    if (e.name === 'NotAllowedError') {
      showError('Permission denied. Click the lock icon in the address bar, set Microphone to Allow, then click Try Again.');
    } else if (e.name === 'NotFoundError') {
      showError('No microphone found. Connect a microphone and try again.');
    } else {
      showError('Error: ' + e.message);
    }
  }
});
