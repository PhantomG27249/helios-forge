import fs from 'node:fs';
import path from 'node:path';

export const SUBAGENT_PROMPT_RE = /You are Helios Forge Pi-native swarm worker/i;

const SESSION_LINKS_REL = '.helios/session-links.json';

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function truncateTitle(text, max = 48) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function looksLikeSystemPrompt(text) {
  const value = String(text || '').trim();
  if (!value) return true;
  if (/^(you are |# |system:|<\/?system)/i.test(value)) return true;
  if (SUBAGENT_PROMPT_RE.test(value)) return true;
  return false;
}

export function inferSubagentMeta(firstUserText = '') {
  if (!SUBAGENT_PROMPT_RE.test(firstUserText)) return null;
  const role = firstUserText.match(/^Role:\s*(.+)$/m)?.[1]?.trim() || '';
  const task = firstUserText.match(/^Task:\s*(.+)$/m)?.[1]?.trim() || '';
  const attemptId = firstUserText.match(/swarm worker ([^.]+)\./)?.[1]?.trim() || '';
  return { role, task, attemptId };
}

export function deriveChatTitle(text, { subagent = null } = {}) {
  if (subagent) {
    const roleLabel = subagent.role
      ? subagent.role.charAt(0).toUpperCase() + subagent.role.slice(1)
      : 'Subagent';
    const taskPart = subagent.task ? truncateTitle(subagent.task, 40) : subagent.attemptId;
    return truncateTitle(taskPart ? `${roleLabel} · ${taskPart}` : roleLabel);
  }

  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned === '[Image]') return '';

  const firstLine = cleaned.split('\n')[0].trim();
  if (looksLikeSystemPrompt(firstLine)) {
    const taskLine = cleaned.match(/^Task:\s*(.+)$/m)?.[1]?.trim();
    if (taskLine) return truncateTitle(taskLine);
    return '';
  }

  const sentence = firstLine.match(/^.{1,100}?[.!?](?:\s|$)/)?.[0]?.trim() || firstLine;
  return truncateTitle(sentence);
}

export function formatSessionDisplayName({
  sessionId,
  timestamp,
  rawName,
  subagent = null,
}) {
  const subagentTitle = deriveChatTitle(rawName, { subagent });
  if (subagentTitle) return subagentTitle;

  const derived = deriveChatTitle(rawName);
  if (derived) return derived;

  if (timestamp) {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    }
    return timestamp.slice(0, 16).replace('T', ' ');
  }

  const shortId = String(sessionId || '').slice(0, 8);
  return shortId ? `Session ${shortId}` : 'Untitled';
}

export function parseSessionFileContent(fileContent = '') {
  let sessionId = '';
  let timestamp = '';
  let cwd = '';
  let firstUserText = '';

  const lines = String(fileContent).split('\n').filter((line) => line.trim());
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.type === 'session') {
        sessionId = record.id || sessionId;
        timestamp = record.timestamp || timestamp;
        cwd = record.cwd || cwd;
      }
      if (record.type === 'message') {
        const message = record.message || {};
        if (message.role !== 'user') continue;
        const content = message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              firstUserText = block.text;
              break;
            }
          }
        } else if (typeof content === 'string') {
          firstUserText = content;
        }
        break;
      }
    } catch {
      // skip malformed lines
    }
  }

  const subagent = inferSubagentMeta(firstUserText);
  return {
    sessionId,
    timestamp,
    cwd,
    firstUserText,
    subagent,
    isSubagent: Boolean(subagent),
  };
}

function defaultLinksFile() {
  return { version: 1, links: [], pendingParents: {} };
}

export function sessionLinksPath(workspaceRoot) {
  return path.join(workspaceRoot, SESSION_LINKS_REL);
}

