import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

function makeArtifactId() {
  return `art_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createArtifactStore({ workspaceRoot }) {
  return {
    async writeTextArtifact({ taskId, type, title, filename, content }) {
      const artifactId = makeArtifactId();
      const artifactDir = path.join(workspaceRoot, '.harness', 'traces', taskId, 'artifacts');
      await mkdir(artifactDir, { recursive: true });
      const artifactPath = path.join(artifactDir, filename);
      await writeFile(artifactPath, content, 'utf8');
      return {
        artifactId,
        taskId,
        type,
        title,
        contentType: 'text/plain',
        path: artifactPath,
      };
    },
  };
}
