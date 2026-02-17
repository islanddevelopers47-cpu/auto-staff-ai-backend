// Claw Staffer — Dashboard UI
// window.BACKEND_URL can be set to the Railway backend origin (e.g. "https://claw-staffer.up.railway.app")
// When set, WebSocket connects directly to the backend; API calls use relative paths (proxied by Netlify).
const BACKEND = window.BACKEND_URL || '';
const API = '/api';
let token = localStorage.getItem('token');
let user = null;
let ws = null;

// --- API helpers ---
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// --- Auth ---
async function login(username, password) {
  const data = await api('/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password })
  });
  token = data.token;
  user = data.user;
  localStorage.setItem('token', token);
  return data;
}

function logout() {
  token = null; user = null;
  localStorage.removeItem('token');
  if (ws) { ws.close(); ws = null; }
  // Sign out of Firebase too
  if (typeof firebase !== 'undefined' && firebase.auth) {
    firebase.auth().signOut().catch(() => {});
  }
  showLogin();
}

// --- WebSocket ---
function connectWs() {
  if (!token) return;
  let wsUrl;
  if (BACKEND) {
    const proto = BACKEND.startsWith('https') ? 'wss' : 'ws';
    const host = BACKEND.replace(/^https?:\/\//, '');
    wsUrl = `${proto}://${host}/ws?token=${token}`;
  } else {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    wsUrl = `${proto}://${location.host}/ws?token=${token}`;
  }
  ws = new WebSocket(wsUrl);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'event') addEvent(msg.event, msg.data);
    } catch {}
  };
  ws.onclose = () => { setTimeout(connectWs, 3000); };
}

function addEvent(event, data) {
  const el = document.getElementById('events');
  if (!el) return;
  const time = new Date().toLocaleTimeString();
  const text = `${time} [${event}] ${JSON.stringify(data).slice(0, 80)}`;
  el.innerHTML = `<div class="event-item">${text}</div>` + el.innerHTML;
  if (el.children.length > 50) el.lastChild.remove();
}

// --- Screens ---
function showLogin() {
  document.getElementById('login-screen').style.display = '';
  document.getElementById('dashboard-screen').style.display = 'none';
}

function showDashboard() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('dashboard-screen').style.display = '';
  const userLabel = user
    ? (user.email || user.displayName || user.username) + ` (${user.role})`
    : '';
  document.getElementById('user-info').textContent = userLabel;
  connectWs();
  loadDashboard();
}

// --- Tabs ---
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
    const tab = document.getElementById(`tab-${btn.dataset.tab}`);
    if (tab) tab.style.display = '';
    if (btn.dataset.tab === 'dashboard') loadDashboard();
    if (btn.dataset.tab === 'bots') loadBots();
    if (btn.dataset.tab === 'agents') loadAgents();
    if (btn.dataset.tab === 'chat') loadChatBots();
    if (btn.dataset.tab === 'agent-chat') loadAgentChatList();
    if (btn.dataset.tab === 'agent-tasks') loadTasks();
    if (btn.dataset.tab === 'integrations') loadIntegrations();
    if (btn.dataset.tab === 'settings') { loadApiKeys(); loadIntegrationConfig(); }
  });
});

// --- Dashboard ---
async function loadDashboard() {
  try {
    const data = await api('/setup/status');
    const grid = document.getElementById('setup-status');
    grid.innerHTML = Object.entries(data.steps).map(([key, step]) => `
      <div class="step-card ${step.done ? 'step-done' : ''}">
        <div class="step-icon">${step.done ? '&#9989;' : '&#11093;'}</div>
        <div class="step-label">${step.label}</div>
      </div>
    `).join('');

    const stats = document.getElementById('quick-stats');
    stats.innerHTML = `
      <div class="stat-card"><div class="value">${data.botCount}</div><div class="label">Bots</div></div>
      <div class="stat-card"><div class="value">${data.runningBotCount}</div><div class="label">Running</div></div>
      <div class="stat-card"><div class="value">${data.agentCount}</div><div class="label">Agents</div></div>
      <div class="stat-card"><div class="value">${data.providers.filter(p => p.configured).length}</div><div class="label">Providers</div></div>
    `;
  } catch (err) { console.error('Dashboard load error:', err); }
}

// --- Bots ---
async function loadBots() {
  try {
    const data = await api('/bots');
    const telegramBots = data.bots.filter(b => b.platform !== 'web');
    const list = document.getElementById('bots-list');
    if (!telegramBots.length) {
      list.innerHTML = '<div class="card"><p>No Telegram bots yet. Click "+ Add Bot" to get started.</p></div>';
    } else {
      list.innerHTML = telegramBots.map(bot => `
        <div class="card">
          <h3>${bot.name} ${bot.telegram_bot_username ? `(@${bot.telegram_bot_username})` : ''}</h3>
          <p>Mode: ${bot.mode} | Agent: ${bot.agent_id || 'default'}</p>
          <div class="meta">
            <span class="status-badge status-${bot.status}">${bot.status}</span>
            <span>Created: ${new Date(bot.created_at).toLocaleDateString()}</span>
          </div>
          <div class="actions">
            ${bot.status === 'running'
              ? `<button class="btn btn-sm" onclick="stopBot('${bot.id}')">Stop</button>`
              : `<button class="btn btn-sm btn-success" onclick="startBot('${bot.id}')">Start</button>`
            }
            <button class="btn btn-sm" onclick="restartBot('${bot.id}')">Restart</button>
            <button class="btn btn-sm btn-danger" onclick="deleteBot('${bot.id}')">Delete</button>
          </div>
        </div>
      `).join('');
    }
  } catch (err) { console.error('Bots load error:', err); }

  // Also load web bots
  loadWebBots();
}

async function startBot(id) { try { await api(`/bots/${id}/start`, { method: 'POST' }); loadBots(); } catch (e) { alert(e.message); } }
async function stopBot(id) { try { await api(`/bots/${id}/stop`, { method: 'POST' }); loadBots(); } catch (e) { alert(e.message); } }
async function restartBot(id) { try { await api(`/bots/${id}/restart`, { method: 'POST' }); loadBots(); } catch (e) { alert(e.message); } }
async function deleteBot(id) {
  if (!confirm('Delete this bot?')) return;
  try { await api(`/bots/${id}`, { method: 'DELETE' }); loadBots(); } catch (e) { alert(e.message); }
}

// --- Web Bots ---
async function loadWebBots() {
  try {
    const data = await api('/web-bots');
    const list = document.getElementById('web-bots-list');
    if (!data.bots.length) {
      list.innerHTML = '<div class="card"><p>No website bots yet. Click "+ Add Web Bot" to create one.</p></div>';
      return;
    }
    list.innerHTML = data.bots.map(bot => `
      <div class="card">
        <h3>${bot.name}</h3>
        <p>Agent: ${bot.agent_id || 'default'} | Origins: ${bot.allowed_origins}</p>
        <div class="meta">
          <span class="status-badge status-${bot.enabled ? 'running' : 'stopped'}">${bot.enabled ? 'Active' : 'Disabled'}</span>
          <span>Created: ${new Date(bot.created_at).toLocaleDateString()}</span>
        </div>
        <div class="actions">
          <button class="btn btn-sm btn-primary" onclick="showEmbedCode('${bot.id}')">Get Embed Code</button>
          <button class="btn btn-sm" onclick="toggleWebBot('${bot.id}', ${bot.enabled ? 'false' : 'true'})">${bot.enabled ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-sm btn-danger" onclick="deleteWebBot('${bot.id}')">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (err) { console.error('Web bots load error:', err); }
}

async function showEmbedCode(botId) {
  try {
    const data = await api(`/web-bots/${botId}/embed`);
    document.getElementById('embed-code-text').value = data.embedCode;
    document.getElementById('embed-code-modal').style.display = '';
  } catch (e) { alert(e.message); }
}

document.getElementById('copy-embed-btn').addEventListener('click', () => {
  const textarea = document.getElementById('embed-code-text');
  textarea.select();
  navigator.clipboard.writeText(textarea.value).then(() => {
    document.getElementById('copy-embed-btn').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('copy-embed-btn').textContent = 'Copy Code'; }, 2000);
  });
});

async function toggleWebBot(botId, enabled) {
  try {
    await api(`/web-bots/${botId}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
    loadWebBots();
  } catch (e) { alert(e.message); }
}

async function deleteWebBot(id) {
  if (!confirm('Delete this web bot?')) return;
  try { await api(`/web-bots/${id}`, { method: 'DELETE' }); loadWebBots(); } catch (e) { alert(e.message); }
}

document.getElementById('add-web-bot-btn').addEventListener('click', async () => {
  try {
    const data = await api('/agents');
    const sel = document.getElementById('web-bot-agent');
    sel.innerHTML = '<option value="">Default Agent</option>' +
      data.agents.map(a => `<option value="${a.id}">${a.name} (${a.model_provider})</option>`).join('');
  } catch {}
  document.getElementById('add-web-bot-modal').style.display = '';
});

document.getElementById('add-web-bot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/web-bots', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('web-bot-name').value,
        agentId: document.getElementById('web-bot-agent').value || undefined,
        allowedOrigins: document.getElementById('web-bot-origins').value || '*',
        widgetConfig: {
          primaryColor: document.getElementById('web-bot-color').value,
          greeting: document.getElementById('web-bot-greeting').value,
          position: document.getElementById('web-bot-position').value,
          title: document.getElementById('web-bot-name').value,
          placeholder: 'Type a message...',
        },
      })
    });
    closeModal('add-web-bot-modal');
    document.getElementById('add-web-bot-form').reset();
    loadWebBots();
  } catch (e) { alert(e.message); }
});

