import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACCEPTED_VISUAL_TASK_KINDS,
  createVisualSwarmCell,
  normalizeVisualSwarmCellTask,
  validateVisualSwarmCellEvidence,
} from '../src/harness-sidecar/vlm/visualSwarmCell.js';
import {
  getDefaultSwarmCells,
  resolveSwarmCell,
} from '../src/harness-sidecar/swarm/swarmCellRegistry.js';

test('visual SwarmCell accepts first-class visual task kinds', () => {
  assert.deepEqual(ACCEPTED_VISUAL_TASK_KINDS, [
    'screenshot',
    'ui_state',
    'diagram',
    'plot',
    'pdf',
    'ocr',
    'chart',
    'generated_artifact',
  ]);

  for (const kind of ACCEPTED_VISUAL_TASK_KINDS) {
    const task = normalizeVisualSwarmCellTask({
      taskId: `task_${kind}`,
      kind,
      goal: `Inspect ${kind}`,
      evidenceRefs: [`trace:${kind}`],
      artifacts: [{
        artifactId: `${kind}_artifact`,
        type: kind,
        path: `.harness/visual/task_${kind}/artifact.png`,
        hash: `sha256:${kind.repeat(4).slice(0, 24)}`,
      }],
    });

    assert.equal(task.kind, kind);
    assert.equal(task.visualImpacting, true);
    assert.deepEqual(task.evidenceRefs, [`trace:${kind}`]);
  }
});

test('visual SwarmCell rejects unsupported visual task kinds and missing evidence refs', () => {
  assert.throws(
    () => normalizeVisualSwarmCellTask({
      taskId: 'task_bad_kind',
      kind: 'audio',
      goal: 'Inspect audio',
      evidenceRefs: ['trace:bad'],
      artifacts: [{ artifactId: 'a1', path: '.harness/visual/a1.png', hash: 'sha256:abc123' }],
    }),
    /visual task kind/i,
  );

  assert.throws(
    () => normalizeVisualSwarmCellTask({
      taskId: 'task_missing_evidence',
      kind: 'screenshot',
      goal: 'Inspect screenshot',
      artifacts: [{ artifactId: 'a1', path: '.harness/visual/a1.png', hash: 'sha256:abc123' }],
    }),
    /evidenceRefs/i,
  );
});

test('visual SwarmCell requires artifact hashes for visual-impacting evidence', () => {
  assert.throws(
    () => validateVisualSwarmCellEvidence({
      task: { taskId: 'task_hash', kind: 'screenshot', visualImpacting: true },
      evidenceRefs: ['trace:task_hash'],
      artifacts: [],
    }),
    /visual artifacts/i,
  );

  assert.throws(
    () => validateVisualSwarmCellEvidence({
      task: { taskId: 'task_hash', kind: 'screenshot', visualImpacting: true },
      evidenceRefs: ['trace:task_hash'],
      artifacts: [{ artifactId: 'after', path: '.harness/visual/task_hash/after.png' }],
    }),
    /artifact hash/i,
  );

  assert.throws(
    () => validateVisualSwarmCellEvidence({
      task: { taskId: 'task_hash', kind: 'screenshot', visualImpacting: true },
      evidenceRefs: ['trace:task_hash'],
      artifacts: [{ artifactId: 'metadata_only' }],
    }),
    /artifact hash/i,
  );

  const result = validateVisualSwarmCellEvidence({
    task: { taskId: 'task_hash', kind: 'screenshot', visualImpacting: true },
    evidenceRefs: ['trace:task_hash'],
    artifacts: [{
      artifactId: 'after',
      path: '.harness/visual/task_hash/after.png',
      artifactHash: 'sha256:abc123',
    }],
  });

  assert.equal(result.valid, true);
  assert.equal(result.artifacts[0].artifactHash, 'sha256:abc123');

  const digestResult = validateVisualSwarmCellEvidence({
    task: { taskId: 'task_digest', kind: 'chart', visualImpacting: true },
    evidenceRefs: ['trace:task_digest'],
    artifacts: [{ artifactId: 'chart', digest: 'sha256:digest123' }],
  });

  assert.equal(digestResult.valid, true);
  assert.equal(digestResult.artifacts[0].artifactHash, 'sha256:digest123');
});

