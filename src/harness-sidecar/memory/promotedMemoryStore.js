import { appendFile, mkdir, readFile } from 'fs/promises';
import path from 'path';

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesAny(recordValues, queryValues) {
  const recordSet = new Set(normalizeList(recordValues).map(normalizeText));
  return normalizeList(queryValues).some((value) => recordSet.has(normalizeText(value)));
}

function matchesTaskKeyword(recordValues, queryValues) {
  const query = normalizeList(queryValues).map(normalizeText);
  return normalizeList(recordValues).some((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    return query.some((value) => value === normalizedKeyword || value.includes(normalizedKeyword));
  });
}

export function getPromotedMemoryPath(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.join(workspaceRoot, '.harness', 'memory', 'promoted.jsonl');
}

export function createPromotedMemoryStore({ workspaceRoot } = {}) {
  const filePath = getPromotedMemoryPath(workspaceRoot);

  async function ensureDir() {
    await mkdir(path.dirname(filePath), { recursive: true });
  }

  async function append(record = {}) {
    await ensureDir();
    const stored = {
      ...record,
      evidence: normalizeList(record.evidence),
      tags: normalizeList(record.tags),
      taskKeywords: normalizeList(record.taskKeywords),
      provenance: normalizeList(record.provenance),
    };
    await appendFile(filePath, `${JSON.stringify(stored)}\n`, 'utf8');
    return stored;
  }

  async function list() {
    try {
      const raw = await readFile(filePath, 'utf8');
      return raw
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function query({ type, tags = [], taskKeywords = [] } = {}) {
    const records = await list();
    return records.filter((record) => {
      if (type && record.type !== type) return false;
      if (normalizeList(tags).length > 0 && !matchesAny(record.tags, tags)) return false;
      if (normalizeList(taskKeywords).length > 0 && !matchesTaskKeyword(record.taskKeywords, taskKeywords)) return false;
      return true;
    });
  }

  return {
    append,
    list,
    query,
    filePath,
  };
}
