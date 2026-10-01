import { createServer } from "node:http";
import type { Socket } from "node:net";

// Only the external Chat Completions boundary is simulated. These responses do
// not implement collection, pricing, persistence, QA, or Inspection semantics.
export function judgeUsageChatResponse(usage: Readonly<Record<string, unknown>>, options: { invalidQA?: boolean; provider?: string } = {}) {
  return {
    id: "judge-usage-response", object: "chat.completion", created: 0, model: "judge-usage-served",
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    usage,
    choices: [{ index: 0, finish_reason: "tool_calls", message: {
      role: "assistant", content: null,
      tool_calls: [{ id: "judge-usage-tool", type: "function", function: {
        name: "record_score_match",
        arguments: options.invalidQA ? "{invalid-qa" : JSON.stringify({ choice: "satisfied", rationale: "The answer names Paris.", citations: ["answer-1"] }),
      } }],
    } }],
  };
}

export function judgeUsageHttp(responses: readonly { status: number; body: unknown }[]) {
  const requests: { method: string | undefined; path: string | undefined; body: string }[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body) > 32_768) request.destroy(new Error("Judge fixture request exceeds its cap"));
    });
    request.on("error", () => response.destroy());
    request.on("end", () => {
      const index = requests.length;
      requests.push({ method: request.method, path: request.url, body });
      const reply = responses[index];
      response.writeHead(reply?.status ?? 400, { "Content-Type": "application/json", "Retry-After": "0" });
      response.end(JSON.stringify(reply?.body ?? { error: { message: "Unexpected fixture request" } }));
    });
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  return {
    requests,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { server.close(); reject(new Error("Judge fixture listen deadline exceeded")); }, 1_000);
        server.once("error", fail);
        function fail(error: Error) { clearTimeout(timer); reject(error); }
        server.listen(0, "127.0.0.1", () => { clearTimeout(timer); server.off("error", fail); resolve(); });
      });
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Judge fixture has no loopback address");
      return `http://127.0.0.1:${address.port}/v1`;
    },
    async close() {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Judge fixture cleanup deadline exceeded")), 1_000);
          server.close((error) => { clearTimeout(timer); error === undefined ? resolve() : reject(error); });
          for (const socket of sockets) socket.destroy();
          server.closeAllConnections();
        });
      } else {
        for (const socket of sockets) socket.destroy();
      }
      return { listening: server.listening, openConnections: [...sockets].filter((socket) => !socket.destroyed).length };
    },
  };
}
