/**
 * Helios Forge — Frontend
 * v3: Thinking bubbles, file attachments, real pi sessions
 */

// ═══════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════
let ws = null;
let isConnected = false;
let isStreaming = false;
let currentModel = null;
let currentThinking = 'high';
let models = [];
let pendingExtensionUI = null;
let activeStream = null;
let activeThinking = null;
let pendingToolCalls = new Map();
let serverUrl = '';
let currentSessionInfo = null;
let uploadedImages = [];
let savedThinkingBlocks = [];
let workspacePath = ''; // Persist across text_start
let currentSessionId = null;
let harnessState = {
  status: 'unknown',
  activeTasks: new Map(),
  pendingApprovals: new Map(),
  latestEvents: [],
  currentApproval: null,
};

// ═══════════════════════════════════════════════════════════
// Debug
// ═══════════════════════════════════════════════════════════
const debugLog = [];
let connectTimeout = null;

function debug(msg) {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(entry);
  debugLog.push(entry);
  const el = document.getElementById('debug-log');
  if (el) { el.value = debugLog.join('\n'); el.scrollTop = el.scrollHeight; }
}

function resetConnectTimeout() {
  if (connectTimeout) clearTimeout(connectTimeout);
  connectTimeout = setTimeout(() => {
    if (!isConnected) {
      debug('⚠ TIMEOUT: pi_ready never received!');
      debug(`  WS state: ${ws?.readyState}, URL: ${ws?.url}`);
      debug(`  Messages logged: ${debugLog.length}`);
    }
  }, 15000);
}

// ═══════════════════════════════════════════════════════════
// Connection Dialog
// ═══════════════════════════════════════════════════════════
const connectionDialog = document.getElementById('connection-dialog');
const serverUrlInput = document.getElementById('server-url');
const connectBtn = document.getElementById('btn-connect');
const appEl = document.getElementById('app');

if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  serverUrlInput.value = `ws://${location.host}`;
} else {
  serverUrlInput.value = `ws://localhost:3777`;
}

window.setServerUrl = function(host) {
  const port = host.includes(':') ? '' : ':3777';
  serverUrlInput.value = `ws://${host}${port}`;
  serverUrlInput.focus();
};

function startConnection() {
  serverUrl = serverUrlInput.value.trim();
  workspacePath = document.getElementById('workspace-path')?.value?.trim() || '';
  if (!serverUrl) return;
  if (location.protocol === 'https:') serverUrl = serverUrl.replace('ws://', 'wss://');
  debug(`Connecting to: ${serverUrl}`);
  connectionDialog.style.display = 'none';
  appEl.style.display = 'flex';
  connect();
}

if (connectBtn) connectBtn.addEventListener('click', startConnection);
if (serverUrlInput) serverUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') startConnection(); });

// ═══════════════════════════════════════════════════════════
// DOM Elements
// ═══════════════════════════════════════════════════════════
const $ = (sel) => document.querySelector(sel);
const messagesEl = $('#messages');
const inputEl = $('#message-input');
const sendBtn = $('#btn-send');
const abortBtn = $('#btn-abort');
const steerBtn = $('#btn-steer');
const sessionTitle = $('#session-title');
const modelDisplay = $('#model-display');
const thinkingDisplay = $('#thinking-display');
const scrollSentinel = $('#scroll-sentinel');
const pinnedList = $('#pinned-list');
const recentsList = $('#recents-list');
let sessions = []; // Session list for sidebar
const userStatus = $('#user-status');
const connectionBanner = $('#connection-banner');
const connectionText = $('#connection-text');
const fileInput = $('#file-input');
const attachBtn = $('#btn-attach');
const imagePreview = $('#image-preview');
const harnessPanel = $('#harness-panel');
const harnessSubtitle = $('#harness-subtitle');
const harnessStatePill = $('#harness-state-pill');
const harnessTaskCount = $('#harness-task-count');
const harnessApprovalCount = $('#harness-approval-count');
const harnessEvents = $('#harness-events');
const harnessTaskInput = $('#harness-task-input');

// ═══════════════════════════════════════════════════════════
// Workspace Input Handler
// ═══════════════════════════════════════════════════════════
const workspaceInput = document.getElementById('workspace-input');
if (workspaceInput) {
  workspaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const newWorkspace = workspaceInput.value.trim();
      if (newWorkspace && newWorkspace !== workspacePath) {
        workspacePath = newWorkspace;
        debug('Workspace changed to: ' + workspacePath);
        send({ type: 'set_workspace', path: workspacePath });
        // Refresh sessions for new workspace
        send({ type: 'get_session_files' });
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════
// WebSocket
// ═══════════════════════════════════════════════════════════
function connect() {
  resetConnectTimeout();
  debug(`WS: Connecting to ${serverUrl}...`);
  ws = new WebSocket(serverUrl);

  ws.onopen = () => debug('WS: Open ✓');
  ws.onclose = (e) => {
    debug(`WS: Closed (code=${e.code})`);
    isConnected = false; isStreaming = false;
    setStatus('disconnected', 'Disconnected');
    setTimeout(connect, 2000);
  };
  ws.onerror = () => debug('WS: Error ✗');
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      debug(`WS: ${msg.type}${msg.event ? '/' + msg.event : ''}`);
      handleMessage(msg);
    } catch (err) { debug(`WS: Parse error: ${err.message}`); }
  };
}

function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function setStatus(state, text) {
  userStatus.textContent = text;
  userStatus.className = 'user-status ' + state;
  if (connectionBanner) {
    connectionBanner.className = 'connection-banner ' + state;
    connectionText.textContent = state === 'connected' ? 'Connected to Helios Forge'
      : state === 'connecting' ? 'Connecting to Helios Forge...'
      : state === 'error' ? text || 'Connection error'
      : 'Disconnected — reconnecting...';
  }
  inputEl.disabled = state !== 'connected';
}