window.showEmbedCode = showEmbedCode;
window.toggleWebBot = toggleWebBot;
window.deleteWebBot = deleteWebBot;

document.getElementById('add-bot-btn').addEventListener('click', async () => {
  // Load agents for dropdown
  try {
    const data = await api('/agents');
    const sel = document.getElementById('bot-agent');
    sel.innerHTML = '<option value="">Default Agent</option>' +
      data.agents.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  } catch {}
  document.getElementById('add-bot-modal').style.display = '';
});

document.getElementById('validate-token-btn').addEventListener('click', async () => {
  const tokenVal = document.getElementById('bot-token').value;
  const status = document.getElementById('token-status');
  try {
    const data = await api('/bots/validate-token', {
      method: 'POST', body: JSON.stringify({ token: tokenVal })
    });
    status.textContent = data.valid ? `Valid: @${data.bot.username}` : 'Invalid';
    status.style.color = data.valid ? 'var(--success)' : 'var(--error)';
  } catch (e) { status.textContent = e.message; status.style.color = 'var(--error)'; }
});

document.getElementById('add-bot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/bots', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('bot-name').value,
        telegramToken: document.getElementById('bot-token').value,
        agentId: document.getElementById('bot-agent').value || undefined,
      })
    });
    closeModal('add-bot-modal');
    document.getElementById('add-bot-form').reset();
    loadBots();
  } catch (e) { alert(e.message); }
});

// --- Agents ---
async function loadAgents() {
  try {
    const data = await api('/agents');
    const list = document.getElementById('agents-list');
    if (!data.agents.length) {
      list.innerHTML = '<div class="card"><p>No agents yet.</p></div>';
      return;
    }
    list.innerHTML = data.agents.map(agent => `
      <div class="card">
        <h3>${agent.name} ${agent.is_builtin ? '<span style="color:var(--text-dim)">[built-in]</span>' : ''}</h3>
        <p>${agent.description || 'No description'}</p>
        <div class="meta">
          <span>${agent.model_provider}/${agent.model_name}</span>
          <span>Temp: ${agent.temperature}</span>
          <span>Skills: ${agent.skills.length || 0}</span>
        </div>
        ${!agent.is_builtin ? `<div class="actions">
          <button class="btn btn-sm btn-danger" onclick="deleteAgent('${agent.id}')">Delete</button>
        </div>` : ''}
      </div>
    `).join('');
  } catch (err) { console.error('Agents load error:', err); }
}

async function deleteAgent(id) {
  if (!confirm('Delete this agent?')) return;
  try { await api(`/agents/${id}`, { method: 'DELETE' }); loadAgents(); } catch (e) { alert(e.message); }
}

// Provider-model mapping
const MODELS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  google: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  grok: ['grok-3', 'grok-3-mini', 'grok-2', 'grok-2-mini']
};

document.getElementById('agent-provider').addEventListener('change', () => {
  const provider = document.getElementById('agent-provider').value;
  const sel = document.getElementById('agent-model');
  sel.innerHTML = (MODELS[provider] || []).map(m => `<option value="${m}">${m}</option>`).join('');
});

// Populate system prompt presets dropdown
function populateSystemPromptPresets() {
  const select = document.getElementById('agent-prompt-preset');
  select.innerHTML = Object.entries(SYSTEM_PROMPT_PRESETS)
    .map(([key, data]) => `<option value="${key}">${data.label}</option>`)
    .join('');
}

// Handle preset selection
document.getElementById('agent-prompt-preset').addEventListener('change', (e) => {
  const preset = SYSTEM_PROMPT_PRESETS[e.target.value];
  if (preset) {
    document.getElementById('agent-prompt').value = preset.prompt;
  }
});

document.getElementById('add-agent-btn').addEventListener('click', () => {
  populateSystemPromptPresets();
  document.getElementById('agent-provider').dispatchEvent(new Event('change'));
  document.getElementById('add-agent-modal').style.display = '';
});

document.getElementById('add-agent-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/agents', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('agent-name').value,
        description: document.getElementById('agent-desc').value || undefined,
        modelProvider: document.getElementById('agent-provider').value,
        modelName: document.getElementById('agent-model').value,
        systemPrompt: document.getElementById('agent-prompt').value || undefined,
        temperature: parseFloat(document.getElementById('agent-temp').value) || 0.7,
      })
    });
    closeModal('add-agent-modal');
    document.getElementById('add-agent-form').reset();
    loadAgents();
  } catch (e) { alert(e.message); }
});

// --- Chat test ---
async function loadChatBots() {
  try {
    const data = await api('/bots');
    const sel = document.getElementById('chat-bot-select');
    sel.innerHTML = data.bots.filter(b => b.status === 'running').map(b =>
      `<option value="${b.id}">${b.name}</option>`
    ).join('');
    if (!sel.innerHTML) sel.innerHTML = '<option value="">No running bots</option>';
  } catch {}
}

document.getElementById('chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  const botId = document.getElementById('chat-bot-select').value;
  if (!botId) { alert('Select a running bot first'); return; }

  addChatMessage('user', text);
  input.value = '';

  // Show typing indicator
  const typingId = addChatMessage('assistant', '⏳ Thinking...');

  try {
    const data = await api(`/bots/${botId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message: text }),
    });
    // Replace typing indicator with actual response
    updateChatMessage(typingId, data.response);
  } catch (err) {
    updateChatMessage(typingId, '❌ ' + (err.message || 'Failed to get response'));
  }
});

let chatMsgCounter = 0;
function addChatMessage(role, text) {
  const box = document.getElementById('chat-messages');
  const msgId = 'chat-msg-' + (++chatMsgCounter);
  box.innerHTML += `<div class="chat-msg ${role}" id="${msgId}">
    <div class="sender">${role === 'user' ? 'You' : 'Bot'}</div>
    <div class="bubble">${escapeHtml(text)}</div>
  </div>`;
  box.scrollTop = box.scrollHeight;
  return msgId;
}

function updateChatMessage(msgId, text) {
  const el = document.getElementById(msgId);
  if (el) {
    el.querySelector('.bubble').innerHTML = escapeHtml(text);
    const box = document.getElementById('chat-messages');
    box.scrollTop = box.scrollHeight;
  }
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Agent Chat ---
let agentChatAgents = [];
let agentChatMsgCounter = 0;

async function loadAgentChatList() {
  try {
    const data = await api('/agents');
    agentChatAgents = data.agents;
    const sel = document.getElementById('agent-chat-select');
    sel.innerHTML = data.agents.map(a =>
      `<option value="${a.id}">${a.name} (${a.model_provider}/${a.model_name})</option>`
    ).join('');
    if (!sel.innerHTML) sel.innerHTML = '<option value="">No agents available</option>';
    updateAgentChatInfo();
  } catch (err) { console.error('Agent chat load error:', err); }
}

document.getElementById('agent-chat-select').addEventListener('change', updateAgentChatInfo);

function updateAgentChatInfo() {
  const sel = document.getElementById('agent-chat-select');
  const info = document.getElementById('agent-chat-info');
  const agent = agentChatAgents.find(a => a.id === sel.value);
  if (agent) {
    info.innerHTML = `
      <span><strong>${agent.name}</strong></span>
      <span class="agent-chat-meta">${agent.model_provider}/${agent.model_name}</span>
      <span class="agent-chat-meta">Temp: ${agent.temperature}</span>
      <span class="agent-chat-meta">Skills: ${agent.skills?.length || 0}</span>
      ${agent.description ? `<span class="agent-chat-meta">${agent.description}</span>` : ''}
    `;
  } else {
    info.innerHTML = '';
  }
}

document.getElementById('agent-chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('agent-chat-input');
  const text = input.value.trim();
  if (!text) return;

  const agentId = document.getElementById('agent-chat-select').value;
  if (!agentId) { alert('Select an agent first'); return; }

  addAgentChatMessage('user', text);
  input.value = '';

  const typingId = addAgentChatMessage('assistant', '⏳ Thinking...');

  try {
    const data = await api(`/agents/${agentId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message: text }),
    });
    const info = data.model ? ` [${data.provider}/${data.model}]` : '';
    updateAgentChatMessage(typingId, data.response, info);
  } catch (err) {
    updateAgentChatMessage(typingId, '❌ ' + (err.message || 'Failed to get response'));
  }
});

