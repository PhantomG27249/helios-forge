import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

export const WORKSPACE_INDEX_VERSION = 1;

export function defaultWorkspaceIndexStorePath(workspaceRoot) {
  return path.join(workspaceRoot, '.harness', 'storage', 'rag', 'workspace-index.json');
}

export async function loadWorkspaceIndexStore(indexStorePath) {
  if (!indexStorePath) return null;
  try {
    const raw = await readFile(indexStorePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== WORKSPACE_INDEX_VERSION || typeof parsed.files !== 'object') {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveWorkspaceIndexStore(indexStorePath, store) {
  if (!indexStorePath) return;
  await mkdir(path.dirname(indexStorePath), { recursive: true });
  await writeFile(indexStorePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

