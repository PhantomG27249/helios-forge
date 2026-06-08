import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createHarnessSidecar } from '../src/harness-sidecar/server.js';

async function withSidecar(testFn, options = {}) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-harness-test-'));
  await options.beforeStart?.({ workspaceRoot });
  const sidecar = createHarnessSidecar({ workspaceRoot, port: 0, ...(options.sidecarOptions || {}) });
  await sidecar.start();

  try {
    await testFn({ sidecar, workspaceRoot });
  } finally {
    await sidecar.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function waitForEvent(events, predicate, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const existing = events.find(predicate);
    if (existing) {
      resolve(existing);
      return;
    }

    const deadline = setTimeout(() => {
      reject(new Error('Timed out waiting for sidecar event'));
    }, timeoutMs);

    events.push = new Proxy(events.push, {
      apply(target, thisArg, args) {
        const result = Reflect.apply(target, thisArg, args);
        const event = args[0];
        if (predicate(event)) {
          clearTimeout(deadline);
          resolve(event);
        }
        return result;
      },
    });
  });
}

test('health endpoint reports status and workspace root', async () => {
  await withSidecar(async ({ sidecar, workspaceRoot }) => {
    const response = await fetch(`${sidecar.url}/v1/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.workspaceRoot, workspaceRoot);
    assert.equal(body.version, '0.1.0');
  });
});

test('task endpoint emits deterministic MVP events and writes a trace', async () => {
  await withSidecar(async ({ sidecar, workspaceRoot }) => {
    const events = [];
    const unsubscribe = sidecar.onEvent((event) => events.push(event));

    const response = await fetch(`${sidecar.url}/v1/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'local',
        task: 'fix the failing test',
        mode: 'mvp',
        budget: { maxToolCalls: 20, maxWallMinutes: 15 },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 202);
    assert.match(body.taskId, /^task_/);

    const approvalEvent = await waitForEvent(
      events,
      (event) => event.taskId === body.taskId && event.type === 'approval.required',
    );

    assert.equal(approvalEvent.risk, 'medium');
    assert.equal(approvalEvent.choices.includes('approve'), true);
    assert.equal(events.some((event) => event.type === 'context_pack.created'), true);
    assert.equal(events.some((event) => event.type === 'subgoals.planned'), true);
    assert.equal(events.some((event) => event.type === 'budget.updated'), true);
    assert.equal(events.some((event) => event.type === 'collaboration.lock_acquired'), true);
    assert.equal(events.some((event) => event.type === 'task_state.updated'), true);
    assert.equal(events.some((event) => event.type === 'audit.recorded' && event.operation === 'task.create'), true);
    assert.equal(events.some((event) => event.type === 'verifier.output' && /MVP verifier passed/.test(event.stdout)), true);
    const patchEvent = events.find((event) => event.type === 'patch.proposed');
    assert.equal(Boolean(patchEvent), true);
    assert.equal(patchEvent.artifacts.length, 1);
    assert.equal(patchEvent.artifacts[0].type, 'patch_manifest');

    const artifactResponse = await fetch(`${sidecar.url}/v1/artifacts/${patchEvent.artifacts[0].artifactId}`);
    const artifactBody = await artifactResponse.json();
    assert.equal(artifactResponse.status, 200);
    assert.equal(artifactBody.artifact.artifactId, patchEvent.artifacts[0].artifactId);
    assert.equal(artifactBody.content.includes('Demonstrate patch proposal flow'), true);

    const tracePath = path.join(workspaceRoot, '.harness', 'traces', body.taskId, 'events.jsonl');
    const traceContent = await readFile(tracePath, 'utf8');
    assert.match(traceContent, /task\.started/);
    assert.match(traceContent, /approval\.required/);

    const taskResponse = await fetch(`${sidecar.url}/v1/tasks/${body.taskId}`);
    const taskDetail = await taskResponse.json();
    assert.equal(taskResponse.status, 200);
    assert.equal(taskDetail.task.taskId, body.taskId);
    assert.equal(taskDetail.state.version >= 2, true);
    assert.equal(taskDetail.audit.some((entry) => entry.operation === 'patch.propose'), true);

    unsubscribe();
  });
});

