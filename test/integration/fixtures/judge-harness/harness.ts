import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createEmulator, defineEmulator, type EmulatorContext } from "emulate";
import { Effect } from "effect";
import { experimentHost } from "niceeval/experiment/host";
import { decodeInspectionDocument, narrowInspectionSuccess } from "niceeval/inspection";
import { runHost } from "niceeval/run/host";
import { runCliInProcess } from "../../../../packages/niceeval/src/cli/in-process.ts";

export {
  defineAgentJudge,
  defineJudge,
  binaryJudge,
  factuality,
  faithfulness,
  instructionFollowing,
  pairwisePreference,
  defineScoreMatch,
  equals,
} from "niceeval/expect";
export { OpenAIProvider, OpenRouterProvider, TypesafeProvider, VercelProvider, judgeImage } from "niceeval/judge";
export { Effect, decodeInspectionDocument, experimentHost, narrowInspectionSuccess, runCliInProcess, runHost };
export { startModelEmulator, type ModelRule } from "../model-emulator.ts";

/**
 * Host-process Sandbox module written into temporary fixture projects so Judge and
 * Agent Judge tests exercise real files and real commands without Docker.
 */
export const HOST_SANDBOX_SOURCE = `
import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Effect } from "effect";
import { CustomSandboxMaterializationError, defineSandbox } from "niceeval/sandbox";

function hostPlatform() {
  if (process.platform === "darwin") return { _tag: "Darwin", os: "darwin", arch: process.arch };
  const report = process.report.getReport();
  return {
    _tag: "Linux",
    os: "linux",
    arch: process.arch,
    libc: report.header?.glibcVersionRuntime === undefined ? "musl" : "gnu",
  };
}

async function hostSandbox() {
  const root = await mkdtemp(join(tmpdir(), "niceeval-judge-sandbox-"));
  const workdir = join(root, "workspace");
  const privateTmp = join(root, "tmp");
  await Promise.all([mkdir(workdir), mkdir(privateTmp)]);
  const map = (value) => value.replaceAll("/tmp/.niceeval-ledger", join(privateTmp, ".niceeval-ledger"));
  const at = (path) => (isAbsolute(map(path)) ? map(path) : resolve(workdir, map(path)));
  const active = new Set();

  const run = (command, args = [], options = {}) =>
    new Promise((done) => {
      if (options.signal?.aborted) {
        done({ stdout: "", stderr: "aborted", exitCode: 130 });
        return;
      }
      const child = spawn(map(command), args.map(map), {
        cwd: at(options.cwd ?? workdir),
        detached: true,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          TMPDIR: privateTmp,
          LANG: "C.UTF-8",
          ...Object.fromEntries(
            Object.entries(options.env ?? {}).flatMap(([key, value]) => (value === undefined ? [] : [[key, map(value)]])),
          ),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (child.pid !== undefined) active.add(child.pid);
      let stdout = "";
      let stderr = "";
      let settled = false;
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
      const killGroup = () => {
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {}
        }
      };
      const onAbort = () => killGroup();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timer =
        options.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              killGroup();
              if (!settled) {
                settled = true;
                cleanup();
                done({ stdout, stderr: stderr + "\\ncommand timed out", exitCode: 124 });
              }
            }, options.timeoutMs);
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        if (child.pid !== undefined) active.delete(child.pid);
      };
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        done({ stdout, stderr: error.message, exitCode: -1, startError: error.message });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        done({ stdout, stderr, exitCode: code ?? (options.signal?.aborted ? 130 : 1) });
      });
    });

  const writeBytes = async (path, bytes) => {
    await mkdir(dirname(at(path)), { recursive: true });
    await writeFile(at(path), bytes);
  };

  return {
    sandboxId: \`judge-sandbox-\${root.split("/").at(-1)}\`,
    workdir,
    otlpHost: "localhost",
    runCommand: run,
    runShell: (script, options) => run("bash", ["-c", script], options),
    readText: (path) => readFile(at(path), "utf8"),
    writeText: (path, text) => writeBytes(path, Buffer.from(text, "utf8")),
    readBytes: (path) => readFile(at(path)),
    writeBytes,
    pathExists: (path) => access(at(path)).then(() => true, () => false),
    uploadFile: async (source, target) => writeBytes(target, await readFile(source)),
    uploadDirectory: (source, target) => cp(source, at(target ?? "."), { recursive: true }),
    downloadFile: async (source, target) => {
      await mkdir(dirname(String(target)), { recursive: true });
      await writeFile(target, await readFile(at(source)));
    },
    downloadDirectory: (source, target) => cp(at(source), target, { recursive: true }),
    stop: async () => {
      for (const pid of active) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {}
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

export default defineSandbox({
  name: "judge-sandbox-host",
  targetPlatform: hostPlatform(),
  exclusive: false,
  create: () =>
    Effect.tryPromise({
      try: hostSandbox,
      catch: (cause) =>
        new CustomSandboxMaterializationError({ code: "judge-sandbox-create-failed", message: String(cause), cause }),
    }),
});
`;

