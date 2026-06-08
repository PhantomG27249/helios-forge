import { getModelProfile } from './modelProfiles.js';
import { repairJsonObject } from './structuredOutputRepair.js';

function makeModelCallId() {
  return `model_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function estimateTokensFromMessages(messages) {
  const text = messages
    .map((message) => `${message.role || 'user'}:${message.content || ''}`)
    .join('\n');
  return Math.ceil(text.length / 4);
}

function normalizeUsage({ usage, messages, text }) {
  const inputTokens = usage?.inputTokens ?? estimateTokensFromMessages(messages);
  const outputTokens = usage?.outputTokens ?? Math.ceil(String(text || '').length / 4);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export class ModelGateway {
  constructor({ provider, emitEvent = () => {}, profileOverrides = {} } = {}) {
    this.provider = provider || (async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0 } }));
    this.emitEvent = emitEvent;
    this.profileOverrides = profileOverrides;
  }

  async call({ taskId, purpose, profileName, messages, structuredOutput = false, visionInputs = [] }) {
    const callId = makeModelCallId();
    const profile = {
      ...getModelProfile(profileName),
      ...(this.profileOverrides[profileName] || {}),
    };
    if (visionInputs.length > 0 && !profile.supportsVision) {
      throw new Error(`Model profile does not support vision inputs: ${profileName}`);
    }

    await this.emitEvent({
      type: 'model_call.started',
      taskId,
      callId,
      purpose,
      profileName,
      inputTokensEstimated: estimateTokensFromMessages(messages),
      visionInputCount: visionInputs.length,
    });

    const response = await this.provider({
      callId,
      taskId,
      purpose,
      profile,
      messages,
      structuredOutput,
      visionInputs,
    });
    const usage = normalizeUsage({ usage: response.usage, messages, text: response.text });
    const structured = structuredOutput ? repairJsonObject(response.text) : null;

    await this.emitEvent({
      type: 'model_call.completed',
      taskId,
      callId,
      purpose,
      profileName,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      structuredOutput,
    });

    return {
      callId,
      purpose,
      profile,
      text: response.text,
      structured,
      usage,
    };
  }
}
