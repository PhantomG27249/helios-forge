import assert from 'node:assert/strict';
import { test } from 'node:test';

import { allocateOversoulBudget } from '../src/harness-sidecar/swarm/oversoulBudgetRouter.js';

test('allocates advisory budget split across cells', () => {
  const result = allocateOversoulBudget({
    cells: [
      { cellId: 'code', role: 'implementer' },
      { cellId: 'memory', role: 'memory_rag' },
    ],
    totalBudget: { maxOutputChars: 1000, maxToolCalls: 6 },
    roleEcology: {
      coreRoles: ['implementer', 'reviewer'],
      missingRoles: ['memory'],
    },
  });

  assert.equal(result.evidenceOnly, true);
  assert.equal(result.canPromote, false);
  assert.equal(result.authority, 'advisory');
  assert.equal(result.cells.length, 2);
  assert.equal(
    result.cells.reduce((sum, cell) => sum + cell.budget.maxOutputChars, 0),
    1000,
  );
  assert.equal(
    result.cells.reduce((sum, cell) => sum + cell.budget.maxToolCalls, 0),
    6,
  );
});

test('boosts budget for cells covering missing roles from role ecology', () => {
  const result = allocateOversoulBudget({
    cells: [
      { cellId: 'code', role: 'implementer' },
      { cellId: 'memory', role: 'memory_rag' },
      { cellId: 'visual', role: 'visual' },
    ],
    totalBudget: { maxOutputChars: 1200, maxToolCalls: 9 },
    roleEcology: {
      coreRoles: ['implementer'],
      missingRoles: ['memory', 'visual'],
    },
  });

  const memoryCell = result.cells.find((cell) => cell.cellId === 'memory');
  const visualCell = result.cells.find((cell) => cell.cellId === 'visual');
  const codeCell = result.cells.find((cell) => cell.cellId === 'code');

  assert.ok(memoryCell.budget.priority > codeCell.budget.priority);
  assert.ok(visualCell.budget.priority > codeCell.budget.priority);
  assert.match(memoryCell.budgetRationale.rationale, /missing role/i);
  assert.match(codeCell.budgetRationale.rationale, /core role/i);
});

test('returns evidence-only rationale without promotion authority', () => {
  const result = allocateOversoulBudget({
    cells: [{ cellId: 'research', role: 'researcher' }],
    totalBudget: { maxOutputChars: 500, maxToolCalls: 3 },
    roleEcology: { coreRoles: [], missingRoles: ['researcher'] },
  });

  assert.equal(result.canPromote, false);
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.cells[0].budget.durableApplyApproved, false);
  assert.match(result.cells[0].budgetRationale.rationale, /advisory/i);
});
