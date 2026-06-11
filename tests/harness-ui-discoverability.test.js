import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('harness controls expose deep research and capabilities as first-class toolbar actions', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const css = await readFile('public/app.css', 'utf8');

  assert.match(html, /id="btn-deep-research" class="topbar-icon-btn" title="Deep Research" aria-label="Open Deep Research"/);
  assert.match(html, /id="btn-capabilities" class="topbar-icon-btn" title="Capabilities" aria-label="Add Skills and MCPs"/);
  assert.match(html, /<div class="topbar-actions bottom-left-tool-dock" aria-label="Workspace tools">/);
  const inputStart = html.indexOf('<div id="input-area">');
  const inputEnd = html.indexOf('</main>', inputStart);
  const dockStart = html.indexOf('<div class="topbar-actions bottom-left-tool-dock"', inputStart);
  assert.ok(dockStart > inputStart && dockStart < inputEnd, 'tool dock should live in the input-area chrome layer');
  assert.match(css, /\.bottom-left-tool-dock\s*\{[^}]*position:\s*static/s);
  assert.doesNotMatch(css, /\.bottom-left-tool-dock\s*\{[^}]*z-index:\s*1200/s);
  assert.match(css, /#input-area\s*\{[^}]*grid-template-columns:\s*144px\s+minmax\(0,\s*1fr\)\s+144px/s);
  assert.doesNotMatch(html, /topbar-text-btn/);
});

test('chat surface exposes live assistant activity while turns are running', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const appJs = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/app.css', 'utf8');

  assert.match(html, /id="assistant-activity" class="assistant-activity hidden"/);
  assert.match(html, /id="assistant-activity-phase"/);
  assert.match(html, /id="assistant-activity-detail"/);
  assert.match(html, /id="assistant-activity-metrics"/);
  assert.match(appJs, /let assistantActivity =/);
  assert.match(appJs, /function setAssistantActivity/);
  assert.match(appJs, /function renderAssistantActivity/);
  assert.match(appJs, /phase:\s*'thinking'/);
  assert.match(appJs, /phase:\s*'tool'/);
  assert.match(appJs, /phase:\s*msg\.isError \? 'error' : 'tool'/);
  assert.match(appJs, /thinkingChars/);
  assert.match(appJs, /textChars/);
  assert.match(css, /\.assistant-activity/);
  assert.match(css, /\.assistant-activity-dot/);
  assert.match(css, /\.assistant-activity-metrics/);
});

test('harness artifact modal supports stale visual artifact previews', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const appJs = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/app.css', 'utf8');
  const serverJs = await readFile('src/server.js', 'utf8');
  const sidecarJs = await readFile('src/harness-sidecar/server.js', 'utf8');

  assert.match(html, /<div id="harness-artifact-content" class="harness-artifact-content">Loading\.\.\.<\/div>/);
  assert.match(appJs, /send\(\{ type: 'harness_artifact_get', artifactId, artifact \}\)/);
  assert.match(appJs, /payload\.dataUrl && String\(payload\.contentType \|\| ''\)\.startsWith\('image\/'\)/);
  assert.match(appJs, /payload\.contentType === 'application\/pdf'/);
  assert.match(css, /\.harness-artifact-content\.visual/);
  assert.match(css, /\.harness-artifact-image/);
  assert.match(css, /\.harness-artifact-frame/);
  assert.match(serverJs, /function readWorkspaceArtifactFallback/);
  assert.match(sidecarJs, /function registerEventArtifacts/);
  assert.match(sidecarJs, /artifactStore\.readArtifact/);
});

test('harness controls expose trace replay as a compact toolbar and tab surface', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const appJs = await readFile('public/app.js', 'utf8');
  const serverJs = await readFile('src/server.js', 'utf8');

  assert.match(html, /id="btn-traces" class="topbar-icon-btn" title="Traces" aria-label="Open Traces and Replay"/);
  assert.match(html, /data-harness-tab="traces"/);
  assert.match(html, /id="harness-trace-list"/);
  assert.match(html, /id="harness-trace-events"/);
  assert.match(html, /id="btn-harness-replay-next"/);
  assert.match(appJs, /harness_traces_get/);
  assert.match(appJs, /harness_trace_get/);
  assert.match(appJs, /harness_trace_replay_prepare/);
  assert.match(serverJs, /case 'harness_traces_get'/);
  assert.match(serverJs, /case 'harness_trace_get'/);
  assert.match(serverJs, /case 'harness_trace_replay_prepare'/);
});