document.getElementById('agent-chat-clear').addEventListener('click', () => {
  document.getElementById('agent-chat-messages').innerHTML = '';
  agentChatMsgCounter = 0;
});

function addAgentChatMessage(role, text) {
  const box = document.getElementById('agent-chat-messages');
  const msgId = 'agent-chat-msg-' + (++agentChatMsgCounter);
  box.innerHTML += `<div class="chat-msg ${role}" id="${msgId}">
    <div class="sender">${role === 'user' ? 'You' : 'Agent'}</div>
    <div class="bubble">${escapeHtml(text)}</div>
  </div>`;
  box.scrollTop = box.scrollHeight;
  return msgId;
}

function updateAgentChatMessage(msgId, text, meta) {
  const el = document.getElementById(msgId);
  if (el) {
    const metaHtml = meta ? `<div class="chat-meta">${escapeHtml(meta)}</div>` : '';
    el.querySelector('.bubble').innerHTML = escapeHtml(text) + metaHtml;
    const box = document.getElementById('agent-chat-messages');
    box.scrollTop = box.scrollHeight;
  }
}

// --- Modal ---
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}
window.closeModal = closeModal;
window.startBot = startBot;
window.stopBot = stopBot;
window.restartBot = restartBot;
window.deleteBot = deleteBot;
window.deleteAgent = deleteAgent;

// --- Init ---
async function init() {
  if (token) {
    try {
      const data = await api('/auth/me');
      user = data;
      showDashboard();
    } catch {
      localStorage.removeItem('token');
      token = null;
      showLogin();
    }
  } else {
    showLogin();
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  try {
    errEl.style.display = 'none';
    await login(
      document.getElementById('login-username').value,
      document.getElementById('login-password').value
    );
    showDashboard();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = '';
  }
});

// Enterprise demo buttons - trigger Cal.com booking
document.getElementById('get-enterprise-demo-btn').addEventListener('click', () => {
  if (window.Cal) {
    Cal("openModal", {
      calLink: "clawstaffer/30min",
      config: { layout: "month_view" }
    });
  }
});

document.getElementById('request-enterprise-demo-btn').addEventListener('click', () => {
  if (window.Cal) {
    Cal("openModal", {
      calLink: "clawstaffer/30min",
      config: { layout: "month_view" }
    });
  }
});

document.getElementById('logout-btn').addEventListener('click', logout);

// --- API Keys ---
let storedKeys = [];

async function loadApiKeys() {
  try {
    const data = await api('/api-keys');
    storedKeys = data.keys || [];
    updateApiKeyStatuses();
    renderStoredKeys();
  } catch (err) { console.error('API keys load error:', err); }
}

function updateApiKeyStatuses() {
  const providers = ['openai', 'anthropic', 'google', 'grok'];
  for (const p of providers) {
    const badge = document.getElementById(`${p}-status`);
    if (!badge) continue;
    const hasKey = storedKeys.some(k => k.provider === p);
    if (hasKey) {
      badge.textContent = 'Configured';
      badge.className = 'provider-badge provider-badge--ok';
      // Show delete button, update placeholder
      const form = document.querySelector(`.api-key-form[data-provider="${p}"]`);
      if (form) {
        const input = form.querySelector('.api-key-input');
        const delBtn = form.querySelector('.api-key-delete');
        const key = storedKeys.find(k => k.provider === p);
        if (input) input.placeholder = key ? key.masked_key : 'Key saved';
        if (delBtn) delBtn.style.display = '';
      }
    } else {
      badge.textContent = 'Not configured';
      badge.className = 'provider-badge';
      const form = document.querySelector(`.api-key-form[data-provider="${p}"]`);
      if (form) {
        const delBtn = form.querySelector('.api-key-delete');
        if (delBtn) delBtn.style.display = 'none';
      }
    }
  }
}

function renderStoredKeys() {
  const list = document.getElementById('stored-keys-list');
  if (!list) return;
  if (!storedKeys.length) {
    list.innerHTML = '<div class="card"><p style="color:var(--text-dim)">No API keys stored yet. Add a key above to get started.</p></div>';
    return;
  }
  list.innerHTML = '<div class="card">' + storedKeys.map(k => `
    <div class="stored-key-item">
      <span class="stored-key-provider">${k.provider}</span>
      <span class="stored-key-masked">${k.masked_key}</span>
      <span style="color:var(--text-dim);font-size:0.75rem">${new Date(k.created_at).toLocaleDateString()}</span>
      <button class="btn btn-sm btn-danger" onclick="deleteApiKey('${k.id}')">Remove</button>
    </div>
  `).join('') + '</div>';
}

// Save key forms
document.querySelectorAll('.api-key-form').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const provider = form.dataset.provider;
    const input = form.querySelector('.api-key-input');
    const msg = form.querySelector('.api-key-msg');
    const keyValue = input.value.trim();

    if (!keyValue) {
      msg.textContent = 'Please enter an API key';
      msg.className = 'api-key-msg error';
      return;
    }

    msg.textContent = 'Testing key...';
    msg.className = 'api-key-msg info';

    try {
      // Test the key first
      const testResult = await api('/api-keys/test', {
        method: 'POST',
        body: JSON.stringify({ provider, apiKey: keyValue })
      });

      if (!testResult.valid) {
        msg.textContent = 'Key is invalid: ' + (testResult.error || 'Authentication failed');
        msg.className = 'api-key-msg error';
        return;
      }

      // Save the key
      await api('/api-keys', {
        method: 'POST',
        body: JSON.stringify({ provider, apiKey: keyValue })
      });

      msg.textContent = 'Key saved and verified!';
      msg.className = 'api-key-msg success';
      input.value = '';

      // Refresh
      await loadApiKeys();
      // Clear message after 3s
      setTimeout(() => { msg.textContent = ''; }, 3000);
    } catch (err) {
      msg.textContent = 'Error: ' + err.message;
      msg.className = 'api-key-msg error';
    }
  });
});

// Delete key buttons (in provider cards)
document.querySelectorAll('.api-key-delete').forEach(btn => {
  btn.addEventListener('click', async () => {
    const form = btn.closest('.api-key-form');
    const provider = form.dataset.provider;
    const key = storedKeys.find(k => k.provider === provider);
    if (!key) return;
    if (!confirm(`Remove your ${provider} API key?`)) return;
    try {
      await api(`/api-keys/${key.id}`, { method: 'DELETE' });
      await loadApiKeys();
    } catch (err) { alert(err.message); }
  });
});

// Delete from stored keys list
async function deleteApiKey(id) {
  if (!confirm('Remove this API key?')) return;
  try {
    await api(`/api-keys/${id}`, { method: 'DELETE' });
    await loadApiKeys();
  } catch (err) { alert(err.message); }
}
window.deleteApiKey = deleteApiKey;

// Toggle password visibility
document.querySelectorAll('.toggle-visibility').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = btn.parentElement.querySelector('.api-key-input');
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = 'Hide';
    } else {
      input.type = 'password';
      btn.textContent = 'Show';
    }
  });
});

// --- Firebase Auth ---
async function checkAuthProviders() {
  try {
    const res = await fetch('/api/auth/providers');
    const data = await res.json();
    if (data.firebase) {
      document.getElementById('firebase-auth-section').style.display = '';
    }
  } catch {}
}

