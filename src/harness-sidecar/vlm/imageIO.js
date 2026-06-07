import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function isInsideRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRoot(root) {
  if (!root) return null;
  return path.resolve(root);
}

function allowedRoots({ workspaceRoot, artifactRoots = [] } = {}) {
  return [workspaceRoot, ...artifactRoots]
    .map(normalizeRoot)
    .filter(Boolean);
}

function resolveImagePath({ imagePath, workspaceRoot } = {}) {
  if (!imagePath) {
    throw new Error('Image path is required');
  }
  if (path.isAbsolute(imagePath)) {
    return path.resolve(imagePath);
  }
  if (!workspaceRoot) {
    throw new Error('Relative image paths require a workspace root');
  }
  return path.resolve(workspaceRoot, imagePath);
}

function signatureMimeType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6) {
    const gifHeader = bytes.subarray(0, 6).toString('ascii');
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function detectImageMimeType({ bytes, imagePath } = {}) {
  return signatureMimeType(bytes || Buffer.alloc(0), imagePath);
}

export async function readImageArtifact({
  imagePath,
  workspaceRoot,
  artifactRoots = [],
  maxBytes = DEFAULT_MAX_IMAGE_BYTES,
} = {}) {
  const resolvedPath = resolveImagePath({ imagePath, workspaceRoot });
  const roots = allowedRoots({ workspaceRoot, artifactRoots });
  if (roots.length === 0) {
    throw new Error('At least one workspace or artifact root is required');
  }
  if (!roots.some((root) => isInsideRoot(resolvedPath, root))) {
    throw new Error(`Image path is outside allowed roots: ${imagePath}`);
  }

  const realRoots = await Promise.all(roots.map((root) => realpath(root)));
  const realResolvedPath = await realpath(resolvedPath);
  if (!realRoots.some((root) => isInsideRoot(realResolvedPath, root))) {
    throw new Error(`Image path is outside allowed roots: ${imagePath}`);
  }

  const fileStats = await stat(resolvedPath);
  if (!fileStats.isFile()) {
    throw new Error(`Image path is not a file: ${imagePath}`);
  }
  if (fileStats.size > maxBytes) {
    throw new Error(`Image artifact exceeds image byte budget: ${fileStats.size} > ${maxBytes}`);
  }

  const bytes = await readFile(resolvedPath);
  const mimeType = detectImageMimeType({ bytes, imagePath: resolvedPath });
  if (!mimeType) {
    throw new Error(`Unsupported image MIME type for artifact: ${imagePath}`);
  }

  const base64 = bytes.toString('base64');
  const relativePath = workspaceRoot && isInsideRoot(realResolvedPath, await realpath(path.resolve(workspaceRoot)))
    ? path.relative(await realpath(path.resolve(workspaceRoot)), realResolvedPath)
    : path.relative(realRoots.find((root) => isInsideRoot(realResolvedPath, root)), realResolvedPath);

  return {
    path: resolvedPath,
    mimeType,
    base64,
    dataUrl: `data:${mimeType};base64,${base64}`,
    metadata: {
      filename: path.basename(resolvedPath),
      extension: path.extname(resolvedPath).toLowerCase(),
      relativePath,
      sizeBytes: fileStats.size,
    },
  };
}