test('harness panel exposes AB-MCTS adaptive search, skill review, and replay surfaces', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const appJs = await readFile('public/app.js', 'utf8');
  const serverJs = await readFile('src/server.js', 'utf8');
  const harnessClientJs = await readFile('src/harness/harnessClient.js', 'utf8');
  const css = await readFile('public/app.css', 'utf8');

  assert.match(html, /id="harness-adaptive-search"/);
  assert.match(html, /Adaptive Search/);
  assert.match(html, /id="harness-adaptive-selected-arm"/);
  assert.match(html, /id="harness-adaptive-mode"/);
  assert.match(html, /id="harness-adaptive-reward"/);
  assert.match(html, /id="harness-adaptive-arm-balance"/);
  assert.match(html, /id="harness-skill-candidate-review"/);
  assert.match(html, /Skill Candidate Review/);
  assert.match(html, /id="harness-skill-candidates"/);
  assert.match(html, /id="harness-abmcts-replay-results"/);
  assert.match(html, /AB-MCTS Replay Results/);
  assert.match(html, /id="harness-abmcts-decisions"/);

  assert.match(appJs, /harness_adaptive_search_status_get/);
  assert.match(appJs, /harness_adaptive_search_status/);
  assert.match(appJs, /harness_skill_candidates_get/);
  assert.match(appJs, /harness_skill_candidates/);
  assert.match(appJs, /harness_skill_candidate_review/);
  assert.match(appJs, /harness_abmcts_replay/);
  assert.match(appJs, /renderHarnessAdaptiveSearch/);
  assert.match(appJs, /renderHarnessSkillCandidates/);
  assert.match(appJs, /renderHarnessAbMctsReplay/);
  assert.match(appJs, /data-skill-candidate-action="approve"/);
  assert.match(appJs, /data-skill-candidate-action="reject"/);
  assert.match(serverJs, /case 'harness_adaptive_search_status_get'/);
  assert.match(serverJs, /case 'harness_adaptive_search_replay_prepare'/);
  assert.match(serverJs, /case 'harness_skill_candidates_get'/);
  assert.match(serverJs, /case 'harness_skill_candidate_review'/);
  assert.match(harnessClientJs, /async getAdaptiveSearchStatus/);
  assert.match(harnessClientJs, /async prepareAdaptiveSearchReplay/);
  assert.match(harnessClientJs, /async listSkillCandidates/);
  assert.match(harnessClientJs, /async reviewSkillCandidate/);

  assert.match(css, /\.harness-adaptive-search/);
  assert.match(css, /\.harness-skill-candidate/);
  assert.match(css, /\.harness-abmcts-decision/);
});

test('harness adaptive status surface displays model council pass@k uplift', async () => {
  const appJs = await readFile('public/app.js', 'utf8');
  const serverJs = await readFile('src/server.js', 'utf8');

  assert.match(appJs, /harness_model_council_passk_eval_prepare/);
  assert.match(appJs, /harness_model_council_passk_eval/);
  assert.match(appJs, /model_council\.passk_eval_completed/);
  assert.match(appJs, /passK/);
  assert.match(appJs, /best-single/);
  assert.match(appJs, /repeated/);
  assert.match(appJs, /static-council/);
  assert.match(appJs, /adaptive-council/);
  assert.match(appJs, /adaptive vs best/);
  assert.match(serverJs, /case 'harness_model_council_passk_eval_prepare'/);
  assert.match(serverJs, /prepareModelCouncilPassKEval/);
});