// Exchange Firebase ID token for local JWT
async function firebaseTokenExchange(firebaseUser) {
  try {
    const idToken = await firebaseUser.getIdToken();
    const data = await api('/auth/firebase', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
    token = data.token;
    user = data.user;
    localStorage.setItem('token', token);
    showDashboard();
  } catch (err) {
    const errEl = document.getElementById('firebase-error');
    errEl.textContent = err.message || 'Authentication failed';
    errEl.style.display = '';
  }
}

// Helper: Firebase sign-in via popup only (no redirect)
async function firebaseSignIn(provider) {
  const errEl = document.getElementById('firebase-error');
  errEl.style.display = 'none';
  try {
    const result = await firebase.auth().signInWithPopup(provider);
    await firebaseTokenExchange(result.user);
  } catch (err) {
    console.error('Firebase sign-in failed:', err);
    errEl.textContent = err.message || 'Sign-in failed';
    errEl.style.display = '';
  }
}

// Google Sign-In
document.getElementById('google-signin-btn').addEventListener('click', () => {
  firebaseSignIn(new firebase.auth.GoogleAuthProvider());
});

// GitHub Sign-In (direct OAuth popup → Firebase signInWithCredential)
document.getElementById('github-signin-btn').addEventListener('click', () => {
  const w = 500, h = 600;
  const left = (screen.width - w) / 2, top = (screen.height - h) / 2;
  window.open('/api/auth/github/login', 'github_auth', `width=${w},height=${h},left=${left},top=${top}`);
});

// Listen for GitHub OAuth token from popup, then sign into Firebase
window.addEventListener('message', async (event) => {
  if (event.data?.type === 'github_oauth_token' && event.data.accessToken) {
    const errEl = document.getElementById('firebase-error');
    try {
      // Create Firebase credential from the GitHub access token
      const credential = firebase.auth.GithubAuthProvider.credential(event.data.accessToken);
      const result = await firebase.auth().signInWithCredential(credential);
      await firebaseTokenExchange(result.user);
    } catch (err) {
      console.error('Firebase GitHub credential sign-in failed:', err);
      if (errEl) { errEl.textContent = err.message || 'GitHub sign-in failed'; errEl.style.display = ''; }
    }
  }
});

// Email/Password Sign-In
document.getElementById('firebase-email-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('firebase-error');
  errEl.style.display = 'none';
  const email = document.getElementById('fb-email').value.trim();
  const password = document.getElementById('fb-password').value;
  if (!email || !password) return;
  try {
    const result = await firebase.auth().signInWithEmailAndPassword(email, password);
    await firebaseTokenExchange(result.user);
  } catch (err) {
    errEl.textContent = err.message || 'Sign-in failed';
    errEl.style.display = '';
  }
});

// Email/Password Register
document.getElementById('fb-register-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('firebase-error');
  errEl.style.display = 'none';
  const email = document.getElementById('fb-email').value.trim();
  const password = document.getElementById('fb-password').value;
  if (!email || !password) {
    errEl.textContent = 'Email and password are required';
    errEl.style.display = '';
    return;
  }
  if (password.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters';
    errEl.style.display = '';
    return;
  }
  try {
    const result = await firebase.auth().createUserWithEmailAndPassword(email, password);
    await firebaseTokenExchange(result.user);
  } catch (err) {
    errEl.textContent = err.message || 'Registration failed';
    errEl.style.display = '';
  }
});

// Check available providers when login screen loads
checkAuthProviders();

// --- Agent Tasks ---
let _cachedAgents = null;

async function getAgentsList() {
  if (_cachedAgents) return _cachedAgents;
  const data = await api('/agents');
  _cachedAgents = data.agents;
  setTimeout(() => { _cachedAgents = null; }, 30000);
  return data.agents;
}

async function loadTasks() {
  try {
    const status = document.getElementById('task-filter-status').value;
    const url = status ? `/tasks?status=${status}` : '/tasks';
    const data = await api(url);
    const list = document.getElementById('tasks-list');

    if (!data.tasks.length) {
      list.innerHTML = '<div class="card" style="text-align:center;color:var(--text-dim);padding:2rem">No tasks yet. Click "+ New Task" to create one.</div>';
      return;
    }

    list.innerHTML = data.tasks.map(t => {
      const intChips = (t.integrations || []).map(i => `<span class="task-integration-chip">${i}</span>`).join('');
      const agentChips = (t.assignments || []).map(a => `<span class="task-agent-chip">${a.agent_name}</span>`).join('');
      return `<div class="task-card" onclick="openTaskDetail('${t.id}')">
        <div class="task-card-header">
          <span class="task-card-title">${escHtml(t.title)}</span>
          <span class="status-pill status-pill-${t.status}">${t.status}</span>
        </div>
        <div class="task-card-meta">
          <span class="priority-badge priority-${t.priority}">${t.priority}</span>
          <span>${t.assignments?.length || 0} agent${t.assignments?.length !== 1 ? 's' : ''}</span>
          <span>${new Date(t.created_at).toLocaleDateString()}</span>
          ${intChips ? '<span>'+intChips+'</span>' : ''}
        </div>
        ${agentChips ? '<div class="task-agents-chips">' + agentChips + '</div>' : ''}
      </div>`;
    }).join('');
  } catch (err) { console.error('Tasks load error:', err); }
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

document.getElementById('task-filter-status').addEventListener('change', loadTasks);
document.getElementById('task-refresh-btn').addEventListener('click', loadTasks);

// Open New Task modal
document.getElementById('new-task-btn').addEventListener('click', async () => {
  document.getElementById('task-modal-title').textContent = 'New Task';
  document.getElementById('task-submit-btn').textContent = 'Create Task';
  document.getElementById('task-edit-id').value = '';
  document.getElementById('task-title').value = '';
  document.getElementById('task-desc').value = '';
  document.getElementById('task-priority').value = 'medium';
  // Uncheck all integrations
  document.querySelectorAll('#task-integrations-list input').forEach(cb => cb.checked = false);
  // Load agents
  await populateTaskAgents([]);
  document.getElementById('task-modal').style.display = '';
});

async function populateTaskAgents(selectedIds) {
  const agents = await getAgentsList();
  const container = document.getElementById('task-agents-list');
  container.innerHTML = agents.map(a =>
    `<label class="chip-checkbox"><input type="checkbox" value="${a.id}" ${selectedIds.includes(a.id) ? 'checked' : ''}> ${escHtml(a.name)}</label>`
  ).join('');
}

// Submit task form (create or update)
document.getElementById('task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editId = document.getElementById('task-edit-id').value;
  const title = document.getElementById('task-title').value.trim();
  const description = document.getElementById('task-desc').value.trim();
  const priority = document.getElementById('task-priority').value;
  const agentIds = Array.from(document.querySelectorAll('#task-agents-list input:checked')).map(cb => cb.value);
  const integrations = Array.from(document.querySelectorAll('#task-integrations-list input:checked')).map(cb => cb.value);

  if (!title) return;
  if (!agentIds.length) { alert('Please select at least one agent.'); return; }

  try {
    if (editId) {
      await api(`/tasks/${editId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title, description, priority, integrations })
      });
    } else {
      await api('/tasks', {
        method: 'POST',
        body: JSON.stringify({ title, description, priority, agentIds, integrations })
      });
    }
    closeModal('task-modal');
    loadTasks();
  } catch (err) { alert('Failed: ' + err.message); }
});

// Open Task Detail
async function openTaskDetail(taskId) {
  try {
    const t = await api(`/tasks/${taskId}`);
    document.getElementById('task-detail-title').textContent = t.title;
    document.getElementById('task-detail-meta').innerHTML = `
      <span class="status-pill status-pill-${t.status}">${t.status}</span>
      <span class="priority-badge priority-${t.priority}">${t.priority}</span>
      <span>Created: ${new Date(t.created_at).toLocaleString()}</span>
      ${t.started_at ? '<span>Started: ' + new Date(t.started_at).toLocaleString() + '</span>' : ''}
      ${t.completed_at ? '<span>Completed: ' + new Date(t.completed_at).toLocaleString() + '</span>' : ''}
    `;
    document.getElementById('task-detail-desc').textContent = t.description || '';

    const intEl = document.getElementById('task-detail-integrations');
    if (t.integrations?.length) {
      intEl.innerHTML = '<strong style="font-size:0.85rem">Integrations:</strong> ' +
        t.integrations.map(i => `<span class="task-integration-chip">${i}</span>`).join(' ');
    } else {
      intEl.innerHTML = '';
    }

    // Agents
    const agentsEl = document.getElementById('task-detail-agents');
    if (t.assignments?.length) {
      agentsEl.innerHTML = t.assignments.map(a => {
        const stColor = a.status === 'completed' ? '#4ade80' : a.status === 'failed' ? '#f87171' : a.status === 'running' ? '#60a5fa' : '#6b7280';
        return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--border);font-size:0.85rem">
          <span style="width:8px;height:8px;border-radius:50%;background:${stColor};flex-shrink:0"></span>
          <strong style="flex:1">${escHtml(a.agent_name)}</strong>
          <span class="status-pill status-pill-${a.status}" style="font-size:0.65rem">${a.status}</span>
          ${a.status === 'pending' && t.status === 'pending' ? `<button class="btn btn-sm btn-danger" style="padding:1px 6px;font-size:0.7rem" onclick="event.stopPropagation();removeTaskAgent('${t.id}','${a.id}')">✕</button>` : ''}
        </div>
        ${a.output ? '<div style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:0.5rem;margin:0.3rem 0 0.5rem 1.2rem;font-size:0.8rem;white-space:pre-wrap;max-height:200px;overflow-y:auto">' + escHtml(a.output).slice(0, 3000) + '</div>' : ''}`;
      }).join('');
    } else {
      agentsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.85rem">No agents assigned</span>';
    }

    // Result
    const resultEl = document.getElementById('task-detail-result');
    const resultContent = document.getElementById('task-detail-result-content');
    if (t.result) {
      resultContent.textContent = t.result;
      resultEl.style.display = '';
    } else {
      resultEl.style.display = 'none';
    }

    // Action buttons
    const actionsEl = document.getElementById('task-detail-actions');
    let btns = '';
    if (t.status === 'pending') {
      btns += `<button class="btn btn-primary btn-sm" onclick="runTask('${t.id}')">▶ Run Task</button>`;
      btns += `<button class="btn btn-sm" onclick="editTask('${t.id}')">Edit</button>`;
      btns += `<button class="btn btn-sm btn-danger" onclick="deleteTask('${t.id}')">Delete</button>`;
    } else if (t.status === 'running') {
      btns += `<button class="btn btn-sm" onclick="cancelTask('${t.id}')">Cancel</button>`;
    } else {
      btns += `<button class="btn btn-sm btn-danger" onclick="deleteTask('${t.id}')">Delete</button>`;
    }
    actionsEl.innerHTML = btns;

    document.getElementById('task-detail-modal').style.display = '';
  } catch (err) { alert('Error loading task: ' + err.message); }
}
window.openTaskDetail = openTaskDetail;