test('visual SwarmCell rejects non-string evidence refs and artifact hashes', () => {
  assert.throws(
    () => validateVisualSwarmCellEvidence({
      task: { taskId: 'task_ref_type', kind: 'screenshot', visualImpacting: true },
      evidenceRefs: [{ traceId: 'trace:task_ref_type' }],
      artifacts: [{
        artifactId: 'after',
        path: '.harness/visual/task_ref_type/after.png',
        artifactHash: 'sha256:abc123',
      }],
    }),
    /evidenceRefs/i,
  );

  for (const evidenceRef of [0, false]) {
    assert.throws(
      () => validateVisualSwarmCellEvidence({
        task: { taskId: 'task_ref_falsy_type', kind: 'screenshot', visualImpacting: true },
        evidenceRefs: [evidenceRef, 'trace:task_ref_falsy_type'],
        artifacts: [{
          artifactId: 'after',
          path: '.harness/visual/task_ref_falsy_type/after.png',
          artifactHash: 'sha256:abc123',
        }],
      }),
      /evidenceRefs/i,
    );
  }

  for (const artifactHash of [{ digest: 'sha256:abc123' }, true]) {
    assert.throws(
      () => validateVisualSwarmCellEvidence({
        task: { taskId: 'task_hash_type', kind: 'screenshot', visualImpacting: true },
        evidenceRefs: ['trace:task_hash_type'],
        artifacts: [{
          artifactId: 'after',
          path: '.harness/visual/task_hash_type/after.png',
          artifactHash,
        }],
      }),
      /artifact hash/i,
    );
  }
});

test('visual SwarmCell rejects blank evidence refs mixed with valid refs', () => {
  assert.throws(
    () => validateVisualSwarmCellEvidence({
      task: { taskId: 'task_blank_ref', kind: 'screenshot', visualImpacting: true },
      evidenceRefs: ['', 'trace:task_blank_ref'],
      artifacts: [{
        artifactId: 'after',
        path: '.harness/visual/task_blank_ref/after.png',
        artifactHash: 'sha256:abc123',
      }],
    }),
    /evidenceRefs/i,
  );
});

test('visual SwarmCell rejects malformed hash-like fields even with valid fallback hashes', () => {
  assert.throws(
    () => validateVisualSwarmCellEvidence({
      task: { taskId: 'task_malformed_hash', kind: 'screenshot', visualImpacting: true },
      evidenceRefs: ['trace:task_malformed_hash'],
      artifacts: [{
        artifactId: 'after',
        path: '.harness/visual/task_malformed_hash/after.png',
        artifactHash: 0,
        hash: 'sha256:ok',
      }],
    }),
    /artifact hash/i,
  );

  assert.throws(
    () => validateVisualSwarmCellEvidence({
      task: { taskId: 'task_malformed_nested_hash', kind: 'screenshot', visualImpacting: true },
      evidenceRefs: ['trace:task_malformed_nested_hash'],
      artifacts: [{
        artifactId: 'after',
        path: '.harness/visual/task_malformed_nested_hash/after.png',
        artifactHash: {},
        artifacts: { hash: 'sha256:ok' },
      }],
    }),
    /artifact hash/i,
  );
});

test('visual SwarmCell rejects unsafe artifact paths even with hashes', () => {
  for (const path of [
    'C:\\temp\\visual\\after.png',
    '../visual/after.png',
    'file:///C:/temp/visual/after.png',
    'https://example.test/visual/after.png',
  ]) {
    assert.throws(
      () => validateVisualSwarmCellEvidence({
        task: { taskId: 'task_unsafe_path', kind: 'screenshot', visualImpacting: true },
        evidenceRefs: ['trace:task_unsafe_path'],
        artifacts: [{
          artifactId: 'after',
          path,
          artifactHash: 'sha256:abc123',
        }],
      }),
      /artifact path/i,
    );
  }
});

