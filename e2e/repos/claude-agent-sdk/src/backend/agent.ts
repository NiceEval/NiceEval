// 真实调用 @anthropic-ai/claude-agent-sdk 的 query()。需要 ANTHROPIC_API_KEY,且需要能找到
// claude-code 可执行文件(SDK 把它作为 optional dependency 一起装)。
//
// 会话形态按官方 sessions 文档的"多用户服务"基线:每轮一次 query(),用 resume 携带上一轮的
// session_id 找回历史(SDK 落盘在 CLAUDE_CONFIG_DIR/projects/,见下)。agents/claude-agent-sdk.ts
// 从消息流里自己拿 session_id(system/init 和 result 消息都带),下一轮随请求带回来——服务端零
// 会话状态。
//
// 隔离本机 ~/.claude:query() 默认会启动一个"真"的 claude-code CLI 子进程,它按普通 CLI 一样
// 读取运行本仓库这台机器上的全局 ~/.claude/settings.json、项目 .claude/、已装 plugin 和
// marketplace MCP server——实测这会把宿主环境的 hooks(如 SessionStart)、skills 和无关 MCP
// server(如 context7)一起带进每一轮对话,污染 assertion 和 usage。两处修复:
//   1. CLAUDE_CONFIG_DIR 指向仓库内一个专用目录,session 落盘(供 resume 用)与宿主的
//      ~/.claude/projects/ 彻底分开,不写进真实用户目录。
//   2. query() 的 settingSources: [](SDK isolation mode,不读任何文件系统 settings/hooks/
//      skills/plugin)+ strictMcpConfig: true(只认 mcpServers 选项里显式传入的 MCP server,
//      忽略 project .mcp.json、user settings、plugin 声明的 MCP)。
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSdkMcpServer, query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { demoTools } from "./tools.ts";
import { pendingApprovals } from "./pending-approvals.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
process.env.CLAUDE_CONFIG_DIR ??= join(REPO_ROOT, ".claude-home");

// HITL 演示:只有 calculate 需要人工审批。MCP 命名空间下,tool_use 块里的真实工具名是
// `mcp__<server>__<tool>`,不是裸的 `calculate`。这个字符串同时也是 agents/claude-agent-sdk.ts
// 判断要不要暂停轮的依据,两处必须一致。
const GATED_TOOL_NAME = "mcp__demo-tools__calculate";

// ANTHROPIC_BASE_URL 指向一个 DeepSeek 的 Anthropic-Messages 兼容端点;AGENT_MODEL 可覆盖具体
// 模型 id(见 .env.example)。
const MODEL = process.env.AGENT_MODEL ?? "deepseek-v4-flash";

const SYSTEM_PROMPT = [
  "You are a demo assistant for niceeval's E2E test suite covering the Claude Agent SDK adapter.",
  "You have two tools: get_weather (look up a city's current weather) and calculate",
  "(evaluate an arithmetic expression). Whenever a question is about weather or arithmetic you",
  "must call the matching tool to get the real result — never invent numbers. Keep answers short.",
].join("\n");

// SDK 内嵌的 MCP server 进程级建一次即可,每次 query() 复用同一个实例。
const demoToolsServer = createSdkMcpServer({
  name: "demo-tools",
  version: "1.0.0",
  tools: demoTools,
});

export function runTurn(message: string, resumeSessionId: string | undefined): Query {
  return query({
    prompt: message,
    options: {
      systemPrompt: SYSTEM_PROMPT,
      model: MODEL,
      // 关掉内置工具(Bash/Read/...),这个 demo 只暴露自己的两个 MCP 工具。
      tools: [],
      mcpServers: { "demo-tools": demoToolsServer },
      // 无人值守的 HTTP 服务没有终端可以答复权限提示,所以两个工具分两条路:get_weather 进
      // allowedTools 白名单直接放行;calculate 留给下面的 canUseTool 做 HITL 审批。
      //
      // 两个工具都塞进 allowedTools 配 permissionMode: 'dontAsk' 时,canUseTool 从来不会被
      // 调用——allowedTools 命中的工具自动执行,dontAsk 模式下没命中白名单的工具直接
      // auto-deny,canUseTool 根本不在决策路径里。要让 calculate 真的走到 canUseTool 的 ask
      // 流程,必须用 permissionMode: 'default'(为未列入白名单的工具触发权限询问,headless
      // 场景下这个"询问"就是回调 canUseTool),并且不能把 calculate 放进 allowedTools。
      allowedTools: ["mcp__demo-tools__get_weather"],
      permissionMode: "default",
      // 隔离本机环境(见文件头注释):不读任何文件系统 settings/hooks/skills/plugin,只信任
      // 上面显式传入的 mcpServers。
      settingSources: [],
      strictMcpConfig: true,
      // 让 SDK 额外产出 stream_event 消息(原始 API 流事件);fromClaudeSdkMessages() 认不出
      // 这类帧,原样忽略,不影响归一。
      includePartialMessages: true,
      // HITL:calculate 调用前先暂停,等 POST /api/chat/approve 决议。
      // opts.toolUseID 与 tool_use 块的 id 是同一个值,agents/claude-agent-sdk.ts 把它当
      // pause 的 id,approve 端点原样带回这个字符串——三处用的是同一个 id。
      canUseTool: async (toolName, input, opts) => {
        // 注意:PermissionResult 的 TS 类型把 `updatedInput` 标成可选,但 CLI 子进程那边校验
        // 用的 zod schema 实测要求 allow 分支必须带上 updatedInput(一个 record)——只回
        // `{behavior:'allow'}` 会在控制通道里被拒(ZodError: invalid_type,收到 undefined)。
        if (toolName !== GATED_TOOL_NAME) return { behavior: "allow", updatedInput: input };
        const approved = await new Promise<boolean>((resolve) => {
          pendingApprovals.set(opts.toolUseID, resolve);
        });
        return approved
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "user rejected this call" };
      },
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  });
}

export { GATED_TOOL_NAME };
