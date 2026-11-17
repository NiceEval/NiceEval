// A profile is untrusted runtime data, including its apparent sourceURL.
export type ProfileManifest = { release: string; files: Record<string, string[]> };
type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue => !!v && typeof v === "object" && !Array.isArray(v);
export const telemetryId = (v: unknown, length = 32): v is string =>
  typeof v === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "i").test(v) && !/^0+$/.test(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export function profileCodePath(value: unknown, platform: "node" | "javascript"): string | undefined {
  if (typeof value !== "string") return;
  const clean = value.split(/[?#]/, 1)[0];
  if (platform === "javascript") {
    try {
      const url = new URL(clean, typeof location === "undefined" ? "https://invalid.local" : location.origin);
      if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) return;
      if (typeof location !== "undefined" && url.origin !== location.origin) return;
      return url.pathname;
    } catch {
      return;
    }
  }
  // Only build output, normalized exactly as the generated manifest/code_file.
  if (/^(?:eval|data|blob|https?):/i.test(clean)) return;
  const marker = "/.next/server/";
  const index = clean.indexOf(marker);
  if (index >= 0) return clean.slice(index + 1);
  if (clean.startsWith(".next/server/")) return clean;
}

export function readProfileManifest(value: unknown, release: string): ProfileManifest | undefined {
  if (!release || !record(value) || value.release !== release || !record(value.files)) return;
  const files: Record<string, string[]> = Object.create(null);
  for (const [file, symbols] of Object.entries(value.files)) {
    if (!Array.isArray(symbols) || !symbols.every((s) => typeof s === "string")) return;
    files[file] = symbols;
  }
  return { release, files };
}

export function cleanProfileChunk(raw: unknown, environment: string, release: string, manifest?: ProfileManifest) {
  if (
    !record(raw) ||
    raw.version !== "2" ||
    !["node", "javascript"].includes(String(raw.platform)) ||
    !telemetryId(raw.profiler_id) ||
    !telemetryId(raw.chunk_id) ||
    !record(raw.profile)
  )
    return;
  const platform = raw.platform as "node" | "javascript";
  const p = raw.profile;
  if (
    !Array.isArray(p.frames) ||
    !p.frames.length ||
    !Array.isArray(p.stacks) ||
    !p.stacks.length ||
    !Array.isArray(p.samples) ||
    !p.samples.length ||
    !record(p.thread_metadata)
  )
    return;
  const threads: Record<string, { name: string }> = {};
  for (const key of Object.keys(p.thread_metadata)) {
    if (!/^(0|[1-9][0-9]*)$/.test(key) || !Number.isSafeInteger(Number(key))) return;
    threads[key] = { name: key === "0" ? "main" : "worker" };
  }
  const stacks: number[][] = [];
  const frameCount = p.frames.length;
  for (const stack of p.stacks) {
    if (!Array.isArray(stack) || !stack.every((i) => integer(i) && i < frameCount)) return;
    stacks.push(stack);
  }
  const samples = [];
  for (const sample of p.samples) {
    if (
      !record(sample) ||
      !integer(sample.stack_id) ||
      sample.stack_id >= stacks.length ||
      typeof sample.timestamp !== "number" ||
      !Number.isFinite(sample.timestamp) ||
      sample.timestamp < 0 ||
      typeof sample.thread_id !== "string" ||
      !Object.hasOwn(threads, sample.thread_id)
    )
      return;
    samples.push({ stack_id: sample.stack_id, timestamp: sample.timestamp, thread_id: sample.thread_id });
  }
  const approved = manifest?.release === release ? manifest.files : undefined;
  const frames = p.frames.map((frame) => {
    if (!record(frame)) return { function: "redacted" };
    const path = profileCodePath(frame.abs_path ?? frame.file, platform);
    const symbols = path && approved && Object.hasOwn(approved, path) ? approved[path] : undefined;
    if (!symbols) return { function: "redacted" };
    return {
      function: typeof frame.function === "string" && symbols.includes(frame.function) ? frame.function : "redacted",
      ...(platform === "node" ? { file: path } : { abs_path: path }),
      ...(integer(frame.lineno) ? { lineno: frame.lineno } : {}),
      ...(integer(frame.colno) ? { colno: frame.colno } : {}),
      ...(typeof frame.in_app === "boolean" ? { in_app: frame.in_app } : {}),
    };
  });
  const images =
    record(raw.debug_meta) && Array.isArray(raw.debug_meta.images)
      ? raw.debug_meta.images.flatMap((img) => {
          if (
            !record(img) ||
            img.type !== "sourcemap" ||
            typeof img.debug_id !== "string" ||
            !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(img.debug_id)
          )
            return [];
          const path = profileCodePath(img.code_file, platform);
          return path && approved && Object.hasOwn(approved, path)
            ? [{ type: "sourcemap", code_file: path, debug_id: img.debug_id }]
            : [];
        })
      : [];
  return {
    version: "2",
    platform,
    profiler_id: raw.profiler_id,
    chunk_id: raw.chunk_id,
    release,
    environment,
    client_sdk: { name: "sentry.javascript.nextjs", version: "11.12.0" },
    debug_meta: { images },
    profile: { samples, stacks, frames, thread_metadata: threads },
  };
}
