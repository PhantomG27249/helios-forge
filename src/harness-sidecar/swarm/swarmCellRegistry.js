import {
  createVisualSwarmCell,
  isVisualSwarmCellEnabled,
} from '../vlm/visualSwarmCell.js';

const SHARED_CELL_CONTRACT = {
  localMetaHarness: { enabled: true },
  localMemoryGraph: { enabled: true },
  mutationPolicy: { durableApply: 'global_only' },
  outputContract: {
    requiredFields: ['summary', 'evolutionOutput'],
    evolutionOutput: { required: true },
  },
};

const DEFAULT_SWARM_CELLS = [
  {
    cellId: 'code',
    role: 'implementer',
    localAgents: ['implementer', 'reviewer', 'verifier'],
    ...SHARED_CELL_CONTRACT,
  },
  {
    cellId: 'verifier',
    role: 'verifier',
    localAgents: ['verifier', 'reviewer'],
    ...SHARED_CELL_CONTRACT,
  },
  {
    cellId: 'memory_rag',
    role: 'memory_rag',
    localAgents: ['memory_rag', 'researcher'],
    ...SHARED_CELL_CONTRACT,
  },
  {
    cellId: 'research',
    role: 'researcher',
    localAgents: ['researcher', 'verifier'],
    ...SHARED_CELL_CONTRACT,
  },
  {
    cellId: 'safety_review',
    role: 'safety_review',
    localAgents: ['safety_review', 'reviewer'],
    ...SHARED_CELL_CONTRACT,
  },
];

function cloneCell(cell) {
  return JSON.parse(JSON.stringify(cell));
}

function normalizeRegistryOptions(optionsOrCells) {
  if (Array.isArray(optionsOrCells)) return { cells: optionsOrCells };
  if (optionsOrCells && typeof optionsOrCells === 'object') return optionsOrCells;
  return {};
}

export function getDefaultSwarmCells(options = {}) {
  const cells = DEFAULT_SWARM_CELLS.map(cloneCell);
  if (isVisualSwarmCellEnabled(options.config)) {
    cells.push(createVisualSwarmCell());
  }
  return cells;
}

export function resolveSwarmCell(cellId, optionsOrCells = DEFAULT_SWARM_CELLS) {
  const options = normalizeRegistryOptions(optionsOrCells);
  const cells = options.cells ?? getDefaultSwarmCells({ config: options.config });
  const found = cells.find((cell) => cell.cellId === cellId);
  return found ? cloneCell(found) : null;
}
