export function extractChoiceText(payload) {
  const message = payload?.choices?.[0]?.message || {};
  if (typeof message.content === 'string' && message.content.length > 0) {
    return message.content;
  }
  if (typeof message.reasoning === 'string' && message.reasoning.length > 0) {
    return message.reasoning;
  }
  return '';
}

function extractToolCalls(payload) {
  const calls = payload?.choices?.[0]?.message?.tool_calls;
  return Array.isArray(calls) ? calls : [];
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/$/, '');
}

function normalizeUsage(usage = {}) {
  return {
    inputTokens: usage.prompt_tokens || usage.input_tokens || 0,
    outputTokens: usage.completion_tokens || usage.output_tokens || 0,
  };
}

function normalizeTool(tool) {
  if (tool?.type === 'function' && tool.function?.name) return tool;
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.inputSchema || { type: 'object' },
    },
  };
}

export function createOpenAICompatibleProvider({
  baseUrl,
  apiKey = 'dummy',
  fetchImpl = fetch,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  return async function openAICompatibleProvider({ profile, messages, tools = [] }) {
    const model = profile.model || profile.name;
    const body = {
      model,
      messages,
      temperature: profile.defaultTemperature,
    };
    if (tools.length > 0) {
      body.tools = tools.map(normalizeTool);
    }
    if (profile.chatTemplateKwargs) {
      body.chat_template_kwargs = profile.chatTemplateKwargs;
    }

    const response = await fetchImpl(`${normalizedBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible request failed: ${response.status}`);
    }

    const payload = await response.json();
    return {
      text: extractChoiceText(payload),
      toolCalls: extractToolCalls(payload),
      raw: payload,
      usage: normalizeUsage(payload.usage),
    };
  };
}
