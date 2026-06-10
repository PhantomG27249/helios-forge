import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const DEFAULT_MAX_REFS = 16;
const DEFAULT_MAX_BYTES = 2048;

function countByType(capabilities) {
  const counts = {};
  for (const capability of capabilities) {
    const type = String(capability?.type || "unknown");
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function compactRef(capability) {
  return {
    id: String(capability?.id || capability?.capabilityId || "").slice(0, 120),
    type: String(capability?.type || "unknown").slice(0, 48),
    name: String(capability?.name || capability?.id || "Unnamed capability").slice(0, 120),
    enabled: capability?.enabled !== false,
  };
}

function warningMetadata(warning) {
  return {
    source: "helios-forge",
    status: "warning",
    warning,
    manifestId: null,
    counts: {},
    refs: [],
  };
}

function fitMetadata(metadata, maxBytes) {
  const fitted = { ...metadata, refs: [...metadata.refs] };
  while (Buffer.byteLength(JSON.stringify(fitted), "utf8") > maxBytes && fitted.refs.length > 0) {
    fitted.refs.pop();
    fitted.truncated = true;
  }
  return fitted;
}

export function createBridgeMetadata({
  manifestPath = process.env.HELIOS_CAPABILITIES_MANIFEST,
  readFile = (filePath) => readFileSync(filePath, "utf8"),
  maxRefs = DEFAULT_MAX_REFS,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (!manifestPath) {
    return warningMetadata("HELIOS_CAPABILITIES_MANIFEST is not available");
  }

  let manifest;
  let manifestRaw;
  try {
    manifestRaw = String(readFile(manifestPath) || "").replace(/^\uFEFF/, "");
    manifest = JSON.parse(manifestRaw);
  } catch {
    return warningMetadata("HELIOS_CAPABILITIES_MANIFEST is not available");
  }

  const capabilities = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
  const refs = capabilities.slice(0, maxRefs).map(compactRef).filter((ref) => ref.id);
  const counts = manifest?.counts && typeof manifest.counts === "object"
    ? Object.fromEntries(
        Object.entries(manifest.counts).filter(([key, value]) => (
          key !== "enabled" && Number.isFinite(Number(value))
        )),
      )
    : countByType(capabilities);

  return fitMetadata({
    source: "helios-forge",
    status: "ready",
    manifestId: createHash("sha256").update(manifestRaw).digest("hex").slice(0, 16),
    counts,
    refs,
  }, maxBytes);
}

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_request", (event) => {
    const metadata = createBridgeMetadata();
    return {
      ...event.payload,
      metadata: {
        ...(event.payload?.metadata || {}),
        heliosForgeBridge: metadata,
      },
    };
  });
}