async function runTask(taskId) {
  if (!confirm('Run this task? All assigned agents will execute sequentially.')) return;
  closeModal('task-detail-modal');
  try {
    const runBtn = document.querySelector(`[onclick="runTask('${taskId}')"]`);
    if (runBtn) { runBtn.textContent = 'Running...'; runBtn.disabled = true; }
    await api(`/tasks/${taskId}/run`, { method: 'POST' });
    loadTasks();
    openTaskDetail(taskId);
  } catch (err) { alert('Run failed: ' + err.message); loadTasks(); }
}
window.runTask = runTask;

async function editTask(taskId) {
  closeModal('task-detail-modal');
  try {
    const t = await api(`/tasks/${taskId}`);
    document.getElementById('task-modal-title').textContent = 'Edit Task';
    document.getElementById('task-submit-btn').textContent = 'Save Changes';
    document.getElementById('task-edit-id').value = t.id;
    document.getElementById('task-title').value = t.title;
    document.getElementById('task-desc').value = t.description || '';
    document.getElementById('task-priority').value = t.priority;

    // Set integrations
    document.querySelectorAll('#task-integrations-list input').forEach(cb => {
      cb.checked = (t.integrations || []).includes(cb.value);
    });

    // Populate agents
    const assignedIds = (t.assignments || []).map(a => a.agent_id);
    await populateTaskAgents(assignedIds);

    document.getElementById('task-modal').style.display = '';
  } catch (err) { alert('Error: ' + err.message); }
}
window.editTask = editTask;

async function deleteTask(taskId) {
  if (!confirm('Delete this task? This cannot be undone.')) return;
  try {
    await api(`/tasks/${taskId}`, { method: 'DELETE' });
    closeModal('task-detail-modal');
    loadTasks();
  } catch (err) { alert('Delete failed: ' + err.message); }
}
window.deleteTask = deleteTask;

