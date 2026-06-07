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
let autoHarnessEnabled = true;
let lastBackgroundHarnessAt = 0;
const HARNESS_BACKGROUND_COOLDOWN_MS = 1500;
const DEFAULT_HARNESS_BUDGET = { maxToolCalls: 20, maxWallMinutes: 15 };
let harnessState = {
  status: 'unknown',
  activeTasks: new Map(),
  subagents: new Map(),
  pendingApprovals: new Map(),
  artifacts: new Map(),
  latestEvents: [],
  currentApproval: null,
};
const CAPABILITY_TYPES = [
  { id: 'skill', label: 'Skills' },
  { id: 'mcp', label: 'MCPs' },
  { id: 'pi_extension', label: 'Pi Extensions' },
  { id: 'profile', label: 'Profiles' },
];
let activeHarnessTab = 'run';
let harnessCapabilitiesLoaded = false;
let harnessCapabilities = [];
let harnessCapabilitiesRequestTimer = null;

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
const workspacePathInput = document.getElementById('workspace-path');
const workspaceBrowseConnectBtn = document.getElementById('btn-workspace-browse-connect');
const workspaceBrowseBtn = document.getElementById('btn-workspace-browse');

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
  workspacePath = workspacePathInput?.value?.trim() || '';
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
const harnessSubagentCount = $('#harness-subagent-count');
const harnessSubagents = $('#harness-subagents');
const harnessEvents = $('#harness-events');
const harnessTaskInput = $('#harness-task-input');
const harnessDeepTaskInput = $('#harness-deep-task-input');
const harnessDeepToolCalls = $('#harness-deep-tool-calls');
const harnessDeepMinutes = $('#harness-deep-minutes');
const harnessCapabilityStatus = $('#harness-capability-status');
const harnessCapabilityForm = $('#harness-capability-form');
const workspaceInput = document.getElementById('workspace-input');

// ═══════════════════════════════════════════════════════════
// Workspace Input Handler
// ═══════════════════════════════════════════════════════════
function syncWorkspaceInputs(path) {
  if (workspacePathInput) workspacePathInput.value = path || '';
  if (workspaceInput) workspaceInput.value = path || '';
}

function applyWorkspaceSelection(path, { notify = true } = {}) {
  const nextWorkspace = String(path || '').trim();
  if (!nextWorkspace) return;
  const changed = nextWorkspace !== workspacePath;
  workspacePath = nextWorkspace;
  syncWorkspaceInputs(workspacePath);
  debug('Workspace changed to: ' + workspacePath);
  if (ws?.readyState === WebSocket.OPEN) {
    send({ type: 'set_workspace', path: workspacePath });
    send({ type: 'get_session_files' });
    if (activeHarnessTab === 'capabilities') requestHarnessCapabilities();
  }
  if (notify && changed) toast('Workspace selected', 'success');
}

function setWorkspaceBrowseBusy(isBusy) {
  if (workspaceBrowseConnectBtn) workspaceBrowseConnectBtn.disabled = isBusy;
  if (workspaceBrowseBtn) workspaceBrowseBtn.disabled = isBusy;
}

async function chooseWorkspace(event) {
  event?.preventDefault();
  event?.stopPropagation();

  const initialDirectory = workspacePath
    || workspaceInput?.value?.trim()
    || workspacePathInput?.value?.trim()
    || '';

  setWorkspaceBrowseBusy(true);
  try {
    let result;
    if (window.electronAPI?.selectWorkspace) {
      result = await window.electronAPI.selectWorkspace(initialDirectory);
    } else {
      const response = await fetch('/api/workspace/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialDirectory }),
      });
      result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Workspace picker failed');
    }

    if (result?.selected && result.path) {
      applyWorkspaceSelection(result.path);
    } else if (result?.unsupported) {
      toast(result.reason || 'Workspace picker is not available here', 'error');
    } else {
      debug('Workspace selection cancelled');
    }
  } catch (error) {
    debug('Workspace picker error: ' + error.message);
    toast(error.message || 'Workspace picker failed', 'error');
  } finally {
    setWorkspaceBrowseBusy(false);
  }
}

