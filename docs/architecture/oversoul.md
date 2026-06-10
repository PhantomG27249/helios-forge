# Swarm Oversoul Contract

`oversoul.md` is the durable identity and evolution contract for the Helios
swarm as a whole. Where `soul.md` describes a single agent, `oversoul.md`
describes the collective: shared mission, role ecology, mutation pressure,
governance posture, and long-running memory of what the swarm is becoming.

The oversoul is also not authority. It can influence swarm composition,
task routing, candidate generation, benchmark priorities, and mutation policy.
It cannot bypass approval gates, promotion policy, trust-kernel boundaries, or
external evidence validation.

## Canonical Runtime Location

Architecture docs live here:

```text
docs/architecture/oversoul.md
docs/architecture/soul.md
```

Runtime oversoul state should live under the workspace harness:

```text
.harness/souls/oversoul.md
.harness/souls/oversoul-history.jsonl
.harness/souls/oversoul-evaluations.jsonl
```

Shadow candidates should live here until approved:

```text
.harness/souls/oversoul-candidates/<candidate-id>/oversoul.md
.harness/souls/oversoul-candidates/<candidate-id>/mutation.json
.harness/souls/oversoul-candidates/<candidate-id>/evidence.json
```

## `oversoul.md` Shape

```markdown
# Oversoul: <workspace-or-swarm-id>

## Identity
- Name:
- Version:
- Parent Oversoul:
- Created:
- Active Soul Families:

## Collective Mission
One paragraph describing what the swarm is optimizing for over time.

## Shared Values And Invariants
- Must preserve:
- Must never:
- Should prefer:
- Should challenge:

## Role Ecology
- Core roles:
- Specialist roles:
- Missing roles:
- Overrepresented roles:
- Compatibility families:

## Strategy Posture
- Exploration pressure:
- Exploitation pressure:
- Evidence threshold:
- Visual/VLM posture:
- Memory/RAG posture:
- A2A posture:
- Budget posture:

## Mutation Policy
- Allowed mutation families:
- Suppressed mutation families:
- Recombination rules:
- Retirement rules:
- Rollback triggers:

## Collective Memory Anchors
- Frontier wins:
- Frontier regressions:
- Promoted lessons:
- Repeated failure modes:
- Trust incidents:

## Governance Posture
- Autonomy level:
- Approval narrowing:
- Escalation triggers:
- External evidence policy:
- VLM evidence policy:
- Audit expectations:

## Evaluation Summary
- Current frontier:
- Last benchmark cycle:
- Health metrics:
- Promotion blockers:

## Prompt Adapter Notes
Short swarm-level instructions that may be injected into planning, routing, or
subagent prompts after sanitization.
```

## How Oversoul Evolution Works

The oversoul evolves by observing many souls and many task outcomes. It should
not mutate because one agent self-reports success. It should mutate only from
evidence:

- longitudinal benchmark deltas;
- RHO grouped replay results;
- BES lane evidence and blockers;
- memory health and conflict metrics;
- visual confidence and UI regression results;
- A2A trust events;
- rollback drill outcomes;
- operator review.

Allowed oversoul operations:

- `rebalance_roles`: change which soul families are scheduled more often;
- `raise_evidence_threshold`: require stronger proof before promotion;
- `lower_exploration_pressure`: reduce risky exploration after regressions;
- `increase_specialization`: create or route to specialist souls;
- `distill_norm`: turn repeated outcomes into a shared invariant;
- `retire_family`: stop using a soul family after repeated failures;
- `fork_oversoul`: test a new swarm strategy in a shadow harness variant.

## Relationship To Agent Souls

The oversoul owns no individual agent. Instead, it coordinates the ecology:

- souls declare their traits, skills, and risks;
- the oversoul chooses what the swarm currently needs;
- RHO identifies hard cases where current souls fail;
- BES proposes soul mutations or recombinations;
- Meta-Harness evaluates candidate soul/oversoul combinations in isolated
  variants;
- promotion policy decides whether any soul or oversoul change becomes durable.

## Safety Boundary

The oversoul must preserve the trust-kernel principle: no optimizer may
self-authorize durable mutation. Oversoul changes are candidates. They need
evidence, replay, verifier coverage, rollback metadata, and approval according
to risk.

