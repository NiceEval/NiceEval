// codex-sdk 的 adapter:进程内直接用 `@openai/codex-sdk` 驱动 Codex,没有中间 HTTP 服务——
// SDK 自己已经 spawn 了 codex CLI 子进程,那才是这条协议路径真实的进程边界(不搭 apps/ + 薄
// projects/ 的隐含拓扑,见 docs/engineering/e2e-ci/README.md §9)。
//
// 断言依据全部来自标准事件流:官方转换器 `fromCodexThreadEvents()` 翻消息文本、工具项
// (command_execution / mcp_tool_call / file_change → action.*)、`turn.completed` 的 usage;
// 逐帧驱动用官方件 `driveFrameStream`。Codex SDK 没有与 Claude Agent SDK `canUseTool` 等价的
// 公开审批回调,因此这条 adapter 从不产生 `input.requested`(反证见 evals/hitl-negative.eval.ts)。
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Codex, type CodexOptions, type ModelReasoningEffort, type Thread, type ThreadEvent } from "@openai/codex-sdk";
import { completeCoverage, defineAgent, driveFrameStream, fromCodexThreadEvents } from "niceeval/adapter";
import type { AgentContext, SseFrameCursor } from "niceeval/adapter";
import type { Turn, TurnInput } from "niceeval";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Codex 是"目录里的编码 agent":给它一个 scratch 工作目录去读写文件、跑命令。运行时创建,
 *  内容是每次真实运行的副产物,不签入(见 .gitignore)。 */
export const WORKSPACE_DIR = path.join(__dirname, "..", "workspace");

// codex CLI 子进程默认读 `$HOME/.codex`——在真机(而非全新 CI VM)上跑这条 adapter 时,
// 那是本机开发者自己的 Codex 安装,而不是这条 Eval 的沙箱。真机复现过:开发者本机的
// `~/.codex/config.toml` 挂着 ChatGPT 桌面版注册的 `[mcp_servers.node_repl]`(一个真实、能跑
// 的本地 Node REPL MCP server),会和这里挂载的 `mcp_servers.e2e` 一起出现在模型的工具列表里——
// mcp-tool Eval 断言"调用 e2e.get-sum"会因为模型选了更顺手的 node_repl 而随机失败,是真实的
// 测试隔离缺口,不是 prompt 用词问题。用 `CodexOptions.env` 给子进程一个仓库私有的 `CODEX_HOME`
// (跨 attempt 复用,保 session 续接;不进 git,见 .gitignore),从根上切断这条串味,而不是在
// prompt 里堆条件去猜开发者本机装了什么 MCP server。
const CODEX_HOME_DIR = path.join(__dirname, "..", ".codex-home");

const CODEX_BASE_URL = process.env.CODEX_BASE_URL ?? "https://api.openai.com/v1";

// MCP 工具挂载:复用官方 `@modelcontextprotocol/server-everything` 的确定性 get-sum 工具,
// 不为这一个 Eval 手写自定义 MCP server。注意配置键是复数 `mcp_servers`——单数 `mcp_server`
// 会被 codex 静默忽略,MCP 压根挂不上(同类坑见 memory/e2e-suite-landing-gotchas.md)。
const codex = new Codex({
  apiKey: process.env.CODEX_API_KEY,
  // 不传 env 时 SDK 透传当前进程的 process.env(含真实 HOME),子进程会读到开发者本机
  // `~/.codex/config.toml`——上面注释的串味根因。这里显式接管:整体保留 process.env(PATH、
  // npx/node 相关变量都还要用),只覆盖 CODEX_HOME 指向仓库私有目录。
  env: { ...process.env, CODEX_HOME: CODEX_HOME_DIR },
  config: {
    model_providers: {
      "e2e-provider": {
        name: "e2e-provider",
        base_url: CODEX_BASE_URL,
        env_key: "CODEX_API_KEY",
        wire_api: "responses",
        supports_websockets: false,
      },
    },
    model_provider: "e2e-provider",
    mcp_servers: {
      e2e: { command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] },
    },
    // 自定义 model_provider 不在 Codex 内置的模型目录里,`model_reasoning_summary` 默认不开——
    // 真机验证过:即使 `modelReasoningEffort` 拉到 high,底层用量里 reasoning_output_tokens
    // 确实 > 0(模型真的在推理),但事件流里从来不出现 `reasoning` item,usage Eval 的
    // thinking 断言必挂,是没请求 summary,不是这个模型/后端不吐 reasoning。显式配成
    // "detailed" 后事件流稳定出现 reasoning item(真机验证 6/6 次)。
    model_reasoning_summary: "detailed",
  } satisfies NonNullable<CodexOptions["config"]>,
});