export interface JudgeProjectFiles {
  readonly config?: string;
  readonly agent?: string;
  readonly sandbox?: string;
  readonly evals: Readonly<Record<string, string>>;
  readonly experiments: Readonly<Record<string, string>>;
  readonly extra?: Readonly<Record<string, string>>;
}

export async function createJudgeProject(prefix: string, files: JudgeProjectFiles): Promise<string> {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), prefix));
  try {
    await Promise.all([mkdir(join(cwd, "evals")), mkdir(join(cwd, "experiments")), mkdir(join(cwd, "node_modules"))]);
    const effectPkgDir = dirname(fileURLToPath(import.meta.resolve("effect/package.json")));
    const writes: Promise<void>[] = [
      symlink(effectPkgDir, join(cwd, "node_modules", "effect"), "dir"),
      writeFile(join(cwd, "package.json"), JSON.stringify({ name: "judge-fixture", private: true, type: "module" })),
    ];
    if (files.config !== undefined) writes.push(writeFile(join(cwd, "niceeval.config.ts"), files.config));
    if (files.agent !== undefined) writes.push(writeFile(join(cwd, "agent.ts"), files.agent));
    if (files.sandbox !== undefined) writes.push(writeFile(join(cwd, "sandbox.ts"), files.sandbox));
    for (const [name, content] of Object.entries(files.evals)) {
      writes.push(writeFile(join(cwd, "evals", name), content));
    }
    for (const [name, content] of Object.entries(files.experiments)) {
      writes.push(writeFile(join(cwd, "experiments", name), content));
    }
    for (const [rel, content] of Object.entries(files.extra ?? {})) {
      const target = join(cwd, rel);
      writes.push(mkdir(dirname(target), { recursive: true }).then(() => writeFile(target, content)));
    }
    await Promise.all(writes);
    return cwd;
  } catch (error) {
    await rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

export async function planAndRunExperiment(
  cwd: string,
  experimentSelector: string,
  options: {
    readonly config?: Record<string, unknown>;
    readonly rerun?: "all" | "failed";
    readonly signal?: AbortSignal;
  } = {},
) {
  const planned = await Effect.runPromise(
    experimentHost.invocation.plan({
      cwd,
      experimentSelector,
      config: options.config ?? { maxConcurrency: 2 },
      overrides: { ...(options.rerun === undefined ? {} : { rerun: options.rerun }), earlyExit: false },
    }),
  );
  if (planned.status !== "ready") return { status: planned.status, planned, receipt: undefined, run: undefined };
  const result = await Effect.runPromise(
    experimentHost.invocation.run({ plan: planned.plan, ...(options.signal ? { signal: options.signal } : {}) }),
  );
  const runId = result.receipt.createdRunIds[0];
  const run = runId === undefined ? undefined : (await Effect.runPromise(runHost.get({ cwd, runId }))).run;
  return { status: "ready" as const, planned, receipt: result.receipt, run };
}

export async function readAssertionsList(cwd: string, locator: string) {
  const [doc] = await showJsonDocuments(cwd, [locator, "assertions"]);
  const res = narrowInspectionSuccess(doc!, "attempt.assertions");
  if (!res.success) throw new Error(res.reason);
  return res.value.assertions.map((item) => {
    if (!("entry" in item) || !("display" in item)) {
      throw new Error(`Expected assertion item with entry, got ${JSON.stringify(item)}`);
    }
    return item;
  });
}

export async function readFullAssertionEntry(cwd: string, locator: string, entryId: string, recordPath?: string) {
  let detail = await readAssertionDetail(cwd, locator, entryId, recordPath);
  if ("fields" in detail.assertion) {
    const assertion: Record<string, unknown> = {};
    const pending = new Map<string, { chunks: Buffer[]; nextOffset: number }>();
    while ("fields" in detail.assertion) {
      const page = detail.assertion;
      for (const part of page.fields) {
        const field = pending.get(part.path) ?? { chunks: [], nextOffset: 0 };
        const bytes = Buffer.from(part.base64, "base64");
        const end = part.offset + bytes.byteLength;
        if (
          part.offset !== field.nextOffset ||
          end > part.byteLength ||
          part.nextOffset !== (end === part.byteLength ? null : end)
        ) {
          throw new Error(`Invalid assertion page range for ${part.path}`);
        }
        field.chunks.push(bytes);
        if (part.nextOffset !== null) {
          field.nextOffset = part.nextOffset;
          pending.set(part.path, field);
          continue;
        }
        pending.delete(part.path);
        const value = Buffer.concat(field.chunks);
        restoreAssertionField(
          assertion,
          part.path,
          part.encoding === "content-base64" ? value.toString("base64") : JSON.parse(value.toString("utf8")),
        );
      }
      if (page.continuation === undefined) break;
      detail = await readAssertionDetail(cwd, locator, entryId, recordPath, page.continuation);
    }
    if (pending.size !== 0 || !("fields" in detail.assertion)) {
      throw new Error(`Incomplete assertion detail for ${entryId}`);
    }
    const decoded = decodeInspectionDocument({ ...detail, assertion });
    if (!decoded.success) throw new Error(decoded.reason);
    const full = narrowInspectionSuccess(decoded.value, "attempt.assertion.detail");
    if (!full.success) throw new Error(full.reason);
    detail = full.value;
  }
  if (!("entry" in detail.assertion) || !("criterion" in detail.assertion.entry)) {
    throw new Error(`Expected full assertion entry for ${entryId}`);
  }
  return { detail, entry: detail.assertion.entry };
}

function restoreAssertionField(assertion: Record<string, unknown>, path: string, value: unknown) {
  const keys = path
    .split("/")
    .slice(1)
    .map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
  let parent: object = assertion;
  for (const [index, key] of keys.entries()) {
    const nextKey = keys[index + 1];
    if (nextKey === undefined) {
      Object.defineProperty(parent, key, { value, enumerable: true });
    } else {
      if (!Object.hasOwn(parent, key)) {
        Object.defineProperty(parent, key, { value: /^\d+$/u.test(nextKey) ? [] : {}, enumerable: true });
      }
      parent = Reflect.get(parent, key);
    }
  }
}

export async function invokeCli(cwd: string, argv: readonly string[], env: Readonly<Record<string, string>> = {}) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const chunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
  const code = await runCliInProcess({
    argv: [...argv],
    cwd,
    env: { NO_COLOR: "1", ...env },
    stdin: Readable.from([]),
    stdout,
    stderr,
  });
  stdout.end();
  stderr.end();
  await Promise.all([finished(stdout), finished(stderr)]);
  return {
    code,
    stdout: Buffer.concat(chunks).toString("utf8"),
    stderr: Buffer.concat(errChunks).toString("utf8"),
  };
}

