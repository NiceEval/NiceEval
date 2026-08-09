import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const infoPath = process.argv[2];
if (!infoPath) throw new Error("usage: node fixtures/backend.mjs <info-path>");

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  response.writeHead(404).end();
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("backend has no address");
  writeFileSync(infoPath, JSON.stringify({ pid: process.pid, port: address.port }), "utf8");
});
