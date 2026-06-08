const TOOL_OUTPUT_SUMMARY_RATIO = 0.25;
const RAW_LOG_COMPRESSION_RATIO = 0.25;

function itemKey(item) {
  return item.id || item.path || item.type || 'context_item';
}

function cloneItem(item) {
  return { ...item };
}

function compressedTokenCount(item, ratio) {
  return Math.max(1, Math.ceil((item.tokensEstimated || 1) * ratio));
}

function shouldCompressToolOutput(item, pressurePercent) {
  return pressurePercent >= 70 && item.type === 'tool_output';
}

function shouldCompressRawLog(item, pressurePercent) {
  return pressurePercent >= 80 && item.type === 'raw_log';
}

function compressItem(item, pressurePercent) {
  if (shouldCompressToolOutput(item, pressurePercent)) {
    return {
      ...item,
      compressed: true,
      compression: 'summarize_older_tool_outputs',
      originalTokensEstimated: item.tokensEstimated || 1,
      tokensEstimated: compressedTokenCount(item, TOOL_OUTPUT_SUMMARY_RATIO),
      content: item.summary || `Summary retained for ${itemKey(item)}`,
    };
  }

  if (shouldCompressRawLog(item, pressurePercent)) {
    return {
      ...item,
      compressed: true,
      compression: 'compress_raw_logs',
      originalTokensEstimated: item.tokensEstimated || 1,
      tokensEstimated: compressedTokenCount(item, RAW_LOG_COMPRESSION_RATIO),
      content: item.summary || `Compressed raw log retained for ${itemKey(item)}`,
    };
  }

  return cloneItem(item);
}

function orderForPacking(items) {
  return items.slice().sort((left, right) => (
    (left.priority ?? 5) - (right.priority ?? 5)
    || (left.tokensEstimated || 1) - (right.tokensEstimated || 1)
    || String(itemKey(left)).localeCompare(String(itemKey(right)))
  ));
}

export class WorkingMemory {
  constructor({ taskId, maxTokens = 6000 } = {}) {
    this.taskId = taskId;
    this.maxTokens = maxTokens;
    this.items = [];
  }

  remember(item) {
    const entry = cloneItem(item);
    this.items.push(entry);
    return entry;
  }

  pack({ pressurePercent = 0, maxTokens = this.maxTokens } = {}) {
    const prepared = this.items.map((item) => compressItem(item, pressurePercent));
    const compressedItems = prepared
      .filter((item) => item.compressed)
      .map(cloneItem);
    const retainedP0Items = prepared
      .filter((item) => item.priority === 0)
      .map(cloneItem);
    const retainedP0Keys = new Set(retainedP0Items.map(itemKey));

    const packed = [];
    const droppedItems = [];
    let tokensEstimated = 0;

    for (const item of retainedP0Items) {
      packed.push(cloneItem(item));
      tokensEstimated += item.tokensEstimated || 1;
    }

    for (const item of orderForPacking(prepared.filter((candidate) => !retainedP0Keys.has(itemKey(candidate))))) {
      const itemTokens = item.tokensEstimated || 1;
      if (tokensEstimated + itemTokens <= maxTokens) {
        packed.push(cloneItem(item));
        tokensEstimated += itemTokens;
      } else {
        droppedItems.push(cloneItem(item));
      }
    }

    return {
      taskId: this.taskId,
      items: packed,
      droppedItems,
      compressedItems,
      retainedP0Items,
      tokensEstimated,
      maxTokens,
    };
  }
}

export function createWorkingMemory(options) {
  return new WorkingMemory(options);
}
