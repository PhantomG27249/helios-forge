import { ICR_DEFAULT_CONFIG } from './icrContracts.js';

export function buildDefaultHarnessIcrConfig({
  enabled = false,
  includeRhoComparison = true,
  useModelRunners = false,
} = {}) {
  const {
    lane: _lane,
    evidenceOnly: _evidenceOnly,
    promotionAllowed: _promotionAllowed,
    ...tuning
  } = ICR_DEFAULT_CONFIG;

  return {
    enabled,
    mode: 'evidence_only',
    persistOnTask: true,
    includeRhoComparison,
    useModelRunners,
    ...tuning,
  };
}

export function buildDefaultHarnessIcrLaneGate({
  enabled = false,
  mode = 'offline',
} = {}) {
  return {
    enabled,
    mode,
    authority: 'evidence_only',
  };
}

export function formatHarnessIcrYamlSection({
  enabled = true,
  includeRhoComparison = true,
  useModelRunners = false,
  includeProductionGate = true,
} = {}) {
  const config = buildDefaultHarnessIcrConfig({
    enabled,
    includeRhoComparison,
    useModelRunners,
  });

  const lines = ['icr:'];
  for (const [key, value] of Object.entries(config)) {
    lines.push(`  ${key}: ${formatYamlScalar(value)}`);
  }

  if (includeProductionGate) {
    const gate = buildDefaultHarnessIcrLaneGate({
      enabled,
      mode: enabled ? 'advisory' : 'offline',
    });
    lines.push('productionCapabilities:');
    lines.push('  icrLane:');
    for (const [key, value] of Object.entries(gate)) {
      lines.push(`    ${key}: ${formatYamlScalar(value)}`);
    }
  }

  return lines.join('\n');
}

function formatYamlScalar(value) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}