// ═══════════════════════════════════════════════════════════
// Message Handler
// ═══════════════════════════════════════════════════════════
function handleMessage(msg) {
  // System events
  if (msg.type === 'system') {
    switch (msg.event) {
      case 'connected':
        debug('Handler: connected');
        setStatus('connecting', 'Connecting...');
        break;
      case 'pi_ready':
        isConnected = true;
        if (connectTimeout) { clearTimeout(connectTimeout); connectTimeout = null; }
        debug(`Handler: pi_ready ✓ (model=${msg.data?.model?.name || msg.data?.model?.id})`);
        setStatus('connected', 'Connected');
        currentModel = msg.data?.model || currentModel;
        currentThinking = msg.data?.thinkingLevel || currentThinking;
        updateHeader();
        currentSessionInfo = msg.data;
        updateSessionTitle(msg.data);
        // Fetch available models, sessions, and state
        if (workspacePath) {
          send({ type: 'set_workspace', path: workspacePath });
        }
        send({ type: 'get_models' });
        send({ type: 'get_session_files' });
        send({ type: 'harness_status' });
        if (!messagesEl.children.length || messagesEl.querySelector('.welcome')) showWelcome();
        break;
      case 'pi_disconnected':
        isConnected = false;
        setStatus('disconnected', 'Disconnected');
        break;
      case 'pi_error':
        isConnected = false;
        setStatus('disconnected', msg.error);
        break;
    }
    return;
  }

  // Meta responses
  if (msg.type === 'models' && msg.data?.models) { models = msg.data.models; return; }
  if (msg.type === 'model_changed' && msg.data) {
    currentModel = msg.data; updateHeader(); closeDropdowns();
    toast(`Model: ${currentModel.name || currentModel.id}`, 'success'); return;
  }
  if (msg.type === 'thinking_changed' && msg.success) { send({ type: 'get_state' }); return; }
  if (msg.type === 'state' && msg.data) {
    currentThinking = msg.data.thinkingLevel || currentThinking;
    if (msg.data.model) currentModel = msg.data.model;
    currentSessionInfo = msg.data;
    updateSessionTitle(msg.data);
    updateHeader(); return;
  }
  if (msg.type === 'session_stats' && msg.data) { renderStats(msg.data); return; }
  if (msg.type === 'error') { toast(msg.error, 'error'); return; }
  if (msg.type === 'session_changed') {
    messagesEl.innerHTML = ''; uploadedImages = []; clearImagePreview();
    currentSessionInfo = msg.data;
    updateSessionTitle(msg.data);
    addSession(msg.data?.sessionName || `Session ${msg.data?.sessionId?.slice(0, 8)}`);
    showWelcome();
    toast('New session', 'success'); return;
  }
  if (msg.type === 'session_loaded') {
    debug('Session loaded: messages=' + (msg.messages?.length || 0) + ', state=' + !!msg.state + ', cancelled=' + msg.cancelled);
    messagesEl.innerHTML = ''; uploadedImages = []; clearImagePreview();
    if (msg.state) {
      currentSessionInfo = msg.state;
      currentSessionInfo.model && (currentModel = currentSessionInfo.model);
      currentSessionInfo.thinkingLevel && (currentThinking = currentSessionInfo.thinkingLevel);
      updateSessionTitle(msg.state);
      updateHeader();
      // Update workspace input to match session's directory
      if (msg.state?.cwd) {
        const workspaceInput = document.getElementById('workspace-input');
        if (workspaceInput) {
          workspaceInput.value = msg.state.cwd;
          if (workspaceInput.value !== workspacePath) {
            workspacePath = workspaceInput.value;
            debug('Workspace updated to: ' + workspacePath);
          }
        }
      }
    }
    // Don't add a new session - update current instead
    if (msg.messages && msg.messages.length > 0) {
      renderHistory(msg.messages);
    } else {
      showWelcome();
      debug('No messages in session');
    }
    return;
  }

  if (msg.type === 'workspace_changed' && msg.success) {
    toast('Workspace set', 'success');
    return;
  }
  if (msg.type === 'session_deleted' && msg.success) {
    toast('Session deleted', 'success');
    return;
  }
  if (msg.type === 'session_files' && msg.data?.sessions) {
    if (typeof sessions === 'undefined') sessions = [];
    renderPiSessions(msg.data.sessions);
    return;
  }
  if (msg.type === 'harness_status' && msg.data) {
    updateHarnessStatus(msg.data);
    return;
  }
  if (msg.type === 'harness_task_started' && msg.data) {
    harnessState.activeTasks.set(msg.data.taskId, msg.data);
    renderHarnessPanel();
    toast('Harness task started', 'success');
    return;
  }
  if (msg.type === 'harness_task_event' && msg.event) {
    handleHarnessEvent(msg.event);
    return;
  }
  if (msg.type === 'harness_approval_resolved' && msg.data) {
    harnessState.pendingApprovals.delete(msg.data.actionId);
    closeModal('harness-approval');
    renderHarnessPanel();
    toast(`Approval ${msg.data.choice}`, 'success');
    return;
  }

  // Agent events
  switch (msg.type) {
    case 'agent_start': isStreaming = true; updateInput(); showLoading(); break;
    case 'agent_end':
      isStreaming = false; pendingToolCalls.clear();
      activeThinking = null; activeStream = null;
      updateInput(); hideLoading();
      // Refresh sessions after response completes (new session may have been created)
      setTimeout(() => send({ type: 'get_session_files' }), 1000);
      break;
    case 'turn_start': 
      activeStream = null; 
      activeThinking = null;
      savedThinkingBlocks = [];
      break;
    case 'turn_end': if (activeStream) finalizeStream(); break;
    case 'message_start':
      if (msg.message.role === 'assistant') {
        const el = createAssistantMsg();
        activeStream = { el, contentEl: el.querySelector('.msg-content'), text: '' };
      }
      break;
    case 'message_update': handleMessageUpdate(msg); break;
    case 'message_end': if (activeStream) finalizeStream(); break;
    case 'tool_execution_start': handleToolStart(msg); break;
    case 'tool_execution_update': handleToolUpdate(msg); break;
    case 'tool_execution_end': handleToolEnd(msg); break;
    case 'queue_update': updateInput(); break;
    case 'compaction_start': toast('Compacting...', 'info'); break;
    case 'compaction_end': toast('Compaction done', 'success'); break;
    case 'extension_ui_request': handleExtensionUI(msg); break;
  }
}

