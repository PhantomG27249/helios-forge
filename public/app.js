/**
 * Helios Forge — Frontend
 * v3: Thinking bubbles, file attachments, real pi sessions
 */

// ═══════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════
let ws = null;
let reconnectTimer = null;
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
let workspacePath = ''; // Persist across text_start
let scrollScheduled = false;
const DEBUG_LOG_MAX = 400;
const WS_DEBUG_SKIP = new Set(['message_update', 'tool_execution_update']);
let currentSessionId = null;
let autoHarnessEnabled = true;
let lastBackgroundHarnessAt = 0;
let connectionState = 'connecting';
const HARNESS_BACKGROUND_COOLDOWN_MS = 1500;
const DEFAULT_HARNESS_BUDGET = { maxToolCalls: 20, maxWallMinutes: 15 };
const HARNESS_MAX_SUBAGENTS = 50;
const STORAGE_SERVER_URL = 'helios_server_url';
const STORAGE_WORKSPACE_PATH = 'helios_workspace_path';
const STORAGE_SMITHERY_KEY = 'helios_smithery_key';
const STORAGE_PINNED_SESSIONS = 'helios_pinned_sessions';
const STORAGE_SESSION_TITLES = 'helios_session_titles';
const STORAGE_CONFIG_DRIFT_DISMISSED = 'helios_config_drift_dismissed';
const LS_AUTO_HARNESS = 'helios_auto_harness';
const KNOWN_MODEL_PROFILES = [
  'qwen36_vlm_fast',
  'qwen36_vlm_deep',
  'critic_low_temp',
  'alphahelion_ebft5',
];
const SWARM_FEATURE_TOGGLES = (window.HELIOS_HARNESS_CONFIG_UI?.FEATURE_TOGGLES) || [
  ['swarm', 'Swarm'],
  ['modelDrivenSwarm', 'Model-driven swarm'],
  ['piNativeSwarm', 'Pi-native swarm'],
  ['multiModelSwarm', 'Multi-model swarm'],
  ['adaptiveModelRouter', 'Adaptive model router'],
  ['autonomousToolLoop', 'Autonomous tool loop'],
  ['worktreeSwarm', 'Worktree swarm'],
  ['deepResearch', 'Deep research'],
  ['experiments', 'Experiments'],
  ['visualArtifacts', 'Visual artifacts'],
  ['adaptiveSearch', 'Adaptive search'],
  ['verifierEvolution', 'Verifier evolution'],
  ['safeApply', 'Safe apply'],
  ['localMemoryGraph', 'Local memory graph'],
  ['nestedSwarmCells', 'Nested swarm cells'],
  ['backgroundEvolution', 'Background evolution (feature flag)'],
];
let harnessRenderScheduled = false;
let harnessState = {
  status: 'unknown',
  activeTasks: new Map(),
  subagents: new Map(),
  pendingApprovals: new Map(),
  artifacts: new Map(),
  latestEvents: [],
  currentApproval: null,
  verifierEvolution: {
    status: 'idle',
    latestScore: null,
    baselineScore: null,
    candidateScore: null,
    latestCandidateId: null,
    pendingVerifierPromotions: 0,
    visualVerifierArtifacts: [],
  },
  swarm: {
    selectedAttemptId: null,
    selectedEventKey: null,
    timelines: new Map(),
  },
  hierarchy: {
    localMeta: {
      status: 'idle',
      candidateCount: 0,
      cellId: null,
      attemptId: null,
    },
    memory: {
      status: 'idle',
      proposalCount: 0,
      cellId: null,
      attemptId: null,
    },
    experiments: {
      status: 'idle',
      runCount: 0,
      decision: null,
      experimentId: null,
    },
  },
  capabilityGoals: null,
  passK: null,
  productionEvidence: {},
  recursiveEvolutionEvidence: null,
  autonomyDashboard: null,
  autonomyLoop: {
    lastReplayDelta: null,
    autonomyLevel: 0,
    regressionCount: 0,
    livePolicyVersion: null,
    shadowPolicyVersion: null,
    sources: [],
    icrRan: false,
  },
  research: {
    activeTaskId: null,
    runs: [],
  },
};
const PRODUCTION_EVIDENCE_TYPES = [
  ['heldOutSuites', 'Held-out suites'],
  ['replayCycles', 'Replay cycles'],
  ['operatorDashboards', 'Operator dashboards'],
  ['visualSuites', 'Visual suites'],
  ['a2aStatus', 'A2A status'],
  ['modelCouncilCalibration', 'Council calibration'],
  ['endpointCapacity', 'Endpoint capacity'],
  ['autonomyRollback', 'Autonomy and rollback'],
  ['productionReports', 'Production paper-grade reports'],
  ['a2aPeerCycles', 'A2A peer cycles'],
  ['icrStatus', 'ICR test-time compute'],
];
const CAPABILITY_TYPES = [
  { id: 'skill', label: 'Skills' },
  { id: 'mcp', label: 'MCPs' },
  { id: 'pi_extension', label: 'Pi Extensions' },
  { id: 'profile', label: 'Profiles' },
  { id: 'template', label: 'Templates' },
  { id: 'slash_command', label: 'Slash Commands' },
];
let activeHarnessTab = 'run';
let harnessCapabilitiesLoaded = false;
let harnessCapabilities = [];
let harnessCapabilitiesRequestTimer = null;
let harnessSmitheryResults = [];
let harnessTraceState = {
  traces: [],
  selectedTaskId: null,
  selectedTrace: null,
  replayEvents: [],
  replayDecisions: [],
  replayCursor: 0,
  replayDone: true,
};
let harnessTracesLoaded = false;
let harnessTracesRequestTimer = null;
let harnessAdaptiveLoaded = false;
let harnessAdaptiveRequestTimer = null;
let harnessSkillCandidatesLoaded = false;
let harnessSkillCandidatesRequestTimer = null;
let harnessAdaptiveStatus = null;
let harnessSkillCandidates = [];
let assistantActivityTimer = null;
let assistantActivityHideTimer = null;
let assistantActivity = {
  phase: 'idle',
  detail: 'Waiting for a task.',
  startedAt: null,
  updatedAt: null,
  thinkingChars: 0,
  textChars: 0,
  toolCalls: 0,
  errors: 0,
  toolName: null,
};
let settingsState = {
  activeTab: 'connection',
  harnessConfig: null,
  workplaceStatus: null,
  connectionTestSocket: null,
  endpointTests: {},
  piModelsSummary: null,
  configDriftDismissed: false,
};
let activeAppMode = 'chat';
let sessionSearchQuery = '';
let capabilitiesAdvancedMode = false;

// ═══════════════════════════════════════════════════════════
// Debug
// ═══════════════════════════════════════════════════════════
const debugLog = [];
let connectTimeout = null;