test('task endpoint runs all enabled harness subsystems at runtime', async () => {
  await withSidecar(async ({ sidecar, workspaceRoot }) => {
    await writeFile(
      path.join(workspaceRoot, 'sample.js'),
      'export function sampleHarnessTarget() { return true; }\n',
    );
    const events = [];
    const unsubscribe = sidecar.onEvent((event) => events.push(event));

    const response = await fetch(`${sidecar.url}/v1/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'local',
        task: 'exercise every harness subsystem',
        mode: 'full',
        budget: { maxToolCalls: 20, maxWallMinutes: 15 },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 202);
    await waitForEvent(
      events,
      (event) => event.taskId === body.taskId && event.type === 'harness_runtime.enabled',
    );

    const requiredTypes = [
      'bes.strategies_seeded',
      'bes.subgoals_scored',
      'bes.genomes_created',
      'bes.recombination_proposed',
      'graph.code_graph_created',
      'graph.code_impact_analyzed',
      'graph.context_composed',
      'memory.candidate_written',
      'memory.reflection_evaluated',
      'memory.corpus_scored',
      'memory.promoted',
      'memory.context_retrieved',
      'meta.trace_inspected',
      'rho.coreset_selected',
      'bes.meta_candidates_generated',
      'rho.preference_judged',
      'meta.optimizer_proposed',
      'meta.promotion_evaluated',
      'trace.compacted',
      'task.resume_ready',
      'verifier.registry_loaded',
      'verifier.selection_created',
      'research.report_created',
      'research.v2_artifacts_created',
      'research.handoff_created',
      'experiment.proposed',
      'experiment.queued',
      'experiment.run_recorded',
      'experiment.decision_written',
      'swarm.subagent_started',
      'swarm.subagent_completed',
      'swarm.attempts_scheduled',
      'swarm.champion_selected',
      'swarm.orchestration_completed',
      'swarm.champion_apply_proposed',
      'vlm.visual_context_created',
      'vlm.native_artifacts_created',
      'context.window_evaluated',
      'budget.dashboard_updated',
      'collaboration.workspace_lease_acquired',
    ];
    for (const type of requiredTypes) {
      assert.equal(events.some((event) => event.type === type), true, `missing ${type}`);
    }

    const graphEvent = events.find((event) => event.type === 'graph.code_graph_created');
    assert.equal(graphEvent.symbolCount >= 1, true);

    const runtimeEvent = events.find((event) => event.type === 'harness_runtime.enabled');
    assert.equal(runtimeEvent.mode, 'full');
    assert.equal(runtimeEvent.enabledSubsystems.includes('meta'), true);
    assert.equal(runtimeEvent.enabledSubsystems.includes('bes'), true);
    assert.equal(runtimeEvent.modelDrivenSwarm, false);

    const scheduledEvent = events.find((event) => event.type === 'swarm.attempts_scheduled');
    assert.equal(scheduledEvent.planning.strategy, 'tooltree');
    assert.equal(scheduledEvent.planning.attempts.length, 4);
    assert.equal(scheduledEvent.planning.attempts.every((attempt) => attempt.planning), true);

    const completedEvent = events.find((event) => event.type === 'swarm.orchestration_completed');
    assert.equal(completedEvent.planning.strategy, 'tooltree');

    const coresetEvent = events.find((event) => event.type === 'rho.coreset_selected');
    assert.equal(coresetEvent.selectedCount >= 1, true);
    assert.equal(coresetEvent.items.some((item) => item.taskId === body.taskId), true);

    const unifiedContextEvent = events.find((event) => event.type === 'context.unified_context_composed');
    assert.equal(Boolean(unifiedContextEvent), true);
    assert.equal(unifiedContextEvent.taskId, body.taskId);
    assert.equal(unifiedContextEvent.contextPackId.startsWith('ctx_'), true);
    assert.equal(unifiedContextEvent.sources.includes('workspace_rag'), true);
    assert.equal(unifiedContextEvent.sources.includes('promoted_memory'), true);
    assert.equal(unifiedContextEvent.sources.includes('knowledge_graph'), true);
    assert.equal(unifiedContextEvent.sourceCounts.workspace_rag >= 1, true);
    assert.equal(unifiedContextEvent.sourceCounts.promoted_memory >= 1, true);
    assert.equal(unifiedContextEvent.sourceCounts.knowledge_graph >= 1, true);
    assert.equal(unifiedContextEvent.itemCount >= 3, true);
    assert.equal(unifiedContextEvent.sourceLabels.some((label) => label.startsWith('memory:')), true);
    assert.equal(unifiedContextEvent.sourceLabels.some((label) => label.startsWith('graph:run:')), true);

    const besMetaEvent = events.find((event) => event.type === 'bes.meta_candidates_generated');
    assert.equal(besMetaEvent.candidateCount, 4);
    assert.equal(Boolean(besMetaEvent.champion), true);

    const preferenceEvent = events.find((event) => event.type === 'rho.preference_judged');
    assert.equal(Boolean(preferenceEvent.winner.candidateId), true);
    const promotionEvent = events.find((event) => event.type === 'meta.promotion_evaluated');
    assert.equal(promotionEvent.decision.status, 'rejected');
    assert.equal(promotionEvent.decision.reasons.includes('missing_human_approval'), true);
    assert.equal(promotionEvent.decision.reasons.includes('smoke_failed'), true);

    const memoryContent = await readFile(
      path.join(workspaceRoot, '.harness', 'memory', 'candidates.jsonl'),
      'utf8',
    );
    assert.match(memoryContent, /exercise every harness subsystem/);
    const graphSnapshotEvent = events.find((event) => event.type === 'memory.graph_snapshot_maintained');
    assert.equal(Boolean(graphSnapshotEvent), true);
    assert.equal(graphSnapshotEvent.nodeCount >= 2, true);
    assert.equal(graphSnapshotEvent.rankedContextItemCount >= 1, true);

    const graphSnapshot = JSON.parse(await readFile(
      path.join(workspaceRoot, '.harness', 'memory', 'graph-snapshot.json'),
      'utf8',
    ));
    assert.equal(graphSnapshot.schemaVersion, 1);
    assert.equal(
      graphSnapshot.nodes.some((node) => node.kind === 'memory' && node.source === 'promoted_memory'),
      true,
    );
    assert.equal(graphSnapshot.nodes.some((node) => node.kind === 'trace' && node.taskId === body.taskId), true);
    assert.equal(graphSnapshot.rankedContextItems.some((item) => item.source === 'graph_memory'), true);

    const tracePath = path.join(workspaceRoot, '.harness', 'traces', body.taskId, 'events.jsonl');
    const traceContent = await readFile(tracePath, 'utf8');
    assert.match(traceContent, /meta\.optimizer_proposed/);
    assert.match(traceContent, /rho\.coreset_selected/);
    assert.match(traceContent, /bes\.meta_candidates_generated/);
    assert.match(traceContent, /rho\.preference_judged/);
    assert.match(traceContent, /research\.report_created/);
    assert.match(traceContent, /experiment\.decision_written/);

    const metaEvent = events.find((event) => event.type === 'meta.optimizer_proposed');
    const metaArtifactContent = await readFile(metaEvent.artifacts[0].path, 'utf8');
    const metaArtifactJson = JSON.parse(metaArtifactContent);
    assert.equal(metaArtifactJson.selectedCandidateId, preferenceEvent.winner.candidateId);
    assert.equal(metaArtifactJson.candidates.length, 4);
    assert.equal(metaArtifactJson.coreset.selectedCount, coresetEvent.selectedCount);
    assert.equal(metaArtifactJson.preference.winner.candidateId, preferenceEvent.winner.candidateId);
    assert.equal(metaArtifactJson.proposal.requiresApproval, true);

    unsubscribe();
  });
});

test('full runtime invokes VLM observation when configured model supports vision', async () => {
  const modelCalls = [];
  const modelProviderFactory = () => async (callInput) => {
    modelCalls.push(callInput);
    if (callInput.purpose === 'vlm_observation') {
      return {
        text: JSON.stringify({
          observations: [{ text: 'Runtime preview image is visible.' }],
          risks: [{ description: 'No visual regression detected.', severity: 'low' }],
          score: 0.86,
        }),
        usage: { inputTokens: 120, outputTokens: 30 },
      };
    }

    return {
      text: JSON.stringify({
        summary: 'Model worker completed a dry-run analysis.',
        verifierEvidence: ['dry-run verifier evidence'],
        score: 0.8,
      }),
      usage: { inputTokens: 80, outputTokens: 20 },
    };
  };

  await withSidecar(
    async ({ sidecar, workspaceRoot }) => {
      await writeFile(
        path.join(workspaceRoot, 'sample.js'),
        'export function sampleHarnessTarget() { return true; }\n',
      );
      const events = [];
      const unsubscribe = sidecar.onEvent((event) => events.push(event));

      const response = await fetch(`${sidecar.url}/v1/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'local',
          task: 'exercise model vision in full runtime',
          mode: 'full',
          budget: { maxToolCalls: 20, maxWallMinutes: 15 },
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 202);
      const vlmEvent = await waitForEvent(
        events,
        (event) => event.taskId === body.taskId && event.type === 'vlm.model_observation_created',
      );

      const vlmCall = modelCalls.find((call) => call.purpose === 'vlm_observation');
      assert.equal(Boolean(vlmCall), true);
      assert.equal(vlmCall.visionInputs.length >= 1, true);
      assert.equal(vlmCall.visionInputs.every((input) => input.dataUrl?.startsWith('data:image/png;base64,')), true);
      assert.equal(vlmEvent.observationCount, 1);
      assert.equal(vlmEvent.score, 0.86);
      assert.equal(vlmEvent.risks.length, 1);
      assert.equal(vlmEvent.model.model, 'local-test-vlm');
      const toolRegistryEvent = events.find((event) => event.type === 'tools.default_registry_available');
      assert.equal(Boolean(toolRegistryEvent), true);
      assert.deepEqual(toolRegistryEvent.toolNames, ['mcp.call', 'shell.run', 'verifier.run', 'visual.verifier.run']);
      assert.equal(toolRegistryEvent.toolLoopReady, true);

      unsubscribe();
    },
    {
      sidecarOptions: { modelProviderFactory },
      beforeStart: async ({ workspaceRoot }) => {
        const harnessDir = path.join(workspaceRoot, '.harness');
        await mkdir(harnessDir, { recursive: true });
        await writeFile(
          path.join(harnessDir, 'config.yaml'),
          [
            'features:',
            '  modelDrivenSwarm: true',
            'models:',
            '  swarmBaseUrl: http://model.test/v1',
            '  swarmModelId: local-test-vlm',
            '  swarmSupportsVision: true',
            '',
          ].join('\n'),
        );
      },
    },
  );
});

