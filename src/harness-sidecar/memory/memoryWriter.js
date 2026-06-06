import { mkdir, appendFile } from 'fs/promises';
import path from 'path';

function makeMemoryId() {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function writeMemoryCandidate({ workspaceRoot, record }) {
  const candidate = {
    memoryId: makeMemoryId(),
    reviewStatus: 'candidate',
    createdAt: new Date().toISOString(),
    ...record,
  };

  const memoryDir = path.join(workspaceRoot, '.harness', 'memory');
  await mkdir(memoryDir, { recursive: true });
  await appendFile(
    path.join(memoryDir, 'candidates.jsonl'),
    `${JSON.stringify(candidate)}\n`,
    'utf8',
  );

  return candidate;
}