if (workspaceInput) {
  workspaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const newWorkspace = workspaceInput.value.trim();
      if (newWorkspace) applyWorkspaceSelection(newWorkspace, { notify: false });
    }
  });
}
if (workspacePathInput) workspacePathInput.addEventListener('keydown', e => { if (e.key === 'Enter') startConnection(); });
if (workspaceBrowseConnectBtn) workspaceBrowseConnectBtn.addEventListener('click', chooseWorkspace);
if (workspaceBrowseBtn) workspaceBrowseBtn.addEventListener('click', chooseWorkspace);

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
        if (!messagesEl.children.length) showWelcome();
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
        syncWorkspaceInputs(msg.state.cwd);
        if (msg.state.cwd !== workspacePath) {
          workspacePath = msg.state.cwd;
          debug('Workspace updated to: ' + workspacePath);
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
  if (msg.type === 'harness_artifact' && msg.data) {
    renderHarnessArtifact(msg.data);
    return;
  }
  if (msg.type === 'harness_capabilities') {
    handleHarnessCapabilities(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_capability_saved') {
    handleHarnessCapabilitySaved(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_capability_deleted') {
    handleHarnessCapabilityDeleted(msg.data || msg);
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

  for (const artifact of event.artifacts || []) {
    harnessState.artifacts.set(artifact.artifactId, artifact);
  }

  updateHarnessSubagent(event);

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

function updateHarnessSubagent(event) {
  if (event.type === 'swarm.attempts_scheduled') {
    for (const attempt of event.attempts || []) {
      const existing = harnessState.subagents.get(attempt.attemptId) || {};
      harnessState.subagents.set(attempt.attemptId, {
        ...existing,
        taskId: event.taskId || existing.taskId,
        attemptId: attempt.attemptId,
        role: attempt.role || existing.role || 'implementer',
        strategy: attempt.strategy || existing.strategy,
        status: attempt.status || existing.status || 'scheduled',
        summary: attempt.output?.summary || existing.summary,
        score: attempt.score ?? existing.score,
        verifierPassed: attempt.verifierPassed ?? existing.verifierPassed,
        patchStats: attempt.patchStats || existing.patchStats,
        updatedAt: attempt.completedAt || attempt.startedAt || existing.updatedAt || new Date().toISOString(),
      });
    }
    return;
  }

  if (!['swarm.subagent_started', 'swarm.subagent_completed'].includes(event.type) || !event.attemptId) {
    return;
  }

  const existing = harnessState.subagents.get(event.attemptId) || {};
  harnessState.subagents.set(event.attemptId, {
    ...existing,
    taskId: event.taskId || existing.taskId,
    attemptId: event.attemptId,
    role: event.role || existing.role || 'subagent',
    strategy: event.strategy || existing.strategy,
    status: event.status || (event.type === 'swarm.subagent_started' ? 'running' : existing.status || 'unknown'),
    summary: event.summary || existing.summary,
    score: event.score ?? existing.score,
    verifierPassed: event.verifierPassed ?? existing.verifierPassed,
    patchStats: event.patchStats || existing.patchStats,
    updatedAt: event.completedAt || event.startedAt || new Date().toISOString(),
  });
}

function renderHarnessSubagents() {
  if (!harnessSubagents) return;
  const agents = Array.from(harnessState.subagents.values())
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 6);

  const activeCount = agents.filter(agent => ['running', 'scheduled'].includes(agent.status)).length;
  if (harnessSubagentCount) {
    harnessSubagentCount.textContent = `${activeCount} active`;
  }

  harnessSubagents.innerHTML = agents.map(agent => {
    const scoreText = Number.isFinite(agent.score) ? `score ${agent.score}` : '';
    const changedLines = agent.patchStats?.changedLines;
    const patchText = Number.isFinite(changedLines) ? `${changedLines} line${changedLines === 1 ? '' : 's'}` : '';
    const verifyText = agent.verifierPassed === true ? 'verified' : agent.verifierPassed === false ? 'unverified' : '';
    const meta = [scoreText, verifyText, patchText].filter(Boolean).join(' · ');
    return `
      <div class="harness-subagent-card">
        <div class="harness-subagent-top">
          <span class="harness-subagent-name">${esc(agent.role || 'subagent')} · ${esc(agent.attemptId || '')}</span>
          <span class="harness-subagent-status ${esc(agent.status || 'unknown')}">${esc(agent.status || 'unknown')}</span>
        </div>
        <div class="harness-subagent-strategy">${esc(agent.strategy || 'strategy pending')}</div>
        <div class="harness-subagent-summary">${esc(agent.summary || 'Waiting for activity')}</div>
        ${meta ? `<div class="harness-subagent-meta">${esc(meta)}</div>` : ''}
      </div>
    `;
  }).join('') || '<div class="harness-empty compact">No subagents running</div>';
}

function renderHarnessPanel() {
  if (!harnessPanel) return;
  harnessSubtitle.textContent = harnessState.status === 'running' ? 'Sidecar running' : `Sidecar ${harnessState.status}`;
  harnessStatePill.textContent = harnessState.status;
  harnessStatePill.className = `harness-pill ${harnessState.status}`;
  harnessTaskCount.textContent = `${harnessState.activeTasks.size} task${harnessState.activeTasks.size === 1 ? '' : 's'}`;
  harnessApprovalCount.textContent = `${harnessState.pendingApprovals.size} approval${harnessState.pendingApprovals.size === 1 ? '' : 's'}`;
  renderHarnessSubagents();
  harnessEvents.innerHTML = harnessState.latestEvents.map(event => `
    <div class="harness-event">
      <div class="harness-event-main">
        <span class="harness-event-type">${esc(event.type)}</span>
        <span class="harness-event-summary">${esc(event.summary || event.reason || event.intent || event.result || '')}</span>
      </div>
      ${(event.artifacts || []).length ? `
        <div class="harness-artifact-links">
          ${event.artifacts.map(artifact => `
            <button class="harness-artifact-link" onclick="openHarnessArtifact('${esc(artifact.artifactId)}')">${esc(artifact.title || artifact.type || 'artifact')}</button>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `).join('') || '<div class="harness-empty">No harness events yet</div>';
}

function switchHarnessTab(tabId) {
  activeHarnessTab = tabId || 'run';
  document.querySelectorAll('.harness-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.harnessTab === activeHarnessTab);
  });
  document.querySelectorAll('.harness-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `harness-tab-${activeHarnessTab}`);
  });
  if (activeHarnessTab === 'capabilities' && !harnessCapabilitiesLoaded) {
    requestHarnessCapabilities();
  }
}

function openHarnessTab(tabId) {
  if (harnessPanel) harnessPanel.classList.remove('hidden');
  send({ type: 'harness_status' });
  switchHarnessTab(tabId);
}

function requestHarnessCapabilities() {
  if (harnessCapabilityStatus) harnessCapabilityStatus.textContent = 'Refreshing capabilities...';
  if (harnessCapabilitiesRequestTimer) clearTimeout(harnessCapabilitiesRequestTimer);
  harnessCapabilitiesRequestTimer = setTimeout(() => {
    if (harnessCapabilityStatus?.textContent === 'Refreshing capabilities...') {
      harnessCapabilityStatus.textContent = harnessCapabilitiesLoaded
        ? `${harnessCapabilities.length} scoped capabilit${harnessCapabilities.length === 1 ? 'y' : 'ies'}`
        : 'No capabilities returned yet';
    }
  }, 2500);
  send({ type: 'harness_capabilities_get', workspaceRoot: workspacePath || undefined });
}

function capabilityBucketFromPayload(payload, keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function extractCapabilityRecords(payload) {
  const direct = payload?.records || payload?.capabilities || payload?.registry?.records || payload?.registry?.capabilities || payload;
  if (Array.isArray(direct)) return direct;
  if (!direct || typeof direct !== 'object') return [];

  const grouped = [
    ...capabilityBucketFromPayload(direct, ['skill', 'skills']),
    ...capabilityBucketFromPayload(direct, ['mcp', 'mcps', 'mcpServers']),
    ...capabilityBucketFromPayload(direct, ['pi_extension', 'piExtensions', 'pi_extensions']),
    ...capabilityBucketFromPayload(direct, ['profile', 'profiles']),
  ];
  if (grouped.length) return grouped;

  return Object.values(direct).filter(value => value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeCapabilityType(type) {
  const value = String(type || 'skill').trim().toLowerCase();
  if (value === 'skills') return 'skill';
  if (value === 'mcps' || value === 'mcp_server') return 'mcp';
  if (value === 'pi-extension' || value === 'pi extension' || value === 'pi_extensions') return 'pi_extension';
  if (value === 'profiles') return 'profile';
  return CAPABILITY_TYPES.some(item => item.id === value) ? value : 'skill';
}

function listToText(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return Object.keys(value).join(', ');
  return String(value || '');
}

function normalizeCapabilityRecord(record, index = 0) {
  const type = normalizeCapabilityType(record?.type || record?.kind);
  const name = String(record?.name || record?.title || `${type}-${index + 1}`);
  const location = record?.pathOrCommandOrUrl || record?.target || record?.path || record?.command || record?.url || '';
  const id = String(record?.id || record?.capabilityId || record?.capability_id || `${type}:${name}`);
  return {
    ...record,
    id,
    type,
    name,
    enabled: record?.enabled !== false,
    pathOrCommandOrUrl: String(location || ''),
    argsText: listToText(record?.args),
    envText: listToText(record?.envVarNames || record?.env_var_names || record?.env),
    approvalMode: String(record?.approvalMode || record?.approval_mode || record?.approval || 'inherit'),
    notes: String(record?.notes || record?.description || ''),
  };
}

function handleHarnessCapabilities(payload) {
  if (harnessCapabilitiesRequestTimer) clearTimeout(harnessCapabilitiesRequestTimer);
  harnessCapabilitiesLoaded = true;
  harnessCapabilities = extractCapabilityRecords(payload).map(normalizeCapabilityRecord);
  renderHarnessCapabilities();
}

function handleHarnessCapabilitySaved(payload) {
  if (harnessCapabilitiesRequestTimer) clearTimeout(harnessCapabilitiesRequestTimer);
  const fullRecords = extractCapabilityRecords(payload);
  if (fullRecords.length > 1) {
    harnessCapabilities = fullRecords.map(normalizeCapabilityRecord);
  } else {
    const saved = normalizeCapabilityRecord(payload?.record || payload?.capability || payload);
    const existingIndex = harnessCapabilities.findIndex(record => record.id === saved.id);
    if (existingIndex >= 0) harnessCapabilities.splice(existingIndex, 1, saved);
    else if (saved.name) harnessCapabilities.unshift(saved);
  }
  harnessCapabilitiesLoaded = true;
  renderHarnessCapabilities();
  resetHarnessCapabilityForm();
  toast('Capability saved', 'success');
}

function handleHarnessCapabilityDeleted(payload) {
  if (harnessCapabilitiesRequestTimer) clearTimeout(harnessCapabilitiesRequestTimer);
  const deletedId = String(payload?.capabilityId || payload?.id || payload?.capability_id || '');
  if (deletedId) {
    harnessCapabilities = harnessCapabilities.filter(record => record.id !== deletedId);
  } else {
    requestHarnessCapabilities();
  }
  renderHarnessCapabilities();
  toast('Capability deleted', 'success');
}

function renderHarnessCapabilities() {
  const grouped = new Map(CAPABILITY_TYPES.map(item => [item.id, []]));
  harnessCapabilities.forEach(record => {
    const type = normalizeCapabilityType(record.type);
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push(record);
  });

  CAPABILITY_TYPES.forEach(({ id }) => {
    const records = grouped.get(id) || [];
    const countEl = document.getElementById(`capability-count-${id}`);
    const listEl = document.getElementById(`capability-list-${id}`);
    if (countEl) countEl.textContent = String(records.length);
    if (!listEl) return;
    listEl.innerHTML = records.map(record => `
      <div class="harness-capability-item ${record.enabled ? '' : 'disabled'}" data-capability-id="${esc(record.id)}">
        <div class="harness-capability-item-main">
          <span class="harness-capability-name">${esc(record.name)}</span>
          <span class="harness-capability-meta">${esc(record.pathOrCommandOrUrl || record.approvalMode || 'local')}</span>
        </div>
        <div class="harness-capability-item-actions">
          <button class="harness-artifact-link" type="button" data-capability-action="edit" data-capability-id="${esc(record.id)}">Edit</button>
          <button class="harness-artifact-link" type="button" data-capability-action="delete" data-capability-id="${esc(record.id)}">Delete</button>
        </div>
      </div>
    `).join('') || '<div class="harness-empty compact">No records</div>';
  });

  if (harnessCapabilityStatus) {
    const total = harnessCapabilities.length;
    harnessCapabilityStatus.textContent = harnessCapabilitiesLoaded
      ? `${total} scoped capabilit${total === 1 ? 'y' : 'ies'}`
      : 'No capabilities loaded';
  }
}

function parseCapabilityList(value) {
  return String(value || '')
    .split(/[\s,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function buildCapabilityRecordFromForm() {
  const type = normalizeCapabilityType($('#capability-type')?.value);
  const location = $('#capability-location')?.value?.trim() || '';
  const record = {
    type,
    name: $('#capability-name')?.value?.trim() || '',
    enabled: $('#capability-enabled')?.checked !== false,
    pathOrCommandOrUrl: location,
    args: parseCapabilityList($('#capability-args')?.value),
    envVarNames: parseCapabilityList($('#capability-env')?.value),
    approvalMode: $('#capability-approval')?.value || 'inherit',
    notes: $('#capability-notes')?.value?.trim() || '',
  };
  const id = $('#capability-id')?.value?.trim();
  if (id) record.id = id;
  if (/^https?:\/\//i.test(location)) record.url = location;
  else if (type === 'mcp') record.command = location;
  else record.path = location;
  return record;
}

function saveHarnessCapability(event) {
  event?.preventDefault();
  const record = buildCapabilityRecordFromForm();
  if (!record.name) {
    toast('Capability name required', 'error');
    return;
  }
  send({
    type: 'harness_capability_save',
    workspaceRoot: workspacePath || undefined,
    record,
  });
  if (harnessCapabilityStatus) harnessCapabilityStatus.textContent = 'Saving capability...';
}

function editHarnessCapability(capabilityId) {
  const record = harnessCapabilities.find(item => item.id === capabilityId);
  if (!record) return;
  $('#capability-id').value = record.id;
  $('#capability-type').value = normalizeCapabilityType(record.type);
  $('#capability-name').value = record.name || '';
  $('#capability-enabled').checked = record.enabled !== false;
  $('#capability-location').value = record.pathOrCommandOrUrl || '';
  $('#capability-args').value = record.argsText || listToText(record.args);
  $('#capability-env').value = record.envText || listToText(record.envVarNames || record.env);
  $('#capability-approval').value = record.approvalMode || 'inherit';
  $('#capability-notes').value = record.notes || '';
}

function deleteHarnessCapability(capabilityId) {
  if (!capabilityId) return;
  const record = harnessCapabilities.find(item => item.id === capabilityId);
  const ok = confirm(`Delete ${record?.name || 'this capability'}?`);
  if (!ok) return;
  send({
    type: 'harness_capability_delete',
    workspaceRoot: workspacePath || undefined,
    capabilityId,
  });
  if (harnessCapabilityStatus) harnessCapabilityStatus.textContent = 'Deleting capability...';
}

function resetHarnessCapabilityForm() {
  if (!harnessCapabilityForm) return;
  harnessCapabilityForm.reset();
  $('#capability-id').value = '';
  $('#capability-type').value = 'skill';
  $('#capability-enabled').checked = true;
  $('#capability-approval').value = 'inherit';
}

function handleHarnessPanelClick(event) {
  const tab = event.target.closest('[data-harness-tab]');
  if (tab) {
    switchHarnessTab(tab.dataset.harnessTab);
    return;
  }

  const actionButton = event.target.closest('[data-capability-action]');
  if (!actionButton) return;
  const capabilityId = actionButton.dataset.capabilityId;
  if (actionButton.dataset.capabilityAction === 'edit') editHarnessCapability(capabilityId);
  if (actionButton.dataset.capabilityAction === 'delete') deleteHarnessCapability(capabilityId);
}

function toggleHarnessPanel() {
  harnessPanel.classList.toggle('hidden');
  if (!harnessPanel.classList.contains('hidden')) {
    send({ type: 'harness_status' });
    if (activeHarnessTab === 'capabilities') requestHarnessCapabilities();
  }
}

function startHarness() {
  send({ type: 'harness_start', workspaceRoot: workspacePath || undefined });
}

function stopHarness() {
  send({ type: 'harness_stop' });
}

function classifyPromptHarnessRoute(text, { hasImages = false, promptIsStreaming = false } = {}) {
  const normalized = String(text || '').trim();
  if (!autoHarnessEnabled) return { shouldRun: false, mode: 'background', task: normalized, reason: 'disabled' };
  if (promptIsStreaming) return { shouldRun: false, mode: 'background', task: normalized, reason: 'streaming_prompt' };
  if (!normalized && !hasImages) return { shouldRun: false, mode: 'background', task: '', reason: 'empty_prompt' };

  const directPatterns = [
    /^\/harness\b/i,
    /\b(?:use|run|launch|start)\b.*\b(?:harness|bes|meta|sidecar)\b/i,
    /\b(?:harness|bes|meta)\b.*\b(?:this|project|task|prompt|repo|repository)\b/i,
  ];
  const isSlashHarness = /^\/harness\b/i.test(normalized);
  const direct = directPatterns.some(pattern => pattern.test(normalized));
  const task = isSlashHarness
    ? normalized.replace(/^\/harness\b[\s:;-]*/i, '').trim() || normalized
    : normalized || '[Image prompt]';

  return {
    shouldRun: true,
    mode: direct ? 'direct' : 'background',
    task,
    reason: direct ? 'explicit_harness_intent' : 'automatic_background',
  };
}

function launchHarnessFromPrompt(text, options = {}) {
  const route = classifyPromptHarnessRoute(text, options);
  if (!route.shouldRun) return route;

  const now = Date.now();
  if (route.mode === 'background' && now - lastBackgroundHarnessAt < HARNESS_BACKGROUND_COOLDOWN_MS) {
    return { ...route, shouldRun: false, reason: 'background_cooldown' };
  }
  if (route.mode === 'background') lastBackgroundHarnessAt = now;

  send({
    type: 'harness_task_start',
    task: route.task,
    mode: 'full',
    budget: { ...DEFAULT_HARNESS_BUDGET },
    source: route.mode === 'direct' ? 'prompt_direct' : 'prompt_background',
  });

  debug(`Harness ${route.mode} launch: ${route.reason}`);
  if (route.mode === 'direct') {
    harnessPanel.classList.remove('hidden');
    toast('Harness launched', 'success');
  }

  return route;
}

function runHarnessTask() {
  const task = harnessTaskInput?.value?.trim();
  if (!task) return;
  send({
    type: 'harness_task_start',
    task,
    mode: 'full',
    budget: { ...DEFAULT_HARNESS_BUDGET },
    source: 'manual_panel',
  });
  harnessTaskInput.value = '';
}

function runDeepResearchTask() {
  const task = harnessDeepTaskInput?.value?.trim();
  if (!task) return;
  const maxToolCalls = Number.parseInt(harnessDeepToolCalls?.value || '80', 10);
  const maxWallMinutes = Number.parseInt(harnessDeepMinutes?.value || '45', 10);
  send({
    type: 'harness_task_start',
    task,
    mode: 'deep_research',
    budget: {
      maxToolCalls: Number.isFinite(maxToolCalls) ? maxToolCalls : 80,
      maxWallMinutes: Number.isFinite(maxWallMinutes) ? maxWallMinutes : 45,
    },
    source: 'deep_research_ui',
  });
  harnessDeepTaskInput.value = '';
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

function openHarnessArtifact(artifactId) {
  const artifact = harnessState.artifacts.get(artifactId);
  $('#harness-artifact-title').textContent = artifact?.title || 'Harness Artifact';
  $('#harness-artifact-content').textContent = 'Loading...';
  openModal('harness-artifact');
  send({ type: 'harness_artifact_get', artifactId });
}

function renderHarnessArtifact(payload) {
  const artifact = payload.artifact || {};
  $('#harness-artifact-title').textContent = artifact.title || artifact.type || 'Harness Artifact';
  $('#harness-artifact-content').textContent = payload.content || '';
  openModal('harness-artifact');
}

function toggleThinkingTrace(button) {
  const block = button.closest('.thinking-block');
  if (!block) return;
  const expanded = block.classList.toggle('expanded');
  button.setAttribute('aria-expanded', String(expanded));

  if (activeStream?.contentEl?.contains(block)) {
    savedThinkingBlocks = Array.from(activeStream.contentEl.querySelectorAll('.thinking-block')).map(el => el.outerHTML);
  } else if (activeThinking?.el === block && savedThinkingBlocks.length) {
    savedThinkingBlocks[savedThinkingBlocks.length - 1] = block.outerHTML;
  }
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
    <div class="thinking-header">
      <div class="thinking-header-left">
        <span class="thinking-icon">✦</span>
        <button type="button" class="thinking-toggle" aria-label="Show thinking trace" aria-expanded="false" onclick="toggleThinkingTrace(this)">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
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
    <div class="thinking-header">
      <div class="thinking-header-left">
        <span class="thinking-icon">✦</span>
        <button type="button" class="thinking-toggle" aria-label="Show thinking trace" aria-expanded="false" onclick="toggleThinkingTrace(this)">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 6l4 4 4-4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
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
  messagesEl.querySelector('.welcome')?.remove();
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

function handlePasteImages(event) {
  const clipboard = event.clipboardData;
  if (!clipboard) return;

  const imageFiles = [];
  for (const item of Array.from(clipboard.items || [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }

  if (!imageFiles.length && clipboard.files?.length) {
    imageFiles.push(...Array.from(clipboard.files).filter(file => file.type.startsWith('image/')));
  }

  if (!imageFiles.length) return;
  event.preventDefault();
  handleFileSelect(imageFiles);
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
  inputArea.addEventListener('paste', handlePasteImages);
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
  const wasStreaming = isStreaming;
  const harnessRoute = mode === 'prompt'
    ? classifyPromptHarnessRoute(text || '[Image]', {
      hasImages: uploadedImages.length > 0,
      promptIsStreaming: wasStreaming,
    })
    : null;
  const harnessOnlyCommand = harnessRoute?.mode === 'direct' && /^\/harness\b/i.test(text);

  if (mode === 'prompt' && !wasStreaming) {
    createUserMsg(text, uploadedImages.length ? [...uploadedImages] : null);
  }

  if (harnessOnlyCommand) {
    launchHarnessFromPrompt(text, {
      hasImages: uploadedImages.length > 0,
      promptIsStreaming: wasStreaming,
    });
    inputEl.value = '';
    clearImagePreview();
    autoResize();
    return;
  }

  const msg = { type: 'prompt', message: text || '[Image]' };
  if (uploadedImages.length) msg.images = [...uploadedImages];
  if (wasStreaming) msg.streamingBehavior = mode === 'steer' ? 'steer' : 'followUp';

  send(msg);
  if (mode === 'prompt') {
    launchHarnessFromPrompt(text || '[Image]', {
      hasImages: uploadedImages.length > 0,
      promptIsStreaming: wasStreaming,
    });
  }
  
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
$('#btn-deep-research')?.addEventListener('click', () => openHarnessTab('deep-research'));
$('#btn-capabilities')?.addEventListener('click', () => openHarnessTab('capabilities'));
$('#btn-harness-start').addEventListener('click', startHarness);
$('#btn-harness-stop').addEventListener('click', stopHarness);
$('#btn-harness-run').addEventListener('click', runHarnessTask);
if (harnessPanel) harnessPanel.addEventListener('click', handleHarnessPanelClick);
$('#btn-harness-deep-run')?.addEventListener('click', runDeepResearchTask);
$('#btn-harness-capabilities-refresh')?.addEventListener('click', requestHarnessCapabilities);
$('#btn-harness-capability-reset')?.addEventListener('click', resetHarnessCapabilityForm);
harnessCapabilityForm?.addEventListener('submit', saveHarnessCapability);
$('#harness-task-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runHarnessTask();
  }
});
$('#harness-deep-task-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runDeepResearchTask();
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