function updateHarnessStatus(status) {
  harnessState.status = status.state || 'unknown';
  renderHarnessPanel();
}

function handleHarnessEvent(event) {
  harnessState.latestEvents.unshift(event);
  harnessState.latestEvents = harnessState.latestEvents.slice(0, 8);

  if (event.taskId) {
    const existing = harnessState.activeTasks.get(event.taskId) || { taskId: event.taskId };
    harnessState.activeTasks.set(event.taskId, { ...existing, lastEvent: event.type, summary: event.summary || existing.summary });
  }

  if (event.type === 'approval.required') {
    harnessState.pendingApprovals.set(event.actionId, event);
    harnessState.currentApproval = event;
    renderHarnessApproval(event);
    openModal('harness-approval');
  }

  if (event.type === 'approval.resolved') {
    harnessState.pendingApprovals.delete(event.actionId);
  }

  renderHarnessPanel();
}

function renderHarnessPanel() {
  if (!harnessPanel) return;
  harnessSubtitle.textContent = harnessState.status === 'running' ? 'Sidecar running' : `Sidecar ${harnessState.status}`;
  harnessStatePill.textContent = harnessState.status;
  harnessStatePill.className = `harness-pill ${harnessState.status}`;
  harnessTaskCount.textContent = `${harnessState.activeTasks.size} task${harnessState.activeTasks.size === 1 ? '' : 's'}`;
  harnessApprovalCount.textContent = `${harnessState.pendingApprovals.size} approval${harnessState.pendingApprovals.size === 1 ? '' : 's'}`;
  harnessEvents.innerHTML = harnessState.latestEvents.map(event => `
    <div class="harness-event">
      <span class="harness-event-type">${esc(event.type)}</span>
      <span class="harness-event-summary">${esc(event.summary || event.reason || event.intent || event.result || '')}</span>
    </div>
  `).join('') || '<div class="harness-empty">No harness events yet</div>';
}

function toggleHarnessPanel() {
  harnessPanel.classList.toggle('hidden');
  if (!harnessPanel.classList.contains('hidden')) {
    send({ type: 'harness_status' });
  }
}

function startHarness() {
  send({ type: 'harness_start', workspaceRoot: workspacePath || undefined });
}

function stopHarness() {
  send({ type: 'harness_stop' });
}

function runHarnessTask() {
  const task = harnessTaskInput?.value?.trim();
  if (!task) return;
  send({
    type: 'harness_task_start',
    task,
    mode: 'mvp',
    budget: { maxToolCalls: 20, maxWallMinutes: 15 },
  });
  harnessTaskInput.value = '';
}

function renderHarnessApproval(event) {
  const action = event.proposedAction || {};
  $('#harness-approval-content').innerHTML = `
    <div class="approval-grid">
      <div><span class="approval-label">Risk</span><strong>${esc(event.risk || 'unknown')}</strong></div>
      <div><span class="approval-label">Action</span><strong>${esc(action.tool || 'harness')}</strong></div>
    </div>
    <p class="approval-reason">${esc(event.reason || '')}</p>
    <pre class="approval-action">${esc(JSON.stringify(action, null, 2))}</pre>
    <div class="approval-actions">
      ${(event.choices || ['approve', 'reject']).map(choice => `
        <button class="ext-btn ${choice === 'approve' ? 'primary' : ''}" onclick="respondHarnessApproval('${esc(event.actionId)}','${esc(choice)}')">${esc(choice)}</button>
      `).join('')}
    </div>
  `;
}

function respondHarnessApproval(actionId, choice) {
  send({ type: 'harness_approval_response', actionId, choice });
}

function handleMessageUpdate(msg) {
  const ev = msg.assistantMessageEvent;
  if (!ev) return;

  switch (ev.type) {
    case 'text_start':
      if (activeStream && !activeStream.text) {
        // Don't clear thinking blocks - they're saved
        activeStream.contentEl.innerHTML = savedThinkingBlocks.join('') + '<span class="cursor"></span>';
      }
      break;
    case 'text_delta':
      if (activeStream) {
        activeStream.text += ev.delta;
        activeStream.contentEl.innerHTML = savedThinkingBlocks.join('') + renderMD(activeStream.text) + '<span class="cursor"></span>';
        renderMath(activeStream.contentEl);
        scroll();
      }
      break;
    case 'thinking_start': 
      createThinkingBlock(); 
      break;
    case 'thinking_delta':
      if (activeThinking) {
        activeThinking.text += ev.delta;
        const preview = activeThinking.el.querySelector('.thinking-preview');
        if (preview) preview.textContent = activeThinking.text.trim();
        activeThinking.contentEl.innerHTML = renderMD(activeThinking.text) + '<div class="done-line"><span class="check">⟳</span> Thinking...</div>';
        renderMath(activeThinking.contentEl);
        // Update saved HTML
        savedThinkingBlocks[savedThinkingBlocks.length - 1] = activeThinking.el.outerHTML;
        scroll();
      }
      break;
    case 'thinking_end':
      if (activeThinking) {
        activeThinking.el.classList.add('thinking-done');
        const preview = activeThinking.el.querySelector('.thinking-preview');
        if (preview) preview.textContent = activeThinking.text.trim();
        activeThinking.contentEl.innerHTML = renderMD(activeThinking.text) + '<div class="done-line"><span class="check">✓</span> Done</div>';
        renderMath(activeThinking.contentEl);
        // Update saved HTML
        savedThinkingBlocks[savedThinkingBlocks.length - 1] = activeThinking.el.outerHTML;
        highlightCode();
      }
      break;
    case 'done': finalizeStream(); break;
  }
}

