import { mkdir, appendFile } from 'fs/promises';
import path from 'path';

export class TraceWriter {
  constructor({ workspaceRoot }) {
    this.workspaceRoot = workspaceRoot;
  }

  getTaskTraceDir(taskId) {
    return path.join(this.workspaceRoot, '.harness', 'traces', taskId);
  }

  async writeEvent(event) {
    const traceDir = this.getTaskTraceDir(event.taskId);
    await mkdir(traceDir, { recursive: true });
    const line = `${JSON.stringify(event)}\n`;
    await appendFile(path.join(traceDir, 'events.jsonl'), line, 'utf8');
  }
}
