// 真调用 Codex SDK(`@openai/codex-sdk`)——没有 mock 模式,这个示例的意义就是
// 演示真实的 Codex agent 长什么样。见 README.md「为什么任务形状长这样」。
//
// 用的是 SDK 自己推荐的流式接口:`thread.runStreamed()` 返回 ThreadEvent 的
// AsyncGenerator(thread.started / turn.started / item.* / turn.completed /
// turn.failed / error),SDK 官方示例(samples/basic_streaming.ts)就是拿这个
// 事件循环驱动 UI 的。server.ts 把事件原样透传成 SSE,前端按 event.type 渲染。
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Codex, type CodexOptions, type Thread, type ThreadEvent } from "@openai/codex-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Codex 是"目录里的编码 agent":给它一个 scratch 工作目录去读写文件、跑命令,
// 别让它碰仓库本体。见 README.md「为什么任务形状长这样」。workspace/ 是运行时
// 生成的 scratch 数据,故意留在项目根(而不是 src/backend/ 里),__dirname 是
// src/backend,得往上两级才能回到项目根。
export const WORKSPACE_DIR = path.join(__dirname, "..", "..", "workspace");

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

// Codex CLI 原生 otel 配置段,导出发生在子进程内部,默认开启(见 README OTel 说明)。
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const otelConfig: NonNullable<CodexOptions["config"]> = {
  otel: {
    environment: "dev",
    trace_exporter: {
      "otlp-http": { endpoint: `${OTLP_ENDPOINT}/v1/traces`, protocol: "json" },
    },
  },
};

const codex = new Codex({
  apiKey: process.env.OPENAI_API_KEY,
  config: {
    model_providers: {
      "openai-no-ws": {
        name: "openai-no-ws",
        base_url: OPENAI_BASE_URL,
        env_key: "OPENAI_API_KEY",
        wire_api: "responses",
        supports_websockets: false,
      },
    },
    model_provider: "openai-no-ws",
    ...otelConfig,
  },
});

// 会话续接用 Codex 原生机制:thread 落盘在 ~/.codex/sessions,前端从
// `thread.started` 事件里拿 thread_id 自己保存,下一轮随请求带回来,这里用
// codex.resumeThread(threadId) 接回去——服务端不需要任何会话状态。
export async function runTurnStreamed(
  message: string,
  threadId: string | undefined,
  signal: AbortSignal,
): Promise<AsyncGenerator<ThreadEvent>> {
  await mkdir(WORKSPACE_DIR, { recursive: true });

  const threadOptions = {
    workingDirectory: WORKSPACE_DIR,
    skipGitRepoCheck: true,
    model: process.env.AGENT_MODEL ?? "gpt-5.4",
  };
  const thread: Thread = threadId
    ? codex.resumeThread(threadId, threadOptions)
    : codex.startThread(threadOptions);

  const { events } = await thread.runStreamed(message, { signal });
  return events;
}