function finalizeStream() {
  if (!activeStream) return;
  activeStream.contentEl.innerHTML = savedThinkingBlocks.join('') + (activeStream.text ? renderMD(activeStream.text) : '');
  renderMath(activeStream.contentEl);
  highlightCode();
  activeStream = null;
  savedThinkingBlocks = [];
  scroll();
}

// ═══════════════════════════════════════════════════════════
// History Rendering
// ═══════════════════════════════════════════════════════════
function renderHistory(messages) {
  let lastAssistant = null;

  messages.forEach(msg => {
    if (msg.role === 'user') {
      lastAssistant = null;
      const el = document.createElement('div');
      el.className = 'message message-user';
      const content = typeof msg.content === 'string' ? msg.content
        : msg.content.map(c => c.type === 'text' ? c.text : '').join('');
      el.innerHTML = `<div class="msg-content">${renderMD(content)}</div>`;
      messagesEl.appendChild(el);
      renderMath(el.querySelector('.msg-content'));
    } else if (msg.role === 'assistant') {
      lastAssistant = createAssistantMsg();
      const contentEl = lastAssistant.querySelector('.msg-content');
      
      // Render thinking blocks
      const thinkingBlocks = (msg.content || []).filter(c => c.type === 'thinking');
      thinkingBlocks.forEach(t => {
        const tb = createThinkingBlockStatic(t.thinking);
        contentEl.appendChild(tb);
      });

      // Render text
      const textBlocks = (msg.content || []).filter(c => c.type === 'text');
      if (textBlocks.length) {
        contentEl.innerHTML += renderMD(textBlocks.map(t => t.text).join(''));
      }

      // Render tool calls
      const toolCalls = (msg.content || []).filter(c => c.type === 'toolCall');
      toolCalls.forEach(tc => {
        const tel = createToolElStatic(tc.name, tc.arguments, 'success');
        contentEl.appendChild(tel);
      });

      highlightCode();
      renderMath(contentEl);
    } else if (msg.role === 'toolResult' && lastAssistant) {
      // Append tool result to last assistant message
      const contentEl = lastAssistant.querySelector('.msg-content');
      // Find the tool call and add result
      const lastTool = contentEl.querySelector('.tool-call:last-child');
      if (lastTool) {
        const result = lastTool.querySelector('.tool-result');
        if (result) {
          const c = (msg.content || []).map(c => c.text || '').join('');
          result.style.display = 'block';
          if (c) result.innerHTML = `<pre>${esc(c)}</pre>`;
        }
      }
    }
  });

  highlightCode();
  // Force scroll to bottom for session restore
  requestAnimationFrame(() => {
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  });
}

function createThinkingBlockStatic(text) {
  const el = document.createElement('div');
  el.className = 'thinking-block thinking-done';
  el.innerHTML = `
    <div class="thinking-header" onclick="this.parentElement.classList.toggle('expanded')">
      <div class="thinking-header-left">
        <span class="thinking-icon">✦</span>
        <span class="thinking-header-text">Thinking</span>
      </div>
      <span class="thinking-status">Done</span>
    </div>
    <div class="thinking-preview">${text.trim().substring(0, 100)}${text.trim().length > 100 ? '...' : ''}</div>
    <div class="thinking-content">${renderMD(text)}<div class="done-line"><span class="check">✓</span> Done</div></div>`;
  return el;
}

function createToolElStatic(name, args, status) {
  const el = document.createElement('div');
  el.className = 'tool-call expanded';
  const icons = { read: '📄', write: '✏️', edit: '🔧', bash: '💻', grep: '🔍', find: '📁', ls: '📂' };
  const icon = icons[name] || '🔹';
  const preview = typeof args === 'object'
    ? Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)}`).join('\n')
    : String(args);
  el.innerHTML = `
    <div class="tool-header" onclick="this.parentElement.classList.toggle('expanded')">
      <div class="tool-name"><span class="tool-icon">${icon}</span><span>${esc(name)}</span></div>
      <span class="tool-status ${status}">${status === 'success' ? 'Done' : 'Running'}</span>
    </div>
    <div class="tool-args"><pre>${esc(preview)}</pre></div>
    <div class="tool-result"></div>`;
  return el;
}

function updateSessionTitle(data) {
  if (data?.sessionName) {
    sessionTitle.textContent = data.sessionName;
  } else if (data?.sessionId) {
    sessionTitle.textContent = `Session ${data.sessionId.slice(0, 8)}`;
  }
}

// ═══════════════════════════════════════════════════════════
// Tools
// ═══════════════════════════════════════════════════════════
function handleToolStart(msg) {
  const el = createToolElDynamic(msg.toolName, msg.args, 'running');
  const last = messagesEl.lastElementChild;
  if (last?.classList.contains('message-assistant')) {
    last.querySelector('.msg-content').appendChild(el);
  }
  pendingToolCalls.set(msg.toolCallId, { el, status: 'running' });
  scroll();
}

function handleToolUpdate(msg) {
  const p = pendingToolCalls.get(msg.toolCallId);
  if (p && msg.partialResult) {
    const r = p.el.querySelector('.tool-result');
    if (r) {
      const c = msg.partialResult.content?.[0]?.text || '';
      if (c) { r.style.display = 'block'; r.innerHTML = `<pre>${esc(c)}</pre>`; }
    }
    scroll();
  }
}

function handleToolEnd(msg) {
  const p = pendingToolCalls.get(msg.toolCallId);
  if (p) {
    p.status = msg.isError ? 'error' : 'success';
    const s = p.el.querySelector('.tool-status');
    if (s) { s.textContent = msg.isError ? 'Error' : 'Done'; s.className = `tool-status ${p.status}`; }
    const r = p.el.querySelector('.tool-result');
    if (r && msg.result) {
      r.style.display = 'block';
      const c = msg.result.content?.[0]?.text || '';
      if (c) r.innerHTML = `<pre>${esc(c)}</pre>`;
    }
    pendingToolCalls.delete(msg.toolCallId);
    scroll();
  }
}

function createToolElDynamic(name, args, status) {
  const el = document.createElement('div');
  el.className = 'tool-call';
  const icons = { read: '📄', write: '✏️', edit: '🔧', bash: '💻', grep: '🔍', find: '📁', ls: '📂' };
  const icon = icons[name] || '🔹';
  const preview = typeof args === 'object'
    ? Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)}`).join('\n')
    : String(args);
  el.innerHTML = `
    <div class="tool-header" onclick="this.parentElement.classList.toggle('expanded')">
      <div class="tool-name"><span class="tool-icon">${icon}</span><span>${esc(name)}</span></div>
      <span class="tool-status ${status}">${status === 'running' ? 'Running' : status === 'success' ? 'Done' : 'Error'}</span>
    </div>
    <div class="tool-args"><pre>${esc(preview)}</pre></div>
    <div class="tool-result"></div>`;
  return el;
}

