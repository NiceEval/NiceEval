// 在沙箱内部起一个轻量 OTLP/HTTP 接收器,供 e2b / vercel 等远程沙箱使用。
// 流程:
//   1. writeFiles 把 collector 脚本上传到沙箱
//   2. runShell 在后台启动它(node ... & echo $!),拿 PID
//   3. agent 往 http://127.0.0.1:4318/v1/traces 发 span(sandbox 内 localhost)
//   4. settle() 等 agent 退出后下载 spans 文件并解析,缓存到内存
//   5. collect() 返回缓存(同步,与本地 receiver 接口一致)
//   6. close() 尝试 kill PID(沙箱本身也会停,所以 best-effort)

import { Effect } from "effect";
import type { TraceSpan } from "../../types.ts";
import type { Sandbox } from "../../types.ts";
import type { TraceReceiver } from "./receiver.ts";
import { parseOtlpTraces } from "./parse.ts";

const COLLECTOR_PORT = 4318;
const COLLECTOR_PATH = "/tmp/.fasteval-otlp-collector.cjs";
const SPANS_PATH = "/tmp/.fasteval-otlp-spans.jsonl";

// collector 脚本:纯 Node.js CJS,无外部依赖。
// 每收一个 OTLP/HTTP 请求就把 { ct, body(base64) } 追加写一行到 SPANS_PATH,
// 同时处理 gzip 解压——这样 host 侧直接复用 parseOtlpTraces 解析。
const COLLECTOR_SCRIPT = /* js */ `
'use strict';
const http = require('http');
const fs   = require('fs');
const zlib = require('zlib');
const OUT  = ${JSON.stringify(SPANS_PATH)};
const server = http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(405).end(); return; }
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    let body = Buffer.concat(chunks);
    const ct = req.headers['content-type'] || '';
    const ce = req.headers['content-encoding'] || '';
    if (ce.includes('gzip') || (body[0] === 0x1f && body[1] === 0x8b)) {
      try { body = zlib.gunzipSync(body); } catch {}
    }
    try { fs.appendFileSync(OUT, JSON.stringify({ ct, b: body.toString('base64') }) + '\\n'); } catch {}
    if (ct.includes('json')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    } else {
      res.writeHead(200, { 'content-type': 'application/x-protobuf' }).end(Buffer.alloc(0));
    }
  });
  req.on('error', () => res.writeHead(400).end());
});
server.listen(${COLLECTOR_PORT}, '127.0.0.1');
`;

export function createInSandboxTraceReceiver(sandbox: Sandbox) {
  return Effect.acquireRelease(
    Effect.promise(() => makeInSandboxReceiver(sandbox)),
    (r) => Effect.promise(() => r.close().catch(() => {})),
  );
}

async function makeInSandboxReceiver(sandbox: Sandbox): Promise<TraceReceiver> {
  let cached: TraceSpan[] = [];

  // 上传 collector 脚本
  await sandbox.writeFiles({ [COLLECTOR_PATH]: COLLECTOR_SCRIPT });

  // 后台启动,拿 PID(shell 的 & 返回后台 PID;echo $! 给我们)
  const startResult = await sandbox.runShell(
    `node ${COLLECTOR_PATH} >/tmp/.fasteval-otlp-collector.log 2>&1 & echo $!`,
  );
  const pid = parseInt(startResult.stdout.trim(), 10);

  return {
    endpoint: (_host) => `http://127.0.0.1:${COLLECTOR_PORT}/v1/traces`,

    collect: () => cached.slice(),

    // agent 结束后调:等片刻(让 OTEL exporter 把最后几个 batch flush 完),再下载解析。
    async settle(quietMs, maxMs) {
      const wait = Math.min(quietMs + 300, maxMs);
      await new Promise((r) => setTimeout(r, wait));
      try {
        const raw = await sandbox.downloadFile(SPANS_PATH);
        cached = parseSpansFile(raw);
      } catch {
        // 没有 spans 文件(agent 没发任何 trace)→ 保留空数组
      }
    },

    async close() {
      if (Number.isFinite(pid) && pid > 0) {
        // best-effort:沙箱停止时进程也会消失,这里只是提前清理
        await sandbox.runShell(`kill ${pid} 2>/dev/null || true`).catch(() => {});
      }
    },
  };
}

// SPANS_PATH 每行一个 { ct: string; b: string(base64) }
function parseSpansFile(raw: Buffer): TraceSpan[] {
  const spans: TraceSpan[] = [];
  const text = raw.toString("utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const { ct, b } = JSON.parse(trimmed) as { ct: string; b: string };
      const body = Buffer.from(b, "base64");
      spans.push(...parseOtlpTraces(body, ct));
    } catch {
      // 跳过损坏行
    }
  }
  return spans;
}
