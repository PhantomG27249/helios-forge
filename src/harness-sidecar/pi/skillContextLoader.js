import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildHeliosSkillInventory } from './heliosSkillBridge.js';

const DEFAULT_MAX_SKILLS = 4;
const DEFAULT_MAX_EXCERPT_CHARS = 2048;
const EXCERPT_SECTIONS = ['## Purpose', '## When To Use', '## Workflow'];

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function extractExcerpt(markdown, maxChars = DEFAULT_MAX_EXCERPT_CHARS) {
  const text = String(markdown || '');
  if (!text.trim()) return '';
  const chunks = [];
  for (const heading of EXCERPT_SECTIONS) {
    const index = text.indexOf(heading);
    if (index === -1) continue;
    const nextHeading = text.indexOf('\n## ', index + heading.length);
    const slice = text.slice(index, nextHeading === -1 ? text.length : nextHeading).trim();
    if (slice) chunks.push(slice);
  }
  const combined = chunks.length ? chunks.join('\n\n') : text.split('\n').slice(0, 24).join('\n');
  return combined.length > maxChars ? `${combined.slice(0, maxChars - 3)}...` : combined;
}

async function loadShadowSkillHints({ workspaceRoot, maxSkills = 2 } = {}) {
  const root = path.resolve(workspaceRoot);
  const candidatesRoot = path.join(root, '.harness', 'meta', 'skill-candidates');
  let entries = [];
  try {
    entries = await readdir(candidatesRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const hints = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    if (hints.length >= maxSkills) break;
    const candidatePath = path.join(candidatesRoot, entry.name, 'candidate.json');
    const skillPath = path.join(candidatesRoot, entry.name, 'SKILL.md');
    try {
      const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
      if (candidate?.status === 'applied') continue;
      const markdown = await readFile(skillPath, 'utf8');
      hints.push({
        candidateId: entry.name,
        name: candidate?.skill?.name || entry.name,
        status: candidate?.status || 'shadow_only',
        excerpt: extractExcerpt(markdown, 600),
        evidenceOnly: true,
        canPromote: false,
        authority: 'advisory_only',
      });
    } catch {
      // skip unreadable candidates
    }
  }
  return hints;
}

export async function loadSkillBridgeContext({
  workspaceRoot,
  repoRoot,
  maxSkills = DEFAULT_MAX_SKILLS,
  maxExcerptChars = DEFAULT_MAX_EXCERPT_CHARS,
  includeShadowCandidates = true,
} = {}) {
  const inventory = await buildHeliosSkillInventory({ workspaceRoot, repoRoot });
  const skills = [];

  for (const skill of inventory.skills.slice(0, maxSkills)) {
    let excerpt = skill.description || '';
    if (skill.relativePath) {
      const abs = path.isAbsolute(skill.relativePath)
        ? path.resolve(skill.relativePath)
        : path.resolve(workspaceRoot, skill.relativePath);
      if (isInside(path.resolve(workspaceRoot), abs) || (repoRoot && isInside(path.resolve(repoRoot), abs))) {
        try {
          excerpt = extractExcerpt(await readFile(abs, 'utf8'), maxExcerptChars);
        } catch {
          // keep description fallback
        }
      }
    }
    skills.push({
      id: skill.id,
      name: skill.name,
      source: skill.source,
      excerpt,
      evidenceOnly: true,
      canPromote: false,
    });
  }

  const shadowHints = includeShadowCandidates
    ? await loadShadowSkillHints({ workspaceRoot, maxSkills: 2 })
    : [];

  return {
    skills,
    shadowHints,
    diagnostics: inventory.diagnostics,
    evidenceOnly: true,
    canPromote: false,
  };
}