// ═══════════════════════════════════════════════════════════
// Thinking Block (Dynamic)
// ═══════════════════════════════════════════════════════════
function createThinkingBlock() {
  const last = messagesEl.lastElementChild;
  let parent;
  if (last?.classList.contains('message-assistant')) {
    parent = last.querySelector('.msg-content');
  } else {
    const el = createAssistantMsg();
    parent = el.querySelector('.msg-content');
  }
  const el = document.createElement('div');
  el.className = 'thinking-block';
  el.innerHTML = `
    <div class="thinking-header" onclick="this.parentElement.classList.toggle('expanded')">
      <div class="thinking-header-left">
        <span class="thinking-icon">✦</span>
        <span class="thinking-header-text">Thinking</span>
      </div>
      <span class="thinking-status">Thinking...</span>
    </div>
    <div class="thinking-preview"></div>
    <div class="thinking-content"></div>`;
  parent.appendChild(el);
  activeThinking = { el, contentEl: el.querySelector('.thinking-content'), previewEl: el.querySelector('.thinking-preview'), text: '' };
  // Save the initial HTML
  savedThinkingBlocks.push(el.outerHTML);
  scroll();
}

// ═══════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════
function createAssistantMsg() {
  const el = document.createElement('div');
  el.className = 'message message-assistant';
  el.innerHTML = `
    <div class="msg-label">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7L12 12L22 7L12 2Z"/>
        <path d="M2 17L12 22L22 17" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 12L12 17L22 12" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Assistant
    </div>
    <div class="msg-content"></div>
    <div class="msg-actions">
      <button class="msg-action-btn" title="Copy" onclick="copyMsg(this)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
      </button>
      <button class="msg-action-btn" title="Good">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/>
        </svg>
      </button>
      <button class="msg-action-btn" title="Retry" onclick="retryMsg()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
        </svg>
      </button>
    </div>`;
  messagesEl.appendChild(el);
  return el;
}

function createUserMsg(text, images) {
  const el = document.createElement('div');
  el.className = 'message message-user';
  let html = '';
  if (images && images.length) {
    html += '<div class="msg-images">' + images.map(img =>
      `<img src="data:${img.mimeType};base64,${img.data}" alt="attached" />`
    ).join('') + '</div>';
  }
  if (text) html += `<div class="msg-content">${renderMD(text)}</div>`;
  el.innerHTML = html;
  messagesEl.appendChild(el);
  highlightCode();
  if (el.querySelector('.msg-content')) renderMath(el.querySelector('.msg-content'));
  scroll();
}

function showWelcome() {
  const el = document.createElement('div');
  el.className = 'welcome';
  el.innerHTML = `
    <div class="welcome-icon">
      <svg viewBox="0 0 48 48" fill="none">
        <path d="M24 4L4 16L24 28L44 16L24 4Z" fill="var(--accent)" opacity="0.6"/>
        <path d="M4 36L24 44L44 36" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"/>
        <path d="M4 24L24 32L44 24" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
      </svg>
    </div>
    <h2>Welcome to Helios Forge</h2>
    <p>Ask anything — read files, run commands, edit code, and more.</p>`;
  messagesEl.appendChild(el);
}

function showLoading() {
  if (!messagesEl.querySelector('.loading-spinner')) {
    const el = document.createElement('div');
    el.className = 'loading-spinner';
    el.innerHTML = '<div class="spinner-icon"></div><span class="spinner-text">Thinking...</span>';
    messagesEl.appendChild(el);
    scroll();
  }
}

function hideLoading() {
  const el = messagesEl.querySelector('.loading-spinner');
  if (el) el.remove();
}

function renderMD(text) {
  if (!text) return '';
  try {
    if (typeof marked !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });
      return marked.parse(text);
    }
    return esc(text);
  } catch { return esc(text); }
}

function renderMath(el) {
  if (typeof renderMathInElement === 'undefined') return;
  try {
    renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
    });
  } catch {}
}

