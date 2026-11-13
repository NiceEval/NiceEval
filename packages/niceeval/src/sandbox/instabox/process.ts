import { randomUUID } from "node:crypto";
import type { Client, ClientChannel } from "ssh2";
import { ManagedProcessOutput } from "../managed-process.ts";
import type { ManagedProcess, ManagedProcessExit, ManagedProcessStart } from "../types.ts";
import { shellQuote } from "../shell.ts";
import type { SSHToken } from "./api.ts";
import { InstaboxConnection, InstaboxReconnectExhausted } from "./connection.ts";
import { spoolReader, spoolSupervisor } from "./spool.ts";
import type { DiagnosticInput } from "../../types.ts";
import { Schema } from "effect";

const decodeStdinReceipt = Schema.decodeUnknownSync(Schema.Struct({
  id: Schema.optionalKey(Schema.Number),
  offset: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  eof: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
}));

export async function startInstaboxProcess(input: {
  readonly token: SSHToken;
  readonly connection: InstaboxConnection;
  readonly process: ManagedProcessStart;
  readonly pathPrepend: readonly string[];
  readonly root: boolean;
  readonly retire: (cause?: Error) => Promise<void>;
  readonly diagnostic: (input: DiagnosticInput) => void;
}): Promise<ManagedProcess> {
  const output = new ManagedProcessOutput();
  const startedAt = performance.now();
  const spool = `/tmp/niceeval-process-${randomUUID()}`;
  let stdoutBytes = 0, stderrBytes = 0;
  const initialReconnects = input.connection.reconnectAttempts;
  let terminal = false, stdinClosed = false, stdinClosing: Promise<void> | undefined;
  let channel: ClientChannel | undefined;
  let lastAttachedClient: Client | undefined;
  let detach: (() => void) | undefined;
  let reconnecting: Promise<void> | undefined;
  let queuedRecovery: { reason: unknown; client: Client } | undefined;
  let originalReason: unknown;
  let failure: Promise<void> | undefined;
  let sequence = 0;
  let stdinOffset = 0, confirmedStdinOffset = 0, readyForInput = false;
  type Pending = { readonly eof: boolean; readonly offset: number; readonly bytes: Buffer; readonly resolve: () => void; readonly reject: (cause: unknown) => void };
  const pending = new Map<number, Pending>();
  let resolveDone!: (exit: ManagedProcessExit) => void;
  let rejectDone!: (cause: unknown) => void;
  const done = new Promise<ManagedProcessExit>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  void done.catch(() => undefined);
  const detail = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason)).replaceAll(input.token.token, "[REDACTED]");
  const counters = () => ({ reconnectAttempts: input.connection.reconnectAttempts - initialReconnects, elapsedMs: Math.round(performance.now() - startedAt), stdoutBytes, stderrBytes });
  const closeChannel = () => { readyForInput = false; detach?.(); detach = undefined; channel?.destroy(); channel = undefined; };
  const rejectPending = (cause: unknown) => { for (const item of pending.values()) item.reject(cause); pending.clear(); };
  const fail = (reason: unknown): Promise<void> => failure ??= (async () => {
    if (terminal) return;
    terminal = true;
    closeChannel();
    const stats = counters();
    let cause: Error = new Error(`Instabox SSH process lost its confirmed exit; retiring the Machine; reason=${detail(originalReason ?? reason)}; recovery=${detail(reason)}; reconnectAttempts=${stats.reconnectAttempts}; elapsedMs=${stats.elapsedMs}; stdoutBytes=${stdoutBytes}; stderrBytes=${stderrBytes}`);
    try { await input.retire(cause); }
    catch (cleanup) { cause = new AggregateError([cause, cleanup], `${cause.message}; Machine cleanup failed: ${detail(cleanup)}`); }
    output.end(); rejectPending(cause); rejectDone(cause);
  })();

  const recover = (reason: unknown, client: Client): void => {
    if (terminal) return;
    if (reconnecting) { queuedRecovery = { reason, client }; return; }
    originalReason ??= reason;
    const recoveryDeadline = performance.now() + 60_000;
    const initialAttempts = input.connection.reconnectAttempts;
    closeChannel();
    reconnecting = (async () => {
      let lastReason = reason;
      let failedClient = client;
      while (!terminal && input.connection.reconnectAttempts - initialAttempts < 3 && performance.now() < recoveryDeadline) {
        try {
          const connected = await input.connection.reconnect(failedClient, recoveryDeadline, 3 - (input.connection.reconnectAttempts - initialAttempts));
          failedClient = connected;
          await attach(false, Math.max(1, recoveryDeadline - performance.now()), connected);
          // A short-lived target may already have exited while disconnected.
          input.diagnostic({ code: "sandbox-transport-reconnected", level: "warning",
            message: `Instabox SSH transport reconnected: ${detail(originalReason)}`,
            data: { reason: detail(originalReason), ...counters() },
          });
          return;
        } catch (error) {
          lastReason = error;
          if (error instanceof InstaboxReconnectExhausted) break;
        }
      }
      if (!terminal) await fail(lastReason);
    })().finally(() => {
      reconnecting = undefined;
      const queued = queuedRecovery; queuedRecovery = undefined;
      originalReason = undefined;
      if (queued && !terminal) recover(queued.reason, queued.client);
    });
    void reconnecting.catch(fail);
  };

  const confirmStdin = (receipt: ReturnType<typeof decodeStdinReceipt>): void => {
    if (receipt.offset > stdinOffset || receipt.offset < confirmedStdinOffset) {
      if (receipt.offset < confirmedStdinOffset && !receipt.error) return;
      throw new Error("Invalid Instabox stdin receipt offset");
    }
    confirmedStdinOffset = receipt.offset;
    if (receipt.eof) stdinClosed = true;
    if (receipt.error && receipt.id !== undefined) {
      pending.get(receipt.id)?.reject(new Error(detail(receipt.error)));
      pending.delete(receipt.id);
    }
    for (const [id, item] of pending) {
      if (item.eof ? receipt.eof : item.offset + item.bytes.length <= receipt.offset) {
        pending.delete(id); item.resolve();
      }
    }
  };

  const send = (id: number, item: Pending): void => {
    if (!readyForInput || !channel) return;
    const current = channel;
    const offset = Math.max(item.offset, confirmedStdinOffset);
    current.write(JSON.stringify({ id, offset, kind: item.eof ? "eof" : "write",
      ...(!item.eof ? { bytes: item.bytes.subarray(offset - item.offset).toString("base64") } : {}),
    }) + "\n", (error?: Error | null) => {
      if (error && channel === current) current.emit("error", error);
    });
  };

  const attach = async (initial: boolean, timeoutMs = 30_000, connected?: Client): Promise<void> => {
    let attachedClient: Client | undefined;
    let rejectAttach!: (cause: unknown) => void;
    let attached = false, active = true;
    const fault = (reason: unknown) => {
      if (terminal || !active) return;
      if (!attached) { rejectAttach(reason); return; }
      if (attachedClient) recover(reason, attachedClient);
    };
    const attempt = new Promise<void>((resolve, reject) => {
      rejectAttach = reject;
      void (connected ? Promise.resolve(connected) : input.connection.get()).then(client => {
        attachedClient = client;
        lastAttachedClient = client;
        if (!active || terminal) { reject(new Error("Instabox process is already terminal")); return; }
        const onError = (error: Error) => fault(error);
        const onClose = () => fault(new Error("SSH connection closed by peer"));
        client.on("error", onError); client.on("close", onClose);
        detach = () => { active = false; client.removeListener("error", onError); client.removeListener("close", onClose); };
        const config = Buffer.from(JSON.stringify({ ...input.process, pathPrepend: input.pathPrepend, spool, initial,
          stdoutOffset: stdoutBytes, stderrOffset: stderrBytes, ...(initial ? { supervisor: spoolSupervisor } : {}),
        })).toString("base64");
        const command = `${input.root ? "sudo -n -- " : ""}node -e ${shellQuote(spoolReader)} ${shellQuote(config)}`;
        client.exec(command, { pty: false }, (error, opened) => {
          if (!active || terminal) { opened?.destroy(); return; }
          if (error) { fault(error); return; }
          channel = opened;
          let buffered: Buffer = Buffer.alloc(0);
          let readerError = "";
          opened.stderr.on("data", (bytes: Buffer) => { readerError = (readerError + bytes.toString("utf8")).slice(-2048); });
          opened.on("data", (bytes: Buffer) => {
            if (!active || terminal) return;
            buffered = buffered.length ? Buffer.concat([buffered, bytes]) : bytes;
            try {
              while (buffered.length >= 5) {
                const tag = buffered[0]!, size = buffered.readUInt32BE(1);
                if (size > 16 * 1024 * 1024) throw new Error("Invalid Instabox spool frame length");
                if (buffered.length < 5 + size) return;
                const payload = buffered.subarray(5, 5 + size);
                buffered = buffered.subarray(5 + size);
                if (tag === 1 || tag === 2) {
                  if (tag === 1) stdoutBytes += size; else stderrBytes += size;
                  output.push({ _tag: tag === 1 ? "Stdout" : "Stderr", bytes: payload });
                } else if (tag === 3) {
                  confirmStdin(decodeStdinReceipt(JSON.parse(payload.toString("utf8"))));
                  attached = true; readyForInput = true;
                  for (const [id, item] of pending) send(id, item);
                  resolve();
                }
                else if (tag === 4) {
                  confirmStdin(decodeStdinReceipt(JSON.parse(payload.toString("utf8"))));
                } else if (tag === 5) {
                  const exit = JSON.parse(payload.toString("utf8")) as ManagedProcessExit & { stdoutSize: number; stderrSize: number };
                  if ((exit.exitCode !== null && !Number.isInteger(exit.exitCode)) || stdoutBytes !== exit.stdoutSize || stderrBytes !== exit.stderrSize) throw new Error("Incomplete Instabox spool exit");
                  terminal = true;
                  for (const item of pending.values()) { if (item.eof) item.resolve(); else item.reject(new Error("Instabox process exited before stdin acknowledgement")); }
                  pending.clear(); closeChannel(); output.end(); resolveDone({ exitCode: exit.exitCode, ...(exit.signal ? { signal: exit.signal } : {}) });
                  return;
                } else if (tag === 6) {
                  const missing = JSON.parse(payload.toString("utf8")) as { reason: string };
                  reject(new Error(missing.reason)); void fail(missing.reason); return;
                } else throw new Error("Invalid Instabox spool frame type");
              }
            } catch (error) { fault(error); }
          });
          opened.on("error", (error: Error) => fault(error));
          opened.once("close", () => { if (active && !terminal) fault(new Error(readerError || "channel closed without a spool exit")); });
        });
      }, reject);
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([attempt, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("SSH spool attachment timed out")), Math.ceil(timeoutMs)); })]);
    } catch (error) {
      active = false; closeChannel();
      if (attachedClient) input.connection.invalidate(attachedClient);
      throw error;
    } finally { clearTimeout(timer); }
  };

  try { await attach(true); }
  catch (error) {
    // The SSH request may have started the supervisor before its ready frame
    // was lost. Recover that spool; never launch the target a second time.
    if (lastAttachedClient) {
      recover(error, lastAttachedClient);
      await reconnecting;
      if (terminal) await done;
    } else { await fail(error); await done; }
  }

  const write = (eof: boolean, bytes?: Uint8Array): Promise<void> => new Promise((resolve, reject) => {
    if (terminal) { if (eof) resolve(); else reject(new Error("Instabox process stdin is closed")); return; }
    if (stdinClosed || (!eof && stdinClosing)) { reject(new Error("Instabox process stdin is closed")); return; }
    const id = ++sequence;
    const item: Pending = { eof, offset: stdinOffset, bytes: Buffer.from(bytes ?? []), resolve, reject };
    stdinOffset += item.bytes.length;
    pending.set(id, item);
    send(id, item);
  });
  let termination: Promise<void> | undefined;
  return {
    output, writeStdin: bytes => write(false, bytes),
    closeStdin: () => stdinClosing ??= write(true),
    wait: () => done,
    terminate: () => termination ??= (async () => {
      if (terminal) { await done; return; }
      terminal = true; closeChannel();
      try { await input.retire(); rejectPending(new Error("Instabox process terminated")); resolveDone({ exitCode: null, signal: "SIGKILL" }); }
      catch (cause) { rejectPending(cause); rejectDone(cause); throw cause; }
      finally { output.end(); }
    })(),
  };
}
