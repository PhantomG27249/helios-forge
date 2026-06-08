import { normalizeAgentCard, normalizeAgentCards } from './agentCards.js';
import { buildGatewayRequest } from './agentRouter.js';
import { verifyDelegatedCapabilityToken } from './delegatedCapabilityTokens.js';

function normalizeList(values = []) {
  const list = Array.isArray(values) ? values : [values];
  return list.map((value) => String(value || '').trim()).filter(Boolean);
}

function isMutationTask(task = {}) {
  if (task.mutation === true || task.mode === 'mutation') return true;
  return normalizeList(task.requiredCapabilities).some((capability) => (
    /\.(apply|write|update|delete|create|merge|exec)$/i.test(capability)
    || /^(patch|write|delete|create|merge|shell|exec)\b/i.test(capability)
  ));
}

function emit(emitEvent, event) {
  if (typeof emitEvent === 'function') emitEvent(event);
}

export class ExternalAgentGateway {
  constructor({
    agents = [],
    dispatch,
    emitEvent,
    now = Date.now,
  } = {}) {
    if (dispatch && typeof dispatch !== 'function') {
      throw new Error('ExternalAgentGateway dispatch must be a function');
    }
    this.agents = new Map(normalizeAgentCards(agents).map((agent) => [agent.id, agent]));
    this.dispatch = dispatch || (async () => ({ ok: true }));
    this.emitEvent = emitEvent;
    this.now = now;
  }

  listAgentCards() {
    return [...this.agents.values()].map((agent) => normalizeAgentCard(agent));
  }

  getAgent(agentId) {
    const agent = this.agents.get(String(agentId || ''));
    if (!agent) throw new Error(`Unknown external agent ${agentId || '(empty)'}`);
    return agent;
  }

  buildEnvelope({ agentId, task = {}, grantedCapabilities } = {}) {
    const agent = this.getAgent(agentId);
    const envelope = buildGatewayRequest({
      agent,
      task,
      grantedCapabilities,
    });
    return {
      ...envelope,
      mode: isMutationTask(task) ? 'mutation' : 'read',
    };
  }

  async dispatchTask({
    agentId,
    task = {},
    grantedCapabilities,
    approval,
    capabilityToken,
  } = {}) {
    const agent = this.getAgent(agentId);
    const mutation = isMutationTask(task);
    const capabilities = normalizeList(grantedCapabilities || task.requiredCapabilities);

    if (mutation && approval?.approved !== true) {
      emit(this.emitEvent, {
        type: 'external_agent.blocked',
        agentId: agent.id,
        taskId: task.id,
        reason: 'mutation_requires_approval',
      });
      return {
        status: 'blocked',
        reason: 'mutation_requires_approval',
      };
    }

    if (mutation) {
      const timestamp = this.now();
      const tokenDecisions = capabilities.map((capability) => ({
        capability,
        decision: verifyDelegatedCapabilityToken(capabilityToken, {
          taskId: task.id,
          agentId: agent.id,
          capability,
          mode: 'mutation',
          now: timestamp,
        }),
      }));
      const tokenReasons = tokenDecisions.flatMap(({ capability, decision }) => (
        decision.reasons.map((reason) => `${capability}:${reason}`)
      ));
      if (tokenReasons.length) {
        emit(this.emitEvent, {
          type: 'external_agent.blocked',
          agentId: agent.id,
          taskId: task.id,
          reason: 'delegated_capability_token_invalid',
          tokenReasons,
        });
        return {
          status: 'blocked',
          reason: 'delegated_capability_token_invalid',
          tokenReasons,
        };
      }
    }

    const envelope = this.buildEnvelope({ agentId: agent.id, task, grantedCapabilities });
    const response = await this.dispatch(envelope);
    emit(this.emitEvent, {
      type: 'external_agent.dispatched',
      agentId: agent.id,
      taskId: task.id,
      mode: envelope.mode,
    });
    return {
      status: 'dispatched',
      envelope,
      response,
    };
  }
}