test('task startup launches enabled MCP capabilities through injected runtime', async () => {
  await withSidecar(
    async ({ sidecar }) => {
      const events = [];
      const unsubscribe = sidecar.onEvent((event) => events.push(event));

      const response = await fetch(`${sidecar.url}/v1/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'local',
          task: 'mount real mcp capabilities',
          mode: 'mvp',
          budget: { maxToolCalls: 20, maxWallMinutes: 15 },
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 202);
      const mcpEvent = await waitForEvent(
        events,
        (event) => event.taskId === body.taskId && event.type === 'mcp.capability_runtime.started',
      );

      assert.equal(mcpEvent.id, 'local-mcp');
      assert.equal(mcpEvent.transport, 'stdio');
      assert.equal(JSON.stringify(mcpEvent).includes('secret-value'), false);
      assert.equal(JSON.stringify(mcpEvent).includes('API_TOKEN'), false);

      unsubscribe();
    },
    {
      sidecarOptions: {
        mcpRuntime: {
          async startServer() {
            return { status: 'running' };
          },
        },
      },
      beforeStart: async ({ workspaceRoot }) => {
        const harnessDir = path.join(workspaceRoot, '.harness');
        await mkdir(harnessDir, { recursive: true });
        await writeFile(
          path.join(harnessDir, 'capabilities.json'),
          JSON.stringify({
            version: 1,
            capabilities: [{
              id: 'local-mcp',
              type: 'mcp',
              enabled: true,
              transport: 'stdio',
              command: 'node',
              args: ['server.js'],
              env: { API_TOKEN: 'secret-value' },
            }],
          }),
        );
      },
    },
  );
});

test('full runtime gates verifier evolution behind config and creates approval action', async () => {
  await withSidecar(
    async ({ sidecar }) => {
      const events = [];
      const unsubscribe = sidecar.onEvent((event) => events.push(event));

      const response = await fetch(`${sidecar.url}/v1/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'local',
          task: 'exercise verifier evolution',
          mode: 'full',
          budget: { maxToolCalls: 20, maxWallMinutes: 15 },
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 202);
      const summary = await waitForEvent(
        events,
        (event) => event.taskId === body.taskId && (
          event.type === 'verifier_evolution.summary'
            || event.type === 'verifier_evolution.failed'
        ),
        8000,
      );

      assert.equal(summary.type, 'verifier_evolution.summary');
      assert.equal(summary.promoted, false);
      assert.equal(summary.proposalCount >= 1, true);
      const approval = events.find((event) => (
        event.taskId === body.taskId
          && event.type === 'approval.required'
          && event.kind === 'verifier_config_apply'
      ));
      assert.equal(Boolean(approval), true);
      assert.equal(approval.risk, 'high');
      assert.equal(approval.reason, 'verifier_config_promotion_requested');
      assert.equal(approval.proposedAction.kind, 'verifier_config_apply');

      unsubscribe();
    },
    {
      beforeStart: async ({ workspaceRoot }) => {
        const harnessDir = path.join(workspaceRoot, '.harness');
        await mkdir(harnessDir, { recursive: true });
        await writeFile(
          path.join(harnessDir, 'config.yaml'),
          [
            'features:',
            '  verifierEvolution: true',
            '',
          ].join('\n'),
        );
      },
    },
  );
});