export async function showJsonDocuments(
  cwd: string,
  argv: readonly string[],
  env: Readonly<Record<string, string>> = {},
) {
  const res = await invokeCli(cwd, ["show", ...argv, "--json"], env);
  if (res.code !== 0) {
    throw new Error(`show ${argv.join(" ")} failed (${res.code}): ${res.stderr}\n${res.stdout}`);
  }
  return res.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const decoded = decodeInspectionDocument(JSON.parse(line));
      if (!decoded.success) throw new Error(decoded.reason);
      return decoded.value;
    });
}

export async function readAssertionDetail(
  cwd: string,
  locator: string,
  entryId: string,
  recordPath?: string,
  continuation?: string,
) {
  const args = [
    locator,
    entryId,
    "--full",
    ...(recordPath ? ["--record", recordPath] : []),
    ...(continuation === undefined ? [] : ["--continuation", continuation]),
  ];
  const [doc] = await showJsonDocuments(cwd, args);
  const detail = narrowInspectionSuccess(doc!, "attempt.assertion.detail");
  if (!detail.success) throw new Error(detail.reason);
  return detail.value;
}

export async function readPaginatedTrace(cwd: string, locator: string, targetId: string, recordPath?: string) {
  const chunks: Buffer[] = [];
  let offset = 0;
  let continuation: string | undefined;
  let expectedSha256: string | undefined;
  let expectedLength: number | undefined;
  for (;;) {
    const args = [
      locator,
      targetId,
      ...(continuation === undefined ? [] : ["--continuation", continuation]),
      ...(recordPath ? ["--record", recordPath] : []),
    ];
    const [doc] = await showJsonDocuments(cwd, args);
    const detail = narrowInspectionSuccess(doc!, "attempt.trace.detail");
    if (!detail.success) throw new Error(detail.reason);
    const page = detail.value.detail;
    if (page.kind !== "execution-evidence") throw new Error(`Expected execution-evidence page, got ${page.kind}`);
    expectedSha256 ??= page.targetSha256;
    expectedLength ??= page.targetByteLength;
    if (page.offset !== offset) throw new Error(`Offset mismatch: expected ${offset}, got ${page.offset}`);
    if (page.targetSha256 !== expectedSha256 || page.targetByteLength !== expectedLength) {
      throw new Error("Target digest or length changed across pagination");
    }
    const chunk = Buffer.from(page.base64, "base64");
    chunks.push(chunk);
    offset += chunk.byteLength;
    const next = detail.value.links.find((link) => link.rel === "next-page");
    if (page.nextOffset === null) break;
    const match = next?.command.match(/--continuation ([^ ]+)/u)?.[1];
    if (match === undefined || match === continuation) throw new Error("Invalid pagination continuation link");
    continuation = match;
  }
  return {
    bytes: Buffer.concat(chunks),
    sha256: expectedSha256!,
    byteLength: expectedLength!,
  };
}

