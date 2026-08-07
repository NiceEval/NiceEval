import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

// owned backend：实验级 setup 启动的宿主机服务。info 文件是 Repo 自有 fixture 收据，
// 不是 NiceEval 的私有结果布局。
const infoPath = process.argv[2];
if (!infoPath) {
  throw new Error("用法: node fixtures/backend.mjs <info-path>");
}

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("backend 没有监听地址");
  }
  writeFileSync(infoPath, JSON.stringify({ pid: process.pid, port: address.port }), "utf8");
});
