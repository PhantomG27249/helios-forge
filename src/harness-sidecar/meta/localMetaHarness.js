import { archiveLocalCandidate } from './localCandidateArchive.js';
import { runLocalEvolutionLoop } from './localEvolutionLoop.js';

function auditEvent(type, payload = {}) {
  return {
    type,
    at: new Date().toISOString(),
    ...payload,
  };
}

function resolveCellId(cell = {}) {
  return cell.cellId || cell.id || 'cell';
}

export async function runLocalMetaHarness({
  workspaceRoot,
  cell = {},
  attempt = {},
  archive = true,
} = {}) {
  const cellId = resolveCellId(cell);
  const loop = runLocalEvolutionLoop({ cellId, attempt });
  const auditEvents = [
    auditEvent('local_meta.evolution_loop_completed', {
      cellId,
      attemptId: loop.attemptId,
      candidateCount: loop.candidates.length,
    }),
  ];
  const archiveRecords = [];

  if (workspaceRoot && archive) {
    for (const candidate of loop.candidates) {
      archiveRecords.push(await archiveLocalCandidate({
        workspaceRoot,
        cellId,
        candidate,
        evidence: candidate.evidence || {},
      }));
    }
    auditEvents.push(auditEvent('local_meta.candidates_archived', {
      cellId,
      candidateCount: archiveRecords.length,
    }));
  }

  return {
    ...loop,
    candidates: loop.candidates.map((candidate) => ({
      ...candidate,
      durableApplyApproved: false,
    })),
    archiveRecords,
    auditEvents,
  };
}
