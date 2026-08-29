import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { ProcessHandle } from "@niceeval/testkit";

export interface LoopbackBackend {
  readonly endpoint: string;
  waitForAttempt(index: number): Promise<void>;
  completeAttempt(index: number): void;
  close(): Promise<void>;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

export async function createLoopbackBackend(): Promise<LoopbackBackend> {
  const arrivals = new Map([[0, deferred()], [1, deferred()]]);
  const responses = new Map<number, ServerResponse>();
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    request.resume();
    const match = request.method === "POST" ? /^\/attempt\/(0|1)$/u.exec(request.url ?? "") : null;
    if (match === null) return void response.writeHead(404).end();
    const index = Number(match[1]);
    if (responses.has(index)) return void response.writeHead(409).end();
    responses.set(index, response);
    response.once("close", () => { if (responses.get(index) === response) responses.delete(index); });
    arrivals.get(index)!.resolve();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    async waitForAttempt(index) {
      const arrival = arrivals.get(index);
      if (arrival === undefined) throw new Error(`Unexpected Attempt index ${index}`);
      await arrival.promise;
    },
    completeAttempt(index) {
      const response = responses.get(index);
      if (response === undefined) throw new Error(`Attempt ${index} has not reached the backend`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        status: "completed",
        events: [{ type: "message", role: "assistant", text: "run-journey-attempt-published" }],
      }));
    },
    async close() {
      for (const response of responses.values()) response.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
      });
    },
  };
}

export async function whileRunning<T>(action: Promise<T>, process: ProcessHandle, label: string): Promise<T> {
  return await Promise.race([
    action,
    process.done.then((receipt) => { throw new Error(`niceeval exp exited before ${label}\n${receipt.diagnostic()}`); }),
  ]);
}
