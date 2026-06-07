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

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/$/, '');
}

function normalizeUsage(usage = {}) {
  return {
    inputTokens: usage.prompt_tokens || usage.input_tokens || 0,
    outputTokens: usage.completion_tokens || usage.output_tokens || 0,
  };
}

export function createOpenAICompatibleProvider({
  baseUrl,
  apiKey = 'dummy',
  fetchImpl = fetch,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  return async function openAICompatibleProvider({ profile, messages }) {
    const model = profile.model || profile.name;
    const body = {
      model,
      messages,
      temperature: profile.defaultTemperature,
    };
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
      raw: payload,
      usage: normalizeUsage(payload.usage),
    };
  };
}
