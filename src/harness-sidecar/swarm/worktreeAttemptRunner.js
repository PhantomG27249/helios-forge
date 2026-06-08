import { WorktreeManager } from './worktreeManager.js';
import { runCommandAttempt } from './commandAttemptRunner.js';

function missingRequiredFields(output, requiredFields = []) {
  return requiredFields.filter((field) => output?.[field] === undefined || output?.[field] === null);
}

function outputFromCommandResult(result = {}) {
  return {
    patch: result.patch,
    verifierEvidence: result.verifierEvidence || [],
    score: result.score,
  };
}

export async function runWorktreeAttempt({
  task = {},
  attempt = {},
  role = 'implementer',
  workspaceRoot,
  worktreeManager,
  command = 'harness attempt',
  verifierCommand,
  commandAdapter,
  verifierAdapter,
  timeoutMs,
  outputContract = {},
} = {}) {
  if (typeof commandAdapter !== 'function') {
    throw new Error('commandAdapter is required');
  }
  if (!workspaceRoot && !worktreeManager) {
    throw new Error('workspaceRoot is required');
  }

  const manager = worktreeManager || new WorktreeManager({ workspaceRoot });
  const startedAt = new Date().toISOString();
  let attemptWorktree = null;
  let worktreeRecord = null;

  try {
    if (!(await manager.isGitRepo())) {
      return {
        attemptId: attempt.attemptId,
        strategy: attempt.strategy,
        role,
        status: 'unavailable',
        output: null,
        verifierEvidence: [],
        score: 0,
        patchStats: { changedLines: 0 },
        contract: {
          requiredFields: outputContract.requiredFields || [],
          missingFields: outputContract.requiredFields || [],
          valid: false,
        },
        worktree: {
          available: false,
          cleanedUp: false,
          reason: 'Workspace is not a git repository',
        },
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    attemptWorktree = await manager.createAttemptWorktree({
      taskId: task.taskId,
      attemptId: attempt.attemptId,
    });
    worktreeRecord = {
      ...attemptWorktree,
      cleanedUp: false,
    };

    if (attemptWorktree?.available === false) {
      return {
        attemptId: attempt.attemptId,
        strategy: attempt.strategy,
        role,
        status: 'unavailable',
        output: null,
        verifierEvidence: [],
        score: 0,
        patchStats: { changedLines: 0 },
        contract: {
          requiredFields: outputContract.requiredFields || [],
          missingFields: outputContract.requiredFields || [],
          valid: false,
        },
        worktree: worktreeRecord,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    const commandResult = await runCommandAttempt({
      attempt,
      worktreePath: attemptWorktree.worktreePath,
      command,
      verifierCommand,
      commandAdapter,
      verifierAdapter,
      timeoutMs,
    });
    const output = outputFromCommandResult(commandResult);
    const requiredFields = outputContract.requiredFields || [];
    const missingFields = missingRequiredFields(output, requiredFields);

    return {
      attemptId: attempt.attemptId,
      strategy: attempt.strategy,
      role,
      status: missingFields.length ? 'contract_failed' : 'completed',
      output,
      verifierEvidence: commandResult.verifierEvidence || [],
      passed: commandResult.passed === true,
      score: commandResult.score || 0,
      patchStats: commandResult.patchStats,
      command: commandResult.command,
      contract: {
        requiredFields,
        missingFields,
        valid: missingFields.length === 0,
      },
      worktree: worktreeRecord,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      attemptId: attempt.attemptId,
      strategy: attempt.strategy,
      role,
      status: 'failed',
      output: null,
      verifierEvidence: [],
      score: 0,
      patchStats: { changedLines: 0 },
      contract: {
        requiredFields: outputContract.requiredFields || [],
        missingFields: outputContract.requiredFields || [],
        valid: false,
      },
      failure: {
        reason: 'worktree_command_failed',
        message: error.message,
        retryable: true,
      },
      worktree: worktreeRecord || {
        ...(attemptWorktree || {}),
        cleanedUp: false,
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } finally {
    if (attemptWorktree?.worktreePath) {
      try {
        await manager.removeAttemptWorktree(attemptWorktree);
        if (worktreeRecord) worktreeRecord.cleanedUp = true;
      } catch (error) {
        if (worktreeRecord) {
          worktreeRecord.cleanedUp = false;
          worktreeRecord.cleanupError = error.message;
        }
      }
    }
  }
}