test('harness tools live in a persistent left side panel outside the chat feed', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const css = await readFile('public/app.css', 'utf8');

  assert.match(html, /<div id="workspace-layout" class="workspace-layout">/);
  assert.match(html, /<section id="chat-workspace" class="chat-workspace"/);
  assert.match(html, /<aside id="harness-panel" class="harness-panel hidden" aria-label="Helios Harness tools">/);

  const chatStart = html.indexOf('<section id="chat-workspace"');
  const harnessStart = html.indexOf('<aside id="harness-panel"');
  assert.ok(harnessStart < chatStart, 'harness panel should sit before the chat workspace so settings stay on the left');

  assert.match(css, /\.workspace-layout\s*\{/);
  assert.match(css, /\.chat-workspace\s*\{/);
  assert.match(css, /\.workspace-layout\s*\{[^}]*grid-template-columns:\s*minmax\(\s*360px,\s*420px\)\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /#main:has\(\.harness-panel:not\(\.hidden\)\)\s*#input-area/);
  assert.match(css, /\.harness-panel\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /@media \(max-width:\s*1180px\)[\s\S]*\.workspace-layout[\s\S]*grid-template-columns:\s*1fr/);
});

test('browser harness prompt routing recognizes installed slash commands safely', async () => {
  const appJs = await readFile('public/app.js', 'utf8');

  assert.equal(appJs.includes('/^\\/(?:harness|research|deep-research|forge)\\b/i'), true);
  assert.equal(appJs.includes("replace(/^\\/(?:harness|research|deep-research|forge)\\b[\\s:;-]*/i"), true);
  assert.equal(appJs.includes("harnessOnlyCommand = harnessRoute?.mode === 'direct' && /^\\/(?:harness|research|deep-research|forge)\\b/i.test(text)"), true);
  assert.equal(appJs.includes('function escAttr'), true);
  assert.equal(appJs.includes('data-task-id="${escAttr(trace.taskId)}"'), true);
});

test('session sidebar uses safe data attributes for Pi session ids', async () => {
  const appJs = await readFile('public/app.js', 'utf8');
  const renderItemStart = appJs.indexOf('function renderSessionItem(s)');
  const renderItemEnd = appJs.indexOf('function togglePin(id)', renderItemStart);
  const renderPiStart = appJs.indexOf('function renderPiSessions(sessionFiles)');
  const renderPiEnd = appJs.indexOf('renderSessions();', renderPiStart);
  const renderItem = appJs.slice(renderItemStart, renderItemEnd);
  const renderPiSessions = appJs.slice(renderPiStart, renderPiEnd);

  assert.match(appJs, /function attachSessionEventListeners\(\)/);
  assert.match(renderItem, /data-session-id="\$\{sessionId\}"/);
  assert.match(renderItem, /class="session-action-btn session-pin-btn"/);
  assert.match(renderItem, /class="session-action-btn session-delete-btn"/);
  assert.match(renderItem, /const sessionId = escAttr\(s\.id\)/);
  assert.doesNotMatch(renderItem, /onclick="selectSession/);
  assert.doesNotMatch(renderItem, /onclick="event\.stopPropagation\(\);togglePin/);
  assert.doesNotMatch(renderItem, /onclick="event\.stopPropagation\(\);deleteSession/);
  assert.match(renderPiSessions, /const shortId = s\.id \|\| String\(s\.path \|\| ''\)\.split\('\/'\)\.pop\(\)\.split\('\\\\'\)\.pop\(\)\.replace\(\/\\\.jsonl\$\/i, ''\)/);
  assert.match(renderPiSessions, /id: `pi_\$\{shortId\}`/);
  assert.doesNotMatch(renderPiSessions, /id: 'pi_' \+ s\.path/);
});

test('capabilities UI exposes package templates and slash commands', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const appJs = await readFile('public/app.js', 'utf8');
  const serverJs = await readFile('src/server.js', 'utf8');

  assert.match(html, /id="capability-list-template"/);
  assert.match(html, /id="capability-list-slash_command"/);
  assert.match(html, /<option value="template">Template<\/option>/);
  assert.match(html, /<option value="slash_command">Slash Command<\/option>/);
  assert.match(html, /id="capability-install-query"/);
  assert.doesNotMatch(html, /id="capability-install-source"/);
  assert.match(html, /npx -y skills add https:\/\/smithery\.ai\/skills\/anthropics\/skill-creator/);
  assert.match(html, /https:\/\/codex\.openai\.com\/marketplace\/skills\/openai\/code-review/);
  assert.match(html, /claude mcp add/);
  assert.match(html, /pi extension add/);
  assert.match(html, /id="btn-capability-search"/);
  assert.match(html, /id="btn-capability-install-quick"/);
  assert.match(html, /id="capability-smithery-results"/);
  assert.match(appJs, /id: 'template'/);
  assert.match(appJs, /id: 'slash_command'/);
  assert.match(appJs, /harness_smithery_search/);
  assert.match(appJs, /harness_smithery_results/);
  assert.match(appJs, /parseCapabilityInstallInput/);
  assert.match(appJs, /installCapabilityFromQuickSource/);
  assert.match(appJs, /applySmitheryResult/);
  assert.match(serverJs, /case 'harness_smithery_search'/);
});

test('harness panel exposes live subagent activity', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(html, /data-harness-tab="swarm"/);
  assert.match(html, /id="harness-subagents"/);
  assert.match(html, /id="harness-swarm-attempts"/);
  assert.match(html, /id="harness-swarm-attempt-detail"/);
  assert.match(html, /id="harness-swarm-timeline"/);
  assert.match(html, /id="harness-swarm-thinking"/);
  assert.match(html, /id="harness-swarm-actions"/);
  assert.match(html, /id="harness-swarm-handoff"/);
  assert.match(html, /id="harness-swarm-event-inspector"/);
  assert.match(appJs, /swarm\.subagent_started/);
  assert.match(appJs, /swarm\.subagent_completed/);
  assert.match(appJs, /swarm\.subagent_trace/);
  assert.match(appJs, /pi_native_subagent/);
  assert.match(appJs, /renderHarnessSwarm/);
  assert.match(appJs, /renderHarnessSwarmInspector/);
  assert.match(appJs, /data-swarm-event-key/);
  assert.match(appJs, /selectedEventKey/);
  assert.match(appJs, /thinkingSummary/);
  assert.match(appJs, /compactHandoff/);
  assert.match(appJs, /renderHarnessSubagents/);
});

test('harness swarm visibility exposes model council route metadata', async () => {
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(appJs, /model_council\.enabled/);
  assert.match(appJs, /model_council\.report_created/);
  assert.match(appJs, /agent\.model\?\.profileName/);
  assert.match(appJs, /agent\.model\?\.route\?\.endpointProfile/);
  assert.match(appJs, /selected\.model\?\.route\?\.endpointProfile/);
});

test('harness panel exposes hierarchical local meta and memory feedback', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="harness-local-meta"/);
  assert.match(html, /Local Meta/);
  assert.match(html, /id="harness-memory-hierarchy"/);
  assert.match(html, /Memory Hierarchy/);
  assert.match(html, /id="harness-experiments"/);
  assert.match(html, /Harness Experiments/);
  assert.match(appJs, /local_meta\.completed/);
  assert.match(appJs, /local_memory\.proposed/);
  assert.match(appJs, /harness_experiment\.completed/);
  assert.match(appJs, /renderHarnessHierarchyFeedback/);
});

test('harness events coalesce panel renders so approval controls stay responsive', async () => {
  const appJs = await readFile('public/app.js', 'utf8');
  const handlerStart = appJs.indexOf('function handleHarnessEvent(event)');
  const handlerEnd = appJs.indexOf('function updateHarnessPolicyEvolution', handlerStart);
  const handler = appJs.slice(handlerStart, handlerEnd);

  assert.match(appJs, /let harnessRenderScheduled = false/);
  assert.match(appJs, /function scheduleHarnessRender\(\{ immediate = false \} = \{\}\)/);
  assert.match(appJs, /requestAnimationFrame\(run\)/);
  assert.match(handler, /scheduleHarnessRender\(\);/);
  assert.doesNotMatch(handler, /\n\s*renderHarnessPanel\(\);\s*\n\}/);
});

