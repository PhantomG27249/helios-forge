import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let crcTable = null;

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function makeCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    return crc >>> 0;
  });
}

function crc32(buffer) {
  crcTable ||= makeCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function setPixel(pixels, width, x, y, color) {
  const offset = (y * width + x) * 3;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
}

function fillRect(pixels, width, height, x, y, rectWidth, rectHeight, color) {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(width, Math.ceil(x + rectWidth));
  const endY = Math.min(height, Math.ceil(y + rectHeight));
  for (let row = startY; row < endY; row += 1) {
    for (let column = startX; column < endX; column += 1) {
      setPixel(pixels, width, column, row, color);
    }
  }
}

function createRuntimePreviewPng({ width = 640, height = 360, metrics = {} } = {}) {
  const quality = clamp01(metrics.quality, 0.5);
  const cost = clamp01(metrics.cost, 0.35);
  const confidence = clamp01(metrics.confidence, quality);
  const pixels = Buffer.alloc(width * height * 3, 246);

  fillRect(pixels, width, height, 0, 0, width, height, [246, 247, 244]);
  fillRect(pixels, width, height, 0, 0, width, 58, [31, 44, 50]);
  fillRect(pixels, width, height, 0, height - 32, width, 32, [225, 230, 226]);

  for (let row = 92; row < height - 60; row += 42) {
    fillRect(pixels, width, height, 64, row, width - 128, 2, [220, 224, 220]);
  }

  const baseY = height - 74;
  const maxBarHeight = 190;
  const bars = [
    { x: 110, value: quality, color: [39, 143, 105] },
    { x: 270, value: 1 - cost, color: [229, 171, 55] },
    { x: 430, value: confidence, color: [73, 115, 183] },
  ];
  for (const bar of bars) {
    const barHeight = Math.round(maxBarHeight * bar.value);
    fillRect(pixels, width, height, bar.x, baseY - barHeight, 86, barHeight, bar.color);
    fillRect(pixels, width, height, bar.x, baseY, 86, 6, [72, 80, 78]);
  }

  const indicatorX = Math.round(64 + (width - 128) * confidence);
  fillRect(pixels, width, height, 64, 74, width - 128, 18, [213, 220, 216]);
  fillRect(pixels, width, height, 64, 74, indicatorX - 64, 18, [73, 115, 183]);
  fillRect(pixels, width, height, indicatorX - 3, 68, 6, 30, [31, 44, 50]);

  const scanlineLength = 1 + width * 3;
  const raw = Buffer.alloc(scanlineLength * height);
  for (let y = 0; y < height; y += 1) {
    const scanlineStart = y * scanlineLength;
    raw[scanlineStart] = 0;
    pixels.copy(raw, scanlineStart + 1, y * width * 3, (y + 1) * width * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND'),
  ]);
}

export async function writeRuntimePreviewImage({ workspaceRoot, taskId, metrics = {} } = {}) {
  const artifactDir = path.join(workspaceRoot, '.harness', 'traces', taskId, 'artifacts');
  await mkdir(artifactDir, { recursive: true });
  const imagePath = path.join(artifactDir, 'runtime-preview.png');
  await writeFile(imagePath, createRuntimePreviewPng({ metrics }));
  return imagePath;
}
