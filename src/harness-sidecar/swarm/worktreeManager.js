import { mkdir } from 'fs/promises';
import path from 'path';
import { runShellCommand } from '../tools/shellBroker.js';

export class WorktreeManager {
  constructor({ workspaceRoot, harnessRoot = path.join(workspaceRoot, '.harness') }) {
    this.workspaceRoot = workspaceRoot;
    this.harnessRoot = harnessRoot;
  }

  async isGitRepo() {
    const result = await runShellCommand({
      command: 'git rev-parse --is-inside-work-tree',
      cwd: this.workspaceRoot,
      timeoutMs: 5000,
    });
    return result.exitCode === 0 && result.stdout.trim() === 'true';
  }

  async createAttemptWorktree({ taskId, attemptId }) {
    if (!(await this.isGitRepo())) {
      return {
        available: false,
        reason: 'Workspace is not a git repository',
      };
    }

    const worktreeRoot = path.join(this.harnessRoot, 'worktrees', taskId);
    await mkdir(worktreeRoot, { recursive: true });
    const worktreePath = path.join(worktreeRoot, attemptId);
    const branchName = `harness/${taskId}/${attemptId}`;
    const result = await runShellCommand({
      command: `git worktree add "${worktreePath}" -b "${branchName}"`,
      cwd: this.workspaceRoot,
      timeoutMs: 15000,
    });

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || 'Failed to create worktree');
    }

    return {
      available: true,
      taskId,
      attemptId,
      branchName,
      worktreePath,
    };
  }

  async removeAttemptWorktree(attempt) {
    if (!attempt?.worktreePath) return;
    await runShellCommand({
      command: `git worktree remove --force "${attempt.worktreePath}"`,
      cwd: this.workspaceRoot,
      timeoutMs: 15000,
    });
  }
}