/** AsyncGenerator → driveFrameStream 需要的最小读帧接口(next() 返回 null 表示流结束)。 */
function asCursor(gen: AsyncGenerator<ThreadEvent>): SseFrameCursor<ThreadEvent> {
  return {
    async next() {
      const { value, done } = await gen.next();
      return done ? null : value;
    },
  };
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  await mkdir(WORKSPACE_DIR, { recursive: true });
  await mkdir(CODEX_HOME_DIR, { recursive: true });

  // linux CI runner 上 Codex CLI 的 bwrap 沙箱起不来(netns loopback 权限被拒),命令会被
  // 沙箱全部拦死;CI 本身就是一次性隔离 VM,用 CODEX_SANDBOX_MODE=danger-full-access 关掉
  // 内层沙箱是惯例(见 memory/e2e-suite-landing-gotchas.md 现象 3)。
  //
  // 本地默认落 "workspace-write",不再"省略 = Codex 默认沙箱":真机验证过,CODEX_HOME
  // 隔离(见上面 CODEX_HOME_DIR 的注释)之后,Codex 对一个全新 home 的原生默认是
  // read-only——coding-tool Eval 的建文件轮会被模型直接判定"当前是只读沙箱"而拒绝执行,
  // 不报运行期错误,是模型自己读到沙箱描述后放弃。之前"本地不设也能过"是假象:开发者本机
  // `~/.codex/config.toml` 恰好写着 `sandbox_mode = "danger-full-access"`,那是隔离前顺带
  // 继承的个人配置,不是 Codex 的真实默认。
  const sandboxMode =
    (process.env.CODEX_SANDBOX_MODE as "read-only" | "workspace-write" | "danger-full-access" | undefined) ??
    "workspace-write";

  const threadOptions = {
    workingDirectory: WORKSPACE_DIR,
    skipGitRepoCheck: true,
    // model 归属:实验决定(ctx.model),省略时用 Codex CLI 原生默认。
    ...(ctx.model ? { model: ctx.model } : {}),
    // reasoningEffort 不跟随「省略 = CLI 原生默认」的惯例:真机验证过,CODEX_HOME 隔离后
    // (见上面 CODEX_HOME_DIR 的注释)Codex 原生默认对这个 model_provider 常在 minimal/low
    // 效果上跑,大多数轮次 reasoning_output_tokens=0——usage Eval 的 thinking 断言需要模型
    // 真的做出可总结的推理,省略时不可靠(真机验证 2/3 次 0 tokens)。固定兜底 "high",
    // 实验显式传 ctx.reasoningEffort 时仍以实验为准。
    modelReasoningEffort: (ctx.reasoningEffort ?? "high") as ModelReasoningEffort,
    sandboxMode,
    // 这条 adapter 没有审批回调(见文件头注释),headless 跑法必须自己把审批策略钉死成
    // "never",否则默认策略在无人可问的 exec 模式下要么拒绝要么挂起。同样是隔离前被开发者
    // 本机 `approval_policy = "never"` 顺带盖过的一个坑。
    approvalPolicy: "never" as const,
  };

  // 会话续接用 Codex 原生机制:thread 落盘在 ~/.codex/sessions,ctx.session.id 记着首轮
  // thread.started 回传的 id,后续轮用 codex.resumeThread(id) 接回去。
  const thread: Thread = ctx.session.id
    ? codex.resumeThread(ctx.session.id, threadOptions)
    : codex.startThread(threadOptions);

  const { events } = await thread.runStreamed(input.text, { signal: ctx.signal });

  const stream = fromCodexThreadEvents();
  return driveFrameStream(asCursor(events), stream, ctx, (frame) => {
    // 会话续接:thread.started 帧回传的 id 写回 ctx.session,只在还没记过时落地
    // (first-writer-wins,ctx.session.capture 内部保证)。
    if (frame.type === "thread.started" && typeof frame.thread_id === "string") {
      ctx.session.capture(frame.thread_id);
    }
  });
}

export default defineAgent({
  name: "codex-sdk",
  coverage: completeCoverage,
  send,
});
