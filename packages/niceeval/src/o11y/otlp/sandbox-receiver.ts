// 在沙箱内部起一个轻量 OTLP/HTTP 接收器,供不承诺宿主回连的 provider 使用
// (Docker / e2b / vercel 等)。
// 流程:
//   1. writeText 把 collector 脚本上传到沙箱
//   2. runShell 在后台启动它(node ... & echo $!),拿 PID;collector 用内核分配端口
//      (listen 0)并把实际端口写回端口文件,host 轮询读回 —— 不写死 4318,沙箱里已有
//      服务占用端口时不会冲突
//   3. agent 往 http://127.0.0.1:<port>/v1/traces 发 span(sandbox 内 localhost)
//   4. settle() 轮询 spans 文件大小直到静默(而不是固定 sleep:等太久拖慢每个 eval,
//      等不够漏掉在途 batch),再下载解析,缓存到内存
//   5. collect() 返回缓存(同步,与本地 receiver 接口一致)
//   6. close() 尝试 kill PID(沙箱本身也会停,所以 best-effort)
//
// 文件路径带随机后缀:同一沙箱跨 eval 复用时,每个 receiver 实例的脚本 / spans /
// 端口文件互不串扰,collector 也不会读到上一个 eval 的 span。启动重试同样每轮换一套后缀
// (见 startCollector)。

import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { Sandbox, TraceSpan } from "../../types.ts";
import { t } from "../../i18n/index.ts";
import { parseOtlpTraces } from "./parse.ts";
import type { TraceReceiver } from "./receiver.ts";

// collector 脚本:纯 Node.js CJS,无外部依赖。
// 每收一个 OTLP/HTTP 请求就把 { ct, body(base64) } 追加写一行到 spans 文件,
// 同时处理 gzip 解压——这样 host 侧直接复用 parseOtlpTraces 解析。
function collectorScript(spansPath: string, portPath: string): string {
  return /* js */ `
'use strict';
const http = require('http');
const fs   = require('fs');
const zlib = require('zlib');
const OUT  = ${JSON.stringify(spansPath)};
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
server.listen(0, '127.0.0.1', () => {
  try { fs.writeFileSync(${JSON.stringify(portPath)}, String(server.address().port)); } catch {}
});
`;
}

// 端口等待预算。这条路径外面没有任何一层重试兜着——`runShell` 不进 `withSandboxIoRetry`
// (命令执行有不可重复副作用),`withProvisionRetry` 只覆盖沙箱 create,runner 也没有
// attempt 级重试:等不到端口就是一条 errored attempt,agent 一次都没跑
// (memory/insandbox-otlp-port-wait-3s-no-retry.md)。所以预算按冷沙箱首次起 node 的最坏
// 情况给,而不是按热沙箱的常见值给。
const PORT_WAIT_MS = 20_000;
// 启动整体的重试次数。慢不需要重试(一次等满预算就够),这里兜的是 collector 起来就死
// (镜像里没有 node、脚本被 OOM kill 等)——那种情况下沙箱侧循环会立刻 break,重试很便宜。
const START_ATTEMPTS = 2;

export function createInSandboxTraceReceiver(
  sandbox: Sandbox,
): Effect.Effect<TraceReceiver, unknown, import("effect/Scope").Scope> {
  return Effect.acquireRelease(
    makeInSandboxReceiver(sandbox),
    (receiver) => receiver.close,
  );
}

interface StartedCollector {
  pid: number;
  port: number;
  spansPath: string;
}

/** Provider SDK Promise boundary. Sandbox APIs do not currently accept AbortSignal. */
function sandboxPromise<Value>(operation: () => Promise<Value>): Effect.Effect<Value, unknown> {
  return Effect.tryPromise({ try: operation, catch: (cause) => cause });
}

/**
 * 上传脚本 + 后台起 collector + 等端口文件,失败重试。每一轮换一套带随机后缀的路径:
 * 上一轮那个「慢但还活着」的 collector 如果在重试之后才起来,会写回它自己那份端口 / spans
 * 文件,不会污染新一轮。
 */
