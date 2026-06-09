function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function clampIndex(index, length) {
  const number = Number(index);
  if (!Number.isFinite(number)) return length;
  return Math.max(0, Math.min(length, Math.floor(number)));
}

function expansion({ trajectory, step, targetIndex }) {
  const next = asArray(trajectory).slice();
  const insertAt = clampIndex(targetIndex === undefined ? next.length : Number(targetIndex) + 1, next.length);
  next.splice(insertAt, 0, step ?? 'expanded_step');
  return next;
}

function deletion({ trajectory, targetIndex }) {
  const next = asArray(trajectory).slice();
  if (next.length === 0) return next;
  next.splice(clampIndex(targetIndex, next.length - 1), 1);
  return next;
}

function translocation({ trajectory, targetIndex, insertIndex }) {
  const next = asArray(trajectory).slice();
  if (next.length <= 1) return next;
  const from = clampIndex(targetIndex, next.length - 1);
  const [step] = next.splice(from, 1);
  const to = clampIndex(insertIndex, next.length);
  next.splice(to, 0, step);
  return next;
}

function crossover({ trajectory, donorTrajectory, targetIndex }) {
  const left = asArray(trajectory);
  const right = asArray(donorTrajectory);
  const split = clampIndex(targetIndex === undefined ? Math.ceil(left.length / 2) : targetIndex, left.length);
  return [...left.slice(0, split), ...right.slice(split)];
}

function recombination({ trajectory, donorTrajectory }) {
  const seen = new Set();
  const next = [];
  for (const step of [...asArray(trajectory), ...asArray(donorTrajectory)]) {
    const key = JSON.stringify(step);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(step);
  }
  return next;
}

const OPERATORS = Object.freeze({
  expansion,
  deletion,
  translocation,
  crossover,
  recombination,
});

export function applyTrajectoryOperator({ operator, ...options } = {}) {
  const key = String(operator ?? '').trim().toLowerCase();
  const apply = OPERATORS[key];
  if (!apply) {
    throw new Error(`Unknown trajectory operator: ${operator}`);
  }
  return {
    operator: key,
    trajectory: apply(options),
  };
}
