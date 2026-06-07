export function repairJsonObject(text) {
  const stripped = String(text)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  const withoutTrailingCommas = stripped.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(withoutTrailingCommas);
}