async function cancelTask(taskId) {
  try {
    await api(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
    closeModal('task-detail-modal');
    loadTasks();
  } catch (err) { alert('Cancel failed: ' + err.message); }
}
window.cancelTask = cancelTask;

async function removeTaskAgent(taskId, assignmentId) {
  try {
    await api(`/tasks/${taskId}/agents/${assignmentId}`, { method: 'DELETE' });
    openTaskDetail(taskId);
  } catch (err) { alert('Remove failed: ' + err.message); }
}
window.removeTaskAgent = removeTaskAgent;

// --- Integrations ---
let _ghCurrentRepo = null;
let _ghCurrentPath = '';
let _ghCurrentFile = null; // { path, sha, content }
let _gdCurrentFile = null; // { id, name, content }
let _gdFolderStack = []; // [{ id, name }]

async function loadIntegrations() {
  try {
    const data = await api('/integrations');
    const ghAccount = data.accounts.find(a => a.provider === 'github');
    const gdAccount = data.accounts.find(a => a.provider === 'google_drive');

    // GitHub card
    if (data.providers.github) {
      document.getElementById('github-connect-btn').style.display = ghAccount ? 'none' : '';
      document.getElementById('github-disconnect-btn').style.display = ghAccount ? '' : 'none';
      document.getElementById('github-browser').style.display = ghAccount ? '' : 'none';
      document.getElementById('github-account-info').textContent = ghAccount
        ? `Connected as ${ghAccount.account_name}${ghAccount.account_email ? ' (' + ghAccount.account_email + ')' : ''}`
        : 'Not connected';
      if (ghAccount) loadGitHubRepos();
    } else {
      document.getElementById('github-connect-btn').textContent = 'Not configured';
      document.getElementById('github-connect-btn').disabled = true;
    }

    // Google Drive card
    if (data.providers.google_drive) {
      document.getElementById('gdrive-connect-btn').style.display = gdAccount ? 'none' : '';
      document.getElementById('gdrive-disconnect-btn').style.display = gdAccount ? '' : 'none';
      document.getElementById('gdrive-browser').style.display = gdAccount ? '' : 'none';
      document.getElementById('gdrive-account-info').textContent = gdAccount
        ? `Connected as ${gdAccount.account_name || gdAccount.account_email || 'Google Account'}`
        : 'Not connected';
      if (gdAccount) loadDriveFiles();
    } else {
      document.getElementById('gdrive-connect-btn').textContent = 'Not configured';
      document.getElementById('gdrive-connect-btn').disabled = true;
    }

    // Vercel card
    const vcAccount = data.accounts.find(a => a.provider === 'vercel');
    if (data.providers.vercel) {
      document.getElementById('vercel-connect-btn').style.display = vcAccount ? 'none' : '';
      document.getElementById('vercel-disconnect-btn').style.display = vcAccount ? '' : 'none';
      document.getElementById('vercel-browser').style.display = vcAccount ? '' : 'none';
      document.getElementById('vercel-account-info').textContent = vcAccount
        ? `Connected as @${vcAccount.account_name || vcAccount.account_email || 'Vercel User'}`
        : 'Not connected';
      if (vcAccount) loadVercelProjects();
    } else {
      document.getElementById('vercel-connect-btn').textContent = 'Not configured';
      document.getElementById('vercel-connect-btn').disabled = true;
    }

    // Netlify card
    const ntAccount = data.accounts.find(a => a.provider === 'netlify');
    if (data.providers.netlify) {
      document.getElementById('netlify-connect-btn').style.display = ntAccount ? 'none' : '';
      document.getElementById('netlify-disconnect-btn').style.display = ntAccount ? '' : 'none';
      document.getElementById('netlify-browser').style.display = ntAccount ? '' : 'none';
      document.getElementById('netlify-account-info').textContent = ntAccount
        ? `Connected as ${ntAccount.account_name || ntAccount.account_email || 'Netlify User'}`
        : 'Not connected';
      if (ntAccount) loadNetlifySites();
    } else {
      document.getElementById('netlify-connect-btn').textContent = 'Not configured';
      document.getElementById('netlify-connect-btn').disabled = true;
    }

    // Docker card
    if (data.providers.docker) {
      document.getElementById('docker-status-info').textContent = 'Configured — click Test Connection';
    } else {
      document.getElementById('docker-status-info').textContent = 'Not configured — set Docker Host in Settings';
    }
  } catch (err) { console.error('Integrations load error:', err); }
}

// --- GitHub Connect/Disconnect ---
document.getElementById('github-connect-btn').addEventListener('click', async () => {
  try {
    const data = await api('/integrations/github/connect');
    const popup = window.open(data.url, 'github-oauth', 'width=600,height=700');
    window.addEventListener('message', function handler(e) {
      if (e.data?.type === 'integration_connected' && e.data.provider === 'github') {
        window.removeEventListener('message', handler);
        loadIntegrations();
      }
    });
  } catch (e) { alert(e.message); }
});

document.getElementById('github-disconnect-btn').addEventListener('click', async () => {
  if (!confirm('Disconnect GitHub? Agents will no longer be able to access your repos.')) return;
  try { await api('/integrations/github', { method: 'DELETE' }); loadIntegrations(); } catch (e) { alert(e.message); }
});

// --- GitHub File Browser ---
async function loadGitHubRepos() {
  try {
    const data = await api('/integrations/github/repos');
    const sel = document.getElementById('github-repo-select');
    sel.innerHTML = '<option value="">Select a repository...</option>' +
      data.repos.map(r => `<option value="${r.full_name}">${r.full_name}${r.private ? ' 🔒' : ''}</option>`).join('');
  } catch (err) { console.error('GitHub repos error:', err); }
}

document.getElementById('github-repo-select').addEventListener('change', () => {
  const val = document.getElementById('github-repo-select').value;
  if (!val) return;
  _ghCurrentRepo = val;
  _ghCurrentPath = '';
  document.getElementById('github-file-viewer').style.display = 'none';
  loadGitHubFiles();
});

document.getElementById('github-refresh-btn').addEventListener('click', () => { if (_ghCurrentRepo) loadGitHubFiles(); });

async function loadGitHubFiles() {
  if (!_ghCurrentRepo) return;
  const [owner, repo] = _ghCurrentRepo.split('/');
  try {
    const data = await api(`/integrations/github/repos/${owner}/${repo}/files?path=${encodeURIComponent(_ghCurrentPath)}`);
    const pathBar = document.getElementById('github-path-bar');
    const parts = _ghCurrentPath ? _ghCurrentPath.split('/') : [];
    pathBar.innerHTML = `<span style="cursor:pointer;text-decoration:underline" onclick="ghNavigate('')">root</span>` +
      parts.map((p, i) => {
        const full = parts.slice(0, i + 1).join('/');
        return ` / <span style="cursor:pointer;text-decoration:underline" onclick="ghNavigate('${full}')">${p}</span>`;
      }).join('');

    const list = document.getElementById('github-files-list');
    if (!data.files.length) {
      list.innerHTML = '<div style="padding:1rem;color:var(--text-dim);text-align:center">Empty directory</div>';
      return;
    }
    // Sort: folders first
    const sorted = data.files.sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1));
    list.innerHTML = (_ghCurrentPath ? `<div class="file-item folder" onclick="ghNavigate('${_ghCurrentPath.split('/').slice(0, -1).join('/')}')"><span class="file-icon">⬆</span><span class="file-name">..</span></div>` : '') +
      sorted.map(f => `<div class="file-item ${f.type === 'dir' ? 'folder' : ''}" onclick="${f.type === 'dir' ? `ghNavigate('${f.path}')` : `ghOpenFile('${f.path}')`}">
        <span class="file-icon">${f.type === 'dir' ? '📁' : '📄'}</span>
        <span class="file-name">${f.name}</span>
        ${f.size ? `<span class="file-size">${formatBytes(f.size)}</span>` : ''}
      </div>`).join('');
  } catch (err) { console.error('GitHub files error:', err); }
}

function ghNavigate(path) { _ghCurrentPath = path; document.getElementById('github-file-viewer').style.display = 'none'; loadGitHubFiles(); }
window.ghNavigate = ghNavigate;

async function ghOpenFile(path) {
  if (!_ghCurrentRepo) return;
  const [owner, repo] = _ghCurrentRepo.split('/');
  try {
    const data = await api(`/integrations/github/repos/${owner}/${repo}/file?path=${encodeURIComponent(path)}`);
    _ghCurrentFile = { path, sha: data.sha, content: data.content };
    document.getElementById('github-file-name').textContent = path;
    document.getElementById('github-file-content').value = data.content;
    document.getElementById('github-file-viewer').style.display = '';
  } catch (err) { alert('Failed to read file: ' + err.message); }
}
window.ghOpenFile = ghOpenFile;

document.getElementById('github-close-file').addEventListener('click', () => {
  document.getElementById('github-file-viewer').style.display = 'none';
  _ghCurrentFile = null;
});

document.getElementById('github-save-file').addEventListener('click', async () => {
  if (!_ghCurrentFile || !_ghCurrentRepo) return;
  const [owner, repo] = _ghCurrentRepo.split('/');
  const content = document.getElementById('github-file-content').value;
  try {
    const result = await api(`/integrations/github/repos/${owner}/${repo}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path: _ghCurrentFile.path, content, sha: _ghCurrentFile.sha, message: `Update ${_ghCurrentFile.path}` })
    });
    _ghCurrentFile.sha = result.sha;
    alert('File saved!');
  } catch (err) { alert('Save failed: ' + err.message); }
});

document.getElementById('github-delete-file').addEventListener('click', async () => {
  if (!_ghCurrentFile || !_ghCurrentRepo) return;
  if (!confirm(`Delete ${_ghCurrentFile.path}?`)) return;
  const [owner, repo] = _ghCurrentRepo.split('/');
  try {
    await api(`/integrations/github/repos/${owner}/${repo}/file`, {
      method: 'DELETE',
      body: JSON.stringify({ path: _ghCurrentFile.path, sha: _ghCurrentFile.sha, message: `Delete ${_ghCurrentFile.path}` })
    });
    document.getElementById('github-file-viewer').style.display = 'none';
    _ghCurrentFile = null;
    loadGitHubFiles();
  } catch (err) { alert('Delete failed: ' + err.message); }
});

// --- Google Drive Connect/Disconnect ---
document.getElementById('gdrive-connect-btn').addEventListener('click', async () => {
  try {
    const data = await api('/integrations/google-drive/connect');
    const popup = window.open(data.url, 'gdrive-oauth', 'width=600,height=700');
    window.addEventListener('message', function handler(e) {
      if (e.data?.type === 'integration_connected' && e.data.provider === 'google_drive') {
        window.removeEventListener('message', handler);
        loadIntegrations();
      }
    });
  } catch (e) { alert(e.message); }
});

document.getElementById('gdrive-disconnect-btn').addEventListener('click', async () => {
  if (!confirm('Disconnect Google Drive?')) return;
  try { await api('/integrations/google_drive', { method: 'DELETE' }); loadIntegrations(); } catch (e) { alert(e.message); }
});

// --- Google Drive File Browser ---
async function loadDriveFiles(folderId) {
  try {
    let url = '/integrations/google-drive/files';
    if (folderId) url += `?folderId=${folderId}`;
    const data = await api(url);
    const list = document.getElementById('gdrive-files-list');

    // Update path bar
    const pathBar = document.getElementById('gdrive-folder-path');
    pathBar.innerHTML = `<span style="cursor:pointer;text-decoration:underline" onclick="gdNavigate(null)">My Drive</span>` +
      _gdFolderStack.map((f, i) => ` / <span style="cursor:pointer;text-decoration:underline" onclick="gdNavigateToIndex(${i})">${f.name}</span>`).join('');

    if (!data.files.length) {
      list.innerHTML = '<div style="padding:1rem;color:var(--text-dim);text-align:center">No files</div>';
      return;
    }
    // Sort: folders first
    const folders = data.files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
    const files = data.files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
    list.innerHTML =
      (_gdFolderStack.length ? `<div class="file-item folder" onclick="gdNavigateUp()"><span class="file-icon">⬆</span><span class="file-name">..</span></div>` : '') +
      folders.map(f => `<div class="file-item folder" onclick="gdNavigateInto('${f.id}','${f.name.replace(/'/g, "\\'")}')">
        <span class="file-icon">📁</span><span class="file-name">${f.name}</span>
      </div>`).join('') +
      files.map(f => `<div class="file-item" onclick="gdOpenFile('${f.id}','${f.name.replace(/'/g, "\\'")}')">
        <span class="file-icon">📄</span><span class="file-name">${f.name}</span>
        ${f.size ? `<span class="file-size">${formatBytes(parseInt(f.size))}</span>` : ''}
      </div>`).join('');
  } catch (err) { console.error('Drive files error:', err); }
}

function gdNavigate(folderId) { _gdFolderStack = []; loadDriveFiles(folderId); }
function gdNavigateInto(id, name) { _gdFolderStack.push({ id, name }); loadDriveFiles(id); }
function gdNavigateUp() { _gdFolderStack.pop(); const last = _gdFolderStack[_gdFolderStack.length - 1]; loadDriveFiles(last?.id); }
function gdNavigateToIndex(idx) { _gdFolderStack = _gdFolderStack.slice(0, idx + 1); loadDriveFiles(_gdFolderStack[idx].id); }
window.gdNavigate = gdNavigate;
window.gdNavigateInto = gdNavigateInto;
window.gdNavigateUp = gdNavigateUp;
window.gdNavigateToIndex = gdNavigateToIndex;

document.getElementById('gdrive-refresh-btn').addEventListener('click', () => {
  const last = _gdFolderStack[_gdFolderStack.length - 1];
  loadDriveFiles(last?.id);
});

async function gdOpenFile(id, name) {
  try {
    const data = await api(`/integrations/google-drive/files/${id}`);
    _gdCurrentFile = { id, name, content: data.content };
    document.getElementById('gdrive-file-name').textContent = name;
    document.getElementById('gdrive-file-content').value = data.content;
    document.getElementById('gdrive-file-viewer').style.display = '';
  } catch (err) { alert('Failed to read file: ' + err.message); }
}
window.gdOpenFile = gdOpenFile;

document.getElementById('gdrive-close-file').addEventListener('click', () => {
  document.getElementById('gdrive-file-viewer').style.display = 'none';
  _gdCurrentFile = null;
});

document.getElementById('gdrive-save-file').addEventListener('click', async () => {
  if (!_gdCurrentFile) return;
  try {
    await api(`/integrations/google-drive/files/${_gdCurrentFile.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: document.getElementById('gdrive-file-content').value })
    });
    alert('File saved!');
  } catch (err) { alert('Save failed: ' + err.message); }
});