export async function readPaginatedImage(
  cwd: string,
  locator: string,
  entryId: string,
  imageId: string,
  recordPath?: string,
) {
  const outDir = await mkdtemp(join(tmpdir(), "niceeval-img-out-"));
  const outPath = join(outDir, "recovered.bin");
  try {
    const res = await invokeCli(cwd, [
      "show",
      locator,
      entryId,
      "image",
      imageId,
      "--output",
      outPath,
      ...(recordPath ? ["--record", recordPath] : []),
    ]);
    if (res.code !== 0) {
      throw new Error(`show image failed (${res.code}): ${res.stderr}\n${res.stdout}`);
    }
    const bytes = await readFile(outPath);
    return { bytes };
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

export async function startJudgeEmulator<State extends object>(
  name: string,
  state: () => State,
  setup: (context: EmulatorContext<State>) => void,
) {
  const service = defineEmulator({ name, state, setup });
  const emulator = await createEmulator({ service, port: 0 });
  return {
    baseUrl: `${emulator.url}/v1`,
    url: emulator.url,
    close: () => emulator.close(),
  };
}

export async function startHttpServer(
  handler: (req: IncomingMessage, body: string, res: ServerResponse) => void | Promise<void>,
) {
  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      void Promise.resolve(handler(req, body, res)).catch((error) => {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(String(error));
        }
      });
    });
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing HTTP address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    port: address.port,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

/** Valid minimal PNG image bytes (1x1 RGBA) plus optional padding in an ancillary tEXt chunk. */
export function validPngBytes(extraPayloadBytes = 0): Uint8Array {
  // Valid 1x1 PNG header + IHDR + IDAT + IEND
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr = [
    0, 0, 0, 13, 73, 72, 68, 82, // length 13, IHDR
    0, 0, 0, 1, // width 1
    0, 0, 0, 1, // height 1
    8, 6, 0, 0, 0, // 8-bit RGBA
    0x1f, 0x15, 0xc4, 0x89, // CRC
  ];
  const idat = [
    0, 0, 0, 10, 73, 68, 65, 84, // length 10, IDAT
    0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
    0x0d, 0x0a, 0x2d, 0xb4, // CRC
  ];
  const iend = [0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82];
  if (extraPayloadBytes <= 0) {
    return new Uint8Array([...signature, ...ihdr, ...idat, ...iend]);
  }
  const len = extraPayloadBytes;
  const textChunk = new Uint8Array(12 + len);
  const view = new DataView(textChunk.buffer);
  view.setUint32(0, len);
  textChunk.set([116, 69, 88, 116], 4); // tEXt
  textChunk.fill(65, 8, 8 + len); // 'A'
  return new Uint8Array([...signature, ...ihdr, ...textChunk, ...idat, ...iend]);
}

export function chatToolResponse(toolName: string, args: unknown, model = "fixture-model", usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }) {
  return JSON.stringify({
    id: "judge-resp-1",
    object: "chat.completion",
    created: 0,
    model,
    usage,
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: toolName, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  });
}