test('harness subagent render state is bounded during event bursts', async () => {
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(appJs, /const HARNESS_MAX_SUBAGENTS = \d+/);
  assert.match(appJs, /function pruneHarnessSubagents\(\)/);
  assert.match(appJs, /harnessState\.subagents\.size <= HARNESS_MAX_SUBAGENTS/);
  assert.match(appJs, /pruneHarnessSubagents\(\);/);
});

test('harness panel recognizes evolution-aware swarm feedback events', async () => {
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(appJs, /swarm\.evolution_planning_created/);
  assert.match(appJs, /swarm\.outcome_recorded/);
  assert.match(appJs, /policy_evolution\.summary/);
  assert.match(appJs, /autoApprovalEligibility/);
  assert.doesNotMatch(appJs, /autoApprovalEligibility\.status === 'auto_approved'.*apply/s);
});

test('harness panel exposes verifier evolution operator visibility', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="harness-verifier-evolution"/);
  assert.match(html, /id="harness-verifier-evolution-status"/);
  assert.match(html, /id="harness-verifier-latest-score"/);
  assert.match(html, /id="harness-verifier-baseline-comparison"/);
  assert.match(html, /id="harness-verifier-pending-promotions"/);
  assert.match(html, /id="harness-verifier-artifacts"/);
  assert.match(appJs, /verifier_evolution\.candidate_completed/);
  assert.match(appJs, /verifier_evolution\.promotion_evaluated/);
  assert.match(appJs, /renderHarnessVerifierEvolution/);
  assert.match(appJs, /pendingVerifierPromotions/);
  assert.match(appJs, /visualVerifierArtifacts/);
});

test('harness panel exposes capability goal status rows', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="harness-capability-goals"/);
  assert.match(html, /id="harness-capability-goals-status"/);
  assert.match(html, /id="harness-capability-goals-implemented"/);
  assert.match(html, /id="harness-capability-goal-rows"/);
  assert.match(appJs, /capabilityGoals/);
  assert.match(appJs, /renderCapabilityGoalRows/);
  assert.match(appJs, /harnessCapabilityGoalsOpen/);
});

test('frontend asset version changes when harness UI changes', async () => {
  const html = await readFile('public/index.html', 'utf8');

  assert.match(html, /app\.css\?v=20250621/);
  assert.match(html, /app\.js\?v=20250621/);
});