function debug(msg) {
  const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(entry);
  debugLog.push(entry);
  if (debugLog.length > DEBUG_LOG_MAX) debugLog.splice(0, debugLog.length - DEBUG_LOG_MAX);
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

function formatActivityDuration(startedAt) {
  if (!startedAt) return '0s';
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function resetAssistantActivity() {
  assistantActivity = {
    phase: 'idle',
    detail: 'Waiting for a task.',
    startedAt: null,
    updatedAt: null,
    thinkingChars: 0,
    textChars: 0,
    toolCalls: 0,
    errors: 0,
    toolName: null,
  };
}

function ensureAssistantActivityTimer() {
  if (assistantActivityTimer) return;
  assistantActivityTimer = setInterval(renderAssistantActivity, 1000);
}

function stopAssistantActivityTimer() {
  if (!assistantActivityTimer) return;
  clearInterval(assistantActivityTimer);
  assistantActivityTimer = null;
}

function setAssistantActivity(patch = {}) {
  if (assistantActivityHideTimer) {
    clearTimeout(assistantActivityHideTimer);
    assistantActivityHideTimer = null;
  }
  const now = Date.now();
  assistantActivity = {
    ...assistantActivity,
    ...patch,
    startedAt: patch.startedAt === undefined ? (assistantActivity.startedAt || now) : patch.startedAt,
    updatedAt: now,
  };
  renderAssistantActivity();
  ensureAssistantActivityTimer();
}

function finishAssistantActivity(detail = 'Turn complete.') {
  setAssistantActivity({ phase: 'complete', detail, toolName: null });
  stopAssistantActivityTimer();
  assistantActivityHideTimer = setTimeout(() => {
    resetAssistantActivity();
    renderAssistantActivity();
  }, 6000);
}

function renderAssistantActivity() {
  if (!assistantActivityEl) return;
  if (assistantActivity.phase === 'idle') {
    assistantActivityEl.classList.add('hidden');
    return;
  }
  assistantActivityEl.classList.remove('hidden');
  assistantActivityEl.dataset.phase = assistantActivity.phase;
  const phaseLabels = {
    starting: 'Starting',
    thinking: 'Thinking',
    writing: 'Writing',
    tool: 'Using tool',
    waiting: 'Waiting',
    error: 'Error',
    complete: 'Complete',
  };
  if (assistantActivityPhase) {
    assistantActivityPhase.textContent = phaseLabels[assistantActivity.phase] || assistantActivity.phase;
  }
  if (assistantActivityDetail) assistantActivityDetail.textContent = assistantActivity.detail || '';
  const metrics = [
    formatActivityDuration(assistantActivity.startedAt),
    assistantActivity.thinkingChars ? `thinking ${assistantActivity.thinkingChars} chars` : null,
    assistantActivity.textChars ? `writing ${assistantActivity.textChars} chars` : null,
    assistantActivity.toolCalls ? `${assistantActivity.toolCalls} tool${assistantActivity.toolCalls === 1 ? '' : 's'}` : null,
    assistantActivity.toolName ? `current ${assistantActivity.toolName}` : null,
    assistantActivity.errors ? `${assistantActivity.errors} error${assistantActivity.errors === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  if (assistantActivityMetrics) assistantActivityMetrics.textContent = metrics.join(' | ');
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

try {
  const storedAutoHarness = localStorage.getItem(LS_AUTO_HARNESS);
  if (storedAutoHarness !== null) autoHarnessEnabled = storedAutoHarness === 'true';
  settingsState.configDriftDismissed = localStorage.getItem(STORAGE_CONFIG_DRIFT_DISMISSED) === '1';
} catch {}

function loadStoredConnectionPrefs() {
  try {
    const savedUrl = localStorage.getItem(STORAGE_SERVER_URL);
    const savedWorkspace = localStorage.getItem(STORAGE_WORKSPACE_PATH);
    serverUrlInput.value = savedUrl || `ws://${location.host}`;
    if (savedWorkspace && workspacePathInput) {
      workspacePathInput.value = savedWorkspace;
      workspacePath = savedWorkspace;
      syncWorkspaceInputs(savedWorkspace);
    }
  } catch (error) {
    serverUrlInput.value = `ws://${location.host}`;
    debug('Failed to load stored connection prefs: ' + error.message);
  }
}

function persistConnectionPrefs() {
  try {
    if (serverUrl) localStorage.setItem(STORAGE_SERVER_URL, serverUrl);
    if (workspacePath) localStorage.setItem(STORAGE_WORKSPACE_PATH, workspacePath);
  } catch (error) {
    debug('Failed to persist connection prefs: ' + error.message);
  }
}

loadStoredConnectionPrefs();

window.setServerUrl = function(host) {
  const port = host.includes(':') ? '' : ':3777';
  serverUrlInput.value = `ws://${host}${port}`;
  serverUrlInput.focus();
};

function startConnection() {
  serverUrl = serverUrlInput.value.trim();
  workspacePath = workspacePathInput?.value?.trim() || '';
  syncWorkspaceInputs(workspacePath);
  persistConnectionPrefs();
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
const streamingModeHint = $('#streaming-mode-hint');
const sessionTitle = $('#session-title');
const assistantActivityEl = $('#assistant-activity');
const assistantActivityPhase = $('#assistant-activity-phase');
const assistantActivityDetail = $('#assistant-activity-detail');
const assistantActivityMetrics = $('#assistant-activity-metrics');
const modelDisplay = $('#model-display');
const thinkingDisplay = $('#thinking-display');
const scrollSentinel = $('#scroll-sentinel');
const pinnedList = $('#pinned-list');
const recentsList = $('#recents-list');
const sidebarEl = $('#sidebar');
const sidebarOverlay = $('#sidebar-overlay');
const sidebarToggle = $('#btn-sidebar-toggle');
let sessions = []; // Session list for sidebar
const sessionCollapsedParents = new Set();
const userStatus = $('#user-status');
const statusChipConnection = $('#status-chip-connection');
const statusChipSidecar = $('#status-chip-sidecar');
const statusChipApprovals = $('#status-chip-approvals');
const harnessPanelFooter = $('#harness-panel-footer');
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
const harnessVerifierEvolutionStatus = $('#harness-verifier-evolution-status');
const harnessVerifierLatestScore = $('#harness-verifier-latest-score');
const harnessVerifierBaselineComparison = $('#harness-verifier-baseline-comparison');
const harnessVerifierPendingPromotions = $('#harness-verifier-pending-promotions');
const harnessVerifierArtifacts = $('#harness-verifier-artifacts');
const harnessSubagentCount = $('#harness-subagent-count');
const harnessSubagents = $('#harness-subagents');
const harnessEvents = $('#harness-events');
const harnessTaskInput = $('#harness-task-input');
const harnessDeepTaskInput = $('#harness-deep-task-input');
const harnessDeepToolCalls = $('#harness-deep-tool-calls');
const harnessDeepMinutes = $('#harness-deep-minutes');
const harnessDeepScopeInclude = $('#harness-deep-scope-include');
const harnessDeepScopeExclude = $('#harness-deep-scope-exclude');
const harnessDeepMaxSources = $('#harness-deep-max-sources');
const harnessDeepMaxTokens = $('#harness-deep-max-tokens');
const harnessDeepOutputFormat = $('#harness-deep-output-format');
const harnessDeepStatus = $('#harness-deep-status');
const harnessDeepRunBadge = $('#harness-deep-run-badge');
const harnessDeepRunSummary = $('#harness-deep-run-summary');
const harnessDeepRunMetrics = $('#harness-deep-run-metrics');
const harnessDeepRunEvents = $('#harness-deep-run-events');
const harnessDeepPipeline = $('#harness-deep-pipeline');
const harnessDeepPipelineStatus = $('#harness-deep-pipeline-status');
const harnessDeepArtifacts = $('#harness-deep-artifacts');

const DEEP_RESEARCH_PRESETS = {
  quick: { maxToolCalls: 40, maxWallMinutes: 20, maxSources: 8, maxInputTokens: 120000 },
  standard: { maxToolCalls: 80, maxWallMinutes: 45, maxSources: 16, maxInputTokens: 200000 },
  literature: { maxToolCalls: 120, maxWallMinutes: 60, maxSources: 24, maxInputTokens: 250000 },
  deep: { maxToolCalls: 150, maxWallMinutes: 90, maxSources: 32, maxInputTokens: 320000 },
};

const DEEP_RESEARCH_PIPELINE = [
  { id: 'brief', label: 'Brief & scope', description: 'Restate question, inclusions, and output contract.', events: ['task.started'] },
  { id: 'discovery', label: 'Source discovery', description: 'Map workspace corpus and approved connectors.', events: [] },
  { id: 'ingestion', label: 'Source ingestion', description: 'Fetch pages, claims, and figure candidates.', events: [] },
  { id: 'audit', label: 'Citation audit', description: 'Verify claim coverage and evidence quality.', events: ['research.report_created'] },
  { id: 'contradictions', label: 'Contradiction review', description: 'Surface conflicts and stale evidence.', events: [] },
  { id: 'handoff', label: 'Report & handoff', description: 'Compile bibliography and implementation recommendations.', events: ['research.v2_artifacts_created', 'research.handoff_created'] },
];

const DEEP_RESEARCH_SETTINGS_KEY = 'helios_deep_research_settings';
const harnessCapabilityStatus = $('#harness-capability-status');
const harnessCapabilityForm = $('#harness-capability-form');
const capabilityInstallQuery = $('#capability-install-query');
const capabilitySmitheryKey = $('#capability-smithery-key');
const capabilitySmitheryResults = $('#capability-smithery-results');
const harnessTraceStatus = $('#harness-trace-status');
const harnessTraceList = $('#harness-trace-list');
const harnessTraceEvents = $('#harness-trace-events');
const harnessTraceEventCount = $('#harness-trace-event-count');
const harnessTraceCostCount = $('#harness-trace-cost-count');
const harnessTraceContextCount = $('#harness-trace-context-count');
const harnessAdaptiveSelectedArm = $('#harness-adaptive-selected-arm');
const harnessAdaptiveMode = $('#harness-adaptive-mode');
const harnessAdaptiveReward = $('#harness-adaptive-reward');
const harnessAdaptiveArmBalance = $('#harness-adaptive-arm-balance');
const harnessAdaptiveNote = $('#harness-adaptive-note');
const harnessProductionEvidenceStatus = $('#harness-production-evidence-status');
const harnessProductionEvidenceSummary = $('#harness-production-evidence-summary');
const harnessProductionEvidenceRows = $('#harness-production-evidence-rows');
const harnessSwarmActivity = $('#harness-swarm-activity');
const harnessSwarmActivityList = $('#harness-swarm-activity-list');
const harnessSwarmLiveStrip = $('#harness-swarm-live-strip');
const harnessSwarmLiveText = $('#harness-swarm-live-text');
const harnessSkillCandidatesEl = $('#harness-skill-candidates');
const harnessPiBridgeStateEl = $('#harness-pi-bridge-state');
const harnessPromotionQueueEl = $('#harness-promotion-queue');
const harnessAbMctsReplayStatus = $('#harness-abmcts-replay-status');
const harnessAbMctsDecisions = $('#harness-abmcts-decisions');
const harnessSwarmStatus = $('#harness-swarm-status');
const harnessSwarmActiveCount = $('#harness-swarm-active-count');
const harnessSwarmAttempts = $('#harness-swarm-attempts');
const harnessSwarmAttemptDetail = $('#harness-swarm-attempt-detail');
const harnessSwarmDetailSummary = $('#harness-swarm-detail-summary');
const harnessSwarmInspectorMetadata = $('#harness-swarm-inspector-metadata');
const harnessSwarmTimeline = $('#harness-swarm-timeline');
const harnessSwarmThinking = $('#harness-swarm-thinking');
const harnessSwarmActions = $('#harness-swarm-actions');
const harnessSwarmHandoff = $('#harness-swarm-handoff');
const harnessSwarmEventInspector = $('#harness-swarm-event-inspector');
let harnessRecursiveEvolutionEvidenceStatus = null;
let harnessRecursiveEvolutionEvidenceRows = null;
let harnessAutonomyDashboardStatus = null;
let harnessAutonomyDashboardRows = null;
let harnessAutonomyLoopRow = null;
const harnessLocalMetaStatus = $('#harness-local-meta-status');
const harnessLocalMetaCandidates = $('#harness-local-meta-candidates');
const harnessLocalMetaCell = $('#harness-local-meta-cell');
const harnessMemoryHierarchyStatus = $('#harness-memory-hierarchy-status');
const harnessMemoryProposals = $('#harness-memory-proposals');
const harnessMemorySource = $('#harness-memory-source');
const harnessExperimentsStatus = $('#harness-experiments-status');
const harnessExperimentRuns = $('#harness-experiment-runs');
const harnessExperimentDecision = $('#harness-experiment-decision');
const harnessCapabilityGoalsStatus = $('#harness-capability-goals-status');
const harnessCapabilityGoalsImplemented = $('#harness-capability-goals-implemented');
const harnessCapabilityGoalsOpen = $('#harness-capability-goals-open');
const harnessCapabilityGoalRows = $('#harness-capability-goal-rows');
const workspaceInput = document.getElementById('workspace-input');
const workspaceBreadcrumb = document.getElementById('workspace-breadcrumb');
const sessionSearchInput = document.getElementById('session-search');
const sessionTitleBar = document.getElementById('session-title-bar');
const sessionTitleInput = document.getElementById('session-title-input');
const modeNav = document.getElementById('mode-nav');
const topbarHarnessBar = document.getElementById('topbar-harness-bar');
const configDriftBanner = document.getElementById('config-drift-banner');
const configDriftText = document.getElementById('config-drift-text');
const cdnOfflineBanner = document.getElementById('cdn-offline-banner');
const harnessSwarmConfigBanner = document.getElementById('harness-swarm-config-banner');
const harnessSwarmConfigBannerText = document.getElementById('harness-swarm-config-banner-text');
const capabilityViewMode = document.getElementById('capability-view-mode');
const capabilityInstallSection = document.getElementById('harness-capability-install');
const settingsPiModelsSummary = document.getElementById('settings-pi-models-summary');
const settingsSmitheryKey = document.getElementById('settings-smithery-key');

// ═══════════════════════════════════════════════════════════
// Workspace Input Handler
// ═══════════════════════════════════════════════════════════
function truncatePath(path, maxLen = 28) {
  const value = String(path || '').trim();
  if (!value) return 'workspace';
  if (value.length <= maxLen) return value;
  return '…' + value.slice(-(maxLen - 1));
}

function syncWorkspaceInputs(path) {
  if (workspacePathInput) workspacePathInput.value = path || '';
  if (workspaceInput) workspaceInput.value = path || '';
  if (workspaceBreadcrumb) workspaceBreadcrumb.textContent = truncatePath(path);
  const settingsPathEl = document.getElementById('settings-workspace-path');
  if (settingsPathEl) settingsPathEl.value = path || '';
  updateWelcomeWorkspace(path);
}

function updateWelcomeWorkspace(path = getSelectedWorkspacePath()) {
  const welcome = messagesEl?.querySelector('.welcome');
  if (!welcome) return;
  const target = welcome.querySelector('.welcome-workspace');
  if (!target) return;
  const wsPath = String(path || '').trim();
  if (wsPath) {
    target.innerHTML = `Workplace: <code>${esc(wsPath)}</code>`;
  } else {
    target.textContent = 'Set your workplace path in the composer or connection dialog.';
  }
}

function getSelectedWorkspacePath() {
  const latest = settingsWorkspacePathInput?.value?.trim()
    || workspaceInput?.value?.trim()
    || workspacePathInput?.value?.trim()
    || workspacePath
    || '';
  if (latest && latest !== workspacePath) {
    workspacePath = latest;
    syncWorkspaceInputs(workspacePath);
  }
  return workspacePath;
}

function applyWorkspaceSelection(path, { notify = true } = {}) {
  const nextWorkspace = String(path || '').trim();
  if (!nextWorkspace) return;
  const changed = nextWorkspace !== workspacePath;
  workspacePath = nextWorkspace;
  syncWorkspaceInputs(workspacePath);
  persistConnectionPrefs();
  debug('Workspace changed to: ' + workspacePath);
  if (ws?.readyState === WebSocket.OPEN) {
    send({ type: 'set_workspace', path: workspacePath });
    send({ type: 'get_session_files' });
    if (activeHarnessTab === 'capabilities') requestHarnessCapabilities();
    if (activeHarnessTab === 'traces') requestHarnessTraces();
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
  if (ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(ws.readyState)) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  resetConnectTimeout();
  debug(`WS: Connecting to ${serverUrl}...`);
  const socket = new WebSocket(serverUrl);
  ws = socket;

  socket.onopen = () => debug('WS: Open ✓');
  socket.onclose = (e) => {
    const closingSocket = socket;
    debug(`WS: Closed (code=${e.code})`);
    if (ws === closingSocket) ws = null;
    isConnected = false; isStreaming = false;
    setStatus('disconnected', 'Disconnected');
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  };
  socket.onerror = () => debug('WS: Error ✗');
  socket.onmessage = (e) => {
    if (socket !== ws) return;
    try {
      const msg = JSON.parse(e.data);
      if (!WS_DEBUG_SKIP.has(msg.type)) debug(`WS: ${describeWsMessage(msg)}`);
      handleMessage(msg);
    } catch (err) { debug(`WS: Parse error: ${err.message}`); }
  };
}

function describeWsMessage(msg) {
  const suffix = msg.event?.type || (typeof msg.event === 'string' ? msg.event : '');
  return `${msg.type || 'unknown'}${suffix ? '/' + suffix : ''}`;
}

function send(msg) {
  if (ws?.readyState !== WebSocket.OPEN) {
    toast('Not connected to Helios Forge', 'error');
    return false;
  }
  try {
    ws.send(JSON.stringify(msg));
    return true;
  } catch (error) {
    toast(`Failed to send message: ${error.message}`, 'error');
    debug(`WS: Send failed (${error.message})`);
    return false;
  }
}

function setStatus(state, text) {
  connectionState = state;
  userStatus.textContent = text;
  userStatus.className = 'user-status ' + state;
  if (connectionBanner) {
    if (state === 'connected') {
      connectionBanner.className = 'connection-banner hidden';
    } else {
      connectionBanner.className = 'connection-banner ' + state;
      connectionText.textContent = state === 'connecting' ? 'Connecting to Helios Forge...'
        : state === 'error' ? text || 'Connection error'
        : 'Disconnected — reconnecting...';
    }
  }
  inputEl.disabled = state !== 'connected';
  updateGlobalStatusBar();
}

function updateGlobalStatusBar() {
  const connectionLabels = {
    connected: 'Connected',
    connecting: 'Connecting',
    disconnected: 'Disconnected',
    error: 'Error',
  };
  if (statusChipConnection) {
    statusChipConnection.dataset.state = connectionState;
    statusChipConnection.textContent = connectionLabels[connectionState] || connectionState;
  }
  if (statusChipSidecar) {
    const status = harnessState.status || 'unknown';
    statusChipSidecar.dataset.state = status;
    statusChipSidecar.textContent = status === 'running' ? 'Sidecar running' : `Sidecar ${status}`;
  }
  if (statusChipApprovals) {
    const count = harnessState.pendingApprovals.size;
    statusChipApprovals.dataset.state = count > 0 ? 'pending' : 'none';
    statusChipApprovals.textContent = `${count} approval${count === 1 ? '' : 's'}`;
  }
}

function updateHarnessPanelFooterVisibility() {
  if (!harnessPanelFooter) return;
  const showFooter = activeHarnessTab === 'run' || activeHarnessTab === 'swarm';
  harnessPanelFooter.classList.toggle('hidden', !showFooter);
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
        getHarnessConfig();
        loadStoredSmitheryKey();
        setCapabilitiesViewMode(false);
        checkCdnOffline();
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
    currentModel = msg.data;
    settingsState.configDriftDismissed = false;
    updateHeader();
    closeDropdowns();
    toast(`Model: ${currentModel.name || currentModel.id}`, 'success');
    return;
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
        applyWorkspaceSelection(msg.state.cwd, { notify: false });
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
    if (msg.path) {
      workspacePath = msg.path;
      syncWorkspaceInputs(workspacePath);
    }
    send({ type: 'harness_status' });
    if (msg.bridge?.repaired) {
      toast('Helios workplace repaired — deep research skills installed', 'success');
    } else {
      toast('Workspace set', 'success');
    }
    return;
  }
  if (msg.type === 'session_deleted' && msg.success) {
    toast('Session deleted', 'success');
    return;
  }
  if (msg.type === 'session_files' && msg.data?.sessions) {
    if (typeof sessions === 'undefined') sessions = [];
    const repaired = msg.data.sessionLinksRepaired;
    if (repaired?.added > 0) {
      toast(`Organized ${repaired.added} subagent chat${repaired.added === 1 ? '' : 's'} under parent sessions`, 'info');
    }
    renderPiSessions(msg.data.sessions);
    return;
  }
  if (msg.type === 'harness_status' && msg.data) {
    updateHarnessStatus(msg.data);
    return;
  }
  if (msg.type === 'harness_task_started' && msg.data) {
    harnessState.activeTasks.set(msg.data.taskId, msg.data);
    if (msg.data.source === 'deep_research_ui') {
      ensureDeepResearchRun({
        taskId: msg.data.taskId,
        question: compactText(msg.data.task || msg.data.summary || 'Research run', 'Research run'),
      });
      if (harnessDeepStatus) harnessDeepStatus.textContent = `Run ${compactText(msg.data.taskId, msg.data.taskId)} started`;
    }
    scheduleHarnessRender({ immediate: true });
    toast(msg.data.source === 'deep_research_ui' ? 'Deep research started' : 'Harness task started', 'success');
    return;
  }
  if (msg.type === 'harness_task_event' && msg.event) {
    handleHarnessEvent(msg.event);
    return;
  }
  if (msg.type === 'harness_approval_resolved' && msg.data) {
    harnessState.pendingApprovals.delete(msg.data.actionId);
    closeModal('harness-approval');
    scheduleHarnessRender({ immediate: true });
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
  if (msg.type === 'harness_smithery_results') {
    handleHarnessSmitheryResults(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_adaptive_search_status') {
    handleHarnessAdaptiveSearchStatus(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_model_council_passk_eval') {
    handleHarnessModelCouncilPassKEval(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_production_evidence') {
    handleHarnessProductionEvidence(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_evidence_refresh') {
    handleHarnessRecursiveEvolutionEvidence(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_skill_candidates') {
    handleHarnessSkillCandidates(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_pi_bridge_state') {
    handleHarnessPiBridgeState(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_promotion_queue') {
    handleHarnessPromotionQueue(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_skill_candidate_reviewed') {
    handleHarnessSkillCandidateReviewed(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_traces') {
    handleHarnessTraces(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_trace') {
    handleHarnessTrace(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_trace_replay') {
    handleHarnessTraceReplay(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_abmcts_replay') {
    handleHarnessTraceReplay(msg.data || msg);
    return;
  }
  if (msg.type === 'harness_workplace_status' && msg.data) {
    handleHarnessWorkplaceStatus(msg.data);
    return;
  }
  if (msg.type === 'harness_workplace_initialized' && msg.data) {
    handleHarnessWorkplaceInitialized(msg.data);
    return;
  }
  if (msg.type === 'harness_config' && msg.data) {
    handleHarnessConfig(msg.data);
    return;
  }
  if (msg.type === 'harness_config_updated' && msg.data) {
    handleHarnessConfigUpdated(msg.data);
    return;
  }
  if (msg.type === 'harness_config_reloaded') {
    handleHarnessConfigReloaded(msg.data || {});
    return;
  }
  if (msg.type === 'harness_workplace_repaired' && msg.data) {
    handleHarnessWorkplaceRepaired(msg.data);
    return;
  }
  if (msg.type === 'harness_endpoint_test_result' && msg.data) {
    handleHarnessEndpointTestResult(msg.data);
    return;
  }
  if (msg.type === 'pi_models_summary' && msg.data) {
    handlePiModelsSummary(msg.data);
    return;
  }

  // Agent events
  switch (msg.type) {
    case 'agent_start':
      isStreaming = true;
      resetAssistantActivity();
      setAssistantActivity({ phase: 'starting', detail: 'Waiting for assistant response.' });
      updateInput();
      showLoading();
      break;
    case 'agent_end':
      isStreaming = false; pendingToolCalls.clear();
      activeThinking = null; activeStream = null;
      finishAssistantActivity(assistantActivity.errors ? 'Turn ended with errors.' : 'Turn complete.');
      updateInput(); hideLoading();
      // Refresh sessions after response completes (new session may have been created)
      setTimeout(() => send({ type: 'get_session_files' }), 1000);
      break;
    case 'turn_start': 
      activeStream = null; 
      activeThinking = null;
      setAssistantActivity({ phase: 'starting', detail: 'Turn started.' });
      break;
    case 'turn_end':
      if (activeStream) finalizeStream();
      setAssistantActivity({ phase: 'waiting', detail: 'Finishing turn.' });
      break;
    case 'message_start':
      if (msg.message.role === 'assistant') {
        const el = createAssistantMsg();
        activeStream = { el, contentEl: el.querySelector('.msg-content'), text: '', textEl: null, liveEl: null };
        setAssistantActivity({ phase: 'writing', detail: 'Assistant message opened.' });
      }
      break;
    case 'message_update': handleMessageUpdate(msg); break;
    case 'message_end': handleMessageEnd(msg); break;
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
  if (status.capabilityGoals) harnessState.capabilityGoals = status.capabilityGoals;
  scheduleHarnessRender({ immediate: true });
}

function scheduleHarnessRender({ immediate = false } = {}) {
  if (immediate) {
    harnessRenderScheduled = false;
    renderHarnessPanel();
    return;
  }
  if (harnessRenderScheduled) return;
  harnessRenderScheduled = true;
  const run = () => {
    harnessRenderScheduled = false;
    renderHarnessPanel();
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run);
  } else {
    setTimeout(run, 16);
  }
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

  if (event.type === 'model_council.enabled') {
    event.summary = event.summary || `model council ${event.enabled ? 'enabled' : 'disabled'} (${event.roleCount || 0} roles)`;
  }
  if (event.type === 'model_council.report_created') {
    event.summary = event.summary || `model council report: ${event.modelDiversity?.uniqueModelProfiles || 0} model profiles`;
  }

  if (event.type === 'icr.lane_completed') {
    event.summary = formatIcrLaneEvent(event);
  }
  if (event.type === 'recursive_evolution.coordinated') {
    event.summary = formatRecursiveEvolutionCoordinatedEvent(event);
  }
  if (event.type?.startsWith('research.')) {
    event.summary = formatDeepResearchEventSummary(event);
  }
  updateDeepResearchFromEvent(event);
  updateAutonomyLoopFromEvent(event);

  updateHarnessSubagent(event);
  pruneHarnessSubagents();
  updateHarnessVerifierEvolution(event);
  updateHarnessPolicyEvolution(event);
  updateHarnessAdaptiveSearch(event);
  updateHarnessSkillCandidateEvents(event);
  updateHarnessAbMctsReplayEvents(event);
  updateHarnessHierarchyFeedback(event);

  if (event.type === 'approval.required') {
    harnessState.pendingApprovals.set(event.actionId, event);
    harnessState.currentApproval = event;
    renderHarnessApproval(event);
    openModal('harness-approval');
    updateHarnessVerifierEvolution(event);
  }

  if (event.type === 'approval.resolved') {
    harnessState.pendingApprovals.delete(event.actionId);
    updateHarnessVerifierEvolution(event);
  }

  scheduleHarnessRender();
}

function asHarnessEventArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function replayDeltaFromReport(report = {}) {
  const delta = report.aggregateDelta ?? report.scoreDelta ?? report.delta;
  const numeric = Number(delta);
  return Number.isFinite(numeric) ? numeric : null;
}

function latestReplayDeltaFromPayload(payload = {}) {
  const coordinatedReports = asHarnessEventArray(payload.coordinated?.replayReports);
  const coordinatedDelta = coordinatedReports.map(replayDeltaFromReport).filter((value) => value !== null).at(-1);
  if (coordinatedDelta !== undefined && coordinatedDelta !== null) return coordinatedDelta;

  const ranEntries = asHarnessEventArray(payload.ran);
  const ranDelta = ranEntries.map((entry) => replayDeltaFromReport(entry.report || entry)).filter((value) => value !== null).at(-1);
  return ranDelta ?? null;
}

function formatReplayDelta(delta) {
  if (delta === null || delta === undefined) return 'n/a';
  const numeric = Number(delta);
  if (!Number.isFinite(numeric)) return 'n/a';
  const prefix = numeric > 0 ? '+' : '';
  return `${prefix}${numeric.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function policyVersionLabel(value) {
  if (value === undefined || value === null || value === '') return 'n/a';
  if (typeof value === 'object') {
    return value.schemaVersion ?? value.updatedAt ?? value.version ?? 'n/a';
  }
  const text = String(value);
  return text.split('/').pop() || text;
}

function formatIcrLaneEvent(event = {}) {
  const raw = event.summary;
  if (typeof raw === 'string') return raw;
  const summary = raw && typeof raw === 'object' ? raw : {};
  const branchCount = summary.branchCount ?? '?';
  const costGate = summary.costGateStatus || 'unknown';
  const parts = [`ICR lane: ${branchCount} branches`, `cost gate ${costGate}`];
  if (summary.rhoUpliftHeadline) {
    parts.push(`rho uplift ${summary.rhoUpliftHeadline}`);
  }
  if (summary.finalCandidateId) {
    parts.push(`candidate ${compactText(summary.finalCandidateId, summary.finalCandidateId)}`);
  } else if (summary.candidateFamilyId) {
    parts.push(`family ${compactText(summary.candidateFamilyId, summary.candidateFamilyId)}`);
  }
  return parts.join(' | ');
}

function formatRecursiveEvolutionCoordinatedEvent(event = {}) {
  const coordinated = event.coordinated || {};
  const sources = asHarnessEventArray(coordinated.sources).map((source) => String(source || '').trim()).filter(Boolean);
  if (harnessState.autonomyLoop.icrRan && !sources.includes('icr')) {
    sources.push('icr');
  }
  if (!sources.length) {
    return event.coordinated == null
      ? 'recursive evolution coordinated (none) | replay, campaign, icr pending'
      : 'recursive evolution coordinated (none) | replay, campaign, icr';
  }
  const ordered = ['replay', 'campaign', 'icr', 'promotion_loop']
    .filter((key) => sources.includes(key))
    .concat(sources.filter((key) => !['replay', 'campaign', 'icr', 'promotion_loop'].includes(key)));
  return `recursive evolution coordinated (${ordered.join(', ')}) | sources: replay, campaign, icr`;
}

function updateAutonomyLoopFromEvent(event = {}) {
  const loop = harnessState.autonomyLoop;
  if (event.type === 'icr.lane_completed') {
    loop.icrRan = true;
  }
  if (event.type === 'replay.cycle_completed') {
    const delta = latestReplayDeltaFromPayload(event);
    if (delta !== null) loop.lastReplayDelta = delta;
    const regressions = asHarnessEventArray(event.ran)
      .flatMap((entry) => asHarnessEventArray(entry.report?.regressions));
    if (regressions.length) {
      loop.regressionCount = (loop.regressionCount || 0) + regressions.length;
    }
  }
  if (event.type === 'recursive_evolution.coordinated') {
    loop.sources = asHarnessEventArray(event.coordinated?.sources);
    if (loop.icrRan && !loop.sources.includes('icr')) {
      loop.sources = [...loop.sources, 'icr'];
    }
    const delta = latestReplayDeltaFromPayload(event);
    if (delta !== null) loop.lastReplayDelta = delta;
    const regressions = asHarnessEventArray(event.coordinated?.replayReports)
      .flatMap((report) => asHarnessEventArray(report.regressions));
    if (regressions.length) {
      loop.regressionCount = regressions.length;
    }
  }
  if (event.type === 'partial_autonomy.applied') {
    loop.shadowPolicyVersion = policyVersionLabel(
      event.shadowPolicyVersion ?? event.shadowPolicy ?? event.shadowPolicyPath ?? loop.shadowPolicyVersion,
    );
    loop.livePolicyVersion = policyVersionLabel(
      event.livePolicyVersion ?? event.livePolicy ?? event.livePolicyPath ?? loop.livePolicyVersion,
    );
    const level = event.autonomyLevel ?? event.level ?? event.partialAutonomy?.level;
    if (level !== undefined && level !== null) loop.autonomyLevel = level;
  }
}

function renderAutonomyLoopStatus() {
  ensureAutonomyDashboardPanel();
  if (!harnessAutonomyLoopRow) return;

  const loop = harnessState.autonomyLoop || {};
  const accumulator = harnessState.autonomyDashboard?.accumulator || {};
  const regressionCount = loop.regressionCount ?? accumulator.regressionCount ?? 0;
  const autonomyLevel = loop.autonomyLevel ?? accumulator.autonomyLevel ?? accumulator.level ?? 0;
  const lastReplayDelta = formatReplayDelta(
    loop.lastReplayDelta ?? accumulator.lastReplayDelta ?? accumulator.latestImprovementDelta,
  );
  const livePolicyVersion = policyVersionLabel(loop.livePolicyVersion ?? accumulator.livePolicyVersion);
  const shadowPolicyVersion = policyVersionLabel(loop.shadowPolicyVersion ?? accumulator.shadowPolicyVersion);
  const sources = asHarnessEventArray(loop.sources);
  const sourceSummary = sources.length
    ? sources.join(', ')
    : (loop.icrRan ? 'icr' : 'replay, campaign, icr pending');

  harnessAutonomyLoopRow.innerHTML = `
    <div>
      <strong>Autonomy loop</strong>
      <span>delta ${esc(lastReplayDelta)} | level ${esc(String(autonomyLevel))} | regressions ${esc(String(regressionCount))}</span>
    </div>
    <span>live ${esc(String(livePolicyVersion))} | shadow ${esc(String(shadowPolicyVersion))} | sources ${esc(sourceSummary)}</span>
  `;
}

function updateHarnessPolicyEvolution(event) {
  if (event.type === 'swarm.evolution_planning_created') {
    event.summary = `evolution planning ${event.strategy || 'created'} | ${event.attemptCount || 0} attempts`;
  }
  if (event.type === 'swarm.outcome_recorded') {
    event.summary = `${event.hardCaseCount || 0} hard cases | ${event.positiveSignalCount || 0} positive signals`;
  }
  if (event.type === 'policy_evolution.summary') {
    const autoApprovalEligibility = event.autoApprovalEligibility;
    const eligibility = autoApprovalEligibility?.status ? ` | auto approval ${autoApprovalEligibility.status}` : '';
    event.summary = `shadow policy feedback${eligibility}`;
  }
}

function isVerifierPromotionApproval(event) {
  const action = event?.proposedAction || event?.payload || {};
  return event?.kind === 'verifier_config_apply'
    || action.kind === 'verifier_config_apply'
    || action.tool === 'verifier_config_apply'
    || action.type === 'verifier_config_apply';
}

function scoreValue(value) {
  if (Number.isFinite(value)) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatScore(value) {
  const score = scoreValue(value);
  return score === null ? 'n/a' : score.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function metricScore(source = {}) {
  return scoreValue(source.score)
    ?? scoreValue(source.candidateScore)
    ?? scoreValue(source.metrics?.score)
    ?? scoreValue(source.metrics?.f1)
    ?? scoreValue(source.metrics?.precision)
    ?? scoreValue(source.result?.score);
}

function visualArtifactRecords(event = {}) {
  return (event.artifacts || []).filter(artifact => {
    const type = String(artifact.type || artifact.title || '').toLowerCase();
    return type.includes('visual')
      || type.includes('screenshot')
      || type.includes('image')
      || type.includes('pdf')
      || type.includes('diff');
  });
}

function updateHarnessVerifierEvolution(event) {
  const state = harnessState.verifierEvolution;
  const visualArtifacts = visualArtifactRecords(event);
  if (visualArtifacts.length) {
    state.visualVerifierArtifacts = [...visualArtifacts, ...state.visualVerifierArtifacts]
      .filter((artifact, index, all) => all.findIndex(item => item.artifactId === artifact.artifactId) === index)
      .slice(0, 4);
  }

  if (event.type === 'verifier_evolution.started') {
    state.status = 'running';
  }
  if (event.type === 'verifier_evolution.candidate_completed') {
    state.status = event.status || 'candidate completed';
    state.latestCandidateId = event.candidateId || event.genomeId || state.latestCandidateId;
    state.latestScore = metricScore(event);
    state.candidateScore = scoreValue(event.candidateScore) ?? metricScore(event) ?? state.candidateScore;
    state.baselineScore = scoreValue(event.baselineScore) ?? scoreValue(event.baseline?.score) ?? state.baselineScore;
  }
  if (event.type === 'verifier_evolution.promotion_evaluated') {
    state.status = event.approved || event.passed ? 'promotion eligible' : event.reason || 'promotion blocked';
    state.latestCandidateId = event.candidateId || state.latestCandidateId;
    state.candidateScore = scoreValue(event.candidateScore) ?? scoreValue(event.candidate?.score) ?? state.candidateScore;
    state.baselineScore = scoreValue(event.baselineScore) ?? scoreValue(event.baseline?.score) ?? state.baselineScore;
  }
  if (event.type === 'verifier_evolution.proposal_created') {
    state.status = 'awaiting approval';
    state.latestCandidateId = event.candidateId || state.latestCandidateId;
  }
  if (event.type === 'approval.required' || event.type === 'approval.resolved') {
    state.pendingVerifierPromotions = Array.from(harnessState.pendingApprovals.values())
      .filter(isVerifierPromotionApproval).length;
  }
}

function updateHarnessHierarchyFeedback(event) {
  if (event.type === 'local_meta.completed') {
    harnessState.hierarchy.localMeta = {
      status: 'completed',
      candidateCount: event.candidateCount ?? (event.candidates || []).length,
      cellId: event.cellId || null,
      attemptId: event.attemptId || null,
    };
    event.summary = event.summary || `${harnessState.hierarchy.localMeta.candidateCount} local meta candidates`;
  }

  if (event.type === 'local_memory.proposed') {
    harnessState.hierarchy.memory = {
      status: 'pending global review',
      proposalCount: event.proposalCount ?? (event.memoryProposals || []).length,
      cellId: event.cellId || null,
      attemptId: event.attemptId || null,
    };
    event.summary = event.summary || `${harnessState.hierarchy.memory.proposalCount} memory proposals`;
  }

  if (event.type === 'harness_experiment.completed' || event.type === 'experiment.decision_written') {
    const current = harnessState.hierarchy.experiments;
    harnessState.hierarchy.experiments = {
      status: event.status || 'completed',
      runCount: current.runCount + 1,
      decision: event.decision?.status || event.decision?.conclusion || event.result || event.status || 'completed',
      experimentId: event.experimentId || current.experimentId,
    };
    event.summary = event.summary || `experiment ${harnessState.hierarchy.experiments.decision}`;
  }

  if (event.type === 'harness_status.updated' && event.capabilityGoals) {
    harnessState.capabilityGoals = event.capabilityGoals;
  }
}

function swarmTimelineEntry(event) {
  return {
    type: event.type || 'event',
    phase: event.phase || event.status || event.type || 'event',
    severity: event.severity || (event.failure ? 'error' : 'info'),
    summary: event.summary || event.reason || event.intent || event.result || event.failure?.message || '',
    timestamp: event.timestamp || event.completedAt || event.startedAt || new Date().toISOString(),
    details: event.details || null,
  };
}

function recordSwarmTimeline(event) {
  if (!event?.attemptId) return;
  const current = harnessState.swarm.timelines.get(event.attemptId) || [];
  harnessState.swarm.timelines.set(event.attemptId, [
    swarmTimelineEntry(event),
    ...current,
  ].slice(0, 80));
}

function selectSwarmAttempt(attemptId) {
  if (!attemptId) return;
  if (!harnessState.swarm.selectedAttemptId || !harnessState.subagents.has(harnessState.swarm.selectedAttemptId)) {
    harnessState.swarm.selectedAttemptId = attemptId;
  }
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
        planning: attempt.planning || existing.planning,
        budget: attempt.budget || existing.budget,
        budgetRationale: attempt.budgetRationale || existing.budgetRationale,
        worker: attempt.worker || existing.worker,
        profile: attempt.profile || existing.profile,
        updatedAt: attempt.completedAt || attempt.startedAt || existing.updatedAt || new Date().toISOString(),
      });
      selectSwarmAttempt(attempt.attemptId);
    }
    return;
  }

  if (event.type === 'swarm.subagent_trace' && event.attemptId) {
    recordSwarmTimeline(event);
    const existing = harnessState.subagents.get(event.attemptId) || {};
    harnessState.subagents.set(event.attemptId, {
      ...existing,
      taskId: event.taskId || existing.taskId,
      attemptId: event.attemptId,
      status: existing.status || 'running',
      summary: event.summary || existing.summary,
      updatedAt: event.timestamp || new Date().toISOString(),
    });
    selectSwarmAttempt(event.attemptId);
    return;
  }

  if (!['swarm.subagent_started', 'swarm.subagent_completed'].includes(event.type) || !event.attemptId) {
    return;
  }

  recordSwarmTimeline(event);
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
    worker: event.worker || existing.worker,
    model: event.model || existing.model,
    planning: event.planning || existing.planning,
    budget: event.budget || existing.budget,
    budgetRationale: event.budgetRationale || existing.budgetRationale,
    profile: event.profile || existing.profile,
    thinkingSummary: event.thinkingSummary || existing.thinkingSummary,
    compactHandoff: event.compactHandoff || existing.compactHandoff,
    handoffQuality: event.handoffQuality ?? existing.handoffQuality,
    failure: event.failure || existing.failure,
    updatedAt: event.completedAt || event.startedAt || new Date().toISOString(),
  });
  selectSwarmAttempt(event.attemptId);
}

function pruneHarnessSubagents() {
  if (harnessState.subagents.size <= HARNESS_MAX_SUBAGENTS) return;

  const records = Array.from(harnessState.subagents.values())
    .sort((a, b) => {
      const aActive = ['running', 'scheduled'].includes(a.status) ? 1 : 0;
      const bActive = ['running', 'scheduled'].includes(b.status) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  const keep = new Set(records
    .slice(0, HARNESS_MAX_SUBAGENTS)
    .map(agent => agent.attemptId)
    .filter(Boolean));

  for (const attemptId of harnessState.subagents.keys()) {
    if (!keep.has(attemptId)) {
      harnessState.subagents.delete(attemptId);
      harnessState.swarm.timelines.delete(attemptId);
    }
  }
  if (harnessState.swarm.selectedAttemptId && !keep.has(harnessState.swarm.selectedAttemptId)) {
    harnessState.swarm.selectedAttemptId = records[0]?.attemptId || null;
  }
}

function getAgentLatestTimelineEvent(agent) {
  if (!agent?.attemptId) return null;
  const timeline = harnessState.swarm.timelines.get(agent.attemptId) || [];
  return timeline[0] || null;
}

function getAgentCurrentPhase(agent) {
  const latest = getAgentLatestTimelineEvent(agent);
  return latest?.phase || latest?.type || agent?.status || 'pending';
}

function renderSwarmActivityCard(agent, { compact = false } = {}) {
  const isActive = ['running', 'scheduled'].includes(agent.status);
  const phase = getAgentCurrentPhase(agent);
  const latest = getAgentLatestTimelineEvent(agent);
  const activityText = latest?.summary || agent.summary || agent.strategy || 'Waiting for activity';
  const worker = workerLabel(agent.worker);
  const meta = [worker, agent.strategy, Number.isFinite(agent.score) ? `score ${agent.score}` : '']
    .filter(Boolean)
    .join(' · ');
  return `
    <button
      class="harness-swarm-activity-card ${isActive ? 'active' : ''} ${compact ? 'compact' : ''}"
      type="button"
      data-swarm-attempt-id="${escAttr(agent.attemptId || '')}"
      title="Open swarm inspector"
    >
      <div class="harness-swarm-activity-top">
        <span class="harness-swarm-activity-role">
          ${isActive ? '<span class="harness-live-dot sm"></span>' : ''}
          ${esc(agent.role || 'subagent')}
        </span>
        <span class="harness-subagent-status ${esc(agent.status || 'unknown')}">${esc(agent.status || 'unknown')}</span>
      </div>
      <div class="harness-swarm-activity-phase">${esc(phase)}</div>
      <div class="harness-swarm-activity-summary">${esc(activityText)}</div>
      ${meta ? `<div class="harness-swarm-activity-meta">${esc(meta)}</div>` : ''}
    </button>
  `;
}

function renderHarnessSwarmActivity() {
  if (!harnessSwarmActivity || !harnessSwarmActivityList) return;
  const agents = Array.from(harnessState.subagents.values())
    .sort((a, b) => {
      const aActive = ['running', 'scheduled'].includes(a.status) ? 1 : 0;
      const bActive = ['running', 'scheduled'].includes(b.status) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  const activeAgents = agents.filter(agent => ['running', 'scheduled'].includes(agent.status));
  const showActivity = activeAgents.length > 0;
  harnessSwarmActivity.classList.toggle('hidden', !showActivity);
  if (!showActivity) {
    harnessSwarmActivityList.innerHTML = '';
    return;
  }
  harnessSwarmActivityList.innerHTML = activeAgents
    .slice(0, 4)
    .map(agent => renderSwarmActivityCard(agent))
    .join('');
}

function renderHarnessSwarmLiveStrip() {
  if (!harnessSwarmLiveStrip || !harnessSwarmLiveText) return;
  const agents = Array.from(harnessState.subagents.values());
  const activeAgents = agents.filter(agent => ['running', 'scheduled'].includes(agent.status));
  if (!activeAgents.length) {
    harnessSwarmLiveStrip.classList.add('hidden');
    return;
  }
  harnessSwarmLiveStrip.classList.remove('hidden');
  const summaries = activeAgents.slice(0, 3).map((agent) => {
    const phase = getAgentCurrentPhase(agent);
    const latest = getAgentLatestTimelineEvent(agent);
    const detail = latest?.summary || agent.summary || agent.strategy || 'working';
    return `${agent.role || 'subagent'}: ${phase} — ${detail}`;
  });
  harnessSwarmLiveText.textContent = summaries.join(' | ');
}

function renderHarnessSubagents() {
  if (!harnessSubagents) return;
  const agents = Array.from(harnessState.subagents.values())
    .sort((a, b) => {
      const aActive = ['running', 'scheduled'].includes(a.status) ? 1 : 0;
      const bActive = ['running', 'scheduled'].includes(b.status) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    })
    .slice(0, 6);

  const activeCount = agents.filter(agent => ['running', 'scheduled'].includes(agent.status)).length;
  if (harnessSubagentCount) {
    harnessSubagentCount.textContent = `${activeCount} active`;
    harnessSubagentCount.classList.toggle('has-active', activeCount > 0);
  }

  harnessSubagents.innerHTML = agents.map(agent => renderSwarmActivityCard(agent, { compact: true })).join('')
    || '<div class="harness-empty compact">No subagents running</div>';
}

function workerLabel(worker = {}) {
  if (worker?.kind === 'pi_native_subagent') return worker.protocol === 'a2a' ? 'Pi Agent A2A' : 'Pi Agent';
  if (worker?.kind === 'model_driven') return 'Sidecar model';
  if (worker?.kind === 'worktree_command') return 'Worktree';
  if (worker?.kind === 'command_subagent') return 'Command';
  if (worker?.kind === 'deterministic_subagent') return 'Deterministic';
  return worker?.kind ? String(worker.kind).replace(/_/g, ' ') : '';
}

function compactText(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return fallback;
  return value.summary || value.title || value.id || fallback;
}

function swarmEventKey(event, index) {
  return [
    event?.timestamp || 'no-time',
    event?.type || 'event',
    event?.phase || 'phase',
    index,
  ].map(value => String(value).replace(/\s+/g, '_')).join('::');
}

function valueList(value) {
  if (Array.isArray(value)) return value.filter(item => item !== undefined && item !== null && String(item).trim());
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function renderInspectorList(items, emptyText = 'None recorded') {
  const values = valueList(items);
  if (!values.length) return `<div class="harness-empty compact">${esc(emptyText)}</div>`;
  return values.map(item => `<div class="harness-swarm-inspector-line">${esc(compactText(item, JSON.stringify(item)))}</div>`).join('');
}

function renderInspectorObject(value, emptyText = 'None recorded') {
  if (!value || typeof value !== 'object') return `<div class="harness-empty compact">${esc(emptyText)}</div>`;
  const rows = Object.entries(value)
    .filter(([, rowValue]) => rowValue !== undefined && rowValue !== null && rowValue !== '' && !(Array.isArray(rowValue) && !rowValue.length))
    .map(([key, rowValue]) => `
      <div class="harness-swarm-inspector-kv">
        <span>${esc(key)}</span>
        <strong>${esc(Array.isArray(rowValue) ? rowValue.map(item => compactText(item, JSON.stringify(item))).join(', ') : compactText(rowValue, JSON.stringify(rowValue)))}</strong>
      </div>
    `);
  return rows.join('') || `<div class="harness-empty compact">${esc(emptyText)}</div>`;
}

function renderSwarmAttemptCard(agent) {
  const isActive = agent.attemptId === harnessState.swarm.selectedAttemptId;
  const isRunning = ['running', 'scheduled'].includes(agent.status);
  const phase = getAgentCurrentPhase(agent);
  const latest = getAgentLatestTimelineEvent(agent);
  const activityText = latest?.summary || agent.summary || agent.failure?.message || 'Waiting for activity';
  const scoreText = Number.isFinite(agent.score) ? `score ${formatScore(agent.score)}` : '';
  const verifyText = agent.verifierPassed === true ? 'verified' : agent.verifierPassed === false ? 'needs review' : '';
  const handoffText = Number.isFinite(agent.handoffQuality) ? `handoff ${formatScore(agent.handoffQuality)}` : '';
  const modelText = agent.model?.profileName
    ? `model ${agent.model.profileName}${agent.model?.route?.endpointProfile ? `/${agent.model.route.endpointProfile}` : ''}`
    : '';
  const meta = [workerLabel(agent.worker), modelText, scoreText, verifyText, handoffText].filter(Boolean).join(' · ');
  return `
    <button class="harness-swarm-attempt-card ${isActive ? 'active' : ''} ${isRunning ? 'running' : ''}" type="button" data-swarm-attempt-id="${escAttr(agent.attemptId || '')}">
      <span class="harness-swarm-attempt-top">
        <span class="harness-swarm-attempt-name">
          ${isRunning ? '<span class="harness-live-dot sm"></span>' : ''}
          ${esc(agent.role || 'subagent')}
        </span>
        <span class="harness-subagent-status ${esc(agent.status || 'unknown')}">${esc(agent.status || 'unknown')}</span>
      </span>
      <span class="harness-swarm-attempt-strategy">${esc(agent.strategy || agent.profile?.name || 'strategy pending')}</span>
      <span class="harness-swarm-attempt-phase">${esc(phase)}</span>
      <span class="harness-swarm-attempt-summary">${esc(activityText)}</span>
      ${meta ? `<span class="harness-swarm-attempt-meta">${esc(meta)}</span>` : ''}
    </button>
  `;
}

function renderSwarmTimelineRow(event, index, selectedEventKey) {
  const eventKey = swarmEventKey(event, index);
  const isActive = eventKey === selectedEventKey;
  const detailText = event.details
    ? Object.entries(event.details)
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${compactText(value, JSON.stringify(value))}`)
      .join(' | ')
    : '';
  const meta = [formatTraceTime(event.timestamp), event.type, detailText].filter(Boolean).join(' | ');
  return `
    <button class="harness-swarm-timeline-row ${escAttr(event.severity || 'info')} ${isActive ? 'active' : ''}" type="button" data-swarm-event-key="${escAttr(eventKey)}">
      <div class="harness-swarm-timeline-top">
        <span class="harness-trace-event-index">${index + 1}</span>
        <span class="harness-swarm-phase">${esc(event.phase || event.type || 'event')}</span>
      </div>
      <div class="harness-swarm-timeline-summary">${esc(event.summary || '')}</div>
      ${meta ? `<div class="harness-swarm-timeline-meta">${esc(meta)}</div>` : ''}
    </button>
  `;
}

function renderHarnessSwarmInspector(selected, timeline, selectedEvent) {
  if (!selected) {
    if (harnessSwarmInspectorMetadata) harnessSwarmInspectorMetadata.innerHTML = '';
    if (harnessSwarmThinking) harnessSwarmThinking.innerHTML = '<div class="harness-empty compact">No thinking summary yet</div>';
    if (harnessSwarmActions) harnessSwarmActions.innerHTML = '<div class="harness-empty compact">No actions yet</div>';
    if (harnessSwarmHandoff) harnessSwarmHandoff.innerHTML = '<div class="harness-empty compact">No handoff yet</div>';
    if (harnessSwarmEventInspector) harnessSwarmEventInspector.innerHTML = '<div class="harness-empty compact">No event selected</div>';
    return;
  }

  const worker = workerLabel(selected.worker) || 'worker pending';
  const metadata = [
    ['worker', worker],
    ['model', selected.model?.profileName || 'n/a'],
    ['endpoint', selected.model?.route?.endpointProfile || 'n/a'],
    ['status', selected.status || 'unknown'],
    ['score', Number.isFinite(selected.score) ? formatScore(selected.score) : 'n/a'],
    ['handoff', Number.isFinite(selected.handoffQuality?.score) ? formatScore(selected.handoffQuality.score) : compactText(selected.handoffQuality?.status, 'n/a')],
    ['budget', selected.budgetRationale || compactText(selected.budget, 'n/a')],
  ];
  if (harnessSwarmInspectorMetadata) {
    harnessSwarmInspectorMetadata.innerHTML = metadata.map(([label, value]) => `
      <span class="harness-swarm-chip"><strong>${esc(label)}</strong>${esc(value)}</span>
    `).join('');
  }

  if (harnessSwarmThinking) {
    const thinking = selected.thinkingSummary
      || selected.compactHandoff?.thinkingSummary
      || selected.compactHandoff?.summary
      || selected.output?.thinkingSummary;
    harnessSwarmThinking.innerHTML = thinking
      ? `<div class="harness-swarm-inspector-text">${esc(thinking)}</div>`
      : '<div class="harness-empty compact">No visible thinking summary yet</div>';
  }

  if (harnessSwarmActions) {
    harnessSwarmActions.innerHTML = timeline.length
      ? timeline.slice(0, 8).map((event, index) => `
        <div class="harness-swarm-inspector-line">
          <strong>${esc(event.phase || event.type || `step ${index + 1}`)}</strong>
          <span>${esc(event.summary || event.type || '')}</span>
        </div>
      `).join('')
      : '<div class="harness-empty compact">No actions yet</div>';
  }

  if (harnessSwarmHandoff) {
    const handoff = selected.compactHandoff || selected.output?.compactHandoff || null;
    const evidence = selected.verifierEvidence || selected.output?.verifierEvidence || [];
    harnessSwarmHandoff.innerHTML = [
      renderInspectorObject(handoff, 'No compact handoff yet'),
      evidence.length ? `<div class="harness-swarm-inspector-subtitle">Verifier Evidence</div>${renderInspectorList(evidence)}` : '',
    ].filter(Boolean).join('');
  }

  if (harnessSwarmEventInspector) {
    harnessSwarmEventInspector.innerHTML = selectedEvent
      ? renderInspectorObject({
        phase: selectedEvent.phase,
        type: selectedEvent.type,
        severity: selectedEvent.severity,
        time: formatTraceTime(selectedEvent.timestamp),
        summary: selectedEvent.summary,
        details: selectedEvent.details ? JSON.stringify(selectedEvent.details) : '',
      }, 'No event details')
      : '<div class="harness-empty compact">Select a timeline event</div>';
  }
}

function renderHarnessSwarm() {
  if (!harnessSwarmAttempts || !harnessSwarmTimeline) return;
  const agents = Array.from(harnessState.subagents.values())
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  const activeCount = agents.filter(agent => ['running', 'scheduled'].includes(agent.status)).length;
  if (!harnessState.swarm.selectedAttemptId && agents[0]?.attemptId) {
    harnessState.swarm.selectedAttemptId = agents[0].attemptId;
  }
  const selected = agents.find(agent => agent.attemptId === harnessState.swarm.selectedAttemptId) || agents[0] || null;
  if (selected?.attemptId && selected.attemptId !== harnessState.swarm.selectedAttemptId) {
    harnessState.swarm.selectedAttemptId = selected.attemptId;
  }

  if (harnessSwarmStatus) {
    harnessSwarmStatus.textContent = agents.length
      ? `${agents.length} swarm attempt${agents.length === 1 ? '' : 's'} visible`
      : 'No swarm attempts yet';
  }
  if (harnessSwarmActiveCount) {
    harnessSwarmActiveCount.textContent = `${activeCount} active`;
    harnessSwarmActiveCount.classList.toggle('has-active', activeCount > 0);
  }

  harnessSwarmAttempts.innerHTML = agents.map(renderSwarmAttemptCard).join('')
    || '<div class="harness-empty compact">No swarm attempts running</div>';

  if (!selected) {
    if (harnessSwarmDetailSummary) harnessSwarmDetailSummary.textContent = 'Select a subagent attempt';
    harnessSwarmTimeline.innerHTML = '<div class="harness-empty compact">No timeline events yet</div>';
    renderHarnessSwarmInspector(null, [], null);
    return;
  }

  const worker = workerLabel(selected.worker) || 'worker pending';
  const phase = getAgentCurrentPhase(selected);
  const latest = getAgentLatestTimelineEvent(selected);
  if (harnessSwarmDetailSummary) {
    harnessSwarmDetailSummary.innerHTML = `
      <div class="harness-swarm-detail-head">
        <span class="harness-swarm-detail-role">${esc(selected.role || 'subagent')}</span>
        <span class="harness-subagent-status ${esc(selected.status || 'unknown')}">${esc(selected.status || 'unknown')}</span>
      </div>
      <div class="harness-swarm-detail-phase">${esc(phase)}</div>
      <div class="harness-swarm-detail-body">${esc(latest?.summary || selected.summary || selected.thinkingSummary || 'Waiting for activity')}</div>
      <div class="harness-swarm-detail-meta">${esc([worker, selected.strategy, selected.budgetRationale].filter(Boolean).join(' · '))}</div>
    `;
  }

  const timeline = harnessState.swarm.timelines.get(selected.attemptId) || [];
  const eventKeys = timeline.map(swarmEventKey);
  if (!eventKeys.includes(harnessState.swarm.selectedEventKey)) {
    harnessState.swarm.selectedEventKey = eventKeys[0] || null;
  }
  const selectedEvent = timeline.find((event, index) => swarmEventKey(event, index) === harnessState.swarm.selectedEventKey) || null;

  harnessSwarmTimeline.innerHTML = timeline.map((event, index) => renderSwarmTimelineRow(event, index, harnessState.swarm.selectedEventKey)).join('')
    || '<div class="harness-empty compact">No timeline events yet</div>';
  renderHarnessSwarmInspector(selected, timeline, selectedEvent);
}

function renderHarnessHierarchyFeedback() {
  const localMeta = harnessState.hierarchy.localMeta;
  if (harnessLocalMetaStatus) harnessLocalMetaStatus.textContent = localMeta.status || 'idle';
  if (harnessLocalMetaCandidates) harnessLocalMetaCandidates.textContent = String(localMeta.candidateCount || 0);
  if (harnessLocalMetaCell) harnessLocalMetaCell.textContent = localMeta.cellId || 'n/a';

  const memory = harnessState.hierarchy.memory;
  if (harnessMemoryHierarchyStatus) harnessMemoryHierarchyStatus.textContent = memory.status || 'idle';
  if (harnessMemoryProposals) harnessMemoryProposals.textContent = String(memory.proposalCount || 0);
  if (harnessMemorySource) harnessMemorySource.textContent = memory.cellId || 'n/a';

  const experiments = harnessState.hierarchy.experiments;
  if (harnessExperimentsStatus) harnessExperimentsStatus.textContent = experiments.status || 'idle';
  if (harnessExperimentRuns) harnessExperimentRuns.textContent = String(experiments.runCount || 0);
  if (harnessExperimentDecision) harnessExperimentDecision.textContent = experiments.decision || 'n/a';
}

function formatCapabilityGoalSuffix(goal = {}) {
  const blockers = (goal.blockers || []).length;
  if (blockers) {
    return `${blockers} blocker${blockers === 1 ? '' : 's'}`;
  }

  const missingProduction = (goal.missingProductionEvidence || []).length;
  const missingSubstrate = (goal.missingEvidence || []).length;
  const paperGaps = (goal.paperGradeAutonomyGaps || []).length;

  if (missingSubstrate > 0) {
    return `${missingSubstrate} evidence gap${missingSubstrate === 1 ? '' : 's'}`;
  }
  if (missingProduction > 0) {
    return `${missingProduction} production artifact${missingProduction === 1 ? '' : 's'} needed`;
  }
  if (paperGaps > 0) {
    return `substrate complete · ${paperGaps} paper gap${paperGaps === 1 ? '' : 's'}`;
  }
  return 'evidence complete';
}

function renderCapabilityGoalRows() {
  const goals = harnessState.capabilityGoals;
  if (!goals) {
    if (harnessCapabilityGoalsStatus) harnessCapabilityGoalsStatus.textContent = 'idle';
    if (harnessCapabilityGoalsImplemented) harnessCapabilityGoalsImplemented.textContent = '0';
    if (harnessCapabilityGoalsOpen) harnessCapabilityGoalsOpen.textContent = '0';
    if (harnessCapabilityGoalRows) harnessCapabilityGoalRows.innerHTML = '<div class="harness-empty compact">No capability goal status yet</div>';
    return;
  }

  const implemented = goals.implementedCount ?? goals.counts?.implemented ?? 0;
  const open = goals.openCount ?? Math.max(0, (goals.totalCount || 0) - implemented);
  if (harnessCapabilityGoalsStatus) {
    harnessCapabilityGoalsStatus.textContent = open > 0 ? `${open} open` : 'complete';
  }
  if (harnessCapabilityGoalsImplemented) harnessCapabilityGoalsImplemented.textContent = String(implemented);
  if (harnessCapabilityGoalsOpen) harnessCapabilityGoalsOpen.textContent = String(open);
  if (!harnessCapabilityGoalRows) return;

  const goalRows = goals.goals || [];
  const rows = goalRows.map((goal) => {
    const suffix = formatCapabilityGoalSuffix(goal);
    return `
      <div class="harness-list-row">
        <span>${esc(goal.label || goal.goalId || 'goal')}</span>
        <strong>${esc(goal.status || 'unknown')} · ${esc(suffix)}</strong>
      </div>
    `;
  }).join('');
  harnessCapabilityGoalRows.innerHTML = rows || '<div class="harness-empty compact">No capability goal rows</div>';
}

function renderHarnessPanel() {
  if (!harnessPanel) return;
  harnessSubtitle.textContent = harnessState.status === 'running' ? 'Sidecar running' : `Sidecar ${harnessState.status}`;
  harnessStatePill.textContent = harnessState.status;
  harnessStatePill.className = `harness-pill ${harnessState.status}`;
  harnessTaskCount.textContent = `${harnessState.activeTasks.size} task${harnessState.activeTasks.size === 1 ? '' : 's'}`;
  harnessApprovalCount.textContent = `${harnessState.pendingApprovals.size} approval${harnessState.pendingApprovals.size === 1 ? '' : 's'}`;
  updateHarnessPanelFooterVisibility();
  updateGlobalStatusBar();
  renderHarnessVerifierEvolution();
  renderHarnessAdaptiveSearch();
  renderHarnessProductionEvidence();
  renderHarnessRecursiveEvolutionEvidence();
  renderHarnessSkillCandidates();
  renderHarnessAbMctsReplay();
  renderHarnessSubagents();
  renderHarnessSwarmActivity();
  renderHarnessSwarm();
  renderHarnessSwarmLiveStrip();
  renderHarnessSwarmConfigBanner();
  renderCapabilityGoalRows();
  renderHarnessHierarchyFeedback();
  renderHarnessTraces();
  renderDeepResearchPanel();
  renderAutonomyLoopStatus();
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

function renderHarnessVerifierEvolution() {
  const state = harnessState.verifierEvolution;
  if (harnessVerifierEvolutionStatus) {
    const candidateText = state.latestCandidateId ? ` | ${state.latestCandidateId}` : '';
    harnessVerifierEvolutionStatus.textContent = `verifier evolution ${state.status || 'idle'}${candidateText}`;
  }
  if (harnessVerifierLatestScore) {
    harnessVerifierLatestScore.textContent = `score ${formatScore(state.latestScore ?? state.candidateScore)}`;
  }
  if (harnessVerifierBaselineComparison) {
    harnessVerifierBaselineComparison.textContent = `baseline ${formatScore(state.baselineScore)} | candidate ${formatScore(state.candidateScore)}`;
  }
  if (harnessVerifierPendingPromotions) {
    const count = state.pendingVerifierPromotions;
    harnessVerifierPendingPromotions.textContent = `${count} verifier approval${count === 1 ? '' : 's'}`;
  }
  if (harnessVerifierArtifacts) {
    harnessVerifierArtifacts.innerHTML = state.visualVerifierArtifacts.map(artifact => `
      <button class="harness-artifact-link" type="button" onclick="openHarnessArtifact('${escAttr(artifact.artifactId)}')">${esc(artifact.title || artifact.type || 'visual artifact')}</button>
    `).join('') || '<span class="harness-empty compact">No visual artifacts</span>';
  }
}

function requestHarnessAdaptiveSearchStatus() {
  if (harnessAdaptiveNote) harnessAdaptiveNote.textContent = 'Refreshing adaptive-search status...';
  if (harnessAdaptiveRequestTimer) clearTimeout(harnessAdaptiveRequestTimer);
  harnessAdaptiveRequestTimer = setTimeout(() => {
    if (harnessAdaptiveNote?.textContent === 'Refreshing adaptive-search status...') {
      harnessAdaptiveNote.textContent = harnessAdaptiveLoaded
        ? 'Adaptive-search status is current.'
        : 'Adaptive-search status has not been returned by the sidecar yet.';
    }
  }, 2500);
  send({ type: 'harness_adaptive_search_status_get', workspaceRoot: getSelectedWorkspacePath() || undefined });
}

function handleHarnessAdaptiveSearchStatus(payload) {
  if (harnessAdaptiveRequestTimer) clearTimeout(harnessAdaptiveRequestTimer);
  harnessAdaptiveLoaded = true;
  harnessAdaptiveStatus = payload?.status || payload?.adaptiveSearch || payload || null;
  renderHarnessAdaptiveSearch();
}

function passKMetric(report, group, name) {
  return report?.[group]?.[name]?.passAtK
    ?? report?.[`${name}PassAtK`]
    ?? report?.passK?.[`${name}PassAtK`]
    ?? null;
}

function normalizePassKReport(payload = {}) {
  const report = payload.data || payload.report || payload.passK || payload;
  const uplift = report.uplift || payload.uplift || {};
  return {
    evalId: report.evalId || payload.evalId || null,
    bestSinglePassAtK: passKMetric(report, 'baselines', 'bestSingle'),
    repeatedSamplingPassAtK: passKMetric(report, 'baselines', 'repeatedSampling'),
    staticCouncilPassAtK: passKMetric(report, 'variants', 'staticCouncil'),
    adaptiveCouncilPassAtK: passKMetric(report, 'variants', 'adaptiveCouncil'),
    uplift,
    proven: Boolean(report.proven ?? payload.proven),
    authority: report.authority || payload.authority || 'evidence_only',
    canPromote: report.canPromote === true || payload.canPromote === true,
  };
}

function handleHarnessModelCouncilPassKEval(payload = {}) {
  const passK = normalizePassKReport(payload);
  harnessState.passK = passK;
  harnessAdaptiveLoaded = true;
  harnessAdaptiveStatus = {
    ...(harnessAdaptiveStatus || {}),
    passK,
    selectedArm: 'adaptive-council',
    mode: 'pass@k',
    advisory: true,
    enabled: true,
    recentReward: passK.uplift?.adaptiveVsBestSingle?.delta,
    latestEventType: 'harness_model_council_passk_eval',
  };
  renderHarnessAdaptiveSearch();
}

function updateHarnessAdaptiveSearch(event) {
  if (event?.type === 'model_council.passk_eval_completed') {
    handleHarnessModelCouncilPassKEval(event);
    event.summary = formatPassKSummary(harnessState.passK);
    return;
  }
  if (!event?.type || !/adaptive[_-]?search|ab[_-]?mcts|arm[_-]?selected/i.test(event.type)) return;
  const nextStatus = event.status || event.adaptiveSearch || event.details || event;
  harnessAdaptiveLoaded = true;
  harnessAdaptiveStatus = { ...(harnessAdaptiveStatus || {}), ...nextStatus, latestEventType: event.type };
}

function formatAdaptiveBalance(balance) {
  if (!balance) return 'n/a';
  if (Array.isArray(balance)) {
    return balance.map(item => {
      if (typeof item === 'string') return item;
      const label = item.arm || item.name || item.id || 'arm';
      const weight = item.weight ?? item.probability ?? item.visits ?? item.count ?? item.score;
      return weight === undefined ? label : `${label}:${compactText(weight, String(weight))}`;
    }).join(' | ');
  }
  if (typeof balance === 'object') {
    return Object.entries(balance).map(([arm, value]) => `${arm}:${compactText(value, String(value))}`).join(' | ');
  }
  return String(balance);
}

function formatPassKValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : 'n/a';
}

function formatPassKBalance(passK = {}) {
  return [
    `best-single:${formatPassKValue(passK.bestSinglePassAtK)}`,
    `repeated:${formatPassKValue(passK.repeatedSamplingPassAtK)}`,
    `static-council:${formatPassKValue(passK.staticCouncilPassAtK)}`,
    `adaptive-council:${formatPassKValue(passK.adaptiveCouncilPassAtK)}`,
  ].join(' | ');
}

function formatPassKSummary(passK = {}) {
  const adaptiveDelta = passK.uplift?.adaptiveVsBestSingle?.delta;
  const staticDelta = passK.uplift?.staticVsBestSingle?.delta;
  return [
    `pass@k ${passK.proven ? 'proven' : 'not proven'}`,
    formatPassKBalance(passK),
    `adaptive vs best:${formatPassKValue(adaptiveDelta)}`,
    `static vs best:${formatPassKValue(staticDelta)}`,
    passK.authority || 'evidence_only',
  ].filter(Boolean).join(' | ');
}

function renderHarnessAdaptiveSearch() {
  const status = harnessAdaptiveStatus || {};
  const passK = status.passK || harnessState.passK;
  const selectedArm = passK ? 'adaptive-council' : status.selectedArm || status.selected_arm || status.arm || status.currentArm || 'n/a';
  const enabled = status.enabled === undefined ? 'unknown' : status.enabled ? 'enabled' : 'disabled';
  const advisory = status.advisory === undefined ? '' : status.advisory ? 'advisory' : 'enforcing';
  const modeParts = [passK ? 'pass@k' : status.mode || status.policyMode || 'unknown', advisory, enabled].filter(Boolean);
  const recentReward = passK?.uplift?.adaptiveVsBestSingle?.delta ?? status.recentReward ?? status.reward ?? status.latestReward ?? status.lastReward;
  const balance = passK ? formatPassKBalance(passK) : status.armBalance || status.arm_balance || status.balance || status.arms;

  if (harnessAdaptiveSelectedArm) harnessAdaptiveSelectedArm.textContent = compactText(selectedArm, 'n/a');
  if (harnessAdaptiveMode) harnessAdaptiveMode.textContent = modeParts.join(' | ');
  if (harnessAdaptiveReward) harnessAdaptiveReward.textContent = Number.isFinite(Number(recentReward)) ? Number(recentReward).toFixed(3) : compactText(recentReward, 'n/a');
  if (harnessAdaptiveArmBalance) harnessAdaptiveArmBalance.textContent = formatAdaptiveBalance(balance);
  if (harnessAdaptiveNote) {
    harnessAdaptiveNote.textContent = harnessAdaptiveLoaded
      ? compactText(passK ? formatPassKSummary(passK) : status.reason || status.summary || status.latestEventType, 'Adaptive-search status is current.')
      : 'Waiting for adaptive-search status.';
  }
}

function requestHarnessModelCouncilPassKEval() {
  send({
    type: 'harness_model_council_passk_eval_prepare',
    workspaceRoot: getSelectedWorkspacePath() || undefined,
  });
}

function requestHarnessProductionEvidence() {
  if (harnessProductionEvidenceStatus) harnessProductionEvidenceStatus.textContent = 'Refreshing production evidence...';
  send({
    type: 'harness_production_evidence_get',
    workspaceRoot: getSelectedWorkspacePath() || undefined,
    evidenceTypes: PRODUCTION_EVIDENCE_TYPES.map(([type]) => type),
  });
}

function handleHarnessProductionEvidence(payload = {}) {
  const reports = payload.reports || payload.productionEvidence || payload;
  harnessState.productionEvidence = { ...(harnessState.productionEvidence || {}), ...(reports || {}) };
  renderHarnessProductionEvidence();
  syncAutonomyDashboardFromState();
}

function renderHarnessProductionEvidence() {
  if (!harnessProductionEvidenceRows) return;
  const reports = harnessState.productionEvidence || {};
  const loadedCount = Object.keys(reports).length;
  const rows = PRODUCTION_EVIDENCE_TYPES.map(([type, label]) => {
    const report = reports[type] || {};
    const gate = report.gate || {};
    const itemCount = report.summary?.itemCount ?? 0;
    const enabled = gate.enabled === true;
    const mode = gate.mode || 'offline';
    const stateClass = enabled ? (mode === 'active' ? 'active' : 'enabled') : 'disabled';
    return { type, label, itemCount, enabled, mode, stateClass };
  });
  const enabledCount = rows.filter(row => row.enabled).length;
  const activeCount = rows.filter(row => row.enabled && row.mode === 'active').length;

  if (harnessProductionEvidenceStatus) {
    harnessProductionEvidenceStatus.textContent = loadedCount
      ? `${loadedCount} surface${loadedCount === 1 ? '' : 's'} · ${enabledCount} enabled · ${activeCount} active`
      : 'No production evidence loaded';
  }
  if (harnessProductionEvidenceSummary) {
    harnessProductionEvidenceSummary.textContent = loadedCount
      ? `${activeCount} active · ${enabledCount} enabled`
      : 'not loaded';
  }

  harnessProductionEvidenceRows.innerHTML = rows.map((row) => `
    <div class="harness-evidence-chip ${esc(row.stateClass)}" title="${esc(row.label)}">
      <span class="harness-evidence-chip-label">${esc(row.label)}</span>
      <span class="harness-evidence-chip-meta">${esc(row.enabled ? row.mode : 'off')} · ${esc(String(row.itemCount))}</span>
    </div>
  `).join('');
}

function ensureRecursiveEvolutionEvidencePanel() {
  if (harnessRecursiveEvolutionEvidenceRows) return;
  const telemetryBody = document.getElementById('harness-swarm-telemetry-body');
  if (!telemetryBody) return;
  const section = document.createElement('section');
  section.id = 'harness-recursive-evolution-evidence';
  section.className = 'harness-hierarchy-panel';
  section.setAttribute('aria-label', 'Recursive evolution evidence');
  section.innerHTML = `
    <div class="harness-section-title-row compact">
      <span>Recursive Evolution Evidence</span>
      <button id="btn-harness-evidence-refresh" class="harness-btn" type="button">Refresh</button>
    </div>
    <div id="harness-recursive-evolution-evidence-status" class="harness-muted-line">No recursive evolution evidence loaded</div>
    <div id="harness-recursive-evolution-evidence-rows" class="harness-list compact"></div>
  `;
  telemetryBody.appendChild(section);
  harnessRecursiveEvolutionEvidenceStatus = $('#harness-recursive-evolution-evidence-status');
  harnessRecursiveEvolutionEvidenceRows = $('#harness-recursive-evolution-evidence-rows');
  $('#btn-harness-evidence-refresh')?.addEventListener('click', requestHarnessRecursiveEvolutionEvidence);
}

function requestHarnessRecursiveEvolutionEvidence() {
  ensureRecursiveEvolutionEvidencePanel();
  if (harnessRecursiveEvolutionEvidenceStatus) {
    harnessRecursiveEvolutionEvidenceStatus.textContent = 'Refreshing recursive evolution evidence...';
  }
  send({
    type: 'harness_evidence_refresh',
    workspaceRoot: getSelectedWorkspacePath() || undefined,
  });
}

function handleHarnessRecursiveEvolutionEvidence(payload = {}) {
  harnessState.recursiveEvolutionEvidence = {
    evidenceOnly: payload.evidenceOnly !== false,
    canPromote: payload.canPromote === true,
    replayCycles: payload.replayCycles || null,
    operatorDashboards: payload.operatorDashboards || null,
    backgroundEvolution: payload.backgroundEvolution || null,
  };
  renderHarnessRecursiveEvolutionEvidence();
  syncAutonomyDashboardFromState();
}

function renderHarnessRecursiveEvolutionEvidence() {
  ensureRecursiveEvolutionEvidencePanel();
  if (!harnessRecursiveEvolutionEvidenceRows) return;
  const evidence = harnessState.recursiveEvolutionEvidence;
  if (!evidence) {
    if (harnessRecursiveEvolutionEvidenceStatus) {
      harnessRecursiveEvolutionEvidenceStatus.textContent = 'No recursive evolution evidence loaded';
    }
    harnessRecursiveEvolutionEvidenceRows.innerHTML = '';
    return;
  }

  const replayCount = evidence.replayCycles?.summary?.itemCount ?? 0;
  const dashboardCount = evidence.operatorDashboards?.summary?.itemCount ?? 0;
  const background = evidence.backgroundEvolution?.worker || evidence.backgroundEvolution?.items?.[0] || null;
  const backgroundRunning = background?.running === true ? 'running' : 'idle';
  const lastTick = background?.lastTickAt ? `last tick ${background.lastTickAt}` : 'no background ticks yet';
  const badge = evidence.evidenceOnly === false ? 'mixed authority' : 'evidence_only';
  if (harnessRecursiveEvolutionEvidenceStatus) {
    harnessRecursiveEvolutionEvidenceStatus.textContent = `${replayCount + dashboardCount} evidence snapshot${replayCount + dashboardCount === 1 ? '' : 's'} loaded | background ${backgroundRunning} | ${badge}`;
  }
  harnessRecursiveEvolutionEvidenceRows.innerHTML = [
    ['Replay cycles', replayCount],
    ['Operator dashboards', dashboardCount],
    ['Background worker', `${backgroundRunning} (${lastTick})`],
  ].map(([label, itemCount]) => `
    <div class="harness-list-row">
      <strong>${esc(label)}</strong>
      <span>${esc(String(itemCount))} item${itemCount === 1 ? '' : 's'} | ${esc(badge)}</span>
    </div>
  `).join('');
}

function extractAutonomyAccumulatorState(autonomyRollbackReport = {}, backgroundEvolutionReport = {}) {
  const backgroundItem = backgroundEvolutionReport?.items?.[0];
  if (backgroundItem && typeof backgroundItem === 'object') {
    return backgroundItem;
  }
  const rollbackItems = autonomyRollbackReport?.items;
  if (Array.isArray(rollbackItems) && rollbackItems.length) {
    const merged = rollbackItems.find((item) => item?.rollbackDrills || item?.dashboardDepth !== undefined);
    if (merged) return merged;
    const nested = rollbackItems.find((item) => item?.autonomy && typeof item.autonomy === 'object');
    if (nested?.autonomy) return nested.autonomy;
  }
  const directAutonomy = autonomyRollbackReport?.items?.autonomy || autonomyRollbackReport?.autonomy;
  if (directAutonomy && typeof directAutonomy === 'object') return directAutonomy;
  return null;
}

function ensureAutonomyDashboardPanel() {
  if (harnessAutonomyDashboardRows) return;
  ensureRecursiveEvolutionEvidencePanel();
  const anchor = document.getElementById('harness-recursive-evolution-evidence');
  if (!anchor) return;
  const section = document.createElement('section');
  section.id = 'harness-autonomy-dashboard';
  section.className = 'harness-hierarchy-panel';
  section.setAttribute('aria-label', 'Autonomy evidence dashboard');
  section.innerHTML = `
    <div class="harness-section-title-row compact">
      <span>Autonomy Evidence Dashboard</span>
      <button id="btn-harness-autonomy-dashboard-refresh" class="harness-btn" type="button">Refresh</button>
    </div>
    <div id="harness-autonomy-dashboard-status" class="harness-muted-line">No autonomy evidence loaded</div>
    <div id="harness-autonomy-loop-row" class="harness-list-row harness-autonomy-loop-row"></div>
    <div id="harness-autonomy-dashboard-rows" class="harness-list compact"></div>
  `;
  anchor.insertAdjacentElement('afterend', section);
  harnessAutonomyDashboardStatus = $('#harness-autonomy-dashboard-status');
  harnessAutonomyDashboardRows = $('#harness-autonomy-dashboard-rows');
  harnessAutonomyLoopRow = $('#harness-autonomy-loop-row');
  $('#btn-harness-autonomy-dashboard-refresh')?.addEventListener('click', requestAutonomyDashboard);
}

function requestAutonomyDashboard() {
  ensureAutonomyDashboardPanel();
  if (harnessAutonomyDashboardStatus) {
    harnessAutonomyDashboardStatus.textContent = 'Refreshing autonomy evidence...';
  }
  send({
    type: 'harness_production_evidence_get',
    workspaceRoot: getSelectedWorkspacePath() || undefined,
    evidenceTypes: ['autonomyRollback', 'backgroundEvolution'],
  });
  send({
    type: 'harness_evidence_refresh',
    workspaceRoot: getSelectedWorkspacePath() || undefined,
  });
}

function syncAutonomyDashboardFromState() {
  const autonomyRollback = harnessState.productionEvidence?.autonomyRollback || null;
  const backgroundEvolution = harnessState.recursiveEvolutionEvidence?.backgroundEvolution
    || harnessState.productionEvidence?.backgroundEvolution
    || null;
  if (!autonomyRollback && !backgroundEvolution) return;
  harnessState.autonomyDashboard = {
    evidenceOnly: true,
    canPromote: false,
    autonomyRollback,
    backgroundEvolution,
    accumulator: extractAutonomyAccumulatorState(autonomyRollback, backgroundEvolution),
  };
  renderAutonomyDashboard();
  renderAutonomyLoopStatus();
}

function renderAutonomyDashboard() {
  ensureAutonomyDashboardPanel();
  if (!harnessAutonomyDashboardRows) return;
  const dashboard = harnessState.autonomyDashboard;
  if (!dashboard) {
    if (harnessAutonomyDashboardStatus) {
      harnessAutonomyDashboardStatus.textContent = 'No autonomy evidence loaded';
    }
    harnessAutonomyDashboardRows.innerHTML = '';
    return;
  }

  const accumulator = dashboard.accumulator || {};
  const drills = accumulator.rollbackDrills || {};
  const passed = drills.passed ?? 0;
  const failed = drills.failed ?? 0;
  const total = drills.total ?? (passed + failed);
  const regressionCount = accumulator.regressionCount ?? 0;
  const dashboardDepth = accumulator.dashboardDepth ?? 0;
  const blockers = Array.isArray(accumulator.blockers) ? accumulator.blockers : [];
  const background = dashboard.backgroundEvolution?.worker
    || dashboard.backgroundEvolution?.items?.[0]
    || null;
  const backgroundRunning = background?.running === true ? 'running' : 'idle';
  const rollbackReport = dashboard.autonomyRollback?.items?.[0]
    || dashboard.autonomyRollback?.items?.rollback
    || null;
  const rollbackCount = Array.isArray(rollbackReport)
    ? rollbackReport.length
    : (rollbackReport ? 1 : (dashboard.autonomyRollback?.summary?.itemCount ?? 0));
  const badge = dashboard.evidenceOnly === false ? 'mixed authority' : 'evidence_only';
  const thresholdSummary = blockers.length
    ? `blocked: ${blockers.join(', ')}`
    : (accumulator.eligible === false ? 'thresholds not met' : 'thresholds satisfied');

  if (harnessAutonomyDashboardStatus) {
    harnessAutonomyDashboardStatus.textContent = [
      `${passed}/${total} rollback drills passed`,
      `${regressionCount} regression${regressionCount === 1 ? '' : 's'}`,
      `dashboard depth ${dashboardDepth}`,
      thresholdSummary,
      `background ${backgroundRunning}`,
      badge,
    ].join(' | ');
  }

  harnessAutonomyDashboardRows.innerHTML = [
    ['Rollback drills passed', passed],
    ['Rollback drills failed', failed],
    ['Replay regressions', regressionCount],
    ['Dashboard depth', dashboardDepth],
    ['Governance rollback records', rollbackCount],
    ['Threshold status', thresholdSummary],
    ['Background worker', backgroundRunning],
  ].map(([label, value]) => `
    <div class="harness-list-row">
      <strong>${esc(label)}</strong>
      <span>${esc(String(value))} | ${esc(badge)}</span>
    </div>
  `).join('');
}

function requestHarnessSkillCandidates() {
  if (harnessSkillCandidatesEl) harnessSkillCandidatesEl.innerHTML = '<div class="harness-empty compact">Refreshing skill candidates...</div>';
  if (harnessSkillCandidatesRequestTimer) clearTimeout(harnessSkillCandidatesRequestTimer);
  harnessSkillCandidatesRequestTimer = setTimeout(() => {
    if (!harnessSkillCandidatesLoaded) renderHarnessSkillCandidates();
  }, 2500);
  send({ type: 'harness_skill_candidates_get', workspaceRoot: getSelectedWorkspacePath() || undefined, limit: 20 });
}

function requestHarnessPiBridgeState() {
  if (harnessPiBridgeStateEl) harnessPiBridgeStateEl.innerHTML = '<div class="harness-empty compact">Refreshing Pi bridge health...</div>';
  send({ type: 'harness_pi_bridge_state_get', workspaceRoot: getSelectedWorkspacePath() || undefined });
}

function requestHarnessPromotionQueue() {
  if (harnessPromotionQueueEl) harnessPromotionQueueEl.innerHTML = '<div class="harness-empty compact">Refreshing promotion queue...</div>';
  send({ type: 'harness_promotion_queue_get', workspaceRoot: getSelectedWorkspacePath() || undefined, limit: 20 });
}

function handleHarnessPiBridgeState(payload = {}) {
  if (!harnessPiBridgeStateEl) return;
  const health = payload.bridgeHealth || payload;
  const consumed = health.manifestConsumedByPi === true;
  const skills = payload.skillInventory?.skills?.length ?? 0;
  harnessPiBridgeStateEl.innerHTML = `
    <article class="harness-skill-candidate">
      <div class="harness-skill-candidate-name">Bridge manifest</div>
      <div class="harness-skill-candidate-meta">${health.manifestPresent ? 'present' : 'missing'} | consumed by Pi: ${consumed ? 'yes' : 'no'}</div>
      <div class="harness-skill-candidate-summary">Skills indexed: ${skills}. Helios Forge extension: ${health.piHeliosForgeExtensionInstalled ? 'installed' : 'missing'}.</div>
    </article>
  `;
}

function handleHarnessPromotionQueue(payload = {}) {
  if (!harnessPromotionQueueEl) return;
  const records = Array.isArray(payload.records) ? payload.records : [];
  if (!records.length) {
    harnessPromotionQueueEl.innerHTML = '<div class="harness-empty compact">Promotion queue is empty (evidence-only; operator approval required).</div>';
    return;
  }
  harnessPromotionQueueEl.innerHTML = records.map((record) => `
    <article class="harness-skill-candidate">
      <div class="harness-skill-candidate-name">${esc(record.proposalId || record.candidateId || 'proposal')}</div>
      <div class="harness-skill-candidate-meta">${esc(record.status || 'queued')} | ${esc(record.target || 'unknown target')}</div>
      <div class="harness-skill-candidate-summary">Queued ${esc(record.queuedAt || 'unknown time')} — read-only; use existing approval flow to promote.</div>
    </article>
  `).join('');
}

function handleHarnessSkillCandidates(payload) {
  if (harnessSkillCandidatesRequestTimer) clearTimeout(harnessSkillCandidatesRequestTimer);
  harnessSkillCandidatesLoaded = true;
  harnessSkillCandidates = Array.isArray(payload?.candidates) ? payload.candidates
    : Array.isArray(payload?.items) ? payload.items
    : Array.isArray(payload) ? payload
    : [];
  renderHarnessSkillCandidates();
}

function handleHarnessSkillCandidateReviewed(payload) {
  const candidateId = payload?.candidateId || payload?.id;
  const decision = payload?.decision || payload?.status;
  harnessSkillCandidates = harnessSkillCandidates.map(candidate => {
    const id = candidate.candidateId || candidate.id || candidate.name;
    return id === candidateId ? { ...candidate, status: decision || 'reviewed' } : candidate;
  });
  renderHarnessSkillCandidates();
}

function updateHarnessSkillCandidateEvents(event) {
  if (!event?.type || !/skill[_-]?candidate/i.test(event.type)) return;
  const candidate = event.candidate || event.details?.candidate || event.details || event;
  const candidateId = candidate.candidateId || candidate.id || event.candidateId || event.actionId;
  if (!candidateId) return;
  harnessSkillCandidatesLoaded = true;
  const normalized = { ...candidate, candidateId, status: candidate.status || event.status || 'pending' };
  const existingIndex = harnessSkillCandidates.findIndex(item => (item.candidateId || item.id || item.name) === candidateId);
  if (existingIndex >= 0) {
    harnessSkillCandidates[existingIndex] = { ...harnessSkillCandidates[existingIndex], ...normalized };
  } else {
    harnessSkillCandidates = [normalized, ...harnessSkillCandidates].slice(0, 20);
  }
}

function reviewHarnessSkillCandidate(candidateId, decision) {
  if (!candidateId || !decision) return;
  send({ type: 'harness_skill_candidate_review', candidateId, decision, workspaceRoot: getSelectedWorkspacePath() || undefined });
  harnessSkillCandidates = harnessSkillCandidates.map(candidate => {
    const id = candidate.candidateId || candidate.id || candidate.name;
    return id === candidateId ? { ...candidate, status: `${decision}_requested` } : candidate;
  });
  renderHarnessSkillCandidates();
}

function renderCandidateBlock(title, value) {
  if (!value) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return `
    <details class="harness-skill-candidate-block">
      <summary>${esc(title)}</summary>
      <pre>${esc(text)}</pre>
    </details>
  `;
}

function renderHarnessSkillCandidates() {
  if (!harnessSkillCandidatesEl) return;
  if (!harnessSkillCandidatesLoaded) {
    harnessSkillCandidatesEl.innerHTML = '<div class="harness-empty compact">Skill candidate review is waiting for the sidecar.</div>';
    return;
  }
  harnessSkillCandidatesEl.innerHTML = harnessSkillCandidates.map(candidate => {
    const candidateId = candidate.candidateId || candidate.id || candidate.name || 'candidate';
    const title = candidate.title || candidate.name || candidate.skillName || candidateId;
    const status = candidate.status || candidate.reviewStatus || 'pending';
    const skillMd = candidate.skillMd || candidate.generatedSkillMd || candidate.generatedSkill || candidate.files?.['SKILL.md'];
    return `
      <article class="harness-skill-candidate" data-skill-candidate-id="${escAttr(candidateId)}">
        <div class="harness-skill-candidate-top">
          <div>
            <div class="harness-skill-candidate-name">${esc(title)}</div>
            <div class="harness-skill-candidate-meta">${esc(candidateId)} | ${esc(status)}</div>
          </div>
          <div class="harness-skill-candidate-actions">
            <button class="harness-btn" type="button" data-skill-candidate-action="reject" data-candidate-id="${escAttr(candidateId)}">Reject</button>
            <button class="harness-run-btn" type="button" data-skill-candidate-action="approve" data-candidate-id="${escAttr(candidateId)}">Approve</button>
          </div>
        </div>
        ${candidate.summary ? `<div class="harness-skill-candidate-summary">${esc(candidate.summary)}</div>` : ''}
        ${renderCandidateBlock('Generated SKILL.md', skillMd)}
        ${renderCandidateBlock('Evaluation', candidate.evaluation || candidate.eval || candidate.scores)}
        ${renderCandidateBlock('Safety', candidate.safety || candidate.safetyReview || candidate.risk)}
        ${renderCandidateBlock('Rollback', candidate.rollback || candidate.rollbackPlan || candidate.revert)}
      </article>
    `;
  }).join('') || '<div class="harness-empty compact">No skill candidates available for review</div>';
}

function extractAbMctsDecisions(payload, events = []) {
  const direct = payload?.decisions || payload?.abMctsDecisions || payload?.abmctsDecisions || payload?.summary?.decisions;
  if (Array.isArray(direct)) return direct;
  return events.filter(event => /ab[_-]?mcts|adaptive[_-]?search|selected[_-]?arm|tree[_-]?policy/i.test(event?.type || ''));
}

function updateHarnessAbMctsReplayEvents(event) {
  if (!event?.type || !/ab[_-]?mcts|adaptive[_-]?search|selected[_-]?arm|tree[_-]?policy/i.test(event.type)) return;
  harnessTraceState.replayDecisions = [event, ...harnessTraceState.replayDecisions].slice(0, 25);
}

function renderHarnessAbMctsReplay() {
  if (!harnessAbMctsDecisions) return;
  const decisions = harnessTraceState.replayDecisions || [];
  if (harnessAbMctsReplayStatus) {
    harnessAbMctsReplayStatus.textContent = decisions.length
      ? `${decisions.length} decision${decisions.length === 1 ? '' : 's'}`
      : 'No replay decisions';
  }
  harnessAbMctsDecisions.innerHTML = decisions.map((decision, index) => {
    const selectedArm = decision.selectedArm || decision.selected_arm || decision.arm || decision.action || decision.choice || 'n/a';
    const reward = decision.reward ?? decision.recentReward ?? decision.value ?? decision.score;
    const balance = decision.armBalance || decision.arm_balance || decision.balance || decision.arms;
    const reason = decision.reason || decision.summary || decision.rationale || decision.type || '';
    return `
      <div class="harness-abmcts-decision">
        <div class="harness-abmcts-decision-top">
          <span>${index + 1}</span>
          <strong>${esc(selectedArm)}</strong>
        </div>
        <div class="harness-abmcts-decision-meta">
          ${reward === undefined ? 'reward n/a' : `reward ${esc(compactText(reward, String(reward)))}`} | ${esc(formatAdaptiveBalance(balance))}
        </div>
        ${reason ? `<div class="harness-abmcts-decision-reason">${esc(reason)}</div>` : ''}
      </div>
    `;
  }).join('') || '<div class="harness-empty compact">Prepare replay to inspect AB-MCTS decisions</div>';
}

function syncSessionNav(tabId) {
  document.querySelectorAll('.session-tab').forEach(tab => {
    const active = tab.dataset.sessionTab === tabId;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function syncWorkspaceLayout(tabId) {
  const isChat = tabId === 'chat';
  const mainEl = document.getElementById('main');
  const chatWorkspace = document.getElementById('chat-workspace');
  mainEl?.classList.toggle('harness-focus', !isChat);
  chatWorkspace?.classList.toggle('hidden', !isChat);
  if (harnessPanel) {
    if (isChat) delete harnessPanel.dataset.activeTab;
    else harnessPanel.dataset.activeTab = tabId;
  }
}

function switchSessionTab(tabId) {
  const nextTab = tabId || 'chat';
  syncWorkspaceLayout(nextTab);
  if (nextTab === 'chat') {
    activeAppMode = 'chat';
    syncSessionNav('chat');
    harnessPanel?.classList.add('hidden');
    topbarHarnessBar?.classList.add('hidden');
    return;
  }

  activeAppMode = nextTab;
  activeHarnessTab = nextTab;
  syncSessionNav(nextTab);
  harnessPanel?.classList.remove('hidden');
  topbarHarnessBar?.classList.remove('hidden');
  send({ type: 'harness_status' });
  switchHarnessTab(nextTab, { syncNav: false });
}

function switchHarnessTab(tabId, { syncNav = true } = {}) {
  activeHarnessTab = tabId || 'run';
  if (syncNav) syncSessionNav(activeHarnessTab);
  document.querySelectorAll('.harness-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `harness-tab-${activeHarnessTab}`);
  });
  updateHarnessPanelFooterVisibility();
  renderHarnessSwarmConfigBanner();
  if (activeHarnessTab === 'capabilities' && !harnessCapabilitiesLoaded) {
    requestHarnessCapabilities();
  }
  if (activeHarnessTab === 'capabilities' && !harnessSkillCandidatesLoaded) {
    requestHarnessSkillCandidates();
  }
  if (activeHarnessTab === 'capabilities') {
    requestHarnessPiBridgeState();
    requestHarnessPromotionQueue();
  }
  if (activeHarnessTab === 'traces' && !harnessTracesLoaded) {
    requestHarnessTraces();
  }
  if (activeHarnessTab === 'run' && !harnessAdaptiveLoaded) {
    requestHarnessAdaptiveSearchStatus();
  }
  if (activeHarnessTab === 'swarm' && !harnessState.recursiveEvolutionEvidence) {
    requestHarnessRecursiveEvolutionEvidence();
  }
  if (activeHarnessTab === 'swarm' && !harnessState.autonomyDashboard) {
    requestAutonomyDashboard();
  }
}

function openHarnessTab(tabId) {
  switchSessionTab(tabId || 'run');
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
  send({ type: 'harness_capabilities_get', workspaceRoot: getSelectedWorkspacePath() || undefined });
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
    ...capabilityBucketFromPayload(direct, ['template', 'templates']),
    ...capabilityBucketFromPayload(direct, ['slash_command', 'slashCommands', 'slash_commands']),
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
  if (value === 'templates') return 'template';
  if (value === 'slash-command' || value === 'slash command' || value === 'slash_commands') return 'slash_command';
  return CAPABILITY_TYPES.some(item => item.id === value) ? value : 'skill';
}

function listToText(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return Object.keys(value).join(', ');
  return String(value || '');
}

function slugText(value) {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function safeUrl(value) {
  try {
    return new URL(String(value || '').trim());
  } catch {
    return null;
  }
}

function stripTrailingUrlPunctuation(value) {
  return String(value || '').replace(/[),.;]+$/g, '');
}

function commandTokens(value) {
  return Array.from(String(value || '').trim().matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g))
    .map(match => match[1] || match[2] || match[3])
    .filter(Boolean);
}

function displayNameFromLocation(value) {
  const input = String(value || '').trim();
  const parsed = safeUrl(input);
  const raw = parsed ? parsed.pathname : input;
  const parts = raw.replace(/^\/+|\/+$/g, '').split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || parsed?.hostname || input || 'capability';
}

function smitherySkillQualifiedNameFromInput(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const urlMatch = input.match(/https?:\/\/smithery\.ai\/skills\/[^\s"'<>]+/i);
  const parsed = safeUrl(stripTrailingUrlPunctuation(urlMatch?.[0] || input));
  if (parsed?.hostname === 'smithery.ai') {
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const skillsIndex = parts.findIndex(part => part.toLowerCase() === 'skills');
    if (skillsIndex >= 0 && parts.length >= skillsIndex + 3) {
      return `${parts[skillsIndex + 1]}/${parts[skillsIndex + 2]}`;
    }
  }
  const bareMatch = input.match(/(?:^|\s)@?([a-z0-9_.-]+\/[a-z0-9_.-]+)(?:\s|$)/i);
  return bareMatch ? bareMatch[1] : '';
}

function smitherySkillUrlFromInput(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const urlMatch = input.match(/https?:\/\/smithery\.ai\/skills\/[^\s"'<>]+/i);
  if (urlMatch) return stripTrailingUrlPunctuation(urlMatch[0]);
  const qualifiedName = smitherySkillQualifiedNameFromInput(input);
  return qualifiedName ? `https://smithery.ai/skills/${qualifiedName.replace(/^@/, '')}` : '';
}

function remoteUrlFromInput(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  const urlMatch = input.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) return stripTrailingUrlPunctuation(urlMatch[0]);
  return input;
}

function codexSkillQualifiedNameFromInput(value) {
  const input = String(value || '').trim();
  const urlMatch = input.match(/https?:\/\/codex\.openai\.com\/marketplace\/skills\/[^\s"'<>]+/i);
  const parsed = safeUrl(stripTrailingUrlPunctuation(urlMatch?.[0] || input));
  if (parsed?.hostname === 'codex.openai.com') {
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const skillsIndex = parts.findIndex(part => part.toLowerCase() === 'skills');
    if (skillsIndex >= 0 && parts.length >= skillsIndex + 3) {
      return `${parts[skillsIndex + 1]}/${parts[skillsIndex + 2]}`;
    }
  }
  const bareMatch = input.match(/(?:^|\s)@?([a-z0-9_.-]+\/[a-z0-9_.-]+)(?:\s|$)/i);
  return bareMatch ? bareMatch[1] : '';
}

function codexSkillUrlFromInput(value) {
  const installUrl = remoteUrlFromInput(value);
  if (/^https?:\/\/codex\.openai\.com\/marketplace\/skills\//i.test(installUrl)) return installUrl;
  const qualifiedName = codexSkillQualifiedNameFromInput(value);
  return qualifiedName ? `https://codex.openai.com/marketplace/skills/${qualifiedName.replace(/^@/, '')}` : '';
}

function mcpNameFromUrl(value) {
  const input = remoteUrlFromInput(value);
  const parsed = safeUrl(input);
  if (parsed) {
    const pathName = parsed.pathname.replace(/^\/+|\/+$/g, '');
    return pathName || parsed.hostname;
  }
  return input.replace(/^@/, '');
}

function buildCodexSkillInstallRecord(input) {
  const qualifiedName = codexSkillQualifiedNameFromInput(input);
  const installUrl = codexSkillUrlFromInput(input);
  const displayName = qualifiedName || displayNameFromLocation(installUrl);
  return {
    id: `codex:skill:${slugText(qualifiedName || displayName) || 'skill'}`,
    type: 'skill',
    name: qualifiedName || displayName,
    enabled: true,
    pathOrCommandOrUrl: installUrl,
    url: installUrl,
    command: 'npx',
    args: ['-y', 'codex', 'skills', 'add', installUrl],
    approvalMode: 'inherit',
    notes: 'Installed from Codex marketplace skill link.',
    metadata: {
      source: 'codex_marketplace',
      kind: 'skill',
      qualifiedName,
      installCommand: `npx -y codex skills add ${installUrl}`,
    },
  };
}

function buildCodexPluginInstallRecord(input) {
  const parsed = safeUrl(input);
  const pluginRef = parsed?.protocol === 'codex:' && parsed.hostname === 'plugins'
    ? parsed.pathname.replace(/^\/+|\/+$/g, '')
    : commandTokens(input).at(-1);
  const [pluginName = pluginRef || 'plugin', marketplace = 'default'] = String(pluginRef || '').split('@');
  const location = parsed?.protocol === 'codex:' ? String(input || '').trim() : `codex://plugins/${pluginName}@${marketplace}`;
  return {
    id: `codex:plugin:${slugText(`${pluginName}-${marketplace}`) || 'plugin'}`,
    type: 'skill',
    name: `${pluginName}@${marketplace}`,
    enabled: true,
    pathOrCommandOrUrl: location,
    url: location,
    approvalMode: 'inherit',
    notes: 'Install/use Codex plugin from the Codex marketplace.',
    metadata: {
      source: 'codex_marketplace',
      kind: 'plugin',
      pluginName,
      marketplace,
      installSurface: 'codex_app',
      deepLink: location,
    },
  };
}

function buildClaudeInstallRecord(input) {
  const tokens = commandTokens(input);
  const commandIndex = tokens.findIndex(token => token.toLowerCase() === 'claude');
  const args = commandIndex >= 0 ? tokens.slice(commandIndex + 1) : [];
  const mode = args[0]?.toLowerCase();
  if (mode === 'plugin') {
    const pluginRef = args.find(arg => arg.includes('@')) || args.at(-1) || 'plugin';
    const [pluginName = pluginRef, marketplace = 'default'] = pluginRef.split('@');
    return {
      id: `claude:plugin:${slugText(`${pluginName}-${marketplace}`) || 'plugin'}`,
      type: 'skill',
      name: pluginRef,
      enabled: true,
      pathOrCommandOrUrl: pluginRef,
      command: 'claude',
      args,
      approvalMode: 'inherit',
      notes: 'Installed from Claude Code marketplace plugin command.',
      metadata: {
        source: 'claude_code_marketplace',
        kind: 'plugin',
        pluginName,
        marketplace,
        installCommand: ['claude', ...args].join(' '),
        activationCommand: '/reload-plugins',
      },
    };
  }
  const isMcp = mode === 'mcp';
  const installUrl = remoteUrlFromInput(input);
  const mcpName = isMcp ? args.find(arg => arg !== 'mcp' && arg !== 'add' && !/^https?:\/\//i.test(arg)) : '';
  const name = isMcp ? (mcpName || displayNameFromLocation(installUrl)) : displayNameFromLocation(installUrl || args.at(-1));
  return {
    id: `claude:${isMcp ? 'mcp' : 'skill'}:${slugText(name) || (isMcp ? 'server' : 'skill')}`,
    type: isMcp ? 'mcp' : 'skill',
    name,
    enabled: true,
    transport: isMcp && /^https?:\/\//i.test(installUrl) ? 'http' : undefined,
    pathOrCommandOrUrl: installUrl || args.join(' '),
    url: /^https?:\/\//i.test(installUrl) ? installUrl : undefined,
    command: 'claude',
    args,
    approvalMode: 'inherit',
    notes: isMcp ? 'Installed from Claude Code MCP command.' : 'Installed from Claude Code marketplace skill command.',
    metadata: {
      source: 'claude_code_marketplace',
      kind: isMcp ? 'mcp' : 'skill',
      qualifiedName: name,
      installCommand: ['claude', ...args].join(' '),
    },
  };
}

function buildPiExtensionInstallRecord(input) {
  const tokens = commandTokens(input);
  const commandIndex = tokens.findIndex(token => /^pi(?:\.cmd|\.ps1)?$/i.test(token) || token.toLowerCase() === 'pi-agent');
  const args = commandIndex >= 0 ? tokens.slice(commandIndex + 1) : [];
  const location = remoteUrlFromInput(input);
  const name = displayNameFromLocation(location);
  return {
    id: `pi_extension:${slugText(name) || 'extension'}`,
    type: 'pi_extension',
    name,
    enabled: true,
    pathOrCommandOrUrl: location,
    url: /^https?:\/\//i.test(location) ? location : undefined,
    command: args.length ? tokens[commandIndex] : undefined,
    args,
    approvalMode: 'inherit',
    notes: 'Installed from Pi Agent extension source.',
    metadata: {
      source: 'pi_agent_extension',
      kind: 'pi_extension',
      installTarget: 'pi_agent_extensions',
      installCommand: args.length ? [tokens[commandIndex], ...args].join(' ') : undefined,
    },
  };
}

function buildSmitherySkillInstallRecord(input, skill = null) {
  const qualifiedName = skill?.qualifiedName || smitherySkillQualifiedNameFromInput(input);
  const installUrl = skill?.installUrl || smitherySkillUrlFromInput(input);
  const displayName = qualifiedName || skill?.displayName || 'Smithery Skill';
  return {
    id: `smithery:skill:${slugText(qualifiedName || displayName) || 'skill'}`,
    type: 'skill',
    name: qualifiedName || displayName,
    enabled: true,
    pathOrCommandOrUrl: installUrl,
    url: installUrl,
    command: 'npx',
    args: ['-y', 'skills', 'add', installUrl],
    approvalMode: 'inherit',
    notes: skill?.description || 'Installed from Smithery skill link.',
    metadata: {
      source: 'smithery',
      kind: 'skill',
      qualifiedName,
      verified: skill?.verified === true,
      useCount: Number(skill?.useCount || 0),
      installCommand: `npx -y skills add ${installUrl}`,
    },
  };
}

function buildMcpInstallRecord(input, server = null) {
  const installUrl = server?.installUrl || remoteUrlFromInput(input);
  const qualifiedName = server?.qualifiedName || mcpNameFromUrl(installUrl);
  const isSmithery = /smithery\.ai|smithery\.run|server\.smithery\.ai/i.test(installUrl);
  return {
    id: `${isSmithery ? 'smithery' : 'mcp'}:mcp:${slugText(qualifiedName || server?.displayName || 'server') || 'server'}`,
    type: 'mcp',
    name: server?.displayName || qualifiedName || 'Remote MCP',
    enabled: true,
    transport: /^https?:\/\//i.test(installUrl) ? 'http' : undefined,
    pathOrCommandOrUrl: installUrl,
    url: /^https?:\/\//i.test(installUrl) ? installUrl : undefined,
    approvalMode: 'inherit',
    notes: server?.description || (isSmithery ? 'Installed from Smithery MCP URL.' : 'Installed from remote MCP URL.'),
    metadata: {
      source: isSmithery ? 'smithery' : 'remote_url',
      kind: 'mcp',
      qualifiedName,
      verified: server?.verified === true,
      useCount: Number(server?.useCount || 0),
    },
  };
}

function parseCapabilityInstallInput(value) {
  const input = String(value || '').trim();
  if (!input) return { kind: 'empty', value: '' };
  if (/^codex:\/\/plugins\/[^?\s]+/i.test(input) || /(?:^|\s)codex\s+plugin\s+(?:install|marketplace\s+add)\s+/i.test(input)) {
    return { kind: 'codex-plugin', value: input };
  }
  if (/(?:^|\s)codex\s+skills?\s+add\s+/i.test(input) || /https?:\/\/codex\.openai\.com\/marketplace\/skills\//i.test(input)) {
    return {
      kind: 'codex-skill',
      value: input,
      qualifiedName: codexSkillQualifiedNameFromInput(input),
      installUrl: codexSkillUrlFromInput(input),
    };
  }
  if (/(?:^|\s)claude\s+(?:skill|skills|mcp)\s+add\s+/i.test(input) || /(?:^|\s)claude\s+plugin\s+(?:install|marketplace\s+add)\s+/i.test(input) || /https?:\/\/(?:www\.)?(?:anthropic\.com|claude\.ai)\/[^\s"'<>]*(?:skill|mcp|marketplace)/i.test(input)) {
    return { kind: 'claude', value: input };
  }
  if (/(?:^|\s)pi(?:\.cmd|\.ps1)?\s+(?:extension|extensions)\s+add\s+/i.test(input) || /(?:^|\s)pi-agent\s+(?:extension|extensions)\s+add\s+/i.test(input) || /(?:^|[\\/])\.pi[\\/]agent[\\/]extensions[\\/]/i.test(input)) {
    return { kind: 'pi-extension', value: input };
  }
  if (/(?:^|\s)skills\s+add\s+/i.test(input) || /https?:\/\/smithery\.ai\/skills\//i.test(input)) {
    return {
      kind: 'skill',
      value: input,
      qualifiedName: smitherySkillQualifiedNameFromInput(input),
      installUrl: smitherySkillUrlFromInput(input),
    };
  }
  if (/https?:\/\/(?:mcp\.)?smithery\.run\//i.test(input) || /https?:\/\/server\.smithery\.ai\//i.test(input)) {
    const installUrl = remoteUrlFromInput(input);
    return { kind: 'mcp', value: input, qualifiedName: mcpNameFromUrl(installUrl), installUrl };
  }
  if (/^https?:\/\//i.test(input)) {
    const installUrl = remoteUrlFromInput(input);
    return { kind: 'mcp', value: input, qualifiedName: mcpNameFromUrl(installUrl), installUrl };
  }
  if (/^(?:[a-z]:[\\/]|\.{1,2}[\\/]|[\\/])/i.test(input)) {
    return { kind: 'local-skill', value: input };
  }
  return { kind: 'search', value: input };
}

function searchQueryFromCapabilityInput(value) {
  const parsed = parseCapabilityInstallInput(value);
  if (parsed.kind === 'skill') return parsed.qualifiedName || parsed.value;
  if (parsed.kind === 'codex-skill') return parsed.qualifiedName || parsed.value;
  if (parsed.kind === 'mcp') return parsed.qualifiedName || parsed.value;
  return parsed.value || '';
}

function buildCapabilityRecordFromInstallInput(value) {
  const parsed = parseCapabilityInstallInput(value);
  if (parsed.kind === 'skill') return buildSmitherySkillInstallRecord(parsed.value);
  if (parsed.kind === 'codex-plugin') return buildCodexPluginInstallRecord(parsed.value);
  if (parsed.kind === 'codex-skill') return buildCodexSkillInstallRecord(parsed.value);
  if (parsed.kind === 'claude') return buildClaudeInstallRecord(parsed.value);
  if (parsed.kind === 'pi-extension') return buildPiExtensionInstallRecord(parsed.value);
  if (parsed.kind === 'mcp') return buildMcpInstallRecord(parsed.installUrl || parsed.value);
  if (parsed.kind === 'local-skill') {
    return {
      id: `skill:${slugText(parsed.value) || 'local'}`,
      type: 'skill',
      name: parsed.value.split(/[\\/]/).filter(Boolean).pop() || 'Local Skill',
      enabled: true,
      pathOrCommandOrUrl: parsed.value,
      path: parsed.value,
      approvalMode: 'inherit',
      notes: 'Installed from local skill path.',
    };
  }
  return null;
}

function buildCapabilityRecordFromSmitheryResult(result) {
  if (result?.kind === 'skill') return buildSmitherySkillInstallRecord(result.installUrl || result.qualifiedName, result);
  return buildMcpInstallRecord(result?.installUrl || result?.qualifiedName || result?.displayName || '', result);
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

function handleHarnessSmitheryResults(payload) {
  harnessSmitheryResults = Array.isArray(payload?.results) ? payload.results : [];
  renderSmitheryResults(payload);
  if (harnessCapabilityStatus) {
    harnessCapabilityStatus.textContent = payload?.error
      ? payload.error
      : `${harnessSmitheryResults.length} Smithery result${harnessSmitheryResults.length === 1 ? '' : 's'}`;
  }
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

function renderSmitheryResults(payload = {}) {
  if (!capabilitySmitheryResults) return;
  if (payload?.error) {
    capabilitySmitheryResults.innerHTML = `<div class="harness-empty compact">${esc(payload.error)}</div>`;
    return;
  }
  capabilitySmitheryResults.innerHTML = harnessSmitheryResults.map((server, index) => `
    <button class="harness-smithery-result" type="button" data-smithery-index="${index}">
      <span class="harness-smithery-result-main">
        <strong>${esc(server.displayName || server.qualifiedName || (server.kind === 'skill' ? 'Smithery skill' : 'Smithery MCP'))}</strong>
        <span>${esc(server.description || server.qualifiedName || server.installUrl || '')}</span>
      </span>
      <span class="harness-smithery-result-meta">
        <span>${esc(server.kind === 'skill' ? 'skill' : 'mcp')}</span>
        ${server.verified ? '<span>verified</span>' : ''}
        ${Number.isFinite(server.useCount) && server.useCount > 0 ? `<span>${server.useCount} uses</span>` : ''}
      </span>
    </button>
  `).join('') || '<div class="harness-empty compact">No Smithery results yet</div>';
}

function populateCapabilityForm(record) {
  if (!record) return;
  $('#capability-id').value = record.id || '';
  $('#capability-type').value = normalizeCapabilityType(record.type);
  $('#capability-name').value = record.name || '';
  $('#capability-enabled').checked = record.enabled !== false;
  $('#capability-location').value = record.pathOrCommandOrUrl || record.path || record.command || record.url || '';
  $('#capability-args').value = listToText(record.args);
  $('#capability-env').value = listToText(record.envVarNames || record.env);
  $('#capability-approval').value = record.approvalMode || 'inherit';
  $('#capability-notes').value = record.notes || '';
}

function requestSmitherySearch() {
  const query = searchQueryFromCapabilityInput(capabilityInstallQuery?.value || '');
  if (!query) {
    toast('Search term required', 'error');
    return;
  }
  if (harnessCapabilityStatus) harnessCapabilityStatus.textContent = 'Searching Smithery...';
  send({
    type: 'harness_smithery_search',
    query,
    apiKey: capabilitySmitheryKey?.value?.trim() || undefined,
    pageSize: 8,
  });
}

function saveCapabilityRecord(record) {
  if (!record?.name) {
    toast('Capability name required', 'error');
    return;
  }
  populateCapabilityForm(record);
  send({
    type: 'harness_capability_save',
    workspaceRoot: getSelectedWorkspacePath() || undefined,
    record,
  });
  if (harnessCapabilityStatus) harnessCapabilityStatus.textContent = `Installing ${record.name}...`;
}

function installCapabilityFromQuickSource() {
  const query = capabilityInstallQuery?.value?.trim() || '';
  if (!query) {
    toast('Link or path required', 'error');
    return;
  }
  const record = buildCapabilityRecordFromInstallInput(query);
  if (!record) {
    requestSmitherySearch();
    return;
  }
  saveCapabilityRecord(record);
}

function applySmitheryResult(index, { save = true } = {}) {
  const server = harnessSmitheryResults[Number(index)];
  if (!server) return;
  const record = buildCapabilityRecordFromSmitheryResult(server);
  if (save) saveCapabilityRecord(record);
  else populateCapabilityForm(record);
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
      <div class="harness-capability-item ${record.enabled ? '' : 'disabled'}" data-capability-id="${escAttr(record.id)}">
        <div class="harness-capability-item-main">
          <span class="harness-capability-name">${esc(record.name)}</span>
          <span class="harness-capability-meta">${esc(record.pathOrCommandOrUrl || record.approvalMode || 'local')}</span>
        </div>
        <div class="harness-capability-item-actions">
          <button class="harness-btn harness-btn-sm" type="button" data-capability-action="edit" data-capability-id="${escAttr(record.id)}">Edit</button>
          <button class="harness-btn harness-btn-sm" type="button" data-capability-action="delete" data-capability-id="${escAttr(record.id)}">Delete</button>
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
  saveCapabilityRecord(record);
}

function editHarnessCapability(capabilityId) {
  const record = harnessCapabilities.find(item => item.id === capabilityId);
  if (!record) return;
  populateCapabilityForm(record);
}

function deleteHarnessCapability(capabilityId) {
  if (!capabilityId) return;
  const record = harnessCapabilities.find(item => item.id === capabilityId);
  const ok = confirm(`Delete ${record?.name || 'this capability'}?`);
  if (!ok) return;
  send({
    type: 'harness_capability_delete',
    workspaceRoot: getSelectedWorkspacePath() || undefined,
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

function requestHarnessTraces() {
  if (harnessTraceStatus) harnessTraceStatus.textContent = 'Refreshing traces...';
  if (harnessTracesRequestTimer) clearTimeout(harnessTracesRequestTimer);
  harnessTracesRequestTimer = setTimeout(() => {
    if (harnessTraceStatus?.textContent === 'Refreshing traces...') {
      harnessTraceStatus.textContent = harnessTracesLoaded
        ? `${harnessTraceState.traces.length} trace${harnessTraceState.traces.length === 1 ? '' : 's'}`
        : 'No traces returned yet';
    }
  }, 2500);
  send({ type: 'harness_traces_get', limit: 25 });
}

function handleHarnessTraces(payload) {
  if (harnessTracesRequestTimer) clearTimeout(harnessTracesRequestTimer);
  harnessTracesLoaded = true;
  harnessTraceState.traces = Array.isArray(payload?.traces) ? payload.traces : [];
  const selectedStillExists = harnessTraceState.traces.some(trace => trace.taskId === harnessTraceState.selectedTaskId);
  if (!selectedStillExists) {
    harnessTraceState.selectedTaskId = harnessTraceState.traces[0]?.taskId || null;
    harnessTraceState.selectedTrace = null;
    harnessTraceState.replayEvents = [];
    harnessTraceState.replayDecisions = [];
    harnessTraceState.replayCursor = 0;
    harnessTraceState.replayDone = true;
  }
  renderHarnessTraces();
  if (harnessTraceState.selectedTaskId && !harnessTraceState.selectedTrace) {
    requestHarnessTrace(harnessTraceState.selectedTaskId);
  }
}

function requestHarnessTrace(taskId) {
  if (!taskId) return;
  harnessTraceState.selectedTaskId = taskId;
  harnessTraceState.replayEvents = [];
  harnessTraceState.replayDecisions = [];
  harnessTraceState.replayCursor = 0;
  harnessTraceState.replayDone = true;
  if (harnessTraceStatus) harnessTraceStatus.textContent = `Loading ${taskId}...`;
  send({ type: 'harness_trace_get', taskId });
  renderHarnessTraces();
}

function handleHarnessTrace(payload) {
  harnessTraceState.selectedTrace = payload || null;
  harnessTraceState.selectedTaskId = payload?.taskId || harnessTraceState.selectedTaskId;
  harnessTraceState.replayEvents = [];
  harnessTraceState.replayDecisions = [];
  harnessTraceState.replayCursor = 0;
  harnessTraceState.replayDone = true;
  renderHarnessTraces();
}

function prepareHarnessTraceReplay({ next = false } = {}) {
  const taskId = harnessTraceState.selectedTaskId;
  if (!taskId) return;
  const cursor = next ? harnessTraceState.replayCursor : 0;
  if (!next) {
    harnessTraceState.replayEvents = [];
    harnessTraceState.replayDecisions = [];
    harnessTraceState.replayCursor = 0;
    harnessTraceState.replayDone = true;
  }
  if (harnessTraceStatus) harnessTraceStatus.textContent = next ? 'Replaying next events...' : 'Preparing replay...';
  send({ type: 'harness_trace_replay_prepare', taskId, cursor, limit: 25 });
  renderHarnessTraces();
}

function resetHarnessTraceReplay() {
  harnessTraceState.replayEvents = [];
  harnessTraceState.replayDecisions = [];
  harnessTraceState.replayCursor = 0;
  harnessTraceState.replayDone = true;
  renderHarnessTraces();
}

function handleHarnessTraceReplay(payload) {
  if (payload?.taskId && payload.taskId !== harnessTraceState.selectedTaskId) {
    harnessTraceState.selectedTaskId = payload.taskId;
  }
  const events = Array.isArray(payload?.events) ? payload.events : [];
  harnessTraceState.replayEvents = harnessTraceState.replayCursor > 0
    ? [...harnessTraceState.replayEvents, ...events]
    : events;
  const decisions = extractAbMctsDecisions(payload, events);
  harnessTraceState.replayDecisions = harnessTraceState.replayCursor > 0
    ? [...harnessTraceState.replayDecisions, ...decisions]
    : decisions;
  harnessTraceState.replayCursor = Number.isFinite(payload?.nextCursor) ? payload.nextCursor : harnessTraceState.replayEvents.length;
  harnessTraceState.replayDone = payload?.done !== false;
  if (payload?.summary && harnessTraceState.selectedTrace) {
    harnessTraceState.selectedTrace = { ...harnessTraceState.selectedTrace, summary: payload.summary };
  }
  renderHarnessTraces();
}

function traceLabel(trace) {
  return trace?.summary?.task?.summary || trace?.summary?.task?.task || trace?.latestTaskEvent?.type || trace?.taskId || 'trace';
}

function formatTraceTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function numberFrom(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summarizeTraceCounters(trace) {
  const events = trace?.events || [];
  const summary = trace?.summary || {};
  let cost = null;
  let contextUsed = null;
  let contextMax = null;

  for (const event of events) {
    cost = numberFrom(event?.cost?.usd ?? event?.costUsd ?? event?.usage?.costUsd) ?? cost;
    contextUsed = numberFrom(event?.context?.tokensUsed ?? event?.contextTokens ?? event?.tokensEstimated ?? event?.usage?.inputTokens) ?? contextUsed;
    contextMax = numberFrom(event?.context?.maxTokens ?? event?.maxTokens ?? event?.usage?.contextWindow) ?? contextMax;
  }

  const costText = cost === null ? 'cost n/a' : `$${cost.toFixed(4)}`;
  const contextText = contextUsed === null
    ? 'ctx n/a'
    : contextMax === null ? `${contextUsed.toLocaleString()} ctx` : `${contextUsed.toLocaleString()}/${contextMax.toLocaleString()} ctx`;
  return {
    eventText: `${summary.eventCount || events.length || 0} events`,
    costText,
    contextText,
  };
}

function renderTraceEventRow(event, index) {
  const meta = [
    formatTraceTime(event?.timestamp),
    event?.taskId,
    event?.status,
    Number.isFinite(event?.tokensEstimated) ? `${event.tokensEstimated.toLocaleString()} tok` : '',
  ].filter(Boolean).join(' | ');
  return `
    <div class="harness-trace-event">
      <span class="harness-trace-event-index">${index + 1}</span>
      <div class="harness-trace-event-body">
        <div class="harness-trace-event-top">
          <span class="harness-trace-event-type">${esc(event?.type || 'event')}</span>
          ${meta ? `<span class="harness-trace-event-meta">${esc(meta)}</span>` : ''}
        </div>
        <div class="harness-trace-event-summary">${esc(event?.summary || event?.reason || event?.intent || event?.result || '')}</div>
      </div>
    </div>
  `;
}

function renderHarnessTraces() {
  if (!harnessTraceList || !harnessTraceEvents) return;

  harnessTraceList.innerHTML = harnessTraceState.traces.map(trace => `
    <button class="harness-trace-item ${trace.taskId === harnessTraceState.selectedTaskId ? 'active' : ''}" type="button" data-trace-action="select" data-task-id="${escAttr(trace.taskId)}">
      <span class="harness-trace-item-name">${esc(traceLabel(trace))}</span>
      <span class="harness-trace-item-meta">${esc(trace.taskId)} | ${trace.eventCount || 0} events</span>
    </button>
  `).join('') || '<div class="harness-empty compact">No traces found</div>';

  const selectedTrace = harnessTraceState.selectedTrace;
  const counters = summarizeTraceCounters(selectedTrace);
  if (harnessTraceEventCount) harnessTraceEventCount.textContent = counters.eventText;
  if (harnessTraceCostCount) harnessTraceCostCount.textContent = counters.costText;
  if (harnessTraceContextCount) harnessTraceContextCount.textContent = counters.contextText;

  if (harnessTraceStatus) {
    if (selectedTrace?.taskId) {
      harnessTraceStatus.textContent = `${harnessTraceState.traces.length} trace${harnessTraceState.traces.length === 1 ? '' : 's'} | ${selectedTrace.taskId}`;
    } else {
      harnessTraceStatus.textContent = harnessTracesLoaded
        ? `${harnessTraceState.traces.length} trace${harnessTraceState.traces.length === 1 ? '' : 's'}`
        : 'No traces loaded';
    }
  }

  const events = harnessTraceState.replayEvents.length ? harnessTraceState.replayEvents : (selectedTrace?.events || []);
  renderHarnessAbMctsReplay();
  harnessTraceEvents.innerHTML = events.map(renderTraceEventRow).join('')
    || '<div class="harness-empty compact">Select a trace to inspect events</div>';
}

function handleHarnessPanelClick(event) {
  const deepPreset = event.target.closest('[data-deep-preset]');
  if (deepPreset) {
    applyDeepResearchPreset(deepPreset.dataset.deepPreset);
    return;
  }

  const traceButton = event.target.closest('[data-trace-action]');
  if (traceButton) {
    if (traceButton.dataset.traceAction === 'select') requestHarnessTrace(traceButton.dataset.taskId);
    return;
  }

  const swarmAttempt = event.target.closest('[data-swarm-attempt-id]');
  if (swarmAttempt) {
    harnessState.swarm.selectedAttemptId = swarmAttempt.dataset.swarmAttemptId;
    harnessState.swarm.selectedEventKey = null;
    if (activeHarnessTab !== 'swarm') switchSessionTab('swarm');
    else renderHarnessPanel();
    return;
  }

  const swarmEvent = event.target.closest('[data-swarm-event-key]');
  if (swarmEvent) {
    harnessState.swarm.selectedEventKey = swarmEvent.dataset.swarmEventKey;
    renderHarnessPanel();
    return;
  }

  const smitheryResult = event.target.closest('[data-smithery-index]');
  if (smitheryResult) {
    applySmitheryResult(smitheryResult.dataset.smitheryIndex);
    return;
  }

  const skillCandidateAction = event.target.closest('[data-skill-candidate-action]');
  if (skillCandidateAction) {
    reviewHarnessSkillCandidate(skillCandidateAction.dataset.candidateId, skillCandidateAction.dataset.skillCandidateAction);
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
    if (activeHarnessTab === 'run') requestHarnessAdaptiveSearchStatus();
    if (activeHarnessTab === 'capabilities') requestHarnessCapabilities();
    if (activeHarnessTab === 'capabilities') requestHarnessSkillCandidates();
    if (activeHarnessTab === 'traces') requestHarnessTraces();
    if (activeHarnessTab === 'swarm' && !harnessState.recursiveEvolutionEvidence) {
      requestHarnessRecursiveEvolutionEvidence();
    }
    if (activeHarnessTab === 'swarm' && !harnessState.autonomyDashboard) {
      requestAutonomyDashboard();
    }
  }
}

function startHarness() {
  send({ type: 'harness_start', workspaceRoot: getSelectedWorkspacePath() || undefined });
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
    /^\/(?:research|deep-research|forge)\b/i,
    /\b(?:use|run|launch|start)\b.*\b(?:harness|bes|meta|sidecar)\b/i,
    /\b(?:harness|bes|meta)\b.*\b(?:this|project|task|prompt|repo|repository)\b/i,
  ];
  const isSlashHarness = /^\/(?:harness|research|deep-research|forge)\b/i.test(normalized);
  const direct = directPatterns.some(pattern => pattern.test(normalized));
  const task = isSlashHarness
    ? normalized.replace(/^\/(?:harness|research|deep-research|forge)\b[\s:;-]*/i, '').trim() || normalized
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
    workspaceRoot: getSelectedWorkspacePath() || undefined,
  });

  debug(`Harness ${route.mode} launch: ${route.reason}`);
  if (route.mode === 'direct') {
    harnessPanel.classList.remove('hidden');
    toast('Harness launched', 'success');
  }

  return route;
}

function readDeepResearchSpecialists() {
  return Array.from(document.querySelectorAll('input[name="deep-specialist"]:checked'))
    .map((input) => input.value)
    .filter(Boolean);
}

function loadDeepResearchSettings() {
  try {
    const raw = localStorage.getItem(DEEP_RESEARCH_SETTINGS_KEY);
    if (!raw) return;
    const settings = JSON.parse(raw);
    if (settings.scopeInclude && harnessDeepScopeInclude) harnessDeepScopeInclude.value = settings.scopeInclude;
    if (settings.scopeExclude && harnessDeepScopeExclude) harnessDeepScopeExclude.value = settings.scopeExclude;
    if (settings.maxToolCalls && harnessDeepToolCalls) harnessDeepToolCalls.value = String(settings.maxToolCalls);
    if (settings.maxWallMinutes && harnessDeepMinutes) harnessDeepMinutes.value = String(settings.maxWallMinutes);
    if (settings.maxSources && harnessDeepMaxSources) harnessDeepMaxSources.value = String(settings.maxSources);
    if (settings.maxInputTokens && harnessDeepMaxTokens) {
      harnessDeepMaxTokens.value = String(Math.round(settings.maxInputTokens / 1000));
    }
    if (settings.outputFormat && harnessDeepOutputFormat) harnessDeepOutputFormat.value = settings.outputFormat;
    if (Array.isArray(settings.specialists)) {
      document.querySelectorAll('input[name="deep-specialist"]').forEach((input) => {
        input.checked = settings.specialists.includes(input.value);
      });
    }
  } catch {
    // ignore invalid persisted settings
  }
}

function saveDeepResearchSettings() {
  try {
    const maxInputTokens = Number.parseInt(harnessDeepMaxTokens?.value || '200', 10) * 1000;
    localStorage.setItem(DEEP_RESEARCH_SETTINGS_KEY, JSON.stringify({
      scopeInclude: harnessDeepScopeInclude?.value?.trim() || '',
      scopeExclude: harnessDeepScopeExclude?.value?.trim() || '',
      maxToolCalls: Number.parseInt(harnessDeepToolCalls?.value || '80', 10),
      maxWallMinutes: Number.parseInt(harnessDeepMinutes?.value || '45', 10),
      maxSources: Number.parseInt(harnessDeepMaxSources?.value || '16', 10),
      maxInputTokens: Number.isFinite(maxInputTokens) ? maxInputTokens : 200000,
      outputFormat: harnessDeepOutputFormat?.value || 'full_report',
      specialists: readDeepResearchSpecialists(),
    }));
  } catch {
    // ignore storage failures
  }
}

function applyDeepResearchPreset(presetId) {
  const preset = DEEP_RESEARCH_PRESETS[presetId];
  if (!preset) return;
  if (harnessDeepToolCalls) harnessDeepToolCalls.value = String(preset.maxToolCalls);
  if (harnessDeepMinutes) harnessDeepMinutes.value = String(preset.maxWallMinutes);
  if (harnessDeepMaxSources) harnessDeepMaxSources.value = String(preset.maxSources);
  if (harnessDeepMaxTokens) harnessDeepMaxTokens.value = String(Math.round(preset.maxInputTokens / 1000));
  saveDeepResearchSettings();
  if (harnessDeepStatus) {
    harnessDeepStatus.textContent = `Preset applied: ${presetId.replace('_', ' ')} (${preset.maxToolCalls} calls · ${preset.maxWallMinutes} min · ${preset.maxSources} sources)`;
  }
}

function buildDeepResearchTaskPrompt({
  question,
  scopeInclude,
  scopeExclude,
  outputFormat,
  specialists,
}) {
  const outputLabels = {
    full_report: 'Full report with bibliography',
    brief: 'Executive brief',
    claim_evidence: 'Claim–evidence table',
    implementation_handoff: 'Implementation handoff',
  };
  const lines = [
    question,
    '',
    '---',
    'Deep research contract:',
    `Output format: ${outputLabels[outputFormat] || outputFormat}`,
  ];
  if (scopeInclude) lines.push(`Scope include: ${scopeInclude}`);
  if (scopeExclude) lines.push(`Scope exclude: ${scopeExclude}`);
  if (specialists.length) lines.push(`Activate specialists: ${specialists.join(', ')}`);
  lines.push('Require citations, claim-evidence separation, contradiction review, and implementation handoff when code changes are implied.');
  return lines.join('\n');
}

function getDeepResearchRun(taskId) {
  return harnessState.research.runs.find((run) => run.taskId === taskId) || null;
}

function ensureDeepResearchRun({ taskId, question }) {
  let run = getDeepResearchRun(taskId);
  if (!run) {
    run = {
      taskId,
      question,
      status: 'running',
      startedAt: new Date().toISOString(),
      events: [],
      metrics: {},
      artifactIds: [],
      completedStages: new Set(),
    };
    harnessState.research.runs.unshift(run);
    harnessState.research.runs = harnessState.research.runs.slice(0, 6);
  }
  harnessState.research.activeTaskId = taskId;
  return run;
}

function formatDeepResearchEventSummary(event = {}) {
  if (event.type === 'research.report_created') {
    return `Report created · ${event.sourceCount || 0} sources · ${event.verifiedClaims || 0}/${event.totalClaims || 0} claims verified`;
  }
  if (event.type === 'research.v2_artifacts_created') {
    return `V2 artifacts · ${(event.artifactNames || []).length} files · risk ${event.riskLevel || 'n/a'}`;
  }
  if (event.type === 'research.v2_artifacts_failed') {
    return event.error || event.reason || 'V2 artifact generation failed';
  }
  if (event.type === 'research.handoff_created') {
    return 'Implementation handoff ready';
  }
  if (event.type === 'task.started') {
    return 'Research run started';
  }
  return event.summary || event.reason || event.intent || event.result || '';
}

function updateDeepResearchFromEvent(event = {}) {
  if (!event.taskId) return;
  const isResearchEvent = event.type?.startsWith('research.')
    || (event.type === 'task.started' && event.source === 'deep_research_ui');
  const run = getDeepResearchRun(event.taskId)
    || (isResearchEvent ? ensureDeepResearchRun({ taskId: event.taskId, question: event.summary || 'Research run' }) : null);
  if (!run) return;

  const summary = formatDeepResearchEventSummary(event);
  run.events.unshift({
    type: event.type,
    summary,
    timestamp: event.timestamp || new Date().toISOString(),
  });
  run.events = run.events.slice(0, 12);

  if (event.type === 'research.report_created') {
    run.metrics.sources = event.sourceCount;
    run.metrics.verifiedClaims = event.verifiedClaims;
    run.metrics.totalClaims = event.totalClaims;
    for (const artifact of event.artifacts || []) run.artifactIds.push(artifact.artifactId);
  }
  if (event.type === 'research.v2_artifacts_created') {
    run.metrics.artifactCount = (event.artifactNames || []).length;
    run.metrics.riskLevel = event.riskLevel;
    run.status = 'completed';
    harnessState.research.activeTaskId = null;
  }
  if (event.type === 'research.handoff_created') {
    run.status = 'completed';
    harnessState.research.activeTaskId = null;
  }
  if (event.type === 'research.v2_artifacts_failed') {
    run.status = 'failed';
    harnessState.research.activeTaskId = null;
  }

  for (const stage of DEEP_RESEARCH_PIPELINE) {
    if (stage.events.includes(event.type)) run.completedStages.add(stage.id);
  }
  if (event.type === 'research.report_created') {
    run.completedStages.add('discovery');
    run.completedStages.add('ingestion');
    run.completedStages.add('audit');
  }
  if (event.type === 'research.v2_artifacts_created' || event.type === 'research.handoff_created') {
    run.completedStages.add('contradictions');
    run.completedStages.add('handoff');
  }
}

function renderDeepResearchPipeline(run = null) {
  if (!harnessDeepPipeline) return;
  const completed = run?.completedStages || new Set();
  const activeStageId = run?.status === 'running'
    ? DEEP_RESEARCH_PIPELINE.find((stage) => !completed.has(stage.id))?.id || null
    : null;

  harnessDeepPipeline.innerHTML = DEEP_RESEARCH_PIPELINE.map((stage, index) => {
    const done = completed.has(stage.id);
    const active = stage.id === activeStageId;
    return `
      <div class="harness-deep-pipeline-step ${done ? 'done' : ''} ${active ? 'active' : ''}">
        <span class="harness-deep-pipeline-index">${done ? '✓' : index + 1}</span>
        <div class="harness-deep-pipeline-copy">
          <strong>${esc(stage.label)}</strong>
          <span>${esc(stage.description)}</span>
        </div>
      </div>
    `;
  }).join('');

  if (harnessDeepPipelineStatus) {
    if (!run) harnessDeepPipelineStatus.textContent = 'idle';
    else if (run.status === 'completed') harnessDeepPipelineStatus.textContent = 'complete';
    else if (run.status === 'failed') harnessDeepPipelineStatus.textContent = 'failed';
    else harnessDeepPipelineStatus.textContent = `${completed.size}/${DEEP_RESEARCH_PIPELINE.length} stages`;
  }
}

function renderDeepResearchArtifacts() {
  if (!harnessDeepArtifacts) return;
  const artifacts = Array.from(harnessState.artifacts.values())
    .filter((artifact) => /research/i.test(String(artifact.type || artifact.title || '')))
    .slice(0, 12);

  harnessDeepArtifacts.innerHTML = artifacts.map((artifact) => `
    <button class="harness-deep-artifact-card" type="button" onclick="openHarnessArtifact('${escAttr(artifact.artifactId)}')">
      <strong>${esc(artifact.title || artifact.type || 'Research artifact')}</strong>
      <span>${esc(artifact.type || 'artifact')}${artifact.path ? ` · ${esc(compactText(artifact.path, artifact.path))}` : ''}</span>
    </button>
  `).join('') || '<div class="harness-empty compact">Research reports appear here after a run completes.</div>';
}

function renderDeepResearchPanel() {
  if (!harnessDeepRunBadge) return;
  const activeRun = harnessState.research.activeTaskId
    ? getDeepResearchRun(harnessState.research.activeTaskId)
    : harnessState.research.runs[0] || null;

  renderDeepResearchPipeline(activeRun);

  if (activeRun) {
    harnessDeepRunBadge.textContent = activeRun.status;
    harnessDeepRunBadge.className = `harness-pill ${activeRun.status === 'completed' ? 'running' : activeRun.status}`;
    harnessDeepRunSummary.textContent = compactText(activeRun.question, activeRun.question);
    const metricParts = [];
    if (Number.isFinite(activeRun.metrics.sources)) metricParts.push(`${activeRun.metrics.sources} sources`);
    if (Number.isFinite(activeRun.metrics.verifiedClaims)) {
      metricParts.push(`${activeRun.metrics.verifiedClaims}/${activeRun.metrics.totalClaims || '?'} claims`);
    }
    if (activeRun.metrics.riskLevel) metricParts.push(`risk ${activeRun.metrics.riskLevel}`);
    if (activeRun.metrics.artifactCount) metricParts.push(`${activeRun.metrics.artifactCount} artifacts`);
    harnessDeepRunMetrics.innerHTML = metricParts.map((part) => `<span>${esc(part)}</span>`).join('');
    harnessDeepRunEvents.innerHTML = activeRun.events.map((entry) => `
      <div class="harness-deep-run-event">
        <div class="harness-deep-run-event-type">${esc(entry.type)}</div>
        <div class="harness-deep-run-event-summary">${esc(entry.summary)}</div>
      </div>
    `).join('') || '<div class="harness-empty compact">Waiting for research events…</div>';
  } else {
    harnessDeepRunBadge.textContent = 'idle';
    harnessDeepRunBadge.className = 'harness-pill';
    harnessDeepRunSummary.textContent = 'No active research run.';
    if (harnessDeepRunMetrics) harnessDeepRunMetrics.innerHTML = '';
    if (harnessDeepRunEvents) {
      harnessDeepRunEvents.innerHTML = '<div class="harness-empty compact">Start a research run to see live pipeline progress.</div>';
    }
  }

  renderDeepResearchArtifacts();
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
    workspaceRoot: getSelectedWorkspacePath() || undefined,
  });
  harnessTaskInput.value = '';
}

function runDeepResearchTask() {
  const question = harnessDeepTaskInput?.value?.trim();
  if (!question) {
    toast('Research question required', 'error');
    return;
  }
  saveDeepResearchSettings();

  const maxToolCalls = Number.parseInt(harnessDeepToolCalls?.value || '80', 10);
  const maxWallMinutes = Number.parseInt(harnessDeepMinutes?.value || '45', 10);
  const maxSources = Number.parseInt(harnessDeepMaxSources?.value || '16', 10);
  const maxInputTokens = Number.parseInt(harnessDeepMaxTokens?.value || '200', 10) * 1000;
  const scopeInclude = harnessDeepScopeInclude?.value?.trim() || '';
  const scopeExclude = harnessDeepScopeExclude?.value?.trim() || '';
  const outputFormat = harnessDeepOutputFormat?.value || 'full_report';
  const specialists = readDeepResearchSpecialists();
  const task = buildDeepResearchTaskPrompt({
    question,
    scopeInclude,
    scopeExclude,
    outputFormat,
    specialists,
  });

  if (harnessDeepStatus) harnessDeepStatus.textContent = 'Starting research run…';

  send({
    type: 'harness_task_start',
    task,
    mode: 'deep_research',
    budget: {
      maxToolCalls: Number.isFinite(maxToolCalls) ? maxToolCalls : 80,
      maxWallMinutes: Number.isFinite(maxWallMinutes) ? maxWallMinutes : 45,
      maxSources: Number.isFinite(maxSources) ? maxSources : 16,
      maxInputTokens: Number.isFinite(maxInputTokens) ? maxInputTokens : 200000,
    },
    source: 'deep_research_ui',
    workspaceRoot: getSelectedWorkspacePath() || undefined,
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
  send({ type: 'harness_artifact_get', artifactId, artifact });
}

function renderHarnessArtifact(payload) {
  const artifact = payload.artifact || {};
  $('#harness-artifact-title').textContent = artifact.title || artifact.type || 'Harness Artifact';
  const contentEl = $('#harness-artifact-content');
  contentEl.textContent = '';
  contentEl.classList.toggle('visual', Boolean(payload.dataUrl));
  if (payload.dataUrl && String(payload.contentType || '').startsWith('image/')) {
    const image = document.createElement('img');
    image.className = 'harness-artifact-image';
    image.src = payload.dataUrl;
    image.alt = artifact.summary || artifact.title || artifact.type || 'Harness artifact image';
    contentEl.appendChild(image);
    if (payload.content) {
      const caption = document.createElement('div');
      caption.className = 'harness-artifact-caption';
      caption.textContent = payload.content;
      contentEl.appendChild(caption);
    }
    return;
  }
  if (payload.dataUrl && payload.contentType === 'application/pdf') {
    const frame = document.createElement('iframe');
    frame.className = 'harness-artifact-frame';
    frame.src = payload.dataUrl;
    frame.title = artifact.summary || artifact.title || 'PDF artifact';
    contentEl.appendChild(frame);
    return;
  }
  contentEl.textContent = payload.content || '';
  openModal('harness-artifact');
}

function toggleThinkingTrace(button) {
  const block = button.closest('.thinking-block');
  if (!block) return;
  const expanded = block.classList.toggle('expanded');
  button.setAttribute('aria-expanded', String(expanded));
}

function ensureStreamShell(contentEl) {
  let liveEl = contentEl.querySelector('.stream-live');
  if (!liveEl) {
    liveEl = document.createElement('div');
    liveEl.className = 'stream-live';
    const textEl = document.createElement('span');
    textEl.className = 'stream-text';
    liveEl.appendChild(textEl);
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    liveEl.appendChild(cursor);
    contentEl.appendChild(liveEl);
  }
  return {
    liveEl,
    textEl: liveEl.querySelector('.stream-text'),
  };
}

function handleMessageUpdate(msg) {
  const ev = msg.assistantMessageEvent;
  if (!ev) return;

  switch (ev.type) {
    case 'text_start':
      setAssistantActivity({ phase: 'writing', detail: 'Writing response.' });
      if (activeStream && !activeStream.text) {
        const shell = ensureStreamShell(activeStream.contentEl);
        activeStream.textEl = shell.textEl;
        activeStream.liveEl = shell.liveEl;
      }
      break;
    case 'text_delta':
      setAssistantActivity({
        phase: 'writing',
        detail: 'Writing response.',
        textChars: assistantActivity.textChars + String(ev.delta || '').length,
      });
      if (activeStream) {
        if (!activeStream.textEl) {
          const shell = ensureStreamShell(activeStream.contentEl);
          activeStream.textEl = shell.textEl;
          activeStream.liveEl = shell.liveEl;
        }
        activeStream.text += ev.delta;
        activeStream.textEl.textContent = activeStream.text;
        scheduleScroll();
      }
      break;
    case 'thinking_start': 
      setAssistantActivity({ phase: 'thinking', detail: 'Model is producing a thinking trace.' });
      createThinkingBlock(); 
      break;
    case 'thinking_delta':
      setAssistantActivity({
        phase: 'thinking',
        detail: 'Model is thinking.',
        thinkingChars: assistantActivity.thinkingChars + String(ev.delta || '').length,
      });
      if (activeThinking) {
        activeThinking.text += ev.delta;
        if (activeThinking.previewEl) {
          activeThinking.previewEl.textContent = activeThinking.text.trim();
        }
        scheduleScroll();
      }
      break;
    case 'thinking_end':
      setAssistantActivity({ phase: 'writing', detail: 'Thinking trace complete.' });
      if (activeThinking) {
        activeThinking.el.classList.add('thinking-done');
        if (activeThinking.previewEl) {
          activeThinking.previewEl.textContent = activeThinking.text.trim();
        }
        activeThinking.contentEl.innerHTML = renderMD(activeThinking.text) + '<div class="done-line"><span class="check">✓</span> Done</div>';
        renderMath(activeThinking.contentEl);
        highlightCode(activeThinking.contentEl);
        activeThinking = null;
      }
      break;
    case 'done': finalizeStream(); break;
  }
}

function finalizeStream() {
  if (!activeStream) return;
  const { el, contentEl, text, liveEl } = activeStream;
  const hasThinking = contentEl.querySelector('.thinking-block');
  if (!text && !hasThinking && activeStream.el) {
    activeStream.el.remove();
    activeStream = null;
    scheduleScroll();
    return;
  }
  if (liveEl) liveEl.remove();
  if (text) {
    const rendered = document.createElement('div');
    rendered.className = 'stream-final';
    rendered.innerHTML = renderMD(text);
    contentEl.appendChild(rendered);
    renderMath(rendered);
    highlightCode(rendered);
  }
  activeStream = null;
  scheduleScroll();
}

// ═══════════════════════════════════════════════════════════
// History Rendering
// ═══════════════════════════════════════════════════════════
function assistantMessageHasRenderableContent(msg) {
  return Array.isArray(msg.content) && msg.content.some(c =>
    ['text', 'thinking', 'toolCall'].includes(c?.type) && String(c.text || c.thinking || c.name || '').trim()
  );
}

function renderAssistantError(contentEl, msg) {
  const reason = String(msg.errorMessage || msg.error || msg.stopReason || 'Assistant response failed.').trim();
  contentEl.innerHTML = `<div class="msg-error">${esc(reason)}</div>`;
}

function assistantMessageError(msg = {}) {
  return msg.errorMessage || msg.error || msg.stopReason === 'error'
    ? String(msg.errorMessage || msg.error || msg.stopReason || 'Assistant response failed.')
    : '';
}

function handleMessageEnd(msg) {
  if (!activeStream) return;
  const error = assistantMessageError(msg.message || msg);
  if (error) {
    renderAssistantError(activeStream.contentEl, msg.message || msg);
    activeStream = null;
    setAssistantActivity({
      phase: 'error',
      detail: error,
      errors: assistantActivity.errors + 1,
    });
    debug(`Assistant error: ${error}`);
    scroll();
    return;
  }
  finalizeStream();
}

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
      if (!assistantMessageHasRenderableContent(msg)) {
        if (msg.errorMessage || msg.error || msg.stopReason === 'error') {
          renderAssistantError(contentEl, msg);
        } else {
          lastAssistant.remove();
          lastAssistant = null;
        }
        return;
      }
      
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

      highlightCode(contentEl);
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

  // Force scroll to bottom for session restore
  requestAnimationFrame(() => scrollNow(true));
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
  const path = data?.sessionFile;
  const overrides = readSessionTitleOverrides();
  if (path && overrides[path]) {
    sessionTitle.textContent = overrides[path];
    return;
  }
  if (data?.sessionName && !isGenericSessionTitle(data.sessionName)) {
    sessionTitle.textContent = data.sessionName;
  } else if (data?.sessionId) {
    sessionTitle.textContent = `Session ${data.sessionId.slice(0, 8)}`;
  }
}

// ═══════════════════════════════════════════════════════════
// Tools
// ═══════════════════════════════════════════════════════════
function handleToolStart(msg) {
  setAssistantActivity({
    phase: 'tool',
    detail: `Running tool: ${msg.toolName || 'unknown'}.`,
    toolName: msg.toolName || null,
    toolCalls: assistantActivity.toolCalls + 1,
  });
  const el = createToolElDynamic(msg.toolName, msg.args, 'running');
  const last = messagesEl.lastElementChild;
  if (last?.classList.contains('message-assistant')) {
    last.querySelector('.msg-content').appendChild(el);
  }
  pendingToolCalls.set(msg.toolCallId, { el, status: 'running' });
  scroll();
}

function handleToolUpdate(msg) {
  setAssistantActivity({
    phase: 'tool',
    detail: `Tool update: ${msg.toolName || assistantActivity.toolName || 'running'}.`,
    toolName: msg.toolName || assistantActivity.toolName,
  });
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
  setAssistantActivity({
    phase: msg.isError ? 'error' : 'tool',
    detail: msg.isError
      ? `Tool error: ${msg.toolName || assistantActivity.toolName || 'unknown'}.`
      : `Tool complete: ${msg.toolName || assistantActivity.toolName || 'unknown'}.`,
    toolName: msg.isError ? (msg.toolName || assistantActivity.toolName || null) : null,
    errors: assistantActivity.errors + (msg.isError ? 1 : 0),
  });
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
  scheduleScroll();
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
      <button class="msg-action-btn" title="Good" onclick="feedbackMsg()">
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
  const content = el.querySelector('.msg-content');
  if (content) highlightCode(content);
  if (content) renderMath(content);
  scheduleScroll();
}

function showWelcome() {
  messagesEl.querySelector('.welcome')?.remove();
  const el = document.createElement('div');
  el.className = 'welcome';
  const wsPath = getSelectedWorkspacePath();
  const wsLine = wsPath
    ? `<p class="welcome-workspace">Workplace: <code>${esc(wsPath)}</code></p>`
    : '<p class="welcome-workspace">Set your workplace path in the composer or connection dialog.</p>';
  el.innerHTML = `
    <div class="welcome-icon">
      <svg viewBox="0 0 48 48" fill="none">
        <path d="M24 4L4 16L24 28L44 16L24 4Z" fill="var(--accent)" opacity="0.6"/>
        <path d="M4 36L24 44L44 36" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"/>
        <path d="M4 24L24 32L44 24" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
      </svg>
    </div>
    <h2>Welcome to Helios Forge</h2>
    <p>Chat with Pi in your workplace, launch research tasks via the sidecar, and use slash commands like <code>/harness</code> and <code>/deep-research</code>.</p>
    ${wsLine}
    <button type="button" class="welcome-settings-btn" onclick="openSettings()">Open Settings</button>`;
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

function highlightCode(root = document) {
  if (typeof hljs === 'undefined') return;
  const scope = root instanceof Element ? root : document;
  scope.querySelectorAll('pre code').forEach(el => {
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

function escAttr(text) {
  return esc(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function scrollNow(force = false) {
  const chatContainer = document.getElementById('chat-container');
  if (!chatContainer) return;
  const threshold = 120;
  const nearBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < threshold;
  if (force || nearBottom) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

function scheduleScroll(force = false) {
  if (scrollScheduled) return;
  scrollScheduled = true;
  requestAnimationFrame(() => {
    scrollScheduled = false;
    scrollNow(force);
  });
}

function scroll(force = false) {
  scheduleScroll(force);
}

// ═══════════════════════════════════════════════════════════
// File Attachments
// ═══════════════════════════════════════════════════════════
const MAX_CHAT_IMAGE_DIMENSION = 1600;
const MAX_CHAT_IMAGE_BYTES = 3 * 1024 * 1024;

function estimateBase64Bytes(base64) {
  return Math.ceil((base64.length * 3) / 4);
}

async function prepareChatImageFile(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_CHAT_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height, 1));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let quality = 0.9;
  let mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  let dataUrl = canvas.toDataURL(mimeType, quality);
  let base64 = dataUrl.split(',')[1];

  while (estimateBase64Bytes(base64) > MAX_CHAT_IMAGE_BYTES && quality > 0.45) {
    quality -= 0.1;
    mimeType = 'image/jpeg';
    dataUrl = canvas.toDataURL(mimeType, quality);
    base64 = dataUrl.split(',')[1];
  }

  if (estimateBase64Bytes(base64) > MAX_CHAT_IMAGE_BYTES) {
    throw new Error('Image is still too large after resizing. Try a smaller screenshot.');
  }

  return { type: 'image', data: base64, mimeType };
}

async function handleFileSelect(files) {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) {
      toast('Only image files are supported', 'error');
      continue;
    }
    try {
      const attachment = await prepareChatImageFile(file);
      uploadedImages.push(attachment);
      updateImagePreview();
      toast(`Image attached: ${file.name}`, 'success');
    } catch (error) {
      toast(error.message || 'Failed to attach image', 'error');
    }
  }
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
    streamingModeHint?.classList.remove('hidden');
  } else {
    steerBtn.classList.add('hidden');
    sendBtn.classList.remove('hidden');
    abortBtn.classList.add('hidden');
    streamingModeHint?.classList.add('hidden');
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
  const harnessOnlyCommand = harnessRoute?.mode === 'direct' && /^\/(?:harness|research|deep-research|forge)\b/i.test(text);

  if (mode === 'prompt' && !wasStreaming) {
    createUserMsg(text, uploadedImages.length ? [...uploadedImages] : null);
    applyChatTitleFromPrompt(text);
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
  if (uploadedImages.length) msg.images = uploadedImages.map((image) => ({ ...image }));

  if (wasStreaming) msg.streamingBehavior = mode === 'steer' ? 'steer' : 'followUp';

  const sent = send(msg);
  if (!sent) return;
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
    </div>`).join('') || '<div class="dropdown-empty">No models found</div>';
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
  renderSettingsPiSection();
  renderConfigDriftBanner();
}

// ═══════════════════════════════════════════════════════════
// Settings
// ═══════════════════════════════════════════════════════════
const settingsServerUrlInput = document.getElementById('settings-server-url');
const settingsConnectionStatus = document.getElementById('settings-connection-status');
const settingsWorkspacePathInput = document.getElementById('settings-workspace-path');
const settingsWorkplaceHealth = document.getElementById('settings-workplace-health');
const settingsHarnessPreset = document.getElementById('settings-harness-preset');
const settingsHarnessStatus = document.getElementById('settings-harness-status');
const settingsEndpointsList = document.getElementById('settings-endpoints-list');
const settingsEndpointForm = document.getElementById('settings-endpoint-form');
const settingsPiModel = document.getElementById('settings-pi-model');
const settingsPiThinking = document.getElementById('settings-pi-thinking');
const settingsPiModelThinking = document.getElementById('settings-pi-model-thinking');
const settingsPiThinkingLevel = document.getElementById('settings-pi-thinking-level');
const settingsPiEnableThinking = document.getElementById('settings-pi-enable-thinking');

function settingsWorkspaceRoot() {
  return getSelectedWorkspacePath() || workspacePath || undefined;
}

function requestWorkplaceStatus() {
  send({ type: 'harness_workplace_status', workspaceRoot: settingsWorkspaceRoot() });
}

function initializeWorkplace() {
  send({ type: 'harness_workplace_initialize', workspaceRoot: settingsWorkspaceRoot() });
}

function getHarnessConfig() {
  send({ type: 'harness_config_get', workspaceRoot: settingsWorkspaceRoot() });
}

function patchHarnessConfig(patch) {
  if (!patch || typeof patch !== 'object') return;
  send({ type: 'harness_config_patch', workspaceRoot: settingsWorkspaceRoot(), patch });
  send({ type: 'harness_config_reload', workspaceRoot: settingsWorkspaceRoot() });
}

function harnessConfigPathKey(path = []) {
  return path.join('.');
}

function getHarnessConfigValue(config, path = []) {
  return path.reduce((value, key) => (
    value && typeof value === 'object' ? value[key] : undefined
  ), config || {});
}

function assignHarnessConfigPatch(patch, path = [], value) {
  let cursor = patch;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    cursor[key] = cursor[key] && typeof cursor[key] === 'object' ? { ...cursor[key] } : {};
    cursor = cursor[key];
  }
  cursor[path[path.length - 1]] = value;
}

function renderHarnessConfigField(field, config) {
  const pathKey = harnessConfigPathKey(field.path);
  const current = getHarnessConfigValue(config, field.path);
  if (field.type === 'checkbox') {
    return `
      <label class="settings-checkbox-row settings-schema-field" data-config-path="${escAttr(pathKey)}">
        <input type="checkbox" data-config-type="checkbox" data-config-path="${escAttr(pathKey)}" ${current ? 'checked' : ''} />
        ${esc(field.label)}
      </label>`;
  }
  if (field.type === 'select') {
    const options = (field.options || []).map(([value, label]) => `
      <option value="${escAttr(value)}" ${String(current ?? '') === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('');
    return `
      <label class="settings-field settings-schema-field" data-config-path="${escAttr(pathKey)}">
        ${esc(field.label)}
        <select class="settings-select" data-config-type="select" data-config-path="${escAttr(pathKey)}">${options}</select>
      </label>`;
  }
  if (field.type === 'modelProfile') {
    return `
      <label class="settings-field settings-schema-field" data-config-path="${escAttr(pathKey)}">
        ${esc(field.label)}
        <select class="settings-select" data-config-type="select" data-config-path="${escAttr(pathKey)}">${modelProfileOptions(current)}</select>
      </label>`;
  }
  if (field.type === 'csv') {
    const value = Array.isArray(current) ? current.join(', ') : (current || '');
    return `
      <label class="settings-field settings-schema-field" data-config-path="${escAttr(pathKey)}">
        ${esc(field.label)}
        <input
          type="text"
          class="settings-input mono"
          data-config-type="csv"
          data-config-path="${escAttr(pathKey)}"
          value="${escAttr(value)}"
          placeholder="tool.one, tool.two"
        />
        ${field.hint ? `<span class="settings-hint">${esc(field.hint)}</span>` : ''}
      </label>`;
  }
  const inputType = field.type === 'number' ? 'number' : 'text';
  const extraAttrs = [
    field.min != null ? `min="${field.min}"` : '',
    field.max != null ? `max="${field.max}"` : '',
    field.step != null ? `step="${field.step}"` : '',
  ].filter(Boolean).join(' ');
  return `
    <label class="settings-field settings-schema-field" data-config-path="${escAttr(pathKey)}">
      ${esc(field.label)}
      <input
        type="${inputType}"
        class="settings-input${field.mono ? ' mono' : ''}"
        data-config-type="${field.type}"
        data-config-path="${escAttr(pathKey)}"
        value="${escAttr(current ?? '')}"
        ${extraAttrs}
      />
    </label>`;
}

function renderHarnessConfigSections(container, sectionIds = [], { hideTitles = false } = {}) {
  if (!container) return;
  const schema = window.HELIOS_HARNESS_CONFIG_UI;
  const config = settingsState.harnessConfig || {};
  if (!schema?.sections) {
    container.innerHTML = '<div class="settings-hint">Harness config schema unavailable.</div>';
    return;
  }
  container.innerHTML = sectionIds.map((sectionId) => {
    const section = schema.sections[sectionId];
    if (!section) return '';
    return `
      <div class="settings-schema-group" data-schema-section="${escAttr(sectionId)}">
        ${hideTitles ? '' : `<div class="settings-section-title">${esc(section.title)}</div>`}
        ${section.fields.map((field) => renderHarnessConfigField(field, config)).join('')}
      </div>`;
  }).join('');
}

function renderHarnessProductionGates() {
  const container = document.getElementById('settings-production-gates');
  if (!container) return;
  const schema = window.HELIOS_HARNESS_CONFIG_UI;
  const config = settingsState.harnessConfig || {};
  const gates = schema?.PRODUCTION_CAPABILITY_GATES || [];
  const modes = schema?.GATE_MODES || ['offline', 'advisory', 'active'];
  if (!gates.length) {
    container.innerHTML = '<div class="settings-hint">No production gates defined.</div>';
    return;
  }
  container.innerHTML = `
    <div class="settings-section-title settings-production-gates-title">Production gates</div>
    <div class="settings-production-gates-head">
      <span>Gate</span>
      <span>Enabled</span>
      <span>Mode</span>
    </div>
    ${gates.map(([gateId, label]) => {
      const gate = config.productionCapabilities?.[gateId] || {};
      const enabled = gate.enabled === true;
      const mode = gate.mode || 'offline';
      const modeOptions = modes.map((entry) => `
        <option value="${escAttr(entry)}" ${entry === mode ? 'selected' : ''}>${esc(entry)}</option>`).join('');
      return `
        <div class="settings-production-gate-row" data-production-gate="${escAttr(gateId)}">
          <div class="settings-production-gate-label">${esc(label)}</div>
          <label class="settings-production-gate-checkbox" aria-label="Enable ${escAttr(label)}">
            <input type="checkbox" data-production-gate-enabled="${escAttr(gateId)}" ${enabled ? 'checked' : ''} />
          </label>
          <select class="settings-select" data-production-gate-mode="${escAttr(gateId)}">${modeOptions}</select>
        </div>`;
    }).join('')}`;
}

function collectHarnessConfigSections(container) {
  const patch = {};
  if (!container) return patch;
  container.querySelectorAll('[data-config-type]').forEach((element) => {
    const pathKey = element.dataset.configPath;
    if (!pathKey) return;
    const path = pathKey.split('.');
    const type = element.dataset.configType || 'text';
    let value;
    if (type === 'checkbox') {
      value = element.checked;
    } else if (type === 'csv') {
      value = String(element.value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    } else if (type === 'number') {
      const parsed = Number(element.value);
      value = Number.isFinite(parsed) ? parsed : element.value;
    } else {
      value = element.value;
    }
    if (type !== 'checkbox' && (value === '' || value === undefined)) return;
    assignHarnessConfigPatch(patch, path, value);
  });
  return patch;
}

function collectHarnessProductionGatesPatch() {
  const patch = { productionCapabilities: {} };
  const schema = window.HELIOS_HARNESS_CONFIG_UI;
  for (const [gateId] of schema?.PRODUCTION_CAPABILITY_GATES || []) {
    const enabledInput = document.querySelector(`[data-production-gate-enabled="${gateId}"]`);
    const modeInput = document.querySelector(`[data-production-gate-mode="${gateId}"]`);
    patch.productionCapabilities[gateId] = {
      enabled: Boolean(enabledInput?.checked),
      mode: modeInput?.value || 'offline',
      authority: 'evidence_only',
    };
  }
  return patch;
}

function renderHarnessConfigPanels() {
  renderHarnessConfigSections(document.getElementById('settings-general-sections'), ['general', 'runtime']);
  renderHarnessConfigSections(document.getElementById('settings-router-advanced-sections'), ['routerAdvanced']);
  renderHarnessConfigSections(document.getElementById('settings-council-advanced-sections'), ['councilAdvanced']);
  renderHarnessConfigSections(document.getElementById('settings-icr-sections'), ['icr'], { hideTitles: true });
  renderHarnessProductionGates();
}

function saveSettingsGeneralSection() {
  patchHarnessConfig(collectHarnessConfigSections(document.getElementById('settings-general-sections')));
}

function saveSettingsProductionSection() {
  const patch = {
    ...collectHarnessProductionGatesPatch(),
    ...collectHarnessConfigSections(document.getElementById('settings-icr-sections')),
  };
  patchHarnessConfig(patch);
}

function applyHarnessPreset(presetId, mode = 'merge') {
  if (!presetId) return;
  send({
    type: 'harness_config_apply_preset',
    workspaceRoot: settingsWorkspaceRoot(),
    presetId,
    mode,
  });
}

function openSettings(tab = settingsState.activeTab || 'connection') {
  if (!document.getElementById('modal-settings')) return;
  settingsState.activeTab = tab;
  syncSettingsFormFromState();
  renderSettingsTabs();
  renderSettingsPiSection();
  renderSettingsEndpointsList();
  renderSettingsRouterSection();
  renderSettingsSwarmSection();
  renderHarnessConfigPanels();
  loadStoredSmitheryKey();
  openModal('settings');
  if (ws?.readyState === WebSocket.OPEN) {
    requestWorkplaceStatus();
    getHarnessConfig();
    if (tab === 'pi') requestPiModelsSummary();
  }
}

function syncSettingsFormFromState() {
  if (settingsServerUrlInput) {
    settingsServerUrlInput.value = serverUrl || serverUrlInput?.value || '';
  }
  if (settingsWorkspacePathInput) {
    settingsWorkspacePathInput.value = getSelectedWorkspacePath() || '';
  }
}

function renderSettingsTabs() {
  document.querySelectorAll('.settings-tab').forEach((tab) => {
    const active = tab.dataset.settingsTab === settingsState.activeTab;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.settings-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `settings-tab-${settingsState.activeTab}`);
  });
}

function formatPiReasoningLevel(level) {
  if (!level) return '—';
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function lookupModelEnableThinking(model) {
  if (!model) return null;
  const args = model.args;
  if (args) {
    const match = String(args).match(/enable_thinking["']?\s*:\s*(true|false)/i);
    if (match) return match[1].toLowerCase() === 'true';
  }
  const catalog = settingsState.piModelsSummary?.models || [];
  const entry = catalog.find((item) => item.id === model.id && (!model.provider || item.provider === model.provider));
  if (entry && entry.enableThinking !== undefined && entry.enableThinking !== null) return entry.enableThinking;
  return null;
}

function formatModelThinkingLabel(value) {
  if (value === true) return 'On';
  if (value === false) return 'Off';
  return '—';
}

function renderSettingsPiSection() {
  if (!settingsPiModel && !settingsPiThinking && !settingsPiModelThinking) return;
  if (settingsPiModel) {
    settingsPiModel.textContent = currentModel?.name || currentModel?.id || '—';
  }
  if (settingsPiThinking) {
    settingsPiThinking.textContent = formatPiReasoningLevel(currentThinking);
  }
  const modelThinking = lookupModelEnableThinking(currentModel);
  if (settingsPiModelThinking) {
    settingsPiModelThinking.textContent = formatModelThinkingLabel(modelThinking);
  }
  if (settingsPiThinkingLevel && currentThinking) {
    settingsPiThinkingLevel.value = currentThinking;
  }
  if (settingsPiEnableThinking && modelThinking !== null) {
    settingsPiEnableThinking.checked = modelThinking === true;
  }
}

function applyPiThinkingSettings() {
  const modelId = currentModel?.id;
  const provider = currentModel?.provider
    || settingsState.piModelsSummary?.models?.find((item) => item.id === modelId)?.provider
    || models.find((item) => item.id === modelId)?.provider;
  if (!provider || !modelId) {
    toast('Connect and select a model first', 'error');
    return;
  }
  const reasoningLevel = settingsPiThinkingLevel?.value || 'medium';
  const enableThinking = settingsPiEnableThinking?.checked !== false;
  send({
    type: 'pi_models_set_thinking',
    provider,
    modelId,
    enableThinking,
    reasoningLevel,
  });
  toast('Applying thinking settings…', 'success');
}

function renderSettingsEndpointsList() {
  if (!settingsEndpointsList) return;
  const profiles = settingsState.harnessConfig?.modelCouncil?.endpointProfiles
    || settingsState.harnessConfig?.endpointProfiles
    || {};
  const entries = Object.entries(profiles);
  if (!entries.length) {
    settingsEndpointsList.innerHTML = '<div class="settings-hint">No endpoint profiles loaded.</div>';
    return;
  }
  settingsEndpointsList.innerHTML = entries.map(([profileId, profile]) => {
    const baseUrl = esc(profile?.baseUrl || '—');
    const modelId = esc(profile?.modelId || '—');
    const test = settingsState.endpointTests[profileId];
    const testClass = test?.healthy === true ? 'ok' : test?.healthy === false ? 'error' : '';
    const testLabel = test
      ? (test.healthy ? `OK (${esc(test.reason || 'healthy')})` : `Fail (${esc(test.reason || 'unhealthy')})`)
      : '';
    return `
      <div class="settings-endpoint-item">
        <div class="settings-endpoint-item-main">
          <div class="settings-endpoint-item-id">${esc(profileId)}</div>
          <div class="settings-endpoint-item-meta">${modelId} · ${baseUrl}</div>
          ${testLabel ? `<div class="settings-endpoint-test-result ${testClass}">${testLabel}</div>` : ''}
        </div>
        <button class="settings-btn settings-endpoint-test-btn" type="button" data-endpoint-test="${escAttr(profileId)}">Test</button>
      </div>`;
  }).join('');
}

const WORKPLACE_HEALTH_LABELS = {
  harnessDir: '.harness/',
  configYaml: 'config.yaml',
  capabilitiesJson: 'capabilities.json',
  runtimeMount: 'runtime mount manifest',
  bundledPackage: 'bundled harness package',
  heldOutSuite: 'held-out suite (workplace-smoke)',
  evolutionConfig: 'evolution config',
  swarmEndpointConfigured: 'swarm model endpoint',
  evolutionReady: 'evolution ready',
};

function workplaceHealthState(item) {
  if (!item?.present) return 'error';
  if (item.error) return 'warn';
  return 'ok';
}

function renderSettingsWorkplaceHealth(status) {
  if (!settingsWorkplaceHealth) return;
  const checklist = status?.checklist || status?.items || status?.artifacts;
  if (Array.isArray(checklist) && checklist.length) {
    settingsWorkplaceHealth.innerHTML = checklist.map((item) => {
      const label = esc(typeof item === 'string' ? item : (item.label || item.name || item.id || 'Item'));
      const state = typeof item === 'object'
        ? (item.ok === true || item.status === 'ok' ? 'ok' : item.status === 'warn' ? 'warn' : item.ok === false || item.status === 'error' ? 'error' : '')
        : '';
      return `
        <div class="settings-health-item">
          <span class="settings-health-dot ${state}"></span>
          <span>${label}</span>
        </div>`;
    }).join('');
    return;
  }

  const artifactKeys = ['harnessDir', 'configYaml', 'capabilitiesJson', 'runtimeMount', 'bundledPackage', 'heldOutSuite', 'evolutionConfig'];
  const rows = artifactKeys
    .filter((key) => status?.[key] && typeof status[key] === 'object')
    .map((key) => {
      const item = status[key];
      const state = workplaceHealthState(item);
      const suffix = item.error ? ` (${item.error})` : '';
      return `
        <div class="settings-health-item">
          <span class="settings-health-dot ${state}"></span>
          <span>${esc(WORKPLACE_HEALTH_LABELS[key] || key)}${esc(suffix)}</span>
        </div>`;
    });

  if (typeof status?.swarmEndpointConfigured === 'boolean') {
    rows.push(`
      <div class="settings-health-item">
        <span class="settings-health-dot ${status.swarmEndpointConfigured ? 'ok' : 'warn'}"></span>
        <span>${esc(WORKPLACE_HEALTH_LABELS.swarmEndpointConfigured)}</span>
      </div>`);
  }

  if (typeof status?.evolutionReady === 'boolean') {
    rows.push(`
      <div class="settings-health-item">
        <span class="settings-health-dot ${status.evolutionReady ? 'ok' : 'warn'}"></span>
        <span>${esc(WORKPLACE_HEALTH_LABELS.evolutionReady)}</span>
      </div>`);
  }

  if (!rows.length) {
    const message = status?.message || status?.summary || 'Open Settings while connected to load workplace health.';
    settingsWorkplaceHealth.innerHTML = `<div class="settings-hint">${esc(String(message))}</div>`;
    return;
  }
  settingsWorkplaceHealth.innerHTML = rows.join('');
}

function handleHarnessWorkplaceStatus(data) {
  settingsState.workplaceStatus = data || null;
  renderSettingsWorkplaceHealth(data || {});
}

function handleHarnessWorkplaceInitialized(data) {
  const created = data?.config?.created || data?.capabilityCount > 0;
  toast(
    data?.message || (created ? 'Workplace initialized' : 'Workplace setup complete'),
    data?.success === false ? 'error' : 'success',
  );
  requestWorkplaceStatus();
  getHarnessConfig();
}

function handleHarnessConfig(data) {
  settingsState.harnessConfig = data?.config || data || null;
  renderSettingsEndpointsList();
  renderSettingsRouterSection();
  renderSettingsSwarmSection();
  renderHarnessConfigPanels();
  renderConfigDriftBanner();
  renderHarnessSwarmConfigBanner();
  if (settingsHarnessStatus && data?.presetId) {
    settingsHarnessStatus.textContent = `Active preset: ${data.presetId}`;
  }
}

function handleHarnessConfigUpdated(data) {
  if (data?.config) settingsState.harnessConfig = data.config;
  renderSettingsEndpointsList();
  renderSettingsRouterSection();
  renderSettingsSwarmSection();
  renderHarnessConfigPanels();
  renderConfigDriftBanner();
  renderHarnessSwarmConfigBanner();
  toast(data?.message || 'Harness config updated', data?.success === false ? 'error' : 'success');
}

function handleHarnessConfigReloaded(data) {
  if (data?.config) settingsState.harnessConfig = data.config;
  renderSettingsEndpointsList();
  renderSettingsRouterSection();
  renderSettingsSwarmSection();
  renderHarnessConfigPanels();
  renderConfigDriftBanner();
  renderHarnessSwarmConfigBanner();
  toast(data?.message || 'Harness config reloaded', 'success');
  send({ type: 'harness_status' });
}

function handleHarnessWorkplaceRepaired(data) {
  toast(data?.message || 'Workplace repair complete', data?.success === false ? 'error' : 'success');
  requestWorkplaceStatus();
  getHarnessConfig();
}

function handleHarnessEndpointTestResult(data) {
  const profileId = data?.profileId;
  if (profileId) settingsState.endpointTests[profileId] = data;
  renderSettingsEndpointsList();
  toast(
    data?.healthy ? `Endpoint ${profileId} is healthy` : `Endpoint ${profileId} failed: ${data?.reason || 'unknown'}`,
    data?.healthy ? 'success' : 'error',
  );
}

function handlePiModelsSummary(data) {
  settingsState.piModelsSummary = data || null;
  renderSettingsPiModelsSummary();
  renderSettingsPiSection();
}

function repairWorkplace() {
  send({ type: 'harness_workplace_repair', workspaceRoot: settingsWorkspaceRoot() });
}

function testEndpointProfile(profileId) {
  const profiles = settingsState.harnessConfig?.modelCouncil?.endpointProfiles || {};
  const profile = profiles[profileId];
  if (!profile) {
    toast(`Unknown endpoint profile: ${profileId}`, 'error');
    return;
  }
  send({ type: 'harness_endpoint_test', profileId, profile });
}

function requestPiModelsSummary() {
  send({ type: 'pi_models_get' });
}

function renderSettingsPiModelsSummary() {
  if (!settingsPiModelsSummary) return;
  const data = settingsState.piModelsSummary;
  if (!data) {
    settingsPiModelsSummary.innerHTML = '<div class="settings-hint">Open this tab while connected to load models.</div>';
    return;
  }
  if (data.parseError) {
    settingsPiModelsSummary.innerHTML = `<div class="settings-hint error">Failed to parse models.json: ${esc(data.parseError)}</div>`;
    return;
  }
  if (!data.present) {
    settingsPiModelsSummary.innerHTML = `<div class="settings-hint">No Pi models.json found at ${esc(data.path || '—')}</div>`;
    return;
  }
  const providers = (data.providers || []).map(p => `${esc(p.name)} (${p.modelCount})`).join(', ') || 'none';
  const models = (data.models || []).slice(0, 12).map(m => {
    const thinkingClass = m.enableThinking === true ? 'on' : m.enableThinking === false ? 'off' : '';
    const thinkingLabel = m.enableThinking === true ? 'On' : m.enableThinking === false ? 'Off' : '—';
    return `
    <div class="settings-pi-model-row">
      <span class="settings-pi-model-provider">${esc(m.provider || '—')}</span>
      <span class="settings-pi-model-id">${esc(m.name || m.id || '—')}</span>
      <span class="settings-pi-model-thinking ${thinkingClass}">${thinkingLabel}</span>
    </div>`;
  }).join('');
  settingsPiModelsSummary.innerHTML = `
    <div class="settings-hint">${esc(String(data.modelCount || 0))} models · ${providers}</div>
    <div class="settings-pi-models-list">${models || '<div class="settings-hint">No models listed</div>'}</div>`;
}

function renderSettingsRouterSection() {
  const config = settingsState.harnessConfig || {};
  const router = config.modelRouter || {};
  const adaptive = config.adaptiveSearch || {};
  const routerEnabled = document.getElementById('settings-model-router-enabled');
  const routerStrategy = document.getElementById('settings-model-router-strategy');
  const adaptiveMode = document.getElementById('settings-adaptive-search-mode');
  const adaptiveMax = document.getElementById('settings-adaptive-search-max-actions');
  const adaptiveSwitch = document.getElementById('settings-adaptive-search-profile-switch');
  if (routerEnabled) routerEnabled.checked = Boolean(router.enabled);
  if (routerStrategy && router.strategy) routerStrategy.value = router.strategy;
  if (adaptiveMode && adaptive.mode) adaptiveMode.value = adaptive.mode;
  if (adaptiveMax && adaptive.maxActionsPerTask != null) adaptiveMax.value = adaptive.maxActionsPerTask;
  if (adaptiveSwitch) adaptiveSwitch.checked = adaptive.allowProfileSwitching !== false;
}

function saveSettingsRouterSection() {
  const routerPatch = collectHarnessConfigSections(document.getElementById('settings-router-advanced-sections'));
  patchHarnessConfig({
    modelRouter: {
      ...(settingsState.harnessConfig?.modelRouter || {}),
      ...(routerPatch.modelRouter || {}),
      enabled: Boolean(document.getElementById('settings-model-router-enabled')?.checked),
      strategy: document.getElementById('settings-model-router-strategy')?.value || 'thompson_sampling',
    },
    adaptiveSearch: {
      ...(settingsState.harnessConfig?.adaptiveSearch || {}),
      mode: document.getElementById('settings-adaptive-search-mode')?.value || 'advisory',
      maxActionsPerTask: Number(document.getElementById('settings-adaptive-search-max-actions')?.value) || 8,
      allowProfileSwitching: Boolean(document.getElementById('settings-adaptive-search-profile-switch')?.checked),
    },
  });
}

function endpointProfileOptions(selected) {
  const profiles = Object.keys(settingsState.harnessConfig?.modelCouncil?.endpointProfiles || {});
  if (!profiles.length) return '<option value="">—</option>';
  return profiles.map(id => `<option value="${escAttr(id)}" ${id === selected ? 'selected' : ''}>${esc(id)}</option>`).join('');
}

function modelProfileOptions(selected) {
  const fromConfig = new Set(KNOWN_MODEL_PROFILES);
  const roles = settingsState.harnessConfig?.modelCouncil?.roles || {};
  Object.values(roles).forEach(role => {
    if (role?.modelProfile) fromConfig.add(role.modelProfile);
  });
  const defaults = settingsState.harnessConfig?.defaults || {};
  if (defaults.modelProfile) fromConfig.add(defaults.modelProfile);
  if (defaults.swarmModelProfile) fromConfig.add(defaults.swarmModelProfile);
  return Array.from(fromConfig).map(id => `<option value="${escAttr(id)}" ${id === selected ? 'selected' : ''}>${esc(id)}</option>`).join('');
}

function renderSettingsSwarmSection() {
  const config = settingsState.harnessConfig || {};
  const council = config.modelCouncil || {};
  const swarm = config.swarmExecution || {};
  const features = config.features || {};
  const councilEnabled = document.getElementById('settings-model-council-enabled');
  const concurrency = document.getElementById('settings-swarm-concurrency');
  const workerMode = document.getElementById('settings-swarm-worker-mode');
  const piNative = document.getElementById('settings-swarm-pi-native');
  const rolesEl = document.getElementById('settings-swarm-roles');
  const featuresEl = document.getElementById('settings-swarm-features');
  if (councilEnabled) councilEnabled.checked = Boolean(council.enabled);
  if (concurrency && swarm.concurrency != null) concurrency.value = swarm.concurrency;
  if (workerMode && swarm.workerMode) workerMode.value = swarm.workerMode;
  if (piNative) piNative.checked = Boolean(swarm.piNative ?? features.piNativeSwarm);
  if (rolesEl) {
    const roles = Object.entries(council.roles || {});
    rolesEl.innerHTML = roles.length ? roles.map(([roleId, role]) => `
      <div class="settings-swarm-role-row" data-role-id="${escAttr(roleId)}">
        <div class="settings-swarm-role-name">${esc(roleId)}</div>
        <label>Model profile
          <select class="settings-select settings-swarm-role-model">${modelProfileOptions(role?.modelProfile)}</select>
        </label>
        <label>Endpoint profile
          <select class="settings-select settings-swarm-role-endpoint">${endpointProfileOptions(role?.endpointProfile)}</select>
        </label>
      </div>`).join('') : '<div class="settings-hint">No swarm roles configured.</div>';
  }
  if (featuresEl) {
    featuresEl.innerHTML = SWARM_FEATURE_TOGGLES.map(([key, label]) => `
      <label class="settings-checkbox-row">
        <input type="checkbox" data-swarm-feature="${escAttr(key)}" ${features[key] ? 'checked' : ''} />
        ${esc(label)}
      </label>`).join('');
  }
}

function saveSettingsSwarmSection() {
  const roles = {};
  document.querySelectorAll('.settings-swarm-role-row').forEach(row => {
    const roleId = row.dataset.roleId;
    if (!roleId) return;
    roles[roleId] = {
      modelProfile: row.querySelector('.settings-swarm-role-model')?.value || undefined,
      endpointProfile: row.querySelector('.settings-swarm-role-endpoint')?.value || undefined,
    };
  });
  const features = { ...(settingsState.harnessConfig?.features || {}) };
  document.querySelectorAll('[data-swarm-feature]').forEach(input => {
    features[input.dataset.swarmFeature] = input.checked;
  });
  const councilPatch = collectHarnessConfigSections(document.getElementById('settings-council-advanced-sections'));
  patchHarnessConfig({
    modelCouncil: {
      ...(settingsState.harnessConfig?.modelCouncil || {}),
      ...(councilPatch.modelCouncil || {}),
      enabled: Boolean(document.getElementById('settings-model-council-enabled')?.checked),
      roles,
    },
    swarmExecution: {
      ...(settingsState.harnessConfig?.swarmExecution || {}),
      concurrency: Number(document.getElementById('settings-swarm-concurrency')?.value) || 2,
      workerMode: document.getElementById('settings-swarm-worker-mode')?.value || 'model_driven',
      piNative: Boolean(document.getElementById('settings-swarm-pi-native')?.checked),
    },
    features: {
      ...features,
      piNativeSwarm: Boolean(document.getElementById('settings-swarm-pi-native')?.checked),
    },
  });
}

function loadStoredSmitheryKey() {
  try {
    const stored = localStorage.getItem(STORAGE_SMITHERY_KEY) || '';
    if (settingsSmitheryKey) settingsSmitheryKey.value = stored;
    if (capabilitySmitheryKey && !capabilitySmitheryKey.value) capabilitySmitheryKey.value = stored;
  } catch (_) { /* ignore */ }
}

function saveSettingsSecrets() {
  const key = settingsSmitheryKey?.value?.trim() || '';
  try {
    if (key) localStorage.setItem(STORAGE_SMITHERY_KEY, key);
    else localStorage.removeItem(STORAGE_SMITHERY_KEY);
    if (capabilitySmitheryKey) capabilitySmitheryKey.value = key;
    toast('Secrets saved locally', 'success');
  } catch (error) {
    toast('Failed to save secrets: ' + error.message, 'error');
  }
}

function loadPinnedSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_PINNED_SESSIONS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePinnedSessions() {
  try {
    const pinnedIds = sessions.filter(s => s.pinned).map(s => s.id);
    localStorage.setItem(STORAGE_PINNED_SESSIONS, JSON.stringify(pinnedIds));
  } catch (_) { /* ignore */ }
}

function applyPinnedSessionsFromStorage() {
  const pinnedIds = new Set(loadPinnedSessions());
  sessions.forEach(s => {
    if (pinnedIds.has(s.id)) s.pinned = true;
  });
}

function chatModelLabel() {
  return currentModel?.name || currentModel?.id || '';
}

function harnessDefaultModelProfile() {
  return settingsState.harnessConfig?.defaults?.modelProfile || '';
}

function harnessResolvedModelId() {
  const profile = harnessDefaultModelProfile();
  if (!profile) return '';
  if (profile.includes('/')) return profile;
  const match = models.find(m => m.id === profile || m.name === profile
    || String(m.id || '').endsWith(`/${profile}`)
    || String(m.name || '').toLowerCase() === profile.toLowerCase());
  return match?.id || profile;
}

function hasConfigDrift() {
  if (settingsState.configDriftDismissed || !currentModel || !settingsState.harnessConfig) return false;
  const harnessDefault = harnessDefaultModelProfile();
  if (!harnessDefault) return false;
  const chatId = currentModel.id || '';
  const chatLabel = chatModelLabel();
  if (!chatId && !chatLabel) return false;
  const resolvedHarness = harnessResolvedModelId();
  if (resolvedHarness === chatId || harnessDefault === chatId || harnessDefault === chatLabel) return false;
  const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const chatNorm = norm(chatId) || norm(chatLabel);
  const harnessNorm = norm(resolvedHarness) || norm(harnessDefault);
  if (!chatNorm || !harnessNorm) return false;
  return chatNorm !== harnessNorm
    && !chatNorm.includes(harnessNorm)
    && !harnessNorm.includes(chatNorm);
}

function renderConfigDriftBanner() {
  if (!configDriftBanner || !configDriftText) return;
  const drift = hasConfigDrift();
  configDriftBanner.classList.toggle('hidden', !drift);
  if (!drift) return;
  configDriftText.textContent = `Harness default is ${harnessDefaultModelProfile()}; chat is using ${chatModelLabel()}.`;
}

function dismissConfigDriftBanner() {
  settingsState.configDriftDismissed = true;
  try {
    localStorage.setItem(STORAGE_CONFIG_DRIFT_DISMISSED, '1');
  } catch (_) { /* ignore */ }
  renderConfigDriftBanner();
}

function alignConfigDrift() {
  const harnessDefault = harnessDefaultModelProfile();
  const match = models.find(m => m.id === harnessDefault || m.name === harnessDefault
    || String(m.id || '').includes(harnessDefault));
  if (match) {
    selectModel(match.provider, match.id);
    settingsState.configDriftDismissed = true;
    try { localStorage.setItem(STORAGE_CONFIG_DRIFT_DISMISSED, '1'); } catch (_) { /* ignore */ }
    renderConfigDriftBanner();
    toast('Chat model aligned to harness default', 'success');
    return;
  }
  const chatLabel = chatModelLabel();
  if (chatLabel) {
    patchHarnessConfig({ defaults: { modelProfile: chatLabel } });
    settingsState.configDriftDismissed = true;
    try { localStorage.setItem(STORAGE_CONFIG_DRIFT_DISMISSED, '1'); } catch (_) { /* ignore */ }
    renderConfigDriftBanner();
    toast('Harness default aligned to chat model', 'success');
  }
}

function renderHarnessSwarmConfigBanner() {
  if (!harnessSwarmConfigBanner) return;
  const config = settingsState.harnessConfig || {};
  const council = config.modelCouncil || {};
  const endpointCount = Object.keys(council.endpointProfiles || {}).length;
  const needsConfig = !council.enabled || endpointCount === 0;
  const showBanner = needsConfig && activeHarnessTab === 'swarm' && activeAppMode !== 'chat';
  harnessSwarmConfigBanner.classList.toggle('hidden', !showBanner);
  if (harnessSwarmConfigBannerText) {
    harnessSwarmConfigBannerText.textContent = !council.enabled
      ? 'Model council is disabled — swarm routing will use defaults only.'
      : 'No endpoint profiles configured — add endpoints before running multi-model swarm.';
  }
}

function setCapabilitiesViewMode(advanced) {
  capabilitiesAdvancedMode = Boolean(advanced);
  if (capabilityViewMode) capabilityViewMode.checked = capabilitiesAdvancedMode;
  document.querySelectorAll('#harness-tab-capabilities .advanced-only').forEach(el => {
    el.classList.toggle('hidden', !capabilitiesAdvancedMode);
  });
  if (capabilityInstallSection) {
    capabilityInstallSection.classList.toggle('simple-mode', !capabilitiesAdvancedMode);
  }
}

function renderApprovalInbox() {
  const container = document.getElementById('approval-inbox-content');
  if (!container) return;
  const pending = Array.from(harnessState.pendingApprovals.values());
  if (!pending.length) {
    container.innerHTML = '<div class="approval-inbox-empty">No pending approvals — you&apos;re all caught up.</div>';
    return;
  }
  container.innerHTML = pending.map(event => {
    const action = event.proposedAction || {};
    const choices = event.choices || ['approve', 'reject'];
    return `
      <div class="approval-inbox-item">
        <div class="approval-inbox-head">
          <strong>${esc(action.tool || event.kind || 'harness')}</strong>
          <span class="approval-inbox-risk">${esc(event.risk || 'unknown')}</span>
        </div>
        <p class="approval-inbox-reason">${esc(event.reason || '')}</p>
        <div class="approval-actions">
          ${choices.map(choice => `
            <button class="ext-btn ${choice === 'approve' ? 'primary' : ''}" type="button"
              data-approval-action="${escAttr(choice)}" data-approval-id="${escAttr(event.actionId)}">${esc(choice)}</button>
          `).join('')}
        </div>
      </div>`;
  }).join('');
}

function openApprovalInbox() {
  renderApprovalInbox();
  openModal('approval-inbox');
}

function setAppMode(mode) {
  const mapped = {
    chat: 'chat',
    research: 'run',
    capabilities: 'capabilities',
    traces: 'traces',
    swarm: 'swarm',
    'deep-research': 'deep-research',
    run: 'run',
  }[mode] || mode || 'chat';
  switchSessionTab(mapped);
}

function focusTabList(tablist, target) {
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const index = tabs.indexOf(target);
  if (index < 0) return;
  tabs.forEach((tab, i) => {
    const active = i === index;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function handleTablistKeydown(event, onSelect) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tablist = event.currentTarget;
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const current = tabs.findIndex(tab => tab === document.activeElement || tab.classList.contains('active'));
  let next = current;
  if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
  if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = tabs.length - 1;
  const tab = tabs[next];
  if (!tab) return;
  event.preventDefault();
  onSelect?.(tab.dataset.sessionTab || tab.dataset.harnessTab || tab.dataset.settingsTab, tab);
  tab.focus();
}

function beginInlineSessionRename() {
  if (!sessionTitleBar || !sessionTitleInput || !sessionTitle) return;
  sessionTitleInput.value = sessionTitle.textContent.trim();
  sessionTitle.classList.add('hidden');
  sessionTitleInput.classList.remove('hidden');
  sessionTitleInput.focus();
  sessionTitleInput.select();
}

function commitInlineSessionRename() {
  if (!sessionTitleInput || !sessionTitle) return;
  const name = sessionTitleInput.value.trim();
  sessionTitleInput.classList.add('hidden');
  sessionTitle.classList.remove('hidden');
  if (!name) return;
  sessionTitle.textContent = name;
  const path = currentSessionInfo?.sessionFile;
  if (path) saveSessionTitleOverride(path, name);
  const s = sessions.find(s => s.id === currentSessionId);
  if (s) { s.name = name; renderSessions(); }
}

function filterSessions(list) {
  const query = sessionSearchQuery.trim().toLowerCase();
  if (!query) return list;
  return list.filter(s => String(s.name || '').toLowerCase().includes(query));
}

function checkCdnOffline() {
  const ok = typeof marked !== 'undefined' && typeof hljs !== 'undefined';
  cdnOfflineBanner?.classList.toggle('hidden', ok);
}

function saveSettingsServerUrl() {
  const nextUrl = settingsServerUrlInput?.value?.trim();
  if (!nextUrl) {
    toast('Enter a server URL', 'error');
    return;
  }
  serverUrl = nextUrl;
  if (serverUrlInput) serverUrlInput.value = nextUrl;
  try {
    localStorage.setItem(STORAGE_SERVER_URL, nextUrl);
  } catch (error) {
    debug('Failed to save server URL: ' + error.message);
  }
  toast('Server URL saved', 'success');
}

function testSettingsConnection() {
  const testUrl = settingsServerUrlInput?.value?.trim();
  if (!testUrl) {
    toast('Enter a server URL to test', 'error');
    return;
  }
  let url = testUrl;
  if (location.protocol === 'https:') url = url.replace('ws://', 'wss://');
  if (settingsConnectionStatus) {
    settingsConnectionStatus.textContent = 'Testing…';
    settingsConnectionStatus.className = 'settings-hint';
  }
  if (settingsState.connectionTestSocket) {
    try { settingsState.connectionTestSocket.close(); } catch (_) { /* ignore */ }
    settingsState.connectionTestSocket = null;
  }
  let settled = false;
  const finish = (ok, message) => {
    if (settled) return;
    settled = true;
    if (settingsConnectionStatus) {
      settingsConnectionStatus.textContent = message;
      settingsConnectionStatus.className = `settings-hint ${ok ? 'ok' : 'error'}`;
    }
  };
  const timeout = setTimeout(() => {
    finish(false, 'Connection timed out');
    try { socket.close(); } catch (_) { /* ignore */ }
  }, 5000);
  const socket = new WebSocket(url);
  settingsState.connectionTestSocket = socket;
  socket.onopen = () => {
    clearTimeout(timeout);
    finish(true, 'Connection successful');
    socket.close();
  };
  socket.onerror = () => {
    clearTimeout(timeout);
    finish(false, 'Connection failed');
  };
  socket.onclose = (event) => {
    if (!settled && event.code !== 1000) {
      clearTimeout(timeout);
      finish(false, 'Connection closed');
    }
  };
}

function saveSettingsEndpoint(event) {
  event?.preventDefault();
  const profileId = document.getElementById('settings-endpoint-id')?.value?.trim();
  const modelId = document.getElementById('settings-endpoint-model')?.value?.trim();
  const baseUrl = document.getElementById('settings-endpoint-base-url')?.value?.trim();
  if (!profileId || !modelId || !baseUrl) {
    toast('Profile ID, model ID, and base URL are required', 'error');
    return;
  }
  patchHarnessConfig({
    modelCouncil: {
      endpointProfiles: {
        [profileId]: { baseUrl, modelId },
      },
    },
  });
  settingsEndpointForm?.reset();
}

function handleSettingsTabClick(event) {
  const tab = event.target.closest('.settings-tab')?.dataset?.settingsTab;
  if (!tab) return;
  settingsState.activeTab = tab;
  renderSettingsTabs();
  if (tab === 'pi') {
    renderSettingsPiSection();
    if (ws?.readyState === WebSocket.OPEN) requestPiModelsSummary();
  }
  if (tab === 'endpoints') renderSettingsEndpointsList();
  if (tab === 'swarm') renderSettingsSwarmSection();
  if (tab === 'harness') renderSettingsRouterSection();
  if (tab === 'general' || tab === 'production' || tab === 'harness') renderHarnessConfigPanels();
  if (tab === 'secrets') loadStoredSmitheryKey();
  if (tab === 'workplace' && ws?.readyState === WebSocket.OPEN) requestWorkplaceStatus();
  if (tab === 'harness' && ws?.readyState === WebSocket.OPEN) getHarnessConfig();
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
      <div class="stat-card"><div class="stat-label">Session</div><div class="stat-value small">${esc((data.sessionId || '').slice(0, 16))}…</div></div>
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
function readSessionTitleOverrides() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_SESSION_TITLES) || '{}');
  } catch {
    return {};
  }
}

function saveSessionTitleOverride(path, title) {
  if (!path || !title) return;
  const overrides = readSessionTitleOverrides();
  overrides[path] = title;
  try { localStorage.setItem(STORAGE_SESSION_TITLES, JSON.stringify(overrides)); } catch {}
}

function truncateSessionTitle(text, max = 48) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function deriveChatTitle(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned === '[Image]') return '';
  const firstLine = cleaned.split('\n')[0].trim();
  if (/^(you are |# |system:|<\/?system)/i.test(firstLine)) {
    const taskLine = cleaned.match(/^Task:\s*(.+)$/m)?.[1]?.trim();
    return taskLine ? truncateSessionTitle(taskLine) : '';
  }
  const sentence = firstLine.match(/^.{1,100}?[.!?](?:\s|$)/)?.[0]?.trim() || firstLine;
  return truncateSessionTitle(sentence);
}

function isGenericSessionTitle(name) {
  return !name
    || /^Session [a-f0-9]{6,}/i.test(name)
    || /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}/.test(name)
    || name === 'Untitled'
    || name === 'Session';
}

function applyChatTitleFromPrompt(text) {
  const title = deriveChatTitle(text);
  if (!title) return;
  const path = currentSessionInfo?.sessionFile;
  const currentTitle = sessionTitle?.textContent?.trim() || '';
  if (!path && isGenericSessionTitle(currentTitle)) {
    sessionTitle.textContent = title;
    return;
  }
  if (path) {
    const overrides = readSessionTitleOverrides();
    if (!overrides[path] && isGenericSessionTitle(currentTitle)) {
      upsertCurrentSessionInSidebar(title);
    }
  }
}

function upsertCurrentSessionInSidebar(title) {
  const path = currentSessionInfo?.sessionFile;
  if (!path) {
    if (sessionTitle) sessionTitle.textContent = title;
    return;
  }
  saveSessionTitleOverride(path, title);
  if (sessionTitle) sessionTitle.textContent = title;
  let session = sessions.find((item) => item.path === path);
  if (!session) {
    const shortId = pathBasename(path);
    session = {
      id: `pi_${shortId}`,
      name: title,
      pinned: false,
      path,
    };
    sessions.unshift(session);
    currentSessionId = session.id;
  } else {
    session.name = title;
    currentSessionId = session.id;
  }
  renderSessions();
}

function buildSessionTree(list) {
  const normalized = list.map((session) => ({ ...session }));
  const childrenByParent = new Map();

  for (const session of normalized) {
    if (!session.isSubagent || !session.parentSessionPath) continue;
    const siblings = childrenByParent.get(session.parentSessionPath) || [];
    siblings.push(session);
    childrenByParent.set(session.parentSessionPath, siblings);
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  }

  const childPaths = new Set();
  for (const children of childrenByParent.values()) {
    for (const child of children) childPaths.add(child.path);
  }

  const roots = normalized.filter((session) => !childPaths.has(session.path));
  roots.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return { roots, childrenByParent };
}

function disambiguateSiblingNames(items) {
  const seen = new Map();
  return items.map((session) => {
    const baseName = session.name;
    const count = (seen.get(baseName) || 0) + 1;
    seen.set(baseName, count);
    if (count === 1) return session;
    const shortId = String(session.id || pathBasename(session.path)).replace(/^pi_/, '').slice(0, 6);
    return { ...session, name: `${baseName} · ${shortId}` };
  });
}

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
  const filtered = filterSessions(sessions);
  const titleOverrides = readSessionTitleOverrides();
  const decorated = filtered.map((session) => ({
    ...session,
    name: (session.path && titleOverrides[session.path]) || session.name,
  }));
  const pinned = decorated.filter(s => s.pinned);
  const unpinned = decorated.filter(s => !s.pinned);
  const { roots, childrenByParent } = buildSessionTree(unpinned);

  pinnedList.innerHTML = disambiguateSiblingNames(pinned)
    .map((session) => renderSessionNode(session, childrenByParent))
    .join('');
  recentsList.innerHTML = disambiguateSiblingNames(roots)
    .map((session) => renderSessionNode(session, childrenByParent))
    .join('');
  attachSessionEventListeners();
}

function renderSessionNode(session, childrenByParent, depth = 0) {
  const children = session.path ? (childrenByParent.get(session.path) || []) : [];
  const hasChildren = children.length > 0;
  const expanded = !session.path || !sessionCollapsedParents.has(session.path);
  const itemHtml = renderSessionItem(session, { depth, isChild: depth > 0, hasChildren, expanded, childCount: children.length });
  if (!hasChildren) return itemHtml;

  return `
    <div class="session-group" data-parent-path="${escAttr(session.path || '')}">
      ${itemHtml}
      <div class="session-children ${expanded ? '' : 'collapsed'}">
        ${disambiguateSiblingNames(children).map((child) => renderSessionItem(child, { depth: depth + 1, isChild: true })).join('')}
      </div>
    </div>`;
}

function attachSessionEventListeners() {
  document.querySelectorAll('.session-item[data-session-id]').forEach(el => {
    el.addEventListener('click', (event) => {
      if (event.target.closest('.session-action-btn') || event.target.closest('.session-children-toggle')) return;
      selectSession(el.dataset.sessionId);
    });
  });
  document.querySelectorAll('.session-children-toggle[data-parent-path]').forEach(button => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const parentPath = button.dataset.parentPath;
      if (!parentPath) return;
      if (sessionCollapsedParents.has(parentPath)) sessionCollapsedParents.delete(parentPath);
      else sessionCollapsedParents.add(parentPath);
      renderSessions();
    });
  });
  document.querySelectorAll('.session-pin-btn[data-session-id]').forEach(button => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      togglePin(button.dataset.sessionId);
    });
  });
  document.querySelectorAll('.session-delete-btn[data-session-id]').forEach(button => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteSession(button.dataset.sessionId);
    });
  });
}

function renderSessionItem(s, { depth = 0, isChild = false, hasChildren = false, expanded = true, childCount = 0 } = {}) {
  const sessionId = escAttr(s.id);
  const countLabel = Number.isFinite(s.messageCount) && s.messageCount > 0
    ? `<span class="session-message-count">${s.messageCount}</span>`
    : '';
  const childCountLabel = hasChildren && childCount > 0
    ? `<span class="session-child-count" title="${childCount} subagent run${childCount === 1 ? '' : 's'}">${childCount}</span>`
    : '';
  const subagentBadge = s.isSubagent
    ? `<span class="session-subagent-badge">${esc(s.subagentRole || 'agent')}</span>`
    : '';
  const toggle = hasChildren ? `
    <button type="button" class="session-children-toggle" data-parent-path="${escAttr(s.path || '')}" aria-expanded="${expanded}" title="Toggle subagent runs">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
    </button>` : '';
  return `
    <div class="session-item ${s.id === currentSessionId ? 'active' : ''} ${isChild ? 'session-item-child' : ''} ${s.isSubagent ? 'session-item-subagent' : ''}" data-session-id="${sessionId}" style="--session-depth:${depth}">
      ${toggle}
      <span class="session-name">${esc(s.name)}</span>
      ${subagentBadge}
      ${childCountLabel}
      ${countLabel}
      <div class="session-actions">
        <button class="session-action-btn session-pin-btn" title="${s.pinned ? 'Unpin' : 'Pin'}" data-session-id="${sessionId}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="${s.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
        </button>
        <button class="session-action-btn session-delete-btn" title="Delete" data-session-id="${sessionId}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

function togglePin(id) {
  const s = sessions.find(s => s.id === id);
  if (s) {
    s.pinned = !s.pinned;
    savePinnedSessions();
    renderSessions();
  }
}
function selectSession(id) {
  currentSessionId = id;
  const session = sessions.find(s => s.id === id);
  if (session && session.path) {
    switchToSession(session);
  }
  renderSessions();
  closeSidebar();
}

function deleteSession(id) {
  const session = sessions.find(s => s.id === id);
  if (!session) return;

  const label = session.name || 'this chat';
  if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;

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
  beginInlineSessionRename();
}
function toggleSection(header) {
  header.classList.toggle('collapsed');
  header.nextElementSibling.classList.toggle('collapsed');
}

function openSidebar() {
  sidebarEl?.classList.add('open');
  sidebarOverlay?.classList.remove('hidden');
  sidebarOverlay?.setAttribute('aria-hidden', 'false');
}

function closeSidebar() {
  sidebarEl?.classList.remove('open');
  sidebarOverlay?.classList.add('hidden');
  sidebarOverlay?.setAttribute('aria-hidden', 'true');
}

function toggleSidebar() {
  if (sidebarEl?.classList.contains('open')) closeSidebar();
  else openSidebar();
}


// ═══════════════════════════════════════════════════════════
// Pi Session Management
// ═══════════════════════════════════════════════════════════
function renderPiSessions(sessionFiles) {
  if (!sessionFiles || !sessionFiles.length) return;
  const currentPath = currentSessionInfo?.sessionFile;
  const titleOverrides = readSessionTitleOverrides();
  const MAX_SESSIONS = 30;

  const existingPinned = sessions.filter(s => s.pinned);
  sessions = [...existingPinned];
  const incoming = [];

  sessionFiles.slice(0, MAX_SESSIONS).forEach(s => {
    if (s.path === currentPath) return;

    const sessionName = (s.path && titleOverrides[s.path]) || s.name || 'Untitled';
    const shortId = s.id || pathBasename(s.path);
    incoming.push({
      id: `pi_${shortId}`,
      name: sessionName,
      pinned: false,
      path: s.path,
      messageCount: s.messageCount,
      timestamp: s.timestamp,
      cwd: s.cwd,
      isSubagent: Boolean(s.isSubagent),
      parentSessionPath: s.parentSessionPath || null,
      subagentRole: s.subagentRole || s.subagent?.role || null,
      subagentAttemptId: s.subagentAttemptId || s.subagent?.attemptId || null,
    });
  });

  for (const session of incoming) {
    const alreadyExists = sessions.find(existing => existing.path === session.path);
    if (!alreadyExists) sessions.push(session);
  }

  applyPinnedSessionsFromStorage();
  renderSessions();
}

function pathBasename(filePath) {
  return String(filePath || '').split('/').pop().split('\\').pop().replace(/\.jsonl$/i, '');
}

function switchToSession(session) {
  if (!session.path) return;
  debug('Switching to session: ' + session.path);
  send({ type: 'switch_session', sessionPath: session.path });
}

// ═══════════════════════════════════════════════════════════
// Copy / Retry / Feedback / Export
// ═══════════════════════════════════════════════════════════
function copyMsg(btn) {
  const msg = btn.closest('.message');
  const content = msg.querySelector('.msg-content');
  navigator.clipboard.writeText(content?.textContent || '').then(() => toast('Copied!', 'success'));
}

function feedbackMsg() {
  toast('Thanks for your feedback', 'success');
}

function collectChatMessages() {
  const messages = [];
  messagesEl.querySelectorAll('.message-user, .message-assistant').forEach(el => {
    const role = el.classList.contains('message-user') ? 'user' : 'assistant';
    const contentEl = el.querySelector('.msg-content');
    const content = contentEl?.textContent?.trim() || '';
    if (content) messages.push({ role, content });
  });
  return messages;
}

function sanitizeFilename(name) {
  return (name || 'chat').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'chat';
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportChat(format = 'markdown') {
  const messages = collectChatMessages();
  if (!messages.length) {
    toast('Nothing to export', 'error');
    return;
  }

  const title = sessionTitle?.textContent?.trim() || 'Chat';
  const exportedAt = new Date().toISOString();
  const baseName = sanitizeFilename(title);

  if (format === 'json') {
    const payload = { title, exportedAt, messages };
    downloadTextFile(JSON.stringify(payload, null, 2), `${baseName}.json`, 'application/json');
  } else {
    const lines = [`# ${title}`, '', `Exported: ${exportedAt}`, ''];
    messages.forEach(({ role, content }) => {
      lines.push(`## ${role === 'user' ? 'User' : 'Assistant'}`, '', content, '');
    });
    downloadTextFile(lines.join('\n'), `${baseName}.md`, 'text/markdown');
  }

  toast('Chat exported', 'success');
}

function retryMsg() {
  const userMsgs = messagesEl.querySelectorAll('.message-user');
  if (!userMsgs.length) return;
  const text = userMsgs[userMsgs.length - 1].querySelector('.msg-content')?.textContent?.trim() || '';
  if (!text) return;
  inputEl.value = text;
  autoResize();
  sendMessage('prompt');
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
$('#btn-export')?.addEventListener('click', (e) => exportChat(e.shiftKey ? 'json' : 'markdown'));
sidebarToggle?.addEventListener('click', toggleSidebar);
sidebarOverlay?.addEventListener('click', closeSidebar);
modeNav?.addEventListener('click', (event) => {
  const btn = event.target.closest('.session-tab');
  if (!btn) return;
  switchSessionTab(btn.dataset.sessionTab || btn.dataset.mode);
});
$('#btn-harness-start').addEventListener('click', startHarness);
$('#btn-harness-stop').addEventListener('click', stopHarness);
$('#btn-harness-run').addEventListener('click', runHarnessTask);
if (harnessPanel) harnessPanel.addEventListener('click', handleHarnessPanelClick);
$('#btn-harness-deep-run')?.addEventListener('click', runDeepResearchTask);
$('#btn-harness-deep-artifacts-refresh')?.addEventListener('click', renderDeepResearchArtifacts);
[
  harnessDeepScopeInclude,
  harnessDeepScopeExclude,
  harnessDeepToolCalls,
  harnessDeepMinutes,
  harnessDeepMaxSources,
  harnessDeepMaxTokens,
  harnessDeepOutputFormat,
].forEach((el) => el?.addEventListener('change', saveDeepResearchSettings));
document.querySelectorAll('input[name="deep-specialist"]').forEach((input) => {
  input.addEventListener('change', saveDeepResearchSettings);
});
$('#btn-harness-adaptive-refresh')?.addEventListener('click', requestHarnessAdaptiveSearchStatus);
$('#btn-harness-production-evidence-refresh')?.addEventListener('click', requestHarnessProductionEvidence);
$('#btn-harness-open-swarm-tab')?.addEventListener('click', () => openHarnessTab('swarm'));
$('#btn-harness-capabilities-refresh')?.addEventListener('click', requestHarnessCapabilities);
$('#btn-harness-skill-candidates-refresh')?.addEventListener('click', requestHarnessSkillCandidates);
$('#btn-harness-pi-bridge-refresh')?.addEventListener('click', requestHarnessPiBridgeState);
$('#btn-harness-promotion-queue-refresh')?.addEventListener('click', requestHarnessPromotionQueue);
$('#btn-capability-search')?.addEventListener('click', requestSmitherySearch);
$('#btn-capability-install-quick')?.addEventListener('click', installCapabilityFromQuickSource);
$('#btn-harness-capability-reset')?.addEventListener('click', resetHarnessCapabilityForm);
$('#btn-harness-traces-refresh')?.addEventListener('click', requestHarnessTraces);
$('#btn-harness-replay-prepare')?.addEventListener('click', () => prepareHarnessTraceReplay());
$('#btn-harness-replay-next')?.addEventListener('click', () => prepareHarnessTraceReplay({ next: true }));
$('#btn-harness-replay-reset')?.addEventListener('click', resetHarnessTraceReplay);
harnessCapabilityForm?.addEventListener('submit', saveHarnessCapability);
$('#capability-install-query')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    installCapabilityFromQuickSource();
  }
});
$('#harness-task-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runHarnessTask();
  }
});
$('#harness-deep-task-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    runDeepResearchTask();
  }
});
$('#model-search').addEventListener('input', (e) => renderModelList(e.target.value));

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', () => o.parentElement.classList.add('hidden'));
});

document.getElementById('btn-settings')?.addEventListener('click', () => openSettings());
document.querySelector('#modal-settings .settings-tabs')?.addEventListener('click', handleSettingsTabClick);
document.getElementById('btn-settings-save-url')?.addEventListener('click', saveSettingsServerUrl);
document.getElementById('btn-settings-test-connection')?.addEventListener('click', testSettingsConnection);
document.getElementById('btn-settings-workspace-browse')?.addEventListener('click', async (event) => {
  await chooseWorkspace(event);
  syncSettingsFormFromState();
  if (ws?.readyState === WebSocket.OPEN) requestWorkplaceStatus();
});
settingsWorkspacePathInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const newWorkspace = settingsWorkspacePathInput.value.trim();
    if (newWorkspace) applyWorkspaceSelection(newWorkspace);
  }
});
settingsWorkspacePathInput?.addEventListener('change', () => {
  const newWorkspace = settingsWorkspacePathInput.value.trim();
  if (newWorkspace) applyWorkspaceSelection(newWorkspace, { notify: false });
});
document.getElementById('btn-settings-init-workplace')?.addEventListener('click', initializeWorkplace);
document.getElementById('btn-settings-load-preset')?.addEventListener('click', () => {
  applyHarnessPreset(settingsHarnessPreset?.value || 'standard', 'merge');
});
document.getElementById('btn-settings-apply-preset')?.addEventListener('click', () => {
  applyHarnessPreset(settingsHarnessPreset?.value || 'standard', 'replace');
});
settingsEndpointForm?.addEventListener('submit', saveSettingsEndpoint);
settingsEndpointsList?.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-endpoint-test]');
  if (!btn) return;
  testEndpointProfile(btn.dataset.endpointTest);
});
document.getElementById('btn-settings-repair-workplace')?.addEventListener('click', repairWorkplace);
document.getElementById('btn-settings-save-router')?.addEventListener('click', saveSettingsRouterSection);
document.getElementById('btn-settings-save-general')?.addEventListener('click', saveSettingsGeneralSection);
document.getElementById('btn-settings-save-production')?.addEventListener('click', saveSettingsProductionSection);
document.getElementById('btn-settings-save-swarm')?.addEventListener('click', saveSettingsSwarmSection);
document.getElementById('btn-settings-save-secrets')?.addEventListener('click', saveSettingsSecrets);
document.getElementById('btn-settings-apply-pi-thinking')?.addEventListener('click', applyPiThinkingSettings);
document.getElementById('btn-config-drift-align')?.addEventListener('click', alignConfigDrift);
document.getElementById('btn-config-drift-dismiss')?.addEventListener('click', dismissConfigDriftBanner);
document.getElementById('btn-harness-swarm-configure')?.addEventListener('click', () => openSettings('swarm'));
statusChipApprovals?.addEventListener('click', openApprovalInbox);
statusChipApprovals?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openApprovalInbox();
  }
});
document.getElementById('approval-inbox-content')?.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-approval-action]');
  if (!btn) return;
  respondHarnessApproval(btn.dataset.approvalId, btn.dataset.approvalAction);
  renderApprovalInbox();
});
sessionSearchInput?.addEventListener('input', (event) => {
  sessionSearchQuery = event.target.value || '';
  renderSessions();
});
sessionTitleBar?.addEventListener('click', (event) => {
  if (event.target.closest('.session-title-input')) return;
  beginInlineSessionRename();
});
sessionTitleInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitInlineSessionRename();
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    sessionTitleInput.classList.add('hidden');
    sessionTitle.classList.remove('hidden');
  }
});
sessionTitleInput?.addEventListener('blur', commitInlineSessionRename);
capabilityViewMode?.addEventListener('change', () => setCapabilitiesViewMode(capabilityViewMode.checked));
document.querySelector('.workspace-breadcrumb')?.addEventListener('click', () => openSettings('workplace'));
document.querySelector('#mode-nav')?.addEventListener('keydown', (event) => {
  handleTablistKeydown(event, (tabId) => switchSessionTab(tabId));
});
document.querySelector('#modal-settings .settings-tabs')?.addEventListener('keydown', (event) => {
  handleTablistKeydown(event, (tabId) => {
    settingsState.activeTab = tabId;
    renderSettingsTabs();
    handleSettingsTabClick({ target: document.querySelector(`.settings-tab[data-settings-tab="${tabId}"]`) });
  });
});
document.addEventListener('keydown', (event) => {
  const tag = event.target?.tagName;
  const inField = tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable;
  if (event.key === 'Escape') {
    closeDropdowns();
    document.querySelectorAll('.modal:not(.hidden)').forEach(modal => modal.classList.add('hidden'));
  }
  if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey && !inField) {
    event.preventDefault();
    openModal('shortcuts');
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown') && !e.target.closest('.meta-select')) closeDropdowns();
});

