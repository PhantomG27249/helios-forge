import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeIcrConfig } from './icrContracts.js';
import { sanitizeIcrEvidenceForDashboard } from './icrEvidence.js';

const ICR_REL = '.harness/icr';
const FAMILIES_REL = `${ICR_REL}/families`;
const RHO_REPORTS_REL = `${ICR_REL}/rho-reports`;
const LATEST_INDEX_REL = `${ICR_REL}/latest-index.json`;

const HIDDEN_PERSIST_KEYS = new Set([
  'branchMemory',
  'branch_memory',
  'critiqueRecords',
  'critique_records',
  'pqfRecords',
  'pqf_records',
  'replacedBranches',
  'replaced_branches',
  'hypothesisHistory',
  'hypothesis_history',
  'activeHypotheses',
  'hypotheses',
  'candidateText',
  'critiqueSummary',
  'correctionSummary',
  'rawPrompt',
  'rawOutput',
  'messages',
]);

const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|authorization|cookie|client[_-]?secret|refresh[_-]?token)/i;

function requireWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function isInsideWorkspace(workspaceRoot, candidatePath) {
  const relative = path.relative(workspaceRoot, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInsideWorkspace(workspaceRoot, candidatePath) {
  const resolved = path.resolve(candidatePath);
  if (!isInsideWorkspace(workspaceRoot, resolved)) {
    throw new Error(`Path must stay inside workspace: ${candidatePath}`);
  }
  return resolved;
}

function sanitizeArtifactId(value, fallback = 'icr-artifact') {
  return String(value || fallback).replace(/[^A-Za-z0-9_-]+/g, '-');
}

function stripHiddenKeys(value, key = '') {
  if (value === undefined || value === null) return value;
  if (SECRET_KEY_PATTERN.test(key)) return '[redacted]';
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripHiddenKeys(item));
  return Object.fromEntries(Object.entries(value)
    .filter(([entryKey]) => !HIDDEN_PERSIST_KEYS.has(entryKey))
    .map(([entryKey, entryValue]) => [entryKey, stripHiddenKeys(entryValue, entryKey)]));
}

function sanitizeRecordForPersist(record = {}) {
  const stripped = stripHiddenKeys(record);
  return {
    ...stripped,
    evidenceOnly: true,
    promotionAllowed: false,
    canPromote: false,
  };
}

function relativeArtifactPath(workspaceRoot, absolutePath) {
  const resolvedRoot = requireWorkspaceRoot(workspaceRoot);
  const resolvedPath = path.resolve(absolutePath);
  assertInsideWorkspace(resolvedRoot, resolvedPath);
  return path.relative(resolvedRoot, resolvedPath).split(path.sep).join('/');
}

async function readJsonFilesFromDir(dirPath, { limit } = {}) {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((left, right) => right.name.localeCompare(left.name));

  const selected = limit === undefined ? files : files.slice(0, Math.max(0, limit));
  const items = [];
  for (const entry of selected) {
    const raw = await readFile(path.join(dirPath, entry.name), 'utf8');
    items.push(JSON.parse(raw));
  }
  return items;
}

async function readLatestIndex(workspaceRoot) {
  const indexPath = assertInsideWorkspace(
    requireWorkspaceRoot(workspaceRoot),
    path.join(requireWorkspaceRoot(workspaceRoot), LATEST_INDEX_REL),
  );
  try {
    const raw = await readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeLatestIndex(workspaceRoot, entries) {
  const resolvedRoot = requireWorkspaceRoot(workspaceRoot);
  const indexPath = assertInsideWorkspace(resolvedRoot, path.join(resolvedRoot, LATEST_INDEX_REL));
  await mkdir(path.dirname(indexPath), { recursive: true });
  const payload = {
    kind: 'icr_latest_index',
    evidenceOnly: true,
    promotionAllowed: false,
    updatedAt: new Date().toISOString(),
    entries: entries.map((entry) => ({
      taskId: entry.taskId ?? null,
      createdAt: entry.createdAt ?? null,
      familyPath: entry.familyPath ?? null,
      rhoReportPath: entry.rhoReportPath ?? null,
    })),
  };
  await writeFile(indexPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return indexPath;
}

export function icrStorePaths(workspaceRoot) {
  const resolvedRoot = requireWorkspaceRoot(workspaceRoot);
  return {
    familiesDir: assertInsideWorkspace(resolvedRoot, path.join(resolvedRoot, FAMILIES_REL)),
    rhoReportsDir: assertInsideWorkspace(resolvedRoot, path.join(resolvedRoot, RHO_REPORTS_REL)),
    latestIndex: assertInsideWorkspace(resolvedRoot, path.join(resolvedRoot, LATEST_INDEX_REL)),
  };
}

export async function persistIcrCandidateFamily(workspaceRoot, record = {}) {
  const resolvedRoot = requireWorkspaceRoot(workspaceRoot);
  const { familiesDir } = icrStorePaths(resolvedRoot);
  await mkdir(familiesDir, { recursive: true });

  const taskId = sanitizeArtifactId(record.taskId ?? record.task?.taskId ?? record.task?.id, 'icr-task');
  const familyId = sanitizeArtifactId(
    record.candidateFamilyId ?? record.familyId ?? record.id ?? record.createdAt,
    'icr-family',
  );
  const filePath = assertInsideWorkspace(resolvedRoot, path.join(familiesDir, `${taskId}-${familyId}.json`));
  const payload = sanitizeRecordForPersist(record);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const familyPath = relativeArtifactPath(resolvedRoot, filePath);
  const entries = await readLatestIndex(resolvedRoot);
  const existing = entries.find((entry) => entry.taskId === taskId || entry.familyPath === familyPath);
  const filtered = entries.filter((entry) => entry.familyPath !== familyPath && entry.taskId !== taskId);
  filtered.unshift({
    taskId: record.taskId ?? record.task?.taskId ?? record.task?.id ?? taskId,
    createdAt: record.createdAt ?? payload.createdAt ?? new Date().toISOString(),
    familyPath,
    rhoReportPath: existing?.rhoReportPath ?? null,
  });
  await writeLatestIndex(resolvedRoot, filtered.slice(0, 50));

  return { filePath, familyPath, record: payload };
}

export async function persistIcrRhoReport(workspaceRoot, report = {}) {
  const resolvedRoot = requireWorkspaceRoot(workspaceRoot);
  const { rhoReportsDir } = icrStorePaths(resolvedRoot);
  await mkdir(rhoReportsDir, { recursive: true });

  const taskId = sanitizeArtifactId(report.taskId ?? report.task?.taskId ?? report.task?.id, 'icr-task');
  const reportId = sanitizeArtifactId(report.comparisonId ?? report.reportId ?? report.createdAt, 'icr-rho');
  const filePath = assertInsideWorkspace(resolvedRoot, path.join(rhoReportsDir, `${taskId}-${reportId}.json`));
  const payload = sanitizeRecordForPersist(report);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const rhoReportPath = relativeArtifactPath(resolvedRoot, filePath);
  const entries = await readLatestIndex(resolvedRoot);
  const existing = entries.find((entry) => entry.taskId === taskId);
  const nextEntries = [
    {
      taskId,
      createdAt: report.createdAt ?? payload.createdAt ?? new Date().toISOString(),
      familyPath: existing?.familyPath ?? null,
      rhoReportPath,
    },
    ...entries.filter((entry) => entry.taskId !== taskId),
  ];
  await writeLatestIndex(resolvedRoot, nextEntries.slice(0, 50));

  return { filePath, rhoReportPath, report: payload };
}

export async function loadRecentIcrEvidence(workspaceRoot, { limit } = {}) {
  const { familiesDir, rhoReportsDir } = icrStorePaths(workspaceRoot);
  const [families, rhoReports] = await Promise.all([
    readJsonFilesFromDir(familiesDir, { limit }),
    readJsonFilesFromDir(rhoReportsDir, { limit }),
  ]);
  return { families, rhoReports };
}

function mergeFamilyWithRhoReports(families = [], rhoReports = []) {
  const reportsByTaskId = new Map();
  for (const report of rhoReports) {
    const taskId = String(report.taskId ?? '');
    if (!taskId) continue;
    if (!reportsByTaskId.has(taskId)) reportsByTaskId.set(taskId, report);
  }

  return families.map((family) => {
    const taskId = String(family.taskId ?? '');
    const rhoReport = reportsByTaskId.get(taskId);
    if (!rhoReport) return family;
    return {
      ...family,
      rhoReplayComparison: rhoReport,
      rhoUpliftReport: rhoReport,
    };
  });
}

export async function loadIcrEvidenceForCapabilityGoals(workspaceRoot, config = {}) {
  const normalizedConfig = normalizeIcrConfig(config);
  const { families, rhoReports } = await loadRecentIcrEvidence(workspaceRoot);
  return mergeFamilyWithRhoReports(families, rhoReports).map((record) => (
    sanitizeRecordForPersist(record)
  ));
}

export function sanitizeIcrFamilyForDashboard(record = {}, config = {}) {
  return sanitizeIcrEvidenceForDashboard(record, config);
}