test('visual SwarmCell rejects unsafe nested artifact paths even when top-level path is safe', () => {
  assert.throws(
    () => validateVisualSwarmCellEvidence({
      task: { taskId: 'task_unsafe_nested_path', kind: 'screenshot', visualImpacting: true },
      evidenceRefs: ['trace:task_unsafe_nested_path'],
      artifacts: [{
        artifactId: 'after',
        path: '.harness/visual/task_unsafe_nested_path/after.png',
        artifacts: { after: '../escape.png' },
        artifactHash: 'sha256:abc123',
      }],
    }),
    /artifact path/i,
  );
});

test('visual SwarmCell rejects unsafe nested artifact path fields', () => {
  assert.throws(
    () => validateVisualSwarmCellEvidence({
      task: { taskId: 'task_unsafe_nested_path_field', kind: 'screenshot', visualImpacting: true },
      evidenceRefs: ['trace:task_unsafe_nested_path_field'],
      artifacts: [{
        artifactId: 'after',
        path: '.harness/visual/task_unsafe_nested_path_field/after.png',
        artifacts: { path: '../escape.png' },
        artifactHash: 'sha256:abc123',
      }],
    }),
    /artifact path/i,
  );
});

test('visual SwarmCell accepts nested artifactHash values', () => {
  const result = validateVisualSwarmCellEvidence({
    task: { taskId: 'task_nested_hash', kind: 'screenshot', visualImpacting: true },
    evidenceRefs: ['trace:task_nested_hash'],
    artifacts: [{
      artifactId: 'after',
      path: '.harness/visual/task_nested_hash/after.png',
      artifacts: { artifactHash: 'sha256:nested123' },
    }],
  });

  assert.equal(result.valid, true);
  assert.equal(result.artifacts[0].artifactHash, 'sha256:nested123');
  assert.equal(result.artifacts[0].hash, 'sha256:nested123');
});

test('visual SwarmCell is evidence-only and quarantines model-visible summaries', () => {
  const cell = createVisualSwarmCell({
    modelVisibleSummary: {
      summary: 'Inspect screenshot with token=ghp_should_not_leak',
      canPromote: true,
      apply: true,
    },
  });

  assert.equal(cell.cellId, 'visual');
  assert.equal(cell.role, 'visual_vlm');
  assert.equal(cell.authority, 'evidence_only');
  assert.equal(cell.evidenceOnly, true);
  assert.equal(cell.mutationPolicy.durableApply, 'global_only');
  assert.equal(cell.actions.includes('apply'), false);
  assert.equal(cell.actions.includes('promote'), false);
  assert.equal(cell.modelVisibleSummary.quarantined, true);
  assert.equal(cell.modelVisibleSummary.value.canPromote, false);
  assert.equal(cell.modelVisibleSummary.value.apply, false);
  assert.equal(JSON.stringify(cell.modelVisibleSummary.value).includes('ghp_should_not_leak'), false);
});

test('visual SwarmCell registration is disabled by default and enabled by visual gates', () => {
  assert.equal(resolveSwarmCell('visual'), null);
  assert.equal(getDefaultSwarmCells().some((cell) => cell.cellId === 'visual'), false);
  assert.equal(resolveSwarmCell('visual_vlm'), null);
  assert.equal(getDefaultSwarmCells().some((cell) => cell.cellId === 'visual_vlm'), false);

  const enabledByProductionGate = {
    productionCapabilities: {
      visualSwarmCell: { enabled: true, mode: 'advisory', authority: 'evidence_only' },
    },
  };
  const productionCells = getDefaultSwarmCells({ config: enabledByProductionGate });
  const productionCell = resolveSwarmCell('visual', { config: enabledByProductionGate });

  assert.equal(productionCells.some((cell) => cell.cellId === 'visual'), true);
  assert.equal(productionCell.authority, 'evidence_only');
  assert.equal(productionCell.featureGate, 'productionCapabilities.visualSwarmCell');

  const enabledByVisualArtifacts = getDefaultSwarmCells({
    config: { features: { visualArtifacts: true } },
  });
  assert.equal(enabledByVisualArtifacts.some((cell) => cell.cellId === 'visual'), true);
});
