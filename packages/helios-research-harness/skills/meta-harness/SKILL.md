---
name: meta-harness
description: Use when improving prompts, retrieval policy, tool policy, skills, or harness routing through eval-gated proposals.
---

# Meta Harness

Treat harness self-improvement as a gated optimization loop.

1. Propose a small, reversible change to prompts, retrieval, tool policy, skills, or routing.
2. Attach the proposal to the trace, graph memory, and affected capability records.
3. Run the configured eval suite or a focused smoke eval.
4. Promote only if the candidate passes gates and has an explicit approval record.
5. Record what changed, why it was safe, and which eval evidence supports it.

Never silently mutate global Pi configuration. Keep package and capability changes workspace-scoped unless the operator explicitly installs globally.