test('autonomous full runtime uses tool loop instead of scripted MVP verifier', async () => {
  const modelCalls = [];
  const modelProviderFactory = () => async (callInput) => {
    modelCalls.push(callInput);
    if (callInput.purpose === 'full_task_tool_loop') {
      return { text: 'Tool loop completed the task.', usage: { inputTokens: 10, outputTokens: 8 } };
    }
    if (callInput.purpose === 'vlm_observation') {
      return { text: JSON.stringify({ observations: [{ text: 'Preview ok.' }], risks: [], score: 0.8 }) };
    }
    return {
      text: JSON.stringify({
        summary: 'Model worker dry run.',
        verifierEvidence: ['dry-run verifier evidence'],
        score: 0.8,
      }),
    };
  };

  await withSidecar(
    async ({ sidecar, workspaceRoot }) => {
      await writeFile(
        path.join(workspaceRoot, 'sample.js'),
        'export function sampleHarnessTarget() { return true; }\n',
      );
      const events = [];
      const unsubscribe = sidecar.onEvent((event) => events.push(event));

      const response = await fetch(`${sidecar.url}/v1/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'local',
          task: 'use the model tool loop for the real task',
          mode: 'full',
          budget: { maxToolCalls: 20, maxWallMinutes: 15 },
        }),
      });
      const body = await response.json();

      assert.equal(response.status, 202);
      const loopEvent = await waitForEvent(
        events,
        (event) => event.taskId === body.taskId && event.type === 'tool_loop.completed',
      );
      assert.equal(loopEvent.status, 'completed');
      assert.equal(loopEvent.finalText, 'Tool loop completed the task.');
      assert.equal(modelCalls.some((call) => call.purpose === 'full_task_tool_loop'), true);
      assert.equal(events.some((event) => event.type === 'verifier.output' && event.name === 'mvp-scripted-verifier'), false);

      unsubscribe();
    },
    {
      sidecarOptions: { modelProviderFactory },
      beforeStart: async ({ workspaceRoot }) => {
        const harnessDir = path.join(workspaceRoot, '.harness');
        await mkdir(harnessDir, { recursive: true });
        await writeFile(
          path.join(harnessDir, 'config.yaml'),
          [
            'features:',
            '  modelDrivenSwarm: true',
            '  autonomousToolLoop: true',
            'models:',
            '  swarmBaseUrl: http://model.test/v1',
            '  swarmModelId: local-test-vlm',
            '',
          ].join('\n'),
        );
      },
    },
  );
});

test('approving champion apply resumes safe apply action once', async () => {
  const applyCalls = [];
  const modelProviderFactory = () => async (callInput) => {
    if (callInput.purpose === 'full_task_tool_loop') {
      return { text: 'Ready to apply champion.' };
    }
    return {
      text: JSON.stringify({
        summary: 'Model worker dry run.',
        verifierEvidence: ['dry-run verifier evidence'],
        score: 0.8,
      }),
    };
  };

  await withSidecar(
    async ({ sidecar, workspaceRoot }) => {
      await writeFile(
        path.join(workspaceRoot, 'sample.js'),
        'export function sampleHarnessTarget() { return true; }\n',
      );
      const events = [];
      const unsubscribe = sidecar.onEvent((event) => events.push(event));

      const taskResponse = await fetch(`${sidecar.url}/v1/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'local',
          task: 'approve champion apply',
          mode: 'full',
          budget: { maxToolCalls: 20, maxWallMinutes: 15 },
        }),
      });
      const taskBody = await taskResponse.json();
      assert.equal(taskResponse.status, 202);

      const approvalEvent = await waitForEvent(
        events,
        (event) => event.taskId === taskBody.taskId
          && event.type === 'approval.required'
          && event.proposedAction?.kind === 'champion_apply',
      );

      const response = await fetch(`${sidecar.url}/v1/approvals/${approvalEvent.actionId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ choice: 'approve', actor: 'tester' }),
      });
      const approvalBody = await response.json();

      assert.equal(response.status, 200);
      assert.equal(approvalBody.status, 'resolved');
      const resumeEvent = await waitForEvent(
        events,
        (event) => event.type === 'approval.resume_completed' && event.actionId === approvalEvent.actionId,
      );

      assert.equal(applyCalls.length, 1);
      assert.equal(applyCalls[0].cwd, workspaceRoot);
      assert.equal(resumeEvent.result.status, 'applied');

      const secondResponse = await fetch(`${sidecar.url}/v1/approvals/${approvalEvent.actionId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ choice: 'approve', actor: 'tester' }),
      });
      assert.equal(secondResponse.status, 200);
      assert.equal(applyCalls.length, 1);

      unsubscribe();
    },
    {
      sidecarOptions: {
        modelProviderFactory,
        applyAdapter: async (input) => {
          applyCalls.push(input);
          return { applied: true };
        },
      },
      beforeStart: async ({ workspaceRoot }) => {
        const harnessDir = path.join(workspaceRoot, '.harness');
        await mkdir(harnessDir, { recursive: true });
        await writeFile(
          path.join(harnessDir, 'config.yaml'),
          [
            'features:',
            '  modelDrivenSwarm: true',
            '  autonomousToolLoop: true',
            '  safeApply: true',
            'models:',
            '  swarmBaseUrl: http://model.test/v1',
            '  swarmModelId: local-test',
            '',
          ].join('\n'),
        );
      },
    },
  );
});

