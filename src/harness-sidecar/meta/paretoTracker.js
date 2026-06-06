function dominates(left, right) {
  const noWorse = (
    left.quality >= right.quality
    && left.safety >= right.safety
    && left.cost <= right.cost
    && left.latency <= right.latency
  );
  const betterSomewhere = (
    left.quality > right.quality
    || left.safety > right.safety
    || left.cost < right.cost
    || left.latency < right.latency
  );
  return noWorse && betterSomewhere;
}

export class ParetoTracker {
  constructor() {
    this.candidates = [];
  }

  add(candidate) {
    this.candidates.push(candidate);
    return this.getFrontier();
  }

  getFrontier() {
    return this.candidates.filter((candidate) => (
      !this.candidates.some((other) => other !== candidate && dominates(other, candidate))
    ));
  }
}
