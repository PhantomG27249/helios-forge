const BASELINE_FAMILIES = Object.freeze([
  {
    id: 'forward_only',
    label: 'Forward Only',
    description: 'Plain forward replay without meta-harness optimization.',
    layers: { forward: true, rho: false, bes: false, swarm: false },
    evidenceOnly: true,
    canPromote: false,
  },
  {
    id: 'rho_only',
    label: 'RHO Only',
    description: 'RHO meta-harness optimization without BES lanes.',
    layers: { forward: true, rho: true, bes: false, swarm: false },
    evidenceOnly: true,
    canPromote: false,
  },
  {
    id: 'bes_rho',
    label: 'BES + RHO',
    description: 'BES meta-harness with RHO longitudinal replay.',
    layers: { forward: true, rho: true, bes: true, swarm: false },
    evidenceOnly: true,
    canPromote: false,
  },
  {
    id: 'full_stack',
    label: 'Full Stack',
    description: 'Full evolutionary stack including swarm-of-swarms.',
    layers: { forward: true, rho: true, bes: true, swarm: true },
    evidenceOnly: true,
    canPromote: false,
  },
]);

const FAMILY_BY_ID = new Map(BASELINE_FAMILIES.map((family) => [family.id, family]));

function cloneFamily(family) {
  return {
    ...family,
    layers: { ...family.layers },
  };
}

export function listBaselineFamilies() {
  return BASELINE_FAMILIES.map(cloneFamily);
}

export function getBaselineFamily(id) {
  const familyId = String(id ?? '').trim();
  if (!familyId) return null;
  const family = FAMILY_BY_ID.get(familyId);
  return family ? cloneFamily(family) : null;
}