// Debug panel toggle
const debugPanel = document.getElementById('debug-panel');
const btnDebug = document.getElementById('btn-debug');
const autoHarnessToggle = document.getElementById('auto-harness-toggle');
if (autoHarnessToggle) {
  autoHarnessToggle.checked = autoHarnessEnabled;
  autoHarnessToggle.addEventListener('change', () => {
    autoHarnessEnabled = autoHarnessToggle.checked;
    try { localStorage.setItem(LS_AUTO_HARNESS, autoHarnessEnabled ? 'true' : 'false'); } catch {}
  });
}
if (btnDebug) btnDebug.addEventListener('click', () => debugPanel.classList.toggle('hidden'));
const btnDebugClose = document.getElementById('btn-debug-close');
if (btnDebugClose) btnDebugClose.addEventListener('click', () => debugPanel.classList.add('hidden'));
document.getElementById('ext-cancel')?.addEventListener('click', extCancel);
document.getElementById('ext-overlay')?.addEventListener('click', extCancel);

// Auto-open debug on issues
setInterval(() => {
  if (!isConnected && debugPanel.classList.contains('hidden') && debugLog.length > 2) {
    debugPanel.classList.remove('hidden');
  }
}, 3000);

// ═══════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════
// Connection is started from the dialog, not automatically (browser dev mode).
// In Electron, auto-connect using runtime info from the main process.
async function bootstrapElectronConnection() {
  if (!window.electronAPI?.getRuntimeInfo) return;
  try {
    const info = await window.electronAPI.getRuntimeInfo();
    if (info?.appUrl && serverUrlInput) {
      const wsUrl = info.appUrl.replace(/^http/i, 'ws').replace(/\/$/, '');
      serverUrlInput.value = wsUrl;
    }
    if (info?.workspaceRoot) {
      applyWorkspaceSelection(info.workspaceRoot, { notify: false });
    }
    if (info?.piStatus && !info.piStatus.ok) {
      const message = info.piStatus.guidance?.join(' ') || 'Pi prerequisites are not satisfied.';
      toast(message, 'error');
    }
    startConnection();
  } catch (error) {
    debug('Electron bootstrap failed: ' + error.message);
  }
}

updateGlobalStatusBar();
updateHarnessPanelFooterVisibility();
loadStoredSmitheryKey();
checkCdnOffline();
window.addEventListener('load', () => {
  checkCdnOffline();
  bootstrapElectronConnection();
});
setCapabilitiesViewMode(false);
loadDeepResearchSettings();
setAppMode('chat');
