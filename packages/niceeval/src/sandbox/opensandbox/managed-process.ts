import type { Sandbox as RemoteSandbox } from "@alibaba-group/opensandbox";
import { Schema } from "effect";
import { StringDecoder } from "node:string_decoder";
import WebSocket, { type RawData } from "ws";
import { ManagedProcessOutput } from "../managed-process.ts";
import type { ManagedProcess, ManagedProcessExit, ManagedProcessStart } from "../types.ts";
import { shellQuote } from "../shell.ts";
import { OPEN_SANDBOX_PROCESS_BRIDGE } from "./process-bridge.ts";

const BridgeFrame = Schema.Union([
  Schema.Struct({ type: Schema.Literal("ready") }),
  Schema.Struct({ type: Schema.Literals(["stdout", "stderr"]), data: Schema.String }),
  Schema.Struct({ type: Schema.Literal("ack"), id: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("exit"),
    exitCode: Schema.NullOr(Schema.Number),
    signal: Schema.optionalKey(Schema.String),
  }),
]);
const decodeBridgeFrame = Schema.decodeUnknownSync(BridgeFrame);
const decodeSession = Schema.decodeUnknownSync(Schema.Struct({ session_id: Schema.String }));
const decodeServerFrame = Schema.decodeUnknownSync(
  Schema.Union([
    Schema.Struct({ type: Schema.Literal("connected") }),
    Schema.Struct({ type: Schema.Literal("exit"), exit_code: Schema.Number }),
    Schema.Struct({ type: Schema.Literal("pong") }),
    Schema.Struct({ type: Schema.Literal("error"), error: Schema.optionalKey(Schema.String) }),
  ]),
);

function rawBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? Buffer.from(data) : data;
}

