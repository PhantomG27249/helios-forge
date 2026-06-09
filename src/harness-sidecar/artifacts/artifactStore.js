import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

function makeArtifactId() {
  return `art_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function contentTypeForPath(artifactPath = '') {
  const ext = path.extname(artifactPath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.json') return 'application/json';
  if (ext === '.md') return 'text/markdown';
  return 'text/plain';
}

function primaryArtifactPath(artifact = {}) {
  if (artifact.path) return artifact.path;
  const nested = artifact.artifacts && typeof artifact.artifacts === 'object' ? artifact.artifacts : {};
  return nested.image || nested.diff || nested.after || nested.before || nested.pdf || null;
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

    async readTextArtifact(artifact) {
      return this.readArtifact(artifact);
    },

    async readArtifact(artifact) {
      const artifactPath = primaryArtifactPath(artifact);
      if (!artifactPath) {
        return {
          artifact,
          content: JSON.stringify(artifact, null, 2),
          contentType: 'application/json',
        };
      }
      const contentType = artifact.contentType || contentTypeForPath(artifactPath);
      if (contentType.startsWith('image/') || contentType === 'application/pdf') {
        const bytes = await readFile(artifactPath);
        return {
          artifact: {
            ...artifact,
            path: artifact.path || artifactPath,
            contentType,
          },
          content: artifact.summary || artifact.title || artifact.type || '',
          contentType,
          dataUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
        };
      }
      const content = await readFile(artifactPath, 'utf8');
      return {
        artifact: {
          ...artifact,
          path: artifact.path || artifactPath,
          contentType,
        },
        content,
        contentType,
      };
    },
  };
}