document.getElementById('gdrive-delete-file').addEventListener('click', async () => {
  if (!_gdCurrentFile) return;
  if (!confirm(`Delete ${_gdCurrentFile.name}?`)) return;
  try {
    await api(`/integrations/google-drive/files/${_gdCurrentFile.id}`, { method: 'DELETE' });
    document.getElementById('gdrive-file-viewer').style.display = 'none';
    _gdCurrentFile = null;
    const last = _gdFolderStack[_gdFolderStack.length - 1];
    loadDriveFiles(last?.id);
  } catch (err) { alert('Delete failed: ' + err.message); }
});

// New Drive file
document.getElementById('gdrive-new-file-btn').addEventListener('click', () => {
  document.getElementById('gdrive-new-file-modal').style.display = '';
});

document.getElementById('gdrive-new-file-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const name = document.getElementById('gdrive-new-filename').value.trim();
    const content = document.getElementById('gdrive-new-content').value;
    const folderId = _gdFolderStack.length ? _gdFolderStack[_gdFolderStack.length - 1].id : undefined;
    await api('/integrations/google-drive/files', {
      method: 'POST',
      body: JSON.stringify({ name, content, folderId })
    });
    closeModal('gdrive-new-file-modal');
    document.getElementById('gdrive-new-file-form').reset();
    loadDriveFiles(folderId);
  } catch (err) { alert('Create failed: ' + err.message); }
});

// --- Vercel Connect/Disconnect ---
document.getElementById('vercel-connect-btn').addEventListener('click', async () => {
  try {
    const data = await api('/integrations/vercel/connect');
    window.open(data.url, 'vercel-oauth', 'width=600,height=700');
    window.addEventListener('message', function handler(e) {
      if (e.data?.type === 'integration_connected' && e.data.provider === 'vercel') {
        window.removeEventListener('message', handler);
        loadIntegrations();
      }
    });
  } catch (e) { alert(e.message); }
});

document.getElementById('vercel-disconnect-btn').addEventListener('click', async () => {
  if (!confirm('Disconnect Vercel?')) return;
  try { await api('/integrations/vercel', { method: 'DELETE' }); loadIntegrations(); } catch (e) { alert(e.message); }
});

// Vercel project/deploy browser
async function loadVercelProjects() {
  try {
    const data = await api('/integrations/vercel/projects');
    const list = document.getElementById('vercel-projects-list');
    document.getElementById('vercel-deploys-list').style.display = 'none';
    list.style.display = '';
    if (!data.projects.length) { list.innerHTML = '<div style="padding:1rem;color:var(--text-dim);text-align:center">No projects</div>'; return; }
    list.innerHTML = data.projects.map(p => `<div class="file-item" onclick="vcShowDeploys('${p.id}','${p.name.replace(/'/g,"\\'")}')">
      <span class="file-icon">▲</span>
      <span class="file-name">${p.name}</span>
      <span class="file-size">${p.framework || 'static'}</span>
    </div>`).join('');
  } catch (err) { console.error('Vercel projects error:', err); }
}

async function vcShowDeploys(projectId, projectName) {
  try {
    document.getElementById('vercel-projects-list').style.display = 'none';
    document.getElementById('vercel-deploys-list').style.display = '';
    document.getElementById('vercel-deploys-title').textContent = `Deployments for ${projectName}`;
    const data = await api(`/integrations/vercel/deployments?projectId=${projectId}`);
    const el = document.getElementById('vercel-deploys-items');
    if (!data.deployments.length) { el.innerHTML = '<div style="padding:0.5rem;color:var(--text-dim)">No deployments yet</div>'; return; }
    el.innerHTML = data.deployments.map(d => `<div class="file-item">
      <span class="file-icon">${d.readyState === 'READY' || d.state === 'READY' ? '✅' : d.state === 'ERROR' ? '❌' : '⏳'}</span>
      <span class="file-name"><a href="https://${d.url}" target="_blank" style="color:var(--accent)">${d.url}</a></span>
      <span class="file-size">${d.state || d.readyState}</span>
    </div>`).join('');
  } catch (err) { console.error('Vercel deploys error:', err); }
}
window.vcShowDeploys = vcShowDeploys;

document.getElementById('vercel-back-projects').addEventListener('click', loadVercelProjects);
document.getElementById('vercel-refresh-btn').addEventListener('click', loadVercelProjects);

// --- Netlify Connect/Disconnect ---
document.getElementById('netlify-connect-btn').addEventListener('click', async () => {
  try {
    const data = await api('/integrations/netlify/connect');
    window.open(data.url, 'netlify-oauth', 'width=600,height=700');
    window.addEventListener('message', function handler(e) {
      if (e.data?.type === 'integration_connected' && e.data.provider === 'netlify') {
        window.removeEventListener('message', handler);
        loadIntegrations();
      }
    });
  } catch (e) { alert(e.message); }
});

document.getElementById('netlify-disconnect-btn').addEventListener('click', async () => {
  if (!confirm('Disconnect Netlify?')) return;
  try { await api('/integrations/netlify', { method: 'DELETE' }); loadIntegrations(); } catch (e) { alert(e.message); }
});

// Netlify site/deploy browser
async function loadNetlifySites() {
  try {
    const data = await api('/integrations/netlify/sites');
    const list = document.getElementById('netlify-sites-list');
    document.getElementById('netlify-deploys-list').style.display = 'none';
    list.style.display = '';
    if (!data.sites.length) { list.innerHTML = '<div style="padding:1rem;color:var(--text-dim);text-align:center">No sites</div>'; return; }
    list.innerHTML = data.sites.map(s => `<div class="file-item" onclick="ntShowDeploys('${s.id}','${s.name.replace(/'/g,"\\'")}')">
      <span class="file-icon">◆</span>
      <span class="file-name">${s.name}</span>
      <span class="file-size"><a href="${s.ssl_url || s.url}" target="_blank" style="color:var(--accent)" onclick="event.stopPropagation()">${(s.ssl_url || s.url).replace('https://','')}</a></span>
    </div>`).join('');
  } catch (err) { console.error('Netlify sites error:', err); }
}

