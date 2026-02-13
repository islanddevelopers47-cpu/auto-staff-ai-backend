(function() {
  'use strict';

  // Find the script tag to get config
  const script = document.currentScript || document.querySelector('script[data-bot-token]');
  if (!script) { console.error('Claw Staffer: Missing script tag'); return; }

  const TOKEN = script.getAttribute('data-bot-token');
  if (!TOKEN) { console.error('Claw Staffer: Missing data-bot-token'); return; }

  const BASE_URL = script.src.replace(/\/widget\.js.*$/, '');
  let sessionId = sessionStorage.getItem('asai_session_' + TOKEN) || null;
  let isOpen = false;
  let isLoading = false;

  // Fetch widget config from server
  let config = {
    primaryColor: '#6C5CE7',
    position: 'bottom-right',
    greeting: 'Hi! How can I help you today?',
    placeholder: 'Type a message...',
    title: 'Chat with us',
  };

  // --- Styles ---
  const styles = document.createElement('style');
  styles.textContent = `
    #asai-widget-btn {
      position: fixed;
      bottom: 20px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s;
    }
    #asai-widget-btn:hover { transform: scale(1.1); }
    #asai-widget-btn svg { width: 28px; height: 28px; fill: #fff; }

    #asai-widget-container {
      position: fixed;
      bottom: 90px;
      width: 380px;
      height: 520px;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      z-index: 99999;
      display: none;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      border: 1px solid #2a2a4a;
    }
    #asai-widget-container.open { display: flex; }

    #asai-widget-header {
      padding: 14px 16px;
      color: #fff;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    #asai-widget-header h3 { margin: 0; font-size: 15px; font-weight: 600; }
    #asai-widget-close {
      background: none; border: none; color: #fff; cursor: pointer;
      font-size: 20px; padding: 0 4px; opacity: 0.7;
    }
    #asai-widget-close:hover { opacity: 1; }

    #asai-widget-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      background: #16213e;
    }
    .asai-msg { margin-bottom: 10px; }
    .asai-msg-sender { font-size: 11px; color: #888; margin-bottom: 2px; }
    .asai-msg-bubble {
      display: inline-block;
      max-width: 85%;
      padding: 8px 12px;
      border-radius: 10px;
      font-size: 14px;
      line-height: 1.4;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .asai-msg.user { text-align: right; }
    .asai-msg.user .asai-msg-bubble { background: var(--asai-primary); color: #fff; }
    .asai-msg.bot .asai-msg-bubble { background: #2a2a4a; color: #e0e0e0; }

    #asai-widget-input-area {
      display: flex;
      padding: 10px 12px;
      background: #1a1a2e;
      border-top: 1px solid #2a2a4a;
      flex-shrink: 0;
    }
    #asai-widget-input {
      flex: 1;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 14px;
      outline: none;
      background: #16213e;
      color: #e0e0e0;
    }
    #asai-widget-input:focus { border-color: var(--asai-primary); }
    #asai-widget-send {
      margin-left: 8px;
      border: none;
      border-radius: 8px;
      padding: 8px 16px;
      color: #fff;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
    }
    #asai-widget-send:disabled { opacity: 0.5; cursor: not-allowed; }

    .asai-typing { color: #888; font-style: italic; font-size: 13px; padding: 4px 0; }

    @media (max-width: 420px) {
      #asai-widget-container {
        width: calc(100vw - 20px);
        height: calc(100vh - 120px);
        bottom: 80px;
        left: 10px !important;
        right: 10px !important;
      }
    }
  `;
  document.head.appendChild(styles);

  // --- Build DOM ---
  // Float button
  const btn = document.createElement('button');
  btn.id = 'asai-widget-btn';
  btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';
  document.body.appendChild(btn);

  // Chat container
  const container = document.createElement('div');
  container.id = 'asai-widget-container';
  container.innerHTML = `
    <div id="asai-widget-header">
      <h3 id="asai-widget-title"></h3>
      <button id="asai-widget-close">&times;</button>
    </div>
    <div id="asai-widget-messages"></div>
    <div id="asai-widget-input-area">
      <input id="asai-widget-input" type="text" autocomplete="off">
      <button id="asai-widget-send">Send</button>
    </div>
  `;
  document.body.appendChild(container);

  const msgBox = container.querySelector('#asai-widget-messages');
  const input = container.querySelector('#asai-widget-input');
  const sendBtn = container.querySelector('#asai-widget-send');

  function applyConfig(cfg) {
    config = { ...config, ...cfg };
    const primary = config.primaryColor || '#6C5CE7';
    document.documentElement.style.setProperty('--asai-primary', primary);
    btn.style.backgroundColor = primary;
    sendBtn.style.backgroundColor = primary;
    container.querySelector('#asai-widget-title').textContent = config.title || 'Chat with us';
    input.placeholder = config.placeholder || 'Type a message...';

    const pos = config.position || 'bottom-right';
    if (pos === 'bottom-left') {
      btn.style.left = '20px'; btn.style.right = 'auto';
      container.style.left = '20px'; container.style.right = 'auto';
    } else {
      btn.style.right = '20px'; btn.style.left = 'auto';
      container.style.right = '20px'; container.style.left = 'auto';
    }
  }

  // Load config from server
  fetch(BASE_URL + '/api/web-bots/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, message: '__ping__', sessionId: '__config__' }),
  }).catch(function() {});

  // Apply defaults immediately
  applyConfig(config);

  // Try to load config from a meta endpoint (non-blocking)
  (async function() {
    try {
      const resp = await fetch(BASE_URL + '/api/web-bots/config?token=' + encodeURIComponent(TOKEN));
      if (resp.ok) {
        const data = await resp.json();
        applyConfig(data.widgetConfig || {});
      }
    } catch(e) {}
  })();

  function addMessage(role, text) {
    const div = document.createElement('div');
    div.className = 'asai-msg ' + (role === 'user' ? 'user' : 'bot');
    div.innerHTML =
      '<div class="asai-msg-sender">' + (role === 'user' ? 'You' : config.title) + '</div>' +
      '<div class="asai-msg-bubble">' + escapeHtml(text) + '</div>';
    msgBox.appendChild(div);
    msgBox.scrollTop = msgBox.scrollHeight;
    return div;
  }

  function escapeHtml(t) {
    return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Toggle
  btn.addEventListener('click', function() {
    isOpen = !isOpen;
    container.classList.toggle('open', isOpen);
    if (isOpen) {
      input.focus();
      if (msgBox.children.length === 0 && config.greeting) {
        addMessage('bot', config.greeting);
      }
    }
  });

  container.querySelector('#asai-widget-close').addEventListener('click', function() {
    isOpen = false;
    container.classList.remove('open');
  });

  // Send message
  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isLoading) return;

    addMessage('user', text);
    input.value = '';
    isLoading = true;
    sendBtn.disabled = true;

    const typingEl = document.createElement('div');
    typingEl.className = 'asai-typing';
    typingEl.textContent = 'Thinking...';
    msgBox.appendChild(typingEl);
    msgBox.scrollTop = msgBox.scrollHeight;

    try {
      const resp = await fetch(BASE_URL + '/api/web-bots/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: TOKEN,
          message: text,
          sessionId: sessionId,
        }),
      });

      const data = await resp.json();

      if (typingEl.parentNode) typingEl.remove();

      if (!resp.ok) {
        addMessage('bot', data.error || 'Something went wrong. Please try again.');
      } else {
        addMessage('bot', data.response);
        if (data.sessionId) {
          sessionId = data.sessionId;
          sessionStorage.setItem('asai_session_' + TOKEN, sessionId);
        }
      }
    } catch(err) {
      if (typingEl.parentNode) typingEl.remove();
      addMessage('bot', 'Connection error. Please try again.');
    }

    isLoading = false;
    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
})();
