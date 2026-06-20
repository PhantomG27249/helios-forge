import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const QUEUE_REL = '.harness/meta/promotion-queue';

function resolveRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

export async function listPromotionQueueRecords({ workspaceRoot, limit = 20 } = {}) {
  const queueDir = path.join(resolveRoot(workspaceRoot), QUEUE_REL);
  let entries = [];
  try {
    entries = await readdir(queueDir);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const records = [];
  for (const entry of entries.filter((name) => name.endsWith('.json') && !name.includes('.orchestration-audit')).sort().reverse()) {
    if (records.length >= limit) break;
    try {
      const record = JSON.parse(await readFile(path.join(queueDir, entry), 'utf8'));
      records.push({
        proposalId: record.proposalId || entry.replace(/\.json$/, ''),
        candidateId: record.candidateRun?.candidateId || record.candidate?.candidateId || null,
        target: record.candidateRun?.target || record.candidate?.target || null,
        status: record.decision?.status || 'queued',
        queuedAt: record.queuedAt || null,
        evidenceOnly: true,
        canPromote: false,
      });
    } catch {
      // skip unreadable queue records
    }
  }
  return records;
}
