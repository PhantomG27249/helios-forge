const CATEGORY_PATTERNS = [
  {
    category: 'instruction_override',
    patterns: [/ignore (all )?(previous|prior|above) instructions/i, /disregard (the )?(system|developer) message/i],
  },
  {
    category: 'secret_exfiltration',
    patterns: [/\b(api key|secret|token|password)\b/i, /print .*credentials/i],
  },
  {
    category: 'tool_abuse',
    patterns: [/run .*without approval/i, /bypass .*permission/i],
  },
];

export function detectPromptInjection(text) {
  const categories = [];
  for (const rule of CATEGORY_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      categories.push(rule.category);
    }
  }

  return {
    flagged: categories.length > 0,
    categories,
  };
}