function highlightCode() {
  if (typeof hljs === 'undefined') return;
  document.querySelectorAll('.msg-content pre code').forEach(el => {
    if (el.className.includes('hljs')) return;
    const text = el.textContent || '';
    let lang = '';
    const pre = el.parentElement;
    if (pre) {
      for (const cls of pre.className.split(' ')) {
        if (cls.startsWith('language-')) { lang = cls.replace('language-', ''); break; }
      }
    }
    if (!lang) {
      if (/function |const |import |export |=>/.test(text)) lang = 'javascript';
      else if (/def |print\(|class /.test(text)) lang = 'python';
      else if (/fn |let |use /.test(text)) lang = 'rust';
      else if (/$ |sudo |cd |ls /.test(text)) lang = 'bash';
    }
    if (lang && hljs.getLanguage(lang)) hljs.highlightElement(el);
  });
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function scroll() {
  requestAnimationFrame(() => {
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer) {
      const obs = new IntersectionObserver(entries => {
        if (entries[0]?.isIntersecting) chatContainer.scrollTop = chatContainer.scrollHeight;
      }, { root: chatContainer, threshold: 1 });
      obs.observe(scrollSentinel);
      setTimeout(() => obs.disconnect(), 100);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// File Attachments
// ═══════════════════════════════════════════════════════════
function handleFileSelect(files) {
  Array.from(files).forEach(file => {
    if (!file.type.startsWith('image/')) {
      toast('Only image files are supported', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target.result.split(',')[1];
      const mime = file.type;
      uploadedImages.push({ type: 'image', data: base64, mimeType: mime });
      updateImagePreview();
      toast(`Image attached: ${file.name}`, 'success');
    };
    reader.readAsDataURL(file);
  });
}

function updateImagePreview() {
  if (!imagePreview) return;
  imagePreview.innerHTML = '';
  uploadedImages.forEach((img, i) => {
    const el = document.createElement('div');
    el.className = 'image-thumb';
    el.innerHTML = `
      <img src="data:${img.mimeType};base64,${img.data}" alt="attached" />
      <button class="remove-image" onclick="removeImage(${i})">&times;</button>`;
    imagePreview.appendChild(el);
  });
}

window.removeImage = function(index) {
  uploadedImages.splice(index, 1);
  updateImagePreview();
};

function clearImagePreview() {
  uploadedImages = [];
  if (imagePreview) imagePreview.innerHTML = '';
  if (fileInput) fileInput.value = '';
}

// File button
if (attachBtn) {
  attachBtn.addEventListener('click', () => {
    if (!fileInput) {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'file-input';
      input.accept = 'image/*';
      input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);
    }
    const fi = document.getElementById('file-input');
    fi.click();
  });
}

// File input change
document.addEventListener('change', (e) => {
  if (e.target.id === 'file-input' && e.target.files.length) {
    handleFileSelect(e.target.files);
  }
});

// Drag and drop on input area
const inputArea = $('#input-area');
if (inputArea) {
  inputArea.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); inputArea.classList.add('drag-over'); });
  inputArea.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); inputArea.classList.remove('drag-over'); });
  inputArea.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    inputArea.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files);
  });
}

// ═══════════════════════════════════════════════════════════
// Input
// ═══════════════════════════════════════════════════════════
function updateInput() {
  if (isStreaming) {
    steerBtn.classList.remove('hidden');
    sendBtn.classList.add('hidden');
    abortBtn.classList.remove('hidden');
  } else {
    steerBtn.classList.add('hidden');
    sendBtn.classList.remove('hidden');
    abortBtn.classList.add('hidden');
  }
}

function sendMessage(mode = 'prompt') {
  const text = inputEl.value.trim();
  if (!text && !uploadedImages.length) return;

  if (mode === 'prompt' && !isStreaming) {
    createUserMsg(text, uploadedImages.length ? [...uploadedImages] : null);
  }

  const msg = { type: 'prompt', message: text || '[Image]' };
  if (uploadedImages.length) msg.images = [...uploadedImages];
  if (isStreaming) msg.streamingBehavior = mode === 'steer' ? 'steer' : 'followUp';

  send(msg);
  
  inputEl.value = '';
  clearImagePreview();
  autoResize();
}

function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
}

// ═══════════════════════════════════════════════════════════
// Dropdowns
// ═══════════════════════════════════════════════════════════
function openDropdown(type) {
  closeDropdowns();
  const wrapper = $(`#${type === 'model' ? 'model-select' : 'thinking-select'}-wrapper`);
  const dropdown = $(`#dropdown-${type}`);
  const rect = wrapper.getBoundingClientRect();
  dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  dropdown.style.top = 'auto';
  dropdown.style.right = `${window.innerWidth - rect.right}px`;
  dropdown.classList.remove('hidden');
  if (type === 'model') {
    renderModelList();
    const searchInput = $('#model-search');
    if (searchInput) setTimeout(() => searchInput.focus(), 50);
  }
  else renderThinkingList();
}

function closeDropdowns() {
  document.querySelectorAll('.dropdown').forEach(d => d.classList.add('hidden'));
}

function renderModelList(filter = '') {
  const filtered = models.filter(m =>
    !filter || m.name?.toLowerCase().includes(filter.toLowerCase()) ||
    m.id?.toLowerCase().includes(filter.toLowerCase()) ||
    m.provider?.toLowerCase().includes(filter.toLowerCase())
  );
  $('#model-list').innerHTML = filtered.map(m => `
    <div class="dropdown-item ${currentModel?.id === m.id ? 'active' : ''}" onclick="selectModel('${esc(m.provider)}','${esc(m.id)}')">
      <div>
        <div class="dropdown-item-name">${esc(m.name || m.id)}</div>
        <div class="dropdown-item-sub">${esc(m.provider)}${m.contextWindow ? ' · ' + (m.contextWindow / 1000).toFixed(0) + 'K ctx' : ''}</div>
      </div>
    </div>`).join('') || '<p style="color:var(--text-tertiary);text-align:center;padding:16px;">No models found</p>';
}

