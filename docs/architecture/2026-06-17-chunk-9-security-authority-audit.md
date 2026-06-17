# Chunk 9B Security / Authority Audit

**Date:** 2026-06-17  
**Verdict:** **APPROVED** (no medium, high, or critical findings in scoped integration surfaces)

---

## Scope

| File | Role |
| --- | --- |
| `recursiveEvolutionRuntimeHook.js` | Post-task evolution spine |
| `productionReportOrchestrator.js` | Gated production evidence reports |
| `autonomyProofRecorder.js` | Governance proof artifacts |
| `a2aPeerCycleRunner.js` | A2A peer-cycle evidence |
| `backgroundEvolutionWorker.js` | Background tick + partial autonomy |
| `server.js` | `/v1/evidence/*` routes |
| `trustKernelGateway.js` | Trust boundary gateway |

ICR modules were checked for regression; none appear in this hot-path diff.

---

## Checklist

### 1. No path bypasses trust kernel on apply/promote

**Pass.**

- Durable apply flows through `executeApprovedApplyAction` → `evaluateProposalTrustBoundary` (`approvalResume.js`).
- Post-task hooks do not call champion apply, promotion loop apply, or `executeApprovedApplyAction`.
- The only autonomous write path is `backgroundEvolutionWorker` → `applyPartialAutonomousImprovements`, which calls `evaluateProposalTrustBoundary` before writing and only targets fixed `.harness/runtime/shadow-policy.json` and `.harness/meta/partial-autonomy-applied.json`.
- `evaluateApplyTrustBoundary` / `buildGovernanceTrustInput` in the hook delegate to the gateway; governance uses `trust.evaluate` + `evaluateProposalTrustBoundary` before auto-approval.

### 2. All new stores use workspace-root constraints

**Pass** (with one defense-in-depth gap below medium).

| Store | Containment |
| --- | --- |
| `createReplayEvidenceStore` | `path.resolve(workspaceRoot)` + `.harness/...`; `reportId` sanitized |
| `productionReportOrchestrator` | Workspace root required; path assertions; sanitized IDs |
| `autonomyProofRecorder` | Fixed paths under resolved root |
| `backgroundEvolutionWorker` | Autonomy evidence under resolved root |
| `a2aPeerCycleRunner` | `assertInsideRoot` + durable store with symlink/realpath checks |
| `operatorDashboardStore` (via hook) | `assertInsideRoot`, symlink checks |
| `server.js` evidence reads | Symlink-safe resolution on evidence paths |

**Defense-in-depth (informational):** `createReplayEvidenceStore` writes without symlink/realpath checks that `operatorDashboardStore` and evidence API routes use. Same-user workspace control; inconsistent hardening only.

### 3. No `canPromote: true` on autonomous/evidence paths without human approval

**Pass** for scoped hot paths.

Persisted and API surfaces force `canPromote: false` and `evidenceOnly: true`. `evaluateProductionAutonomy` may compute `promotionEligible` as advisory metadata only (`canApply: false`). Evidence APIs scrub authority fields. Partial autonomy writes remain threshold- and feature-gated; outputs keep `canPromote: false`.

### 4. ICR blind judge isolation not weakened

**Pass (no regression).**

Changed files do not touch `src/harness-sidecar/icr/*`. Existing `assertIcrEvidenceOnly`, blind judge packet construction, and `hiddenFromJudge` lists remain intact.

---

## Tests reviewed

- `tests/harness-recursive-evolution-integration.test.js`
- `tests/partial-autonomy-apply.test.js`
- `tests/harness-autonomy-proof-recorder.test.js`
- `tests/harness-a2a-two-instance-integration.test.js`

---

## Conclusion

```
APPROVED
```

No medium, high, or critical issues with demonstrated exploitability on the scoped integration surfaces.
