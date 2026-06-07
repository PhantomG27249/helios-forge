import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createHarnessSidecar } from '../src/harness-sidecar/server.js';

async function withSidecar(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-harness-test-'));
  const sidecar = createHarnessSidecar({ workspaceRoot, port: 0 });
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
      'graph.context_composed',
      'memory.candidate_written',
      'memory.reflection_evaluated',
      'memory.corpus_scored',
      'memory.promoted',
      'memory.context_retrieved',
      'meta.trace_inspected',
      'meta.optimizer_proposed',
      'meta.promotion_evaluated',
      'trace.compacted',
      'task.resume_ready',
      'research.report_created',
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

    const memoryContent = await readFile(
      path.join(workspaceRoot, '.harness', 'memory', 'candidates.jsonl'),
      'utf8',
    );
    assert.match(memoryContent, /exercise every harness subsystem/);

    const tracePath = path.join(workspaceRoot, '.harness', 'traces', body.taskId, 'events.jsonl');
    const traceContent = await readFile(tracePath, 'utf8');
    assert.match(traceContent, /meta\.optimizer_proposed/);
    assert.match(traceContent, /research\.report_created/);
    assert.match(traceContent, /experiment\.decision_written/);

    unsubscribe();
  });
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
