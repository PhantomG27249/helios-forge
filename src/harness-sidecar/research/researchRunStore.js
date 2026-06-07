import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function makeRunId() {
  return `research_run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function runDir(workspaceRoot) {
  return path.join(workspaceRoot, '.harness', 'research-runs');
}

function normalizeRunId(runId) {
  const normalized = String(runId || '').trim();
  if (
    !normalized
    || normalized.includes('\0')
    || normalized.includes('/')
    || normalized.includes('\\')
    || normalized.includes('..')
  ) {
    throw new Error(`Unsafe research run id: ${runId}`);
  }
  return normalized;
}

function runPath(workspaceRoot, runId) {
  const baseDir = path.resolve(runDir(workspaceRoot));
  const safeRunId = normalizeRunId(runId);
  const filePath = path.resolve(baseDir, `${safeRunId}.json`);
  const relativePath = path.relative(baseDir, filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Unsafe research run id: ${runId}`);
  }
  return filePath;
}

async function writeRun(workspaceRoot, run) {
  await mkdir(runDir(workspaceRoot), { recursive: true });
  await writeFile(runPath(workspaceRoot, run.runId), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return run;
}

export function createResearchRunStore({ workspaceRoot }) {
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }

  return {
    async createRun({ runId = makeRunId(), question, status = 'created', metadata = {}, ...rest } = {}) {
      const safeRunId = normalizeRunId(runId);
      const timestamp = nowIso();
      const run = {
        runId: safeRunId,
        question,
        status,
        metadata,
        stageEvents: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        ...rest,
      };

      return writeRun(workspaceRoot, run);
    },

    async readRun(runId) {
      const content = await readFile(runPath(workspaceRoot, runId), 'utf8');
      return JSON.parse(content);
    },

    async updateRun(runId, updates = {}) {
      const existing = await this.readRun(runId);
      const updated = {
        ...existing,
        ...updates,
        runId: existing.runId,
        updatedAt: nowIso(),
      };

      return writeRun(workspaceRoot, updated);
    },

    async appendStageEvent(runId, event = {}) {
      const existing = await this.readRun(runId);
      const stageEvent = {
        eventId: `evt_${String((existing.stageEvents || []).length + 1).padStart(4, '0')}`,
        at: nowIso(),
        ...event,
      };
      const updated = {
        ...existing,
        stageEvents: [...(existing.stageEvents || []), stageEvent],
        updatedAt: nowIso(),
      };

      await writeRun(workspaceRoot, updated);
      return stageEvent;
    },

    async listRuns() {
      await mkdir(runDir(workspaceRoot), { recursive: true });
      const files = await readdir(runDir(workspaceRoot));
      const runs = await Promise.all(
        files
          .filter((file) => file.endsWith('.json'))
          .map(async (file) => JSON.parse(await readFile(path.join(runDir(workspaceRoot), file), 'utf8'))),
      );

      return runs.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
  };
}