function receipt<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export async function startOpenSandboxProcess(input: {
  readonly remote: RemoteSandbox;
  readonly process: ManagedProcessStart;
  readonly uid?: number;
  readonly gid?: number;
  readonly retire: () => Promise<void>;
}): Promise<ManagedProcess> {
  const { remote } = input;
  const endpoint = await remote.getEndpoint(44772);
  const base = new URL(`${remote.connectionConfig.protocol}://${endpoint.endpoint}`);
  if (base.origin !== new URL(remote.connectionConfig.getBaseUrl()).origin) {
    throw new Error("OpenSandbox managed process requires a same-origin server proxy endpoint");
  }
  const headers = { ...remote.connectionConfig.headers, ...endpoint.headers };
  const config = Buffer.from(
    JSON.stringify({
      argv: input.process.argv,
      cwd: input.process.cwd,
      env: input.process.env,
      uid: input.uid,
      gid: input.gid,
    }),
  ).toString("base64");
  const response = await remote.connectionConfig.fetch(`${base.href}/pty`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      cwd: input.process.cwd,
      command: `exec node -e ${shellQuote(OPEN_SANDBOX_PROCESS_BRIDGE)} ${shellQuote(config)}`,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OpenSandbox process session creation failed (${response.status})`);
  const session = decodeSession(await response.json());
  const sessionUrl = `${base.href}/pty/${encodeURIComponent(session.session_id)}`;
  const wsUrl = new URL(`${sessionUrl}/ws?pty=0`);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(wsUrl, { headers, handshakeTimeout: 30_000, maxPayload: 16 * 1024 * 1024 });
  const output = new ManagedProcessOutput();
  const ready = receipt<void>();
  const done = receipt<ManagedProcessExit>();
  // The adapter may consume output before awaiting wait().
  void done.promise.catch(() => undefined);
  let result: ManagedProcessExit | undefined;
  let settled = false;
  let failing: Promise<void> | undefined;
  let prefix = "";
  const decoder = new StringDecoder("utf8");
  let sequence = 0;
  let stdinClosed = false;
  let closeReceipt: Promise<void> | undefined;
  let termination: Promise<void> | undefined;
  const acknowledgements = new Map<number, ReturnType<typeof receipt<void>>>();
  const deleteSession = async (): Promise<void> => {
    const response = await remote.connectionConfig.fetch(sessionUrl, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok && response.status !== 404)
      throw new Error(`OpenSandbox process session cleanup failed (${response.status})`);
  };
  const fail = (cause: Error): Promise<void> =>
    (failing ??= (async () => {
      if (settled) return;
      let failure = cause;
      try {
        await input.retire();
      } catch (cleanup) {
        failure = new AggregateError([cause, cleanup], "OpenSandbox process failed and sandbox retirement failed");
      }
      settled = true;
      clearTimeout(startupTimer);
      socket.terminate();
      output.end();
      for (const ack of acknowledgements.values()) ack.reject(failure);
      acknowledgements.clear();
      ready.reject(failure);
      done.reject(failure);
    })());
  const startupTimer = setTimeout(() => {
    void fail(new Error("OpenSandbox managed process did not become ready; the image must provide Node.js 24"));
  }, 30_000);
  socket.on("error", (cause) => {
    void fail(cause);
  });
  socket.on("close", () => {
    if (!settled) void fail(new Error("OpenSandbox process transport closed without a confirmed exit"));
  });
  socket.on("message", (data, binary) => {
    if (settled || failing !== undefined) return;
    try {
      const bytes = rawBuffer(data);
      if (!binary) {
        const frame = decodeServerFrame(JSON.parse(bytes.toString("utf8")));
        if (frame.type === "error") throw new Error(frame.error ?? "OpenSandbox process transport failed");
        if (frame.type === "exit") {
          if (result === undefined || frame.exit_code !== 0 || prefix.length !== 0)
            throw new Error("OpenSandbox process bridge ended without a complete terminal receipt");
          const terminal = result;
          // Mark the normal transport close before awaiting HTTP cleanup.
          settled = true;
          clearTimeout(startupTimer);
          output.end();
          void deleteSession().then(
            () => done.resolve(terminal),
            async (cause: unknown) => {
              try {
                await input.retire();
              } catch (cleanup) {
                done.reject(new AggregateError([cause, cleanup], "OpenSandbox process cleanup failed"));
                return;
              }
              done.reject(cause);
            },
          );
          for (const ack of acknowledgements.values())
            ack.reject(new Error("OpenSandbox process exited before acknowledging stdin"));
          acknowledgements.clear();
        }
        return;
      }
      if (bytes[0] === 2)
        throw new Error(
          "OpenSandbox process bridge failed; the image must provide Node.js 24 and permit the configured execution identity",
        );
      if (bytes[0] !== 1 && bytes[0] !== 3)
        throw new Error("OpenSandbox process transport returned an unexpected channel");
      if (bytes[0] === 3 && bytes.length < 9) throw new Error("OpenSandbox process replay frame is incomplete");
      prefix += decoder.write(bytes.subarray(bytes[0] === 3 ? 9 : 1));
      if (prefix.length > 16 * 1024 * 1024) throw new Error("OpenSandbox process bridge frame exceeded the size limit");
      let newline: number;
      while ((newline = prefix.indexOf("\n")) >= 0) {
        const line = prefix.slice(0, newline);
        prefix = prefix.slice(newline + 1);
        const frame = decodeBridgeFrame(JSON.parse(line));
        switch (frame.type) {
          case "ready":
            clearTimeout(startupTimer);
            ready.resolve();
            break;
          case "stdout":
            output.push({ _tag: "Stdout", bytes: Buffer.from(frame.data, "base64") });
            break;
          case "stderr":
            output.push({ _tag: "Stderr", bytes: Buffer.from(frame.data, "base64") });
            break;
          case "ack":
            acknowledgements.get(frame.id)?.resolve();
            acknowledgements.delete(frame.id);
            break;
          case "error":
            throw new Error(`OpenSandbox managed process failed: ${frame.message}`);
          case "exit":
            result = { exitCode: frame.exitCode, ...(frame.signal === undefined ? {} : { signal: frame.signal }) };
            break;
        }
      }
    } catch (cause) {
      void fail(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
  await ready.promise;
  const send = (frame: object): Promise<void> =>
    new Promise((resolve, reject) => {
      if (settled || socket.readyState !== WebSocket.OPEN) {
        reject(new Error("OpenSandbox process is closed"));
        return;
      }
      socket.send(Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify(frame) + "\n")]), (error) => {
        if (error) {
          void fail(error);
          reject(error);
        } else resolve();
      });
    });
  const request = async (frame: { readonly type: "write" | "eof"; readonly data?: string }): Promise<void> => {
    const id = ++sequence;
    const ack = receipt<void>();
    acknowledgements.set(id, ack);
    void ack.promise.catch(() => undefined);
    await send({ ...frame, id });
    await ack.promise;
  };
  return {
    output,
    writeStdin: (bytes) =>
      stdinClosed
        ? Promise.reject(new Error("OpenSandbox process stdin is closed"))
        : request({ type: "write", data: Buffer.from(bytes).toString("base64") }),
    closeStdin: () =>
      (closeReceipt ??= (async () => {
        stdinClosed = true;
        await request({ type: "eof" });
      })()),
    wait: () => done.promise,
    terminate: () =>
      (termination ??= (async () => {
        stdinClosed = true;
        if (settled) {
          await done.promise;
          return;
        }
        const timer = setTimeout(() => {
          void fail(new Error("OpenSandbox managed process termination was not confirmed"));
        }, 10_000);
        try {
          await send({ type: "terminate" });
          await done.promise;
        } finally {
          clearTimeout(timer);
        }
      })()),
  };
}
