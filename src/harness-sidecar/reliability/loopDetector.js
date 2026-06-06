export class LoopDetector {
  constructor({ threshold = 3 } = {}) {
    this.threshold = threshold;
    this.signatures = new Map();
  }

  record(signature) {
    const count = (this.signatures.get(signature) || 0) + 1;
    this.signatures.set(signature, count);

    return {
      signature,
      count,
      loopDetected: count >= this.threshold,
    };
  }

  reset(signature) {
    if (signature) {
      this.signatures.delete(signature);
      return;
    }
    this.signatures.clear();
  }
}