function renderThinkingList() {
  const levels = ['Off', 'Minimal', 'Low', 'Medium', 'High', 'XHigh'];
  const values = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  $('#thinking-list').innerHTML = levels.map((label, i) => `
    <div class="dropdown-item ${currentThinking === values[i] ? 'active' : ''}" onclick="selectThinking('${values[i]}')">
      <span class="dropdown-item-name">${label}</span>
    </div>`).join('');
}

function selectModel(provider, modelId) { send({ type: 'set_model', provider, modelId }); }
function selectThinking(level) {
  send({ type: 'set_thinking', level });
  currentThinking = level;
  thinkingDisplay.textContent = level.charAt(0).toUpperCase() + level.slice(1);
  closeDropdowns();
}
function updateHeader() {
  modelDisplay.textContent = currentModel?.name || currentModel?.id || '—';
  thinkingDisplay.textContent = currentThinking ? currentThinking.charAt(0).toUpperCase() + currentThinking.slice(1) : '—';
}

// ═══════════════════════════════════════════════════════════
// Modal
// ═══════════════════════════════════════════════════════════
function openModal(id) { $(`#modal-${id}`).classList.remove('hidden'); }
function closeModal(id) { $(`#modal-${id}`).classList.add('hidden'); }

function renderStats(data) {
  const tokens = data.tokens || {};
  const ctx = data.contextUsage || {};
  const pct = ctx.percent || 0;
  $('#stats-content').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Messages</div><div class="stat-value">${data.totalMessages || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Tool Calls</div><div class="stat-value">${data.toolCalls || 0}</div></div>
      <div class="stat-card"><div class="stat-label">Input Tokens</div><div class="stat-value">${(tokens.input || 0).toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Output Tokens</div><div class="stat-value">${(tokens.output || 0).toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Cost</div><div class="stat-value accent">$${(data.cost || 0).toFixed(4)}</div></div>
      <div class="stat-card"><div class="stat-label">Session</div><div class="stat-value" style="font-size:11px;word-break:break-all;">${(data.sessionId || '').slice(0, 12)}...</div></div>
      <div class="context-bar">
        <div class="context-bar-label">Context: ${typeof pct === 'number' ? pct.toFixed(1) + '%' : 'N/A'}</div>
        <div class="context-bar-track"><div class="context-bar-fill" style="width:${typeof pct === 'number' ? pct : 0}%"></div></div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
// Extension UI
// ═══════════════════════════════════════════════════════════
function handleExtensionUI(req) {
  const fireAndForget = ['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text'];
  if (fireAndForget.includes(req.method)) {
    if (req.method === 'notify') toast(req.message || '', req.notifyType === 'error' ? 'error' : 'success');
    return;
  }
  pendingExtensionUI = req;
  $('#ext-title').textContent = req.title || 'Extension Request';
  const body = $('#ext-body');
  body.innerHTML = '';
  switch (req.method) {
    case 'select':
      body.innerHTML = `<p class="ext-message">${esc(req.message || '')}</p><div class="ext-options">${(req.options || []).map(o => `<div class="ext-option" onclick="extSelect('${esc(o)}')">${esc(o)}</div>`).join('')}</div>`;
      break;
    case 'confirm':
      body.innerHTML = `<p class="ext-message">${esc(req.message || '')}</p><div class="ext-actions"><button class="ext-btn" onclick="extConfirm(false)">Cancel</button><button class="ext-btn primary" onclick="extConfirm(true)">Confirm</button></div>`;
      break;
    case 'input':
      body.innerHTML = `<p class="ext-message">${esc(req.message || '')}</p><input class="ext-textarea" type="text" id="ext-input-val" placeholder="${esc(req.placeholder || '')}"><div class="ext-actions"><button class="ext-btn" onclick="extCancel()">Cancel</button><button class="ext-btn primary" onclick="extInput()">Submit</button></div>`;
      break;
    case 'editor':
      body.innerHTML = `<textarea class="ext-textarea" id="ext-editor-val">${esc(req.prefill || '')}</textarea><div class="ext-actions"><button class="ext-btn" onclick="extCancel()">Cancel</button><button class="ext-btn primary" onclick="extEditor()">Submit</button></div>`;
      break;
  }
  openModal('extension');
}

function extSelect(v) { if (pendingExtensionUI) { send({ type: 'extension_ui_response', id: pendingExtensionUI.id, value: v }); pendingExtensionUI = null; closeModal('extension'); } }
function extConfirm(c) { if (pendingExtensionUI) { send({ type: 'extension_ui_response', id: pendingExtensionUI.id, confirmed: c }); pendingExtensionUI = null; closeModal('extension'); } }
function extInput() { if (pendingExtensionUI) { send({ type: 'extension_ui_response', id: pendingExtensionUI.id, value: $('#ext-input-val')?.value || '' }); pendingExtensionUI = null; closeModal('extension'); } }
function extEditor() { if (pendingExtensionUI) { send({ type: 'extension_ui_response', id: pendingExtensionUI.id, value: $('#ext-editor-val')?.value || '' }); pendingExtensionUI = null; closeModal('extension'); } }
function extCancel() { if (pendingExtensionUI) { send({ type: 'extension_ui_response', id: pendingExtensionUI.id, cancelled: true }); pendingExtensionUI = null; closeModal('extension'); } }

// ═══════════════════════════════════════════════════════════
// Toast
// ═══════════════════════════════════════════════════════════
function toast(message, type = 'info') {
  const container = $('#toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); el.classList.add('hiding'); setTimeout(() => el.remove(), 300); }, 2500);
}

// ═══════════════════════════════════════════════════════════
// Sessions
// ═══════════════════════════════════════════════════════════
function addSession(name) {
  if (!name) return;
  const existing = sessions.find(s => s.name === name);
  if (existing) return;
  const s = { id: Date.now().toString(), name, pinned: false };
  sessions.unshift(s);
  renderSessions();
  sessionTitle.textContent = name;
  currentSessionId = s.id;
}

function renderSessions() {
  pinnedList.innerHTML = sessions.filter(s => s.pinned).map(renderSessionItem).join('');
  recentsList.innerHTML = sessions.filter(s => !s.pinned).map(renderSessionItem).join('');
}

function renderSessionItem(s) {
  return `
    <div class="session-item ${s.id === currentSessionId ? 'active' : ''}" onclick="selectSession('${s.id}')">
      <span class="session-name">${esc(s.name)}</span>
      <div class="session-actions">
        <button class="session-action-btn" title="${s.pinned ? 'Unpin' : 'Pin'}" onclick="event.stopPropagation();togglePin('${s.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="${s.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </button>
        <button class="session-action-btn" title="Delete" onclick="event.stopPropagation();deleteSession('${s.id}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

function togglePin(id) {
  const s = sessions.find(s => s.id === id);
  if (s) { s.pinned = !s.pinned; renderSessions(); }
}
function selectSession(id) {
  currentSessionId = id;
  const session = sessions.find(s => s.id === id);
  if (session && session.path) {
    switchToSession(session);
  }
  renderSessions();
}

function deleteSession(id) {
  const session = sessions.find(s => s.id === id);
  if (!session) return;
  
  // Remove from local array
  sessions = sessions.filter(s => s.id !== id);
  renderSessions();
  
  // Delete from server if it's a pi session
  if (session.path) {
    send({ type: 'delete_session', path: session.path });
    toast('Session deleted', 'success');
  }
}
function renameSession() {
  const name = prompt('Rename chat:', sessionTitle.textContent);
  if (name) {
    sessionTitle.textContent = name;
    const s = sessions.find(s => s.id === currentSessionId);
    if (s) { s.name = name; renderSessions(); }
  }
}
function toggleSection(header) {
  header.classList.toggle('collapsed');
  header.nextElementSibling.classList.toggle('collapsed');
}


// ═══════════════════════════════════════════════════════════
// Pi Session Management
// ═══════════════════════════════════════════════════════════
function renderPiSessions(sessionFiles) {
  if (!sessionFiles || !sessionFiles.length) return;
  const currentPath = currentSessionInfo?.sessionFile;
  
  // Keep existing pinned sessions
  const existingPinned = sessions.filter(s => s.pinned);
  sessions = [...existingPinned];
  
  // Add all pi sessions (not just 30)
  sessionFiles.forEach(s => {
    if (s.path === currentPath) return; // Skip current session
    
    const sessionName = s.name || s.timestamp?.slice(0, 16).replace('T', ' ') || 'Session';
    const alreadyExists = sessions.find(existing => existing.path === s.path);
    
    if (!alreadyExists) {
      sessions.push({
        id: 'pi_' + s.path,
        name: sessionName,
        pinned: false,
        path: s.path,
        messageCount: s.messageCount
      });
    }
  });
  
  renderSessions();
}

function switchToSession(session) {
  if (!session.path) return;
  debug('Switching to session: ' + session.path);
  send({ type: 'switch_session', sessionPath: session.path });
}

// ═══════════════════════════════════════════════════════════
// Copy / Retry

// ═══════════════════════════════════════════════════════════
function copyMsg(btn) {
  const msg = btn.closest('.message');
  const content = msg.querySelector('.msg-content');
  navigator.clipboard.writeText(content?.textContent || '').then(() => toast('Copied!', 'success'));
}

function retryMsg() {
  const userMsgs = messagesEl.querySelectorAll('.message-user');
  if (userMsgs.length) {
    const lastUser = userMsgs[userMsgs.length - 1];
    const text = lastUser.querySelector('.msg-content').textContent;
    sendMessage('prompt');
  }
}

// ═══════════════════════════════════════════════════════════
// Events
// ═══════════════════════════════════════════════════════════
sendBtn.addEventListener('click', () => sendMessage('prompt'));
steerBtn.addEventListener('click', () => sendMessage('steer'));
abortBtn.addEventListener('click', () => send({ type: 'abort' }));

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(isStreaming ? 'steer' : 'prompt');
  }
  autoResize();
});

$('#btn-new-chat').addEventListener('click', () => send({ type: 'new_session' }));
$('#btn-stats').addEventListener('click', () => { send({ type: 'get_session_stats' }); openModal('stats'); });
$('#btn-harness').addEventListener('click', toggleHarnessPanel);
$('#btn-harness-start').addEventListener('click', startHarness);
$('#btn-harness-stop').addEventListener('click', stopHarness);
$('#btn-harness-run').addEventListener('click', runHarnessTask);
$('#harness-task-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runHarnessTask();
  }
});
$('#model-search').addEventListener('input', (e) => renderModelList(e.target.value));

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', () => o.parentElement.classList.add('hidden'));
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown') && !e.target.closest('.meta-select')) closeDropdowns();
});

// Debug panel toggle
const debugPanel = document.getElementById('debug-panel');
const btnDebug = document.getElementById('btn-debug');
if (btnDebug) btnDebug.addEventListener('click', () => debugPanel.classList.toggle('hidden'));
const btnDebugClose = document.getElementById('btn-debug-close');
if (btnDebugClose) btnDebugClose.addEventListener('click', () => debugPanel.classList.add('hidden'));

// Auto-open debug on issues
setInterval(() => {
  if (!isConnected && debugPanel.classList.contains('hidden') && debugLog.length > 2) {
    debugPanel.classList.remove('hidden');
  }
}, 3000);

// ═══════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════
// Connection is started from the dialog, not automatically
