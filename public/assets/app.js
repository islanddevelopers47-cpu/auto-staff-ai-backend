// Auto Staff AI — Test UI
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
  showLogin();
}

// --- WebSocket ---
function connectWs() {
  if (!token) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
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
  document.getElementById('user-info').textContent = user ? `${user.username} (${user.role})` : '';
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
    if (btn.dataset.tab === 'settings') loadApiKeys();
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
    const list = document.getElementById('bots-list');
    if (!data.bots.length) {
      list.innerHTML = '<div class="card"><p>No bots yet. Click "+ Add Bot" to get started.</p></div>';
      return;
    }
    list.innerHTML = data.bots.map(bot => `
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
  } catch (err) { console.error('Bots load error:', err); }
}

async function startBot(id) { try { await api(`/bots/${id}/start`, { method: 'POST' }); loadBots(); } catch (e) { alert(e.message); } }
async function stopBot(id) { try { await api(`/bots/${id}/stop`, { method: 'POST' }); loadBots(); } catch (e) { alert(e.message); } }
async function restartBot(id) { try { await api(`/bots/${id}/restart`, { method: 'POST' }); loadBots(); } catch (e) { alert(e.message); } }
async function deleteBot(id) {
  if (!confirm('Delete this bot?')) return;
  try { await api(`/bots/${id}`, { method: 'DELETE' }); loadBots(); } catch (e) { alert(e.message); }
}

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
  ollama: ['llama3.2', 'llama3.1', 'mistral', 'codellama']
};

document.getElementById('agent-provider').addEventListener('change', () => {
  const provider = document.getElementById('agent-provider').value;
  const sel = document.getElementById('agent-model');
  sel.innerHTML = (MODELS[provider] || []).map(m => `<option value="${m}">${m}</option>`).join('');
});

document.getElementById('add-agent-btn').addEventListener('click', () => {
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

  // Note: This sends via the API — in a real scenario the bot processes Telegram messages.
  // For testing, we directly run the agent pipeline via a test endpoint.
  addChatMessage('assistant', 'Processing... (Chat test sends through the agent pipeline. In production, messages come from Telegram.)');
});

function addChatMessage(role, text) {
  const box = document.getElementById('chat-messages');
  box.innerHTML += `<div class="chat-msg ${role}">
    <div class="sender">${role === 'user' ? 'You' : 'Bot'}</div>
    <div class="bubble">${escapeHtml(text)}</div>
  </div>`;
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  const providers = ['openai', 'anthropic', 'google'];
  for (const p of providers) {
    const badge = document.getElementById(`${p}-status`);
    if (!badge) continue;
    const hasKey = storedKeys.some(k => k.provider === p);
    if (hasKey) {
      badge.textContent = 'Configured';
      badge.className = 'status-badge status-running';
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
      badge.className = 'status-badge status-stopped';
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

init();
