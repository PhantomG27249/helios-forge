export class HarnessClient {
  constructor({ baseUrl }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.lastEvents = [];
    this.eventHandlers = new Set();
    this.eventStreamPromise = null;
    this.eventStreamReady = null;
    this.eventAbortController = null;
  }

  async getHealth() {
    return this.getJson('/v1/health');
  }

  async startTask(taskRequest) {
    await this.ensureEventStream();
    return this.postJson('/v1/tasks', taskRequest);
  }

  async listCapabilities({ workspaceRoot } = {}) {
    const query = workspaceRoot ? `?workspaceRoot=${encodeURIComponent(workspaceRoot)}` : '';
    return this.getJson(`/v1/capabilities${query}`);
  }

  async saveCapability({ workspaceRoot, record }) {
    return this.postJson('/v1/capabilities', { workspaceRoot, record });
  }

  async deleteCapability({ workspaceRoot, capabilityId }) {
    const query = workspaceRoot ? `?workspaceRoot=${encodeURIComponent(workspaceRoot)}` : '';
    return this.deleteJson(`/v1/capabilities/${encodeURIComponent(capabilityId)}${query}`);
  }

  async mountCapabilities({ workspaceRoot, profileId } = {}) {
    return this.postJson('/v1/capabilities/mount', { workspaceRoot, profileId });
  }

  async listTraces({ limit } = {}) {
    const query = Number.isFinite(limit) ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.getJson(`/v1/traces${query}`);
  }

  async getTrace(taskId) {
    return this.getJson(`/v1/traces/${encodeURIComponent(taskId)}`);
  }

  async prepareTraceReplay(taskId, { cursor = 0, limit = 100 } = {}) {
    return this.postJson(`/v1/traces/${encodeURIComponent(taskId)}/replay`, { cursor, limit });
  }

  async getAdaptiveSearchStatus({ taskId, limit } = {}) {
    const params = new URLSearchParams();
    if (taskId) params.set('taskId', taskId);
    if (Number.isFinite(limit)) params.set('limit', String(limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.getJson(`/v1/adaptive-search/status${query}`);
  }

  async prepareAdaptiveSearchReplay({ taskId, events, context, evidence, scheduler, policy } = {}) {
    return this.postJson('/v1/adaptive-search/replay', {
      taskId,
      events,
      context,
      evidence,
      scheduler,
      policy,
    });
  }

  async prepareModelCouncilPassKEval({ taskId, context, cases, k, minCases, upliftThreshold } = {}) {
    return this.postJson('/v1/model-council/passk-eval/prepare', {
      command: 'harness_model_council_passk_eval_prepare',
      taskId,
      context,
      cases,
      k,
      minCases,
      upliftThreshold,
    });
  }

  async getProductionEvidence(type) {
    const routes = {
      heldOutSuites: '/v1/evidence/held-out-suites',
      replayCycles: '/v1/evidence/replay-cycles',
      operatorDashboards: '/v1/evidence/operator-dashboards',
      visualSuites: '/v1/evidence/visual-suites',
      a2aStatus: '/v1/evidence/a2a-status',
      modelCouncilCalibration: '/v1/evidence/model-council-calibration',
      endpointCapacity: '/v1/evidence/endpoint-capacity',
      autonomyRollback: '/v1/evidence/autonomy-rollback',
      backgroundEvolution: '/v1/evidence/background-evolution',
    };
    return this.getJson(routes[type] || routes.heldOutSuites);
  }

  async listSkillCandidates({ limit } = {}) {
    const query = Number.isFinite(limit) ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.getJson(`/v1/skill-candidates${query}`);
  }

  async getPiBridgeState() {
    return this.getJson('/v1/pi-bridge/state');
  }

  async listPromotionQueue({ limit } = {}) {
    const query = Number.isFinite(limit) ? `?limit=${encodeURIComponent(limit)}` : '';
    return this.getJson(`/v1/promotion-queue${query}`);
  }

  async reviewSkillCandidate({ candidateId, decision, reviewer = 'human', reason } = {}) {
    const action = decision === 'reject' ? 'reject' : 'approve';
    return this.postJson(`/v1/skill-candidates/${encodeURIComponent(candidateId)}/${action}`, {
      reviewer,
      approver: reviewer,
      reason,
    });
  }

  async resolveApproval(actionId, choice) {
    return this.postJson(`/v1/approvals/${encodeURIComponent(actionId)}`, { choice });
  }

  async getArtifact(artifactId) {
    return this.getJson(`/v1/artifacts/${encodeURIComponent(artifactId)}`);
  }

  onEvent(handler) {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  close() {
    if (this.eventAbortController) {
      this.eventAbortController.abort();
      this.eventAbortController = null;
    }
    this.eventStreamPromise = null;
    this.eventStreamReady = null;
  }

  async getJson(path) {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`Harness request failed: ${response.status}`);
    }
    return response.json();
  }

  async deleteJson(path) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error(`Harness request failed: ${response.status}`);
    }
    return response.json();
  }

  async postJson(path, body) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    if (!response.ok) {
      throw new Error(`Harness request failed: ${response.status}`);
    }
    return response.json();
  }

  async ensureEventStream() {
    if (!this.eventStreamPromise) {
      let markReady;
      this.eventStreamReady = new Promise((resolve) => {
        markReady = resolve;
      });
      this.eventAbortController = new AbortController();
      this.eventStreamPromise = this.readEventStream(markReady).catch((error) => {
        if (error.name !== 'AbortError') {
          throw error;
        }
      });
    }
    await this.eventStreamReady;
  }

  async readEventStream(markReady) {
    const response = await fetch(`${this.baseUrl}/v1/events`, {
      signal: this.eventAbortController.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Harness event stream failed: ${response.status}`);
    }
    markReady();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        this.handleRawServerSentEvent(rawEvent);
        separatorIndex = buffer.indexOf('\n\n');
      }
    }
  }

  handleRawServerSentEvent(rawEvent) {
    const dataLine = rawEvent
      .split(/\r?\n/)
      .find((line) => line.startsWith('data: '));
    if (!dataLine) return;

    const event = JSON.parse(dataLine.slice('data: '.length));
    this.lastEvents.push(event);
    if (this.lastEvents.length > 100) {
      this.lastEvents.shift();
    }
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }
}
