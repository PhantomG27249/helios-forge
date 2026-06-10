import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runPiNativeAttempt } from '../src/harness-sidecar/swarm/piNativeWorker.js';
import { orchestrateSwarm } from '../src/harness-sidecar/swarm/swarmOrchestrator.js';

const bridgeContext = {
  skillHints: [
    { id: 'visual-debugging', reason: 'Validate rendered UI regressions.' },
    { id: 'meta-harness', reason: 'Compare candidate quality.' },
  ],
  soulRefs: [{ soulId: 'agent-implementer', soulVersion: 'soul-v3' }],
  oversoulRefs: [{ oversoulId: 'global', oversoulVersion: 'oversoul-v2' }],
  taskCorrelationId: 'corr-task-42',
  sidecarCallbackHints: {
    progressEndpoint: 'ws://127.0.0.1:3030/a2a/progress',
    handoffEndpoint: 'http://127.0.0.1:3030/a2a/handoff',
  },
  mutationOptimization: {
    heliosDeterministicCandidates: [
      { candidateId: 'bes-1', source: 'bes', operator: 'expansion', score: 0.82 },
      { candidateId: 'rho-1', source: 'rho', hardCaseTags: ['missing_context'] },
    ],
    piNativeSuggestionPolicy: {
      source: 'pi_native_model_suggestions',
      authority: 'advisory_only',
    },
  },
  modelWarnings: [
    { code: 'thinking_disabled', message: 'Active Pi model profile disables thinking at C:\\private\\models\\qwen.' },
    { code: 'kwargs_not_applied', message: 'Expected chat-template kwargs were not applied.' },
  ],
};

test('pi native worker sends bridge handoff context without mutation authority', async () => {
  let promptCommand;
  const result = await runPiNativeAttempt({
    task: { taskId: 'task_bridge', task: 'Improve mutation proposal handoff.' },
    attempt: { attemptId: 'attempt_bridge', strategy: 'pi_bridge_handoff' },
    role: 'implementer',
    context: { allowedFiles: ['src/harness-sidecar/swarm/piNativeWorker.js'] },
    outputContract: { requiredFields: ['summary', 'verifierEvidence'] },
    capabilitiesManifest: {
      workspaceRoot: 'C:\\private\\workspace',
      apiKey: 'sk-should-not-leak',
      capabilities: [
        {
          id: 'helios-research-harness:skill:visual-debugging',
          type: 'skill',
          name: 'Visual Debugging',
          enabled: true,
          rawTrace: 'x'.repeat(500),
          sourcePath: 'C:\\private\\workspace\\.harness\\packages\\helios-research-harness\\skills\\visual-debugging\\SKILL.md',
        },
      ],
    },
    piBridgeContext: bridgeContext,
    piWorkerFactory: async () => ({
      start: async () => {},
      sendCommand: async (command) => {
        promptCommand = command;
        return {
          success: true,
          data: {
            summary: 'Pi-native handoff context received.',
            verifierEvidence: ['bridge envelope inspected'],
            compactHandoff: {
              summary: 'Bridge context received.',
              filesInspected: ['src/harness-sidecar/swarm/piNativeWorker.js'],
              filesChanged: [],
              testsRun: ['node --test tests/pi-native-worker-bridge.test.js'],
              nextAction: 'Review advisory suggestions.',
              sourcePointers: ['tests/pi-native-worker-bridge.test.js'],
              risks: ['advisory_only'],
            },
            evolutionOutput: {
              durableApplyApproved: true,
              piNativeSuggestions: [{ suggestionId: 'pi-1', summary: 'Try a narrower prompt.' }],
            },
          },
        };
      },
      stop: async () => {},
    }),
  });

  assert.equal(result.status, 'contract_failed');
  assert.equal(result.contract.reasons.includes('local_durable_approval_forbidden'), true);
  assert.equal(result.evolutionOutput.durableApplyApproved, false);

  assert.equal(promptCommand.a2a.durable.correlationId, 'corr-task-42');
  assert.deepEqual(promptCommand.a2a.message.bridgeContext.skillHints, [
    { id: 'visual-debugging', reason: 'Validate rendered UI regressions.' },
    { id: 'meta-harness', reason: 'Compare candidate quality.' },
  ]);
  assert.deepEqual(promptCommand.a2a.message.bridgeContext.soulRefs, [
    { id: 'agent-implementer', version: 'soul-v3' },
  ]);
  assert.deepEqual(promptCommand.a2a.message.bridgeContext.oversoulRefs, [
    { id: 'global', version: 'oversoul-v2' },
  ]);
  assert.deepEqual(promptCommand.a2a.message.bridgeContext.outputContract.requiredFields, ['summary', 'verifierEvidence']);
  assert.deepEqual(promptCommand.a2a.message.bridgeContext.sidecarCallbackHints, bridgeContext.sidecarCallbackHints);
  assert.equal(promptCommand.a2a.message.bridgeContext.capabilitiesManifest.refs[0].id, 'helios-research-harness:skill:visual-debugging');
  assert.equal(promptCommand.a2a.message.bridgeContext.capabilitiesManifest.refs[0].name, 'Visual Debugging');
  assert.equal(promptCommand.a2a.message.bridgeContext.capabilitiesManifest.refs[0].type, 'skill');
  assert.equal(promptCommand.a2a.message.bridgeContext.capabilitiesManifest.counts.skill, 1);
  assert.equal(promptCommand.a2a.message.bridgeContext.mutationOptimization.piNativeSuggestionPolicy.authority, 'advisory_only');
  assert.deepEqual(promptCommand.a2a.message.bridgeContext.mutationOptimization.heliosDeterministicCandidates[0], {
    id: 'bes-1',
    source: 'bes',
    operator: 'expansion',
    score: 0.82,
  });
  assert.deepEqual(
    promptCommand.a2a.message.bridgeContext.modelWarnings.map((warning) => warning.code),
    ['thinking_disabled', 'kwargs_not_applied'],
  );
  const bridgeContextJson = JSON.stringify(promptCommand.a2a.message.bridgeContext);
  assert.equal(bridgeContextJson.includes('sk-should-not-leak'), false);
  assert.equal(bridgeContextJson.includes('rawTrace'), false);
  assert.equal(bridgeContextJson.includes('C:\\private'), false);
  assert.match(promptCommand.message, /Skill hints: visual-debugging, meta-harness/);
  assert.match(promptCommand.message, /Soul refs: agent-implementer@soul-v3/);
  assert.match(promptCommand.message, /Oversoul refs: global@oversoul-v2/);
  assert.match(promptCommand.message, /Task correlation id: corr-task-42/);
  assert.match(promptCommand.message, /Helios deterministic mutation candidates \(BES\/RHO\): bes-1:bes, rho-1:rho/);
  assert.match(promptCommand.message, /Pi-native model suggestions are advisory only/);
  assert.match(promptCommand.message, /Active Pi model profile disables thinking at \[path\]/);
  assert.doesNotMatch(promptCommand.message, /C:\\private/);
  assert.match(promptCommand.message, /Expected chat-template kwargs were not applied/);
  assert.match(promptCommand.message, /Do not approve or apply durable local changes/);
});

