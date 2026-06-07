export class VersionedState {
  constructor({ initialValue = {} } = {}) {
    this.value = { ...initialValue };
    this.version = 0;
    this.history = [];
  }

  update({ expectedVersion, patch, updatedBy }) {
    if (expectedVersion !== this.version) {
      return {
        applied: false,
        reason: 'version_conflict',
        currentVersion: this.version,
      };
    }

    const previousVersion = this.version;
    this.value = { ...this.value, ...patch };
    this.version += 1;
    this.history.push({
      previousVersion,
      version: this.version,
      patch,
      updatedBy,
      updatedAt: new Date().toISOString(),
    });

    return {
      applied: true,
      version: this.version,
      value: { ...this.value },
    };
  }
}