export function readSessionLinks(workspaceRoot) {
  if (!workspaceRoot) return defaultLinksFile();
  try {
    const raw = fs.readFileSync(sessionLinksPath(workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: parsed.version || 1,
      links: Array.isArray(parsed.links) ? parsed.links : [],
      pendingParents: parsed.pendingParents && typeof parsed.pendingParents === 'object'
        ? parsed.pendingParents
        : {},
    };
  } catch {
    return defaultLinksFile();
  }
}

function writeSessionLinks(workspaceRoot, data) {
  if (!workspaceRoot) return;
  const filePath = sessionLinksPath(workspaceRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function registerPendingParentSession(workspaceRoot, taskId, parentSessionPath) {
  if (!workspaceRoot || !taskId || !parentSessionPath) return;
  const store = readSessionLinks(workspaceRoot);
  store.pendingParents[taskId] = {
    parentSessionPath: normalizePath(parentSessionPath),
    registeredAt: new Date().toISOString(),
  };
  writeSessionLinks(workspaceRoot, store);
}

export function registerSubagentSessionLink({
  workspaceRoot,
  sessionPath,
  parentSessionPath,
  taskId,
  attemptId,
  role,
} = {}) {
  if (!workspaceRoot || !sessionPath) return;
  const store = readSessionLinks(workspaceRoot);
  const normalizedSessionPath = normalizePath(sessionPath);
  const normalizedParent = parentSessionPath ? normalizePath(parentSessionPath) : '';

  if (!normalizedParent && taskId && store.pendingParents[taskId]) {
    parentSessionPath = store.pendingParents[taskId].parentSessionPath;
    delete store.pendingParents[taskId];
  }

  const existingIndex = store.links.findIndex((link) => link.sessionPath === normalizedSessionPath);
  const entry = {
    sessionPath: normalizedSessionPath,
    parentSessionPath: normalizePath(parentSessionPath || normalizedParent),
    taskId: taskId || undefined,
    attemptId: attemptId || undefined,
    role: role || undefined,
    registeredAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) store.links[existingIndex] = { ...store.links[existingIndex], ...entry };
  else store.links.push(entry);

  writeSessionLinks(workspaceRoot, store);
}

export function inferParentLinksByTimeline(sessions = []) {
  const sorted = [...sessions].sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  const links = new Map();
  let currentParent = null;

  for (const session of sorted) {
    if (!session?.path) continue;
    if (!session.isSubagent) {
      currentParent = session;
      continue;
    }
    if (!currentParent?.path) continue;
    links.set(normalizePath(session.path), {
      sessionPath: normalizePath(session.path),
      parentSessionPath: normalizePath(currentParent.path),
      attemptId: session.subagent?.attemptId,
      role: session.subagent?.role,
      source: 'timeline_inference',
    });
  }

  return [...links.values()];
}

export function inferParentSessionPath(session, candidates = []) {
  if (!session?.isSubagent) return null;
  const sameCwd = candidates.filter((candidate) =>
    candidate.cwd
    && session.cwd
    && normalizePath(candidate.cwd) === normalizePath(session.cwd),
  );
  const inferred = inferParentLinksByTimeline(sameCwd).find(
    (link) => normalizePath(link.sessionPath) === normalizePath(session.path),
  );
  return inferred?.parentSessionPath || null;
}

function pruneStaleSessionLinks(store, { knownSessionPaths = new Set() } = {}) {
  let pruned = 0;
  const before = store.links.length;
  store.links = store.links.filter((link) => {
    const sessionPath = normalizePath(link.sessionPath);
    if (!sessionPath) return false;
    if (knownSessionPaths.size > 0 && !knownSessionPaths.has(sessionPath)) {
      pruned += 1;
      return false;
    }
    return true;
  });
  pruned += before - store.links.length;

  const pending = store.pendingParents || {};
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  for (const [taskId, entry] of Object.entries(pending)) {
    const registeredAt = Date.parse(entry?.registeredAt || '');
    if (!entry?.parentSessionPath || (Number.isFinite(registeredAt) && registeredAt < cutoff)) {
      delete pending[taskId];
      pruned += 1;
    }
  }
  store.pendingParents = pending;
  return pruned;
}

export function repairWorkspaceSessionLinks(workspaceRoot, allSessions = []) {
  if (!workspaceRoot) return { added: 0, pruned: 0 };
  const normalizedRoot = normalizePath(workspaceRoot);
  const workspaceSessions = allSessions.filter((session) =>
    session.cwd && normalizePath(session.cwd) === normalizedRoot && session.path,
  );
  if (!workspaceSessions.length) return { added: 0, pruned: 0 };

  const store = readSessionLinks(workspaceRoot);
  const knownSessionPaths = new Set(
    workspaceSessions.map((session) => normalizePath(session.path)).filter(Boolean),
  );
  const existingByPath = new Map(
    store.links.map((link) => [normalizePath(link.sessionPath), link]),
  );

  let added = 0;
  for (const inferred of inferParentLinksByTimeline(workspaceSessions)) {
    const existing = existingByPath.get(inferred.sessionPath);
    if (existing?.parentSessionPath) continue;

    if (existing) {
      Object.assign(existing, {
        parentSessionPath: inferred.parentSessionPath,
        attemptId: existing.attemptId || inferred.attemptId,
        role: existing.role || inferred.role,
        source: existing.source || inferred.source,
        registeredAt: existing.registeredAt || new Date().toISOString(),
      });
    } else {
      store.links.push({
        ...inferred,
        registeredAt: new Date().toISOString(),
      });
      existingByPath.set(inferred.sessionPath, store.links[store.links.length - 1]);
    }
    added += 1;
  }

  const pruned = pruneStaleSessionLinks(store, { knownSessionPaths });
  if (added > 0 || pruned > 0) writeSessionLinks(workspaceRoot, store);
  return { added, pruned };
}

export function repairAllWorkspaceSessionLinks(allSessions = []) {
  const workspaceRoots = new Set(
    allSessions
      .map((session) => session.cwd)
      .filter(Boolean)
      .map((cwd) => normalizePath(cwd)),
  );

  let added = 0;
  let pruned = 0;
  let workspaces = 0;

  for (const workspaceRoot of workspaceRoots) {
    try {
      if (!fs.existsSync(workspaceRoot)) continue;
      const result = repairWorkspaceSessionLinks(workspaceRoot, allSessions);
      if (result.added > 0 || result.pruned > 0) workspaces += 1;
      added += result.added;
      pruned += result.pruned;
    } catch {
      // skip unreadable workspaces
    }
  }

  return { workspaces, added, pruned };
}

export function buildSessionLinkIndex(workspaceRoots = []) {
  const bySessionPath = new Map();
  for (const workspaceRoot of workspaceRoots) {
    const store = readSessionLinks(workspaceRoot);
    for (const link of store.links) {
      if (!link?.sessionPath) continue;
      bySessionPath.set(normalizePath(link.sessionPath), link);
    }
  }
  return bySessionPath;
}

export function enrichSessionRecord(base, linkIndex, candidates = []) {
  const link = linkIndex.get(normalizePath(base.path));
  const parentSessionPath = link?.parentSessionPath
    || inferParentSessionPath(base, candidates)
    || null;

  return {
    ...base,
    parentSessionPath,
    isSubagent: Boolean(base.isSubagent),
    subagentRole: base.subagent?.role || link?.role || null,
    subagentAttemptId: base.subagent?.attemptId || link?.attemptId || null,
  };
}