async function ntShowDeploys(siteId, siteName) {
  try {
    document.getElementById('netlify-sites-list').style.display = 'none';
    document.getElementById('netlify-deploys-list').style.display = '';
    document.getElementById('netlify-deploys-title').textContent = `Deploys for ${siteName}`;
    const data = await api(`/integrations/netlify/sites/${siteId}/deploys`);
    const el = document.getElementById('netlify-deploys-items');
    if (!data.deploys.length) { el.innerHTML = '<div style="padding:0.5rem;color:var(--text-dim)">No deploys yet</div>'; return; }
    el.innerHTML = data.deploys.map(d => `<div class="file-item">
      <span class="file-icon">${d.state === 'ready' ? '✅' : d.state === 'error' ? '❌' : '⏳'}</span>
      <span class="file-name"><a href="${d.ssl_url || d.url}" target="_blank" style="color:var(--accent)">${(d.ssl_url || d.url || '').replace('https://','')}</a></span>
      <span class="file-size">${d.state} ${d.title ? '— ' + d.title : ''}</span>
    </div>`).join('');
  } catch (err) { console.error('Netlify deploys error:', err); }
}
window.ntShowDeploys = ntShowDeploys;

document.getElementById('netlify-back-sites').addEventListener('click', loadNetlifySites);
document.getElementById('netlify-refresh-btn').addEventListener('click', loadNetlifySites);

// --- Docker ---
document.getElementById('docker-ping-btn').addEventListener('click', async () => {
  const info = document.getElementById('docker-status-info');
  info.textContent = 'Testing...';
  try {
    const data = await api('/integrations/docker/ping');
    if (data.connected) {
      info.textContent = `Connected to ${data.host}`;
      info.style.color = '#4ade80';
      document.getElementById('docker-browser').style.display = '';
      loadDockerContainers();
    } else {
      info.textContent = `Not reachable (${data.host})`;
      info.style.color = '#f87171';
    }
  } catch (err) { info.textContent = 'Error: ' + err.message; info.style.color = '#f87171'; }
});

async function loadDockerContainers() {
  try {
    const data = await api('/integrations/docker/containers');
    const list = document.getElementById('docker-containers-list');
    if (!data.containers.length) { list.innerHTML = '<div style="padding:1rem;color:var(--text-dim);text-align:center">No containers</div>'; return; }
    list.innerHTML = data.containers.map(c => {
      const name = (c.Names?.[0] || c.Id.slice(0,12)).replace(/^\//, '');
      const stateColor = c.State === 'running' ? '#4ade80' : c.State === 'exited' ? '#f87171' : '#fbbf24';
      return `<div class="file-item" style="display:flex;align-items:center;gap:0.5rem">
        <span style="width:8px;height:8px;border-radius:50%;background:${stateColor};flex-shrink:0"></span>
        <span class="file-name" style="flex:1">${name} <span style="color:var(--text-dim);font-size:0.75rem">(${c.Image})</span></span>
        <span class="file-size">${c.Status}</span>
        <button class="btn btn-sm" onclick="dockerAction('${c.Id}','start')" style="padding:2px 6px;font-size:0.7rem" title="Start">▶</button>
        <button class="btn btn-sm" onclick="dockerAction('${c.Id}','stop')" style="padding:2px 6px;font-size:0.7rem" title="Stop">⏹</button>
        <button class="btn btn-sm" onclick="dockerAction('${c.Id}','restart')" style="padding:2px 6px;font-size:0.7rem" title="Restart">🔄</button>
      </div>`;
    }).join('');
  } catch (err) { console.error('Docker containers error:', err); }
}

async function dockerAction(containerId, action) {
  try {
    await api(`/integrations/docker/containers/${containerId}/${action}`, { method: 'POST' });
    setTimeout(loadDockerContainers, 1000);
  } catch (err) { alert(`Docker ${action} failed: ${err.message}`); }
}
window.dockerAction = dockerAction;

document.getElementById('docker-refresh-btn').addEventListener('click', loadDockerContainers);

// --- Integration OAuth Config (Settings tab) ---
async function loadIntegrationConfig() {
  try {
    // Show callback URLs
    const base = window.location.origin;
    const ghCb = document.getElementById('gh-callback-url');
    const gdCb = document.getElementById('gd-callback-url');
    const vcCb = document.getElementById('vc-callback-url');
    const ntCb = document.getElementById('nt-callback-url');
    if (ghCb) ghCb.textContent = `${base}/api/auth/github/callback`;
    if (gdCb) gdCb.textContent = `${base}/api/integrations/google-drive/callback`;
    if (vcCb) vcCb.textContent = `${base}/api/integrations/vercel/callback`;
    if (ntCb) ntCb.textContent = `${base}/api/integrations/netlify/callback`;

    const data = await api('/integrations/config');
    document.getElementById('int-gh-client-id').value = data.github_client_id || '';
    document.getElementById('int-gh-client-secret').value = '';
    document.getElementById('int-gh-client-secret').placeholder = data.github_client_secret || 'GitHub client secret';
    document.getElementById('int-gd-client-id').value = data.google_drive_client_id || '';
    document.getElementById('int-gd-client-secret').value = '';
    document.getElementById('int-gd-client-secret').placeholder = data.google_drive_client_secret || 'Google Drive client secret';
    document.getElementById('int-vc-client-id').value = data.vercel_client_id || '';
    document.getElementById('int-vc-client-secret').value = '';
    document.getElementById('int-vc-client-secret').placeholder = data.vercel_client_secret || 'Vercel client secret';
    document.getElementById('int-nt-client-id').value = data.netlify_client_id || '';
    document.getElementById('int-nt-client-secret').value = '';
    document.getElementById('int-nt-client-secret').placeholder = data.netlify_client_secret || 'Netlify client secret';
    document.getElementById('int-docker-host').value = data.docker_host || '';
  } catch {
    // Non-admin users won't have access - hide the section
    const section = document.getElementById('integration-config-section');
    if (section) section.style.display = 'none';
  }
}

function saveConfigHandler(fields, msgId) {
  return async () => {
    const msg = document.getElementById(msgId);
    const body = {};
    let hasValue = false;
    for (const [inputId, key] of fields) {
      const val = document.getElementById(inputId).value.trim();
      if (val) { body[key] = val; hasValue = true; }
    }
    if (!hasValue) { msg.textContent = 'Enter at least one field'; msg.className = 'api-key-msg error'; return; }
    try {
      await api('/integrations/config', { method: 'POST', body: JSON.stringify(body) });
      msg.textContent = 'Saved!'; msg.className = 'api-key-msg success';
      loadIntegrationConfig();
    } catch (e) { msg.textContent = e.message; msg.className = 'api-key-msg error'; }
  };
}

document.getElementById('save-gh-config').addEventListener('click', saveConfigHandler([
  ['int-gh-client-id', 'github_client_id'], ['int-gh-client-secret', 'github_client_secret']
], 'gh-config-msg'));

document.getElementById('save-gd-config').addEventListener('click', saveConfigHandler([
  ['int-gd-client-id', 'google_drive_client_id'], ['int-gd-client-secret', 'google_drive_client_secret']
], 'gd-config-msg'));

document.getElementById('save-vc-config').addEventListener('click', saveConfigHandler([
  ['int-vc-client-id', 'vercel_client_id'], ['int-vc-client-secret', 'vercel_client_secret']
], 'vc-config-msg'));

document.getElementById('save-nt-config').addEventListener('click', saveConfigHandler([
  ['int-nt-client-id', 'netlify_client_id'], ['int-nt-client-secret', 'netlify_client_secret']
], 'nt-config-msg'));

document.getElementById('save-docker-config').addEventListener('click', async () => {
  const msg = document.getElementById('docker-config-msg');
  const val = document.getElementById('int-docker-host').value.trim();
  if (!val) { msg.textContent = 'Enter a Docker host URL'; msg.className = 'api-key-msg error'; return; }
  try {
    await api('/integrations/config', { method: 'POST', body: JSON.stringify({ docker_host: val }) });
    msg.textContent = 'Saved!'; msg.className = 'api-key-msg success';
    loadIntegrationConfig();
  } catch (e) { msg.textContent = e.message; msg.className = 'api-key-msg error'; }
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

init();
