# Agent Soul Contract

`soul.md` is the durable identity and evolution contract for a Helios agent.
It is meant to be human-readable, versioned, and safe to expose to prompts,
reviews, RHO/BES lanes, and swarm routing.

The soul is not authority. It can influence behavior, routing, mutation,
memory selection, and evaluation. It cannot bypass trust gates, approvals,
verifier requirements, workspace boundaries, or delegated-token scope.

## Purpose

A Helios agent should be more than a role label such as `implementer` or
`critic`. The soul record gives each agent continuity:

- what it is for;
- how it prefers to reason and collaborate;
- which memories anchor its behavior;
- what risks it should avoid;
- how it has changed over time;
- which mutations helped or harmed it;
- how it relates to the swarm and oversoul.

This gives the swarm a substrate for personality-like behavior while keeping
the implementation auditable and testable.

## Canonical Runtime Location

Architecture docs live here:

```text
docs/architecture/soul.md
docs/architecture/oversoul.md
```

Runtime soul records should live under the workspace harness:

```text
.harness/souls/agents/<agent-id>/soul.md
.harness/souls/agents/<agent-id>/history.jsonl
.harness/souls/agents/<agent-id>/evaluations.jsonl
```

Generated or evolved soul candidates should be shadow-only until approved:

```text
.harness/souls/candidates/<candidate-id>/soul.md
.harness/souls/candidates/<candidate-id>/mutation.json
.harness/souls/candidates/<candidate-id>/evidence.json
```

## `soul.md` Shape

Each agent soul should be Markdown with strict sections. The Markdown is the
operator-facing source of truth; the runtime may also parse it into JSON for
tests, routing, and BES/RHO evidence.

```markdown
# Soul: <agent-id>

## Identity
- Name:
- Kind: deterministic_subagent | model_worker | pi_native_subagent | external_agent
- Role:
- Version:
- Parent Soul:
- Created:

## Mission
One paragraph describing what this agent is trying to become good at.

## Temperament
- Reasoning style:
- Collaboration style:
- Default pace:
- Uncertainty behavior:
- Preferred evidence:

## Values And Invariants
- Must preserve:
- Must never:
- Should prefer:
- Should challenge:

## Capability Affinities
- Strong tools:
- Weak tools:
- Preferred task types:
- Avoid task types:
- Visual/VLM posture:
- Memory/RAG posture:
- A2A posture:

## Risk Posture
- Mutation risk:
- Tool risk:
- External delegation risk:
- Workspace write risk:
- Approval needs:

## Memory Anchors
- Promoted memories:
- Graph nodes:
- Prior wins:
- Prior failures:
- Lessons:

## Evolution Genome
- Mutation family:
- Compatible families:
- Current traits:
- Suppressed traits:
- Recombination notes:

## Evaluation History
- Current score summary:
- Last benchmark cycle:
- Regressions:
- Promotion blockers:

## Prompt Adapter Notes
Short instructions that may be injected into a worker prompt after sanitization.
```

## Evolution Operations

Soul evolution should use the same evidence-only pattern as the rest of Helios.
Allowed operations:

- `mutate_trait`: adjust one trait, risk posture, or collaboration preference;
- `recombine`: merge compatible traits from two successful souls;
- `distill`: summarize repeated wins or failures into an invariant or lesson;
- `specialize`: narrow a soul toward a task family such as visual review or
  memory adjudication;
- `deprecate`: mark a trait as harmful after replay, verifier, or review
  evidence;
- `rollback`: restore a prior approved soul version.

Disallowed operations:

- lowering verifier requirements;
- broadening workspace write authority;
- granting new tools or external delegation without policy approval;
- hiding lineage, parentage, or failed evaluations;
- marking self-evaluation as promotion authority.

## Runtime Integration

Soul records should connect to these systems:

- `agentProfiles.js`: seed routing and role prompts from soul metadata.
- `rolePrompts.js`: inject sanitized prompt adapter notes.
- `swarmCellContracts.js`: require soul refs in SwarmCell outputs.
- `swarmOutcomeRecorder.js`: record soul outcomes into RHO/BES hard cases.
- `laneRuntime.js`: attach soul refs and mutation lineage to BES lane evidence.
- `coresetBuilder.js`: mine failed or high-performing soul variants as hard cases.
- `harnessVariantWorkspace.js`: include soul files in candidate harness variants.
- `a2aSwarmEnvelope.js`: pass soul refs across local and external envelopes.
- `capabilityGoalStatus.js`: surface soul/oversoul evolution progress.

## Safety Boundary

A soul is a behavioral prior, not a permission model. Permission still comes
from the trust kernel, promotion policy, capability records, scoped delegated
tokens, and human approval. If a soul and policy conflict, policy wins.