function startCollector(sandbox: Sandbox): Effect.Effect<StartedCollector, unknown> {
  const attempt = (number: number, lastLog: string): Effect.Effect<StartedCollector, unknown> => Effect.suspend(() => {
    const tag = randomUUID().slice(0, 8);
    const collectorPath = `/tmp/.niceeval-otlp-collector-${tag}.cjs`;
    const spansPath = `/tmp/.niceeval-otlp-spans-${tag}.jsonl`;
    const portPath = `/tmp/.niceeval-otlp-port-${tag}`;
    const logPath = `/tmp/.niceeval-otlp-collector-${tag}.log`;
    const writeCollector = sandboxPromise(() => sandbox.writeText(collectorPath, collectorScript(spansPath, portPath))).pipe(
      Effect.catchAll((error) => isWriteDeniedError(error)
        ? Effect.fail(new Error(t("o11y.sandboxTempNotWritable", { path: collectorPath }), { cause: error }))
        : Effect.fail(error)),
    );

    return Effect.gen(function* () {
      // 采集器脚本落在系统临时目录(workdir 之外的私有路径,契约见
      // docs/feature/sandbox/architecture.md「provider 的可写保证不止 workdir」)。/tmp 对运行
      // 用户不可写时,e2b 一类 provider 只抛一个 500 原始串,读到它的人无从下手:这里翻译成
      // 「点名路径 + 这是镜像环境缺陷 + 怎么修」,原始错误留在 cause 里做证据,不进消息。
      yield* writeCollector;

      // 后台启动 + 等端口文件,折进一次 shell 往返(远程沙箱一次 exec 要 100-500ms,
      // host 侧逐次轮询会把几秒的启动等待放大成 N 个 API round-trip)。循环两条退出边:
      //   · `kill -0` 失败 → collector 已经死了,别再空等满预算,立刻回 host 重试;
      //   · 到 deadline → 真的太慢。
      // 预算按 `date +%s` 的墙钟算而不是数 tick:`sleep` 的小数秒支持因镜像而异,数 tick 会让
      // 不支持小数的镜像瞬间跑完循环、伪装成「等了 20s」。
      // 输出两行:PID、端口(等不到则空)。
      const startResult = yield* sandboxPromise(() => sandbox.runShell(
        `node ${collectorPath} >${logPath} 2>&1 & pid=$!; echo $pid; ` +
          `end=$(( $(date +%s) + ${Math.ceil(PORT_WAIT_MS / 1000)} )); ` +
          `while [ ! -s ${portPath} ]; do ` +
          `kill -0 $pid 2>/dev/null || break; ` +
          `[ "$(date +%s)" -lt "$end" ] || break; ` +
          `sleep 0.1 2>/dev/null || sleep 1; ` +
          `done; ` +
          `cat ${portPath} 2>/dev/null || true`,
      ));
      const [pidLine, portLine] = startResult.stdout.trim().split("\n");
      const pid = parseInt((pidLine ?? "").trim(), 10);
      const port = parseInt((portLine ?? "").trim(), 10) || 0;
      if (port) return { pid, port, spansPath };

      const log = yield* sandboxPromise(() => sandbox.runShell(`cat ${logPath} 2>/dev/null || true`)).pipe(
        Effect.orElseSucceed(() => undefined),
      );
      const nextLastLog = log?.stdout.trim() ?? lastLog;
      // 这一轮可能只是慢、进程还活着:重试前先杀掉,不留孤儿 collector 占内存
      //(沙箱复用 / --keep-sandbox 下它会一直在)。
      if (Number.isFinite(pid) && pid > 0) {
        yield* sandboxPromise(() => sandbox.runShell(`kill ${pid} 2>/dev/null || true`)).pipe(Effect.ignore);
      }
      if (number >= START_ATTEMPTS) {
        // 等不到端口的两种常见死因分开报:镜像里没有 node(采集器日志会说),或系统临时目录对
        // 运行用户不可写——后者采集器自己的写入被静默吞掉,日志是空的,只报「等了 20s」等于让人
        // 对着空日志猜。探一次写权限,是环境缺陷就按环境缺陷报(点名路径 + 修法)。
        if (yield* tempDirWriteDenied(sandbox, portPath)) {
          return yield* Effect.fail(new Error(t("o11y.sandboxTempNotWritable", { path: portPath })));
        }
        return yield* Effect.fail(new Error(
          `in-sandbox OTLP collector failed to report its port within ${Math.round(PORT_WAIT_MS / 1000)}s ` +
            `(${number} attempts). Collector log:\n${nextLastLog || "(empty)"}`,
        ));
      }
      return yield* attempt(number + 1, nextLastLog);
    });
  });
  return attempt(1, "");
}

/**
 * provider SDK 的写入被拒判定:沿 cause 链找权限词法。e2b envd 把 EACCES 包成 500 响应,
 * 所以不能只看状态码——认的是 `permission denied` / `EACCES` / 只读文件系统这类词法。
 */
