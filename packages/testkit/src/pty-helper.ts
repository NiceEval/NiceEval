import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";

type ControlMessage =
  | { readonly type: "status"; readonly phase: "configured"; readonly helperPid: number; readonly helperGroupId: number; readonly helperSessionId: number; readonly columns: number; readonly rows: number }
  | { readonly type: "status"; readonly phase: "candidate"; readonly pid: number; readonly processGroupId: number }
  | { readonly type: "status"; readonly phase: "exit"; readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }
  | { readonly type: "status"; readonly phase: "error"; readonly message: string };

interface InitMessage {
  readonly type: "init";
  readonly argv: readonly string[];
}

const MAX_ARGV_ITEMS = 256;
const MAX_ARGV_BYTES = 64 * 1024;

function procIdentity(pid: number): { readonly processGroupId: number; readonly sessionId: number } {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const end = stat.lastIndexOf(")");
  const fields = stat.slice(end + 2).trim().split(/\s+/);
  const processGroupId = Number(fields[2]);
  const sessionId = Number(fields[3]);
  if (!Number.isSafeInteger(processGroupId) || !Number.isSafeInteger(sessionId)) {
    throw new Error(`could not read process identity for ${pid}`);
  }
  return { processGroupId, sessionId };
}

async function send(socket: ReturnType<typeof createConnection>, message: ControlMessage): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(`${JSON.stringify(message)}\n`, (error) => error == null ? resolve() : reject(error));
  });
}

async function close(socket: ReturnType<typeof createConnection>): Promise<void> {
  await new Promise<void>((resolve) => {
    socket.end(resolve);
  });
}

function validArgv(value: unknown): readonly [string, ...string[]] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ARGV_ITEMS) {
    throw new Error("PTY init has an invalid argv length");
  }
  let bytes = 0;
  for (const item of value) {
    if (typeof item !== "string" || item.includes("\0")) throw new Error("PTY init argv must contain NUL-free strings");
    bytes += Buffer.byteLength(item, "utf8");
  }
  if (bytes > MAX_ARGV_BYTES) throw new Error("PTY init argv exceeds the byte limit");
  return value as [string, ...string[]];
}

async function receiveInit(socket: ReturnType<typeof createConnection>): Promise<readonly [string, ...string[]]> {
  return await new Promise((resolve, reject) => {
    let pending = "";
    socket.on("data", (chunk: string | Buffer) => {
      pending += chunk.toString();
      if (Buffer.byteLength(pending, "utf8") > MAX_ARGV_BYTES + 1024) {
        reject(new Error("PTY init frame exceeds the byte limit"));
        return;
      }
      const newline = pending.indexOf("\n");
      if (newline < 0) return;
      if (pending.slice(newline + 1).trim().length !== 0) {
        reject(new Error("PTY control accepts exactly one init frame"));
        return;
      }
      try {
        const message = JSON.parse(pending.slice(0, newline)) as Partial<InitMessage>;
        if (message.type !== "init" || !Object.hasOwn(message, "argv")) throw new Error("PTY control expected an init frame");
        resolve(validArgv(message.argv));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
    socket.once("end", () => reject(new Error("PTY control closed before init")));
  });
}

async function main(): Promise<void> {
  const [socketPath, columnsText, rowsText] = process.argv.slice(2);
  const columns = Number(columnsText);
  const rows = Number(rowsText);
  if (
    socketPath === undefined ||
    !Number.isSafeInteger(columns) || columns <= 0 ||
    !Number.isSafeInteger(rows) || rows <= 0
  ) {
    throw new Error("pty helper requires socket path and positive dimensions");
  }

  const socket = createConnection(socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  try {
    const configured = spawnSync("stty", ["cols", String(columns), "rows", String(rows)], {
      // stdin must remain the PTY; stdout/stderr would only pollute the raw
      // transcript when stty itself reports an error.
      stdio: ["inherit", "ignore", "ignore"],
    });
    if (configured.status !== 0 || configured.error !== undefined) {
      throw configured.error ?? new Error(`stty exited ${configured.status}`);
    }
    const helper = procIdentity(process.pid);
    await send(socket, {
      type: "status",
      phase: "configured",
      helperPid: process.pid,
      helperGroupId: helper.processGroupId,
      helperSessionId: helper.sessionId,
      columns,
      rows,
    });

    const argv = await receiveInit(socket);
    const candidate = spawn(argv[0], argv.slice(1), {
      detached: true,
      stdio: "inherit",
    });
    await new Promise<void>((resolve, reject) => {
      candidate.once("spawn", resolve);
      candidate.once("error", reject);
    });
    if (candidate.pid === undefined) throw new Error("candidate did not expose a PID");
    const candidateIdentity = procIdentity(candidate.pid);
    if (candidateIdentity.processGroupId !== candidate.pid) {
      throw new Error(`candidate ${candidate.pid} was not made its own process group`);
    }
    await send(socket, { type: "status", phase: "candidate", pid: candidate.pid, processGroupId: candidateIdentity.processGroupId });

    const exited = await new Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>((resolve) => {
      candidate.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });
    await send(socket, { type: "status", phase: "exit", ...exited });
    await close(socket);
    process.exitCode = exited.exitCode ?? 1;
  } catch (error) {
    await send(socket, { type: "status", phase: "error", message: error instanceof Error ? error.message : String(error) }).catch(() => {});
    await close(socket).catch(() => {});
    throw error;
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
