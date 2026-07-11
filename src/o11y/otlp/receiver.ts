// 本机 OTLP/HTTP traces 接收器:每个沙箱起一个,容器里的 agent 把 OTLP 导出到它。
// 监听 0.0.0.0 的临时端口(容器经 host.docker.internal 回连宿主),收到的 span 攒着,
// 跑完由运行器一次性 collect 挂到 EvalResult.trace。只认 POST .../v1/traces。

import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import type { TraceSpan } from "../../types.ts";
import { parseOtlpTraces } from "./parse.ts";
import { t } from "../../i18n/index.ts";

export interface TraceReceiver {
  /** agent 应导出到的完整端点(host 由 provider 定:docker → host.docker.internal)。 */
  endpoint(host: string): string;
  /** 目前为止收到并解析出的全部 span(副本)。 */
  collect(): TraceSpan[];
  /** 给在途的最后一批导出留点落地时间(无新 span 持续 quietMs 即返回,至多 maxMs)。 */
  settle(quietMs: number, maxMs: number): Promise<void>;
  close(): Promise<void>;
}

/**
 * 创建 OTLP 接收器,并把 close() 注册为 Scope 回收动作(免端口泄漏)。
 * 在 Effect.scoped / Effect.gen 里 yield* 即可。
 */
export function createTraceReceiver() {
  return Effect.acquireRelease(
    Effect.promise(() => makeTraceReceiver()),
    (r) => Effect.promise(() => r.close().catch(() => {})),
  );
}

/**
 * 直接创建接收器(非 Effect 场景:run 级共享池自己管生命周期)。
 * port=0 挑临时端口;固定端口模式(config telemetry.port / NICEEVAL_OTLP_PORT)传定值。
 */
export async function makeTraceReceiver(port = 0): Promise<TraceReceiver> {
  return makeReceiver(port);
}

async function makeReceiver(port = 0): Promise<TraceReceiver> {
  const spans: TraceSpan[] = [];
  let lastAt = 0;

  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const ct = req.headers["content-type"] ?? "";
      try {
        let body = Buffer.concat(chunks);
        // OTLP 导出端可能 gzip(OTEL_EXPORTER_OTLP_COMPRESSION 或默认开)。按 header 或 gzip 魔数解压。
        const ce = String(req.headers["content-encoding"] ?? "");
        if (ce.includes("gzip") || (body[0] === 0x1f && body[1] === 0x8b)) {
          try {
            body = gunzipSync(body);
          } catch {
            // 不是合法 gzip 就按原样试
          }
        }
        const parsed = parseOtlpTraces(body, ct);
        if (parsed.length) {
          spans.push(...parsed);
          lastAt = Date.now();
        }
      } catch {
        // 解析失败不回 5xx,免得导出端重试刷屏。
      }
      // OTLP 成功响应:空 ExportTraceServiceResponse(JSON {} / protobuf 空 body)。
      if (ct.includes("json")) {
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      } else {
        res.writeHead(200, { "content-type": "application/x-protobuf" }).end(Buffer.alloc(0));
      }
    });
    req.on("error", () => res.writeHead(400).end());
  });

  const boundPort = await new Promise<number>((resolve, reject) => {
    server.once("error", (err) => {
      // 固定端口模式(defineConfig({ telemetry: { port } }))下最常见的失败:翻成可操作的
      // 提示而不是裸 EADDRINUSE 栈——用户不知道这是 OTLP 接收器占端口失败,还以为是别的 bug。
      if (port !== 0 && (err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        reject(new Error(t("otel.portInUse", { port })));
      } else {
        reject(err);
      }
    });
    // 0.0.0.0:容器经 host-gateway / host.docker.internal 回连宿主,不能只听 127.0.0.1。
    server.listen(port, "0.0.0.0", () => {
      const a = server.address();
      resolve(typeof a === "object" && a ? a.port : 0);
    });
  });

  return {
    endpoint: (host) => `http://${host}:${boundPort}/v1/traces`,
    collect: () => spans.slice(),
    async settle(quietMs, maxMs) {
      // 等到「收到过 span 且静默 quietMs」或「整体超 maxMs」。还没收到任何 span 时
      // 也一直等到 maxMs —— 最后一批导出可能正在途中(进程刚退、POST 还没到)。
      const deadline = Date.now() + maxMs;
      for (;;) {
        if (Date.now() >= deadline) return;
        if (lastAt !== 0 && Date.now() - lastAt >= quietMs) return;
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