function isWriteDeniedError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    const record = typeof current === "object" ? current as globalThis.Record<string, unknown> : undefined;
    const code = record && typeof record.code === "string" ? record.code : "";
    const message = current instanceof Error ? current.message : String(current);
    if (/^(EACCES|EPERM|EROFS)$/i.test(code)) return true;
    if (/EACCES|EPERM|EROFS|permission denied|operation not permitted|read-only file system|not writable/i.test(message)) {
      return true;
    }
    current = record?.cause;
  }
  return false;
}

/**
 * 采集器落点所在目录的写权限探测,只在启动已经失败的路径上跑一次(正常路径不付代价)。
 * 只有沙箱**明确**回答 `denied` 才算判定成立——探测本身失败 / 回答不了时不改结论,
 * 让调用方照原样报「等不到端口」,不拿一个猜测替换掉真实证据。
 */
function tempDirWriteDenied(sandbox: Sandbox, probeBasePath: string): Effect.Effect<boolean> {
  const dir = probeBasePath.slice(0, probeBasePath.lastIndexOf("/")) || "/tmp";
  const probe = `${dir}/.niceeval-write-probe-${randomUUID().slice(0, 8)}`;
  return sandboxPromise(() => sandbox.runShell(
    `if touch ${probe} 2>/dev/null; then rm -f ${probe}; echo writable; else echo denied; fi`,
  )).pipe(
    Effect.map((result) => result.stdout.trim() === "denied"),
    Effect.orElseSucceed(() => false),
  );
}

function makeInSandboxReceiver(sandbox: Sandbox): Effect.Effect<TraceReceiver, unknown> {
  return startCollector(sandbox).pipe(Effect.map(({ pid, port, spansPath }) => {
    let cached: TraceSpan[] = [];
    const settle = (quietMs: number, maxMs: number): Effect.Effect<void> => {
      const quietTicks = Math.max(1, Math.round(quietMs / 100));
      const maxTicks = Math.max(quietTicks, Math.round(maxMs / 100));
      // agent 结束后调:等 spans 文件大小连续 quietMs 无增长(exporter flush 完)再下载。
      // 等待循环整个跑在沙箱内(一次 shell 往返),不从 host 逐次轮询。
      return sandboxPromise(() => sandbox.runShell(
        `prev=$(wc -c < ${spansPath} 2>/dev/null || echo 0); stable=0; i=0; ` +
          `while [ $i -lt ${maxTicks} ]; do ` +
          `s=$(wc -c < ${spansPath} 2>/dev/null || echo 0); ` +
          `if [ "$s" = "$prev" ]; then stable=$((stable+1)); [ $stable -ge ${quietTicks} ] && break; ` +
          `else stable=0; prev=$s; fi; ` +
          `sleep 0.1; i=$((i+1)); done`,
      )).pipe(
        Effect.ignore,
        Effect.zipRight(
          sandboxPromise(() => sandbox.readBytes(spansPath)).pipe(
            Effect.map(parseSpansFile),
            Effect.tap((spans) => Effect.sync(() => {
              cached = spans;
            })),
            // 没有 spans 文件(agent 没发任何 trace)→ 保留当前缓存。
            Effect.catchAll(() => Effect.void),
          ),
        ),
      );
    };
    const close = Number.isFinite(pid) && pid > 0
      ? sandboxPromise(() => sandbox.runShell(`kill ${pid} 2>/dev/null || true`)).pipe(Effect.ignore)
      : Effect.void;
    return Object.freeze({
      endpoint: (_host: string) => `http://127.0.0.1:${port}/v1/traces`,
      collect: () => cached.slice(),
      settle,
      close,
    });
  }));
}

// spans 文件每行一个 { ct: string; b: string(base64) }
function collectorEnvelope(value: unknown): { readonly ct: string; readonly b: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as globalThis.Record<string, unknown>;
  return typeof record.ct === "string" && typeof record.b === "string"
    ? { ct: record.ct, b: record.b }
    : undefined;
}

function parseSpansFile(raw: Uint8Array): TraceSpan[] {
  const spans: TraceSpan[] = [];
  const text = Buffer.from(raw).toString("utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const envelope = collectorEnvelope(JSON.parse(trimmed));
      if (!envelope) continue;
      const body = Buffer.from(envelope.b, "base64");
      spans.push(...parseOtlpTraces(body, envelope.ct));
    } catch {
      // 跳过损坏行
    }
  }
  return spans;
}