test('task endpoint preserves prompt launch source metadata', async () => {
  await withSidecar(async ({ sidecar }) => {
    const events = [];
    const unsubscribe = sidecar.onEvent((event) => events.push(event));

    const response = await fetch(`${sidecar.url}/v1/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'local',
        task: 'inspect prompt launch source',
        mode: 'full',
        source: 'prompt_background',
        budget: { maxToolCalls: 20, maxWallMinutes: 15 },
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 202);
    const startedEvent = await waitForEvent(
      events,
      (event) => event.taskId === body.taskId && event.type === 'task.started',
    );
    const taskResponse = await fetch(`${sidecar.url}/v1/tasks/${body.taskId}`);
    const taskDetail = await taskResponse.json();

    assert.equal(startedEvent.source, 'prompt_background');
    assert.equal(taskDetail.task.source, 'prompt_background');

    unsubscribe();
  });
});

test('approval endpoint resolves a pending approval and emits an event', async () => {
  await withSidecar(async ({ sidecar }) => {
    const events = [];
    const unsubscribe = sidecar.onEvent((event) => events.push(event));

    const taskResponse = await fetch(`${sidecar.url}/v1/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceId: 'local',
        task: 'approve a toy patch',
        mode: 'mvp',
        budget: { maxToolCalls: 20, maxWallMinutes: 15 },
      }),
    });
    const taskBody = await taskResponse.json();
    const approvalEvent = await waitForEvent(
      events,
      (event) => event.taskId === taskBody.taskId && event.type === 'approval.required',
    );

    const response = await fetch(`${sidecar.url}/v1/approvals/${approvalEvent.actionId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ choice: 'approve' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'resolved');
    assert.equal(body.choice, 'approve');

    const resolvedEvent = await waitForEvent(
      events,
      (event) => event.type === 'approval.resolved' && event.actionId === approvalEvent.actionId,
    );
    assert.equal(resolvedEvent.choice, 'approve');

    const finalAuditEvent = await waitForEvent(
      events,
      (event) => event.type === 'final_audit.created' && event.taskId === taskBody.taskId,
    );
    assert.equal(finalAuditEvent.artifacts.length, 1);
    assert.equal(finalAuditEvent.approvalChoice, 'approve');

    const taskDetailResponse = await fetch(`${sidecar.url}/v1/tasks/${taskBody.taskId}`);
    const taskDetail = await taskDetailResponse.json();
    assert.equal(taskDetail.audit.some((entry) => entry.operation === 'approval.resolve'), true);
    assert.equal(taskDetail.state.value.approvalChoice, 'approve');
    assert.equal(taskDetail.state.value.finalAuditArtifactId, finalAuditEvent.artifacts[0].artifactId);

    const artifactResponse = await fetch(`${sidecar.url}/v1/artifacts/${finalAuditEvent.artifacts[0].artifactId}`);
    const artifactBody = await artifactResponse.json();
    assert.equal(artifactBody.content.includes('Final Audit'), true);
    assert.equal(artifactBody.content.includes('approve'), true);

    unsubscribe();
  });
});