test('swarm orchestrator forwards injected Pi bridge context to Pi-native attempts', async () => {
  let bridgeEnvelope;
  const result = await orchestrateSwarm({
    task: { taskId: 'task_bridge_orch', task: 'Run Pi-native bridge handoff.' },
    taskType: 'coding_bugfix',
    maxAttempts: 1,
    context: { allowedFiles: ['src/harness-sidecar/swarm/piNativeWorker.js'] },
    outputContract: { requiredFields: ['summary', 'verifierEvidence'] },
    swarmExecution: { piNative: true, concurrency: 1 },
    piBridgeContext: bridgeContext,
    capabilitiesManifest: { capabilities: [{ id: 'helios-research-harness:skill:meta-harness' }] },
    piWorkerFactory: async () => ({
      start: async () => {},
      sendCommand: async (command) => {
        bridgeEnvelope = command.a2a;
        return {
          success: true,
          data: {
            summary: 'Orchestrator bridge context forwarded.',
            verifierEvidence: ['bridge envelope inspected'],
            compactHandoff: {
              summary: 'Orchestrator bridge context forwarded.',
              filesInspected: ['src/harness-sidecar/swarm/swarmOrchestrator.js'],
              filesChanged: [],
              testsRun: ['node --test tests/pi-native-worker-bridge.test.js'],
              nextAction: 'Use advisory context only.',
              sourcePointers: ['swarmOrchestrator.js:runScheduledAttempt'],
              risks: [],
            },
          },
        };
      },
      stop: async () => {},
    }),
  });

  assert.equal(result.attempts[0].status, 'completed');
  assert.equal(bridgeEnvelope.durable.correlationId, 'corr-task-42');
  assert.equal(bridgeEnvelope.message.bridgeContext.taskCorrelationId, 'corr-task-42');
  assert.equal(bridgeEnvelope.message.bridgeContext.capabilitiesManifest.refs[0].id, 'helios-research-harness:skill:meta-harness');
});
