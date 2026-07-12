# agent-eval 具体怎么做适配转换(源码阅读记录)

**来源:** 直接读 `/Users/ctrdh/Code/agent-eval`(vercel-labs/agent-eval 本机 checkout)的源码,不是转述。关键文件:

- 目标 schema:`packages/agent-eval/src/lib/o11y/types.ts`
- 分发 + 聚合:`packages/agent-eval/src/lib/o11y/parsers/index.ts`
- Claude Code 转换:`packages/agent-eval/src/lib/o11y/parsers/claude-code.ts`
- Codex 转换:`packages/agent-eval/src/lib/o11y/parsers/codex.ts`
- 采集(怎么拿到原始 transcript):`packages/agent-eval/src/lib/agents/claude-code.ts`、`codex.ts`、`shared.ts`

这是**学习笔记**,记录别人的具体实现,供设计归一化管线时对照;不是 niceeval 的实现描述——niceeval 自己的 Agent 契约见 [Adapter 契约](../contract.md),能力分档见 [Adapter 写法](../authoring.md)。

## 目标层长什么样:`TranscriptEvent` / `Transcript`

所有 agent 的 parser 都收敛到同一组类型(`o11y/types.ts`),这就是"适配"要落到的靶子:

```typescript
type ToolName =
  | 'file_read' | 'file_write' | 'file_edit'
  | 'shell' | 'web_fetch' | 'web_search'
  | 'glob' | 'grep' | 'list_dir' | 'agent_task' | 'unknown';

interface TranscriptEvent {
  timestamp?: string;
  type: 'message' | 'tool_call' | 'tool_result' | 'thinking' | 'error';
  role?: 'user' | 'assistant' | 'system';        // 仅 message
  content?: string;                                // message / thinking / error
  tool?: {
    name: ToolName;                                // 归一后的名字
    originalName: string;                           // 原始名字,不丢
    args?: Record<string, unknown>;
    result?: unknown;                               // 仅 tool_result
    durationMs?: number;
    success?: boolean;
  };
  raw?: unknown;                                    // 原始事件,调试用
}

interface Transcript {
  agent: string;
  model?: string;
  events: TranscriptEvent[];
  summary: TranscriptSummary;                       // 见下文 generateSummary
  parseSuccess: boolean;
  parseErrors?: string[];
}
```

`type` 只有五种(`message` / `tool_call` / `tool_result` / `thinking` / `error`),`tool_call` 和 `tool_result` 是**两条独立事件**,不像 niceeval 的 `action.called` / `action.result` 那样带 `callId` 配对——这一点直接影响了后面聚合层怎么把 call 和 result 对上号(见"聚合层"一节的问题)。

## 分发层:一个 agent 名对一个 parser 函数

```typescript
// parsers/index.ts
const AGENT_PARSERS = {
  'claude-code': parseClaudeCodeTranscript,
  'codex': parseCodexTranscript,
  'opencode': parseOpenCodeTranscript,
  'gemini': parseGeminiTranscript,
  'cursor': parseCursorTranscript,
} as const;

function getParserForAgent(agent: string) {
  for (const key of SUPPORTED_AGENTS) {
    if (agent.includes(key)) return AGENT_PARSERS[key];   // 子串匹配,不是精确匹配
  }
  return null;
}
```

用 `agent.includes(key)` 而不是精确相等,是为了让 `vercel-ai-gateway/claude-code` 这种网关前缀变体和裸的 `claude-code` 走同一个 parser——两边其实是同一个 CLI,只是鉴权路径不同,不该因为名字里多了个前缀就找不到 parser。认不出的 agent 直接返回 `parseSuccess: false` 加一句报错(列出 `SUPPORTED_AGENTS`),不猜。

## Claude Code 怎么转换

**输入形状:** Claude Code 把整段会话写成 JSONL,一行一个事件,顶层 `type` 是 `"user"` / `"assistant"` / `"system"`,真正的内容嵌在 `message.content`(可能是字符串,也可能是内容块数组)。

**转换逻辑(`parseClaudeCodeLine`,逐行处理):**

- `type === "assistant"`:先从 `content` 数组里挑出 `type === "text"` 的块拼成一条 `message` 事件;再挑出 `type === "tool_use"` 的块,每个转成一条独立的 `tool_call` 事件(`name` 经 `normalizeToolName` 归一,原名存进 `originalName`,`input` 整个存进 `args`);再挑出 `type === "thinking"` 的块转成 `thinking` 事件。**一行输入可能产出好几条事件**,不是一对一。
- `type === "user"`:**这是最容易踩坑的一步**——Claude Code 把工具执行结果也包装成一条 `user` 消息(`content` 数组里塞一个 `type: "tool_result"` 的块),parser 必须先检查 `content` 里有没有 `tool_result` 块,有就转成 `tool_result` 事件,没有才当成真的用户消息。搞反了就会把工具结果误判成用户在说话。
- 还兼容一种 OpenAI 风格的 `tool_calls` 数组(`message.tool_calls[].function.{name,arguments}`,`arguments` 是要再 `JSON.parse` 一次的字符串)——这是防御性代码,应对 Claude Code 某些输出路径可能改用 OpenAI 兼容格式。

**`normalizeToolName`(Claude Code 专属映射表)**,把 CLI 的私有工具名收敛成 canonical `ToolName`:

| 原始名 | canonical |
|---|---|
| `Read` / `read_file` / `ReadFile` | `file_read` |
| `Write` / `write_file` / `WriteFile` / `write_to_file` | `file_write` |
| `Edit` / `edit_file` / `EditFile` / `str_replace_editor` / `StrReplace` | `file_edit` |
| `Bash` / `bash` / `Shell` / `shell` / `execute_command` / `run_command` | `shell` |
| `WebFetch` / `web_fetch` / `fetch_url` / `mcp__fetch__fetch` | `web_fetch` |
| `WebSearch` / `web_search` | `web_search` |
| `Glob` / `glob` / `list_files` | `glob` |
| `Grep` / `grep` / `search_files` | `grep` |
| `LS` / `list_dir` / `ListDir` | `list_dir` |
| `Task` / `task` | `agent_task` |
| 认不出的 | `unknown` |

**行级容错:** 每一行包在 `try/catch` 里,解析失败静默跳过(`parseClaudeCodeTranscript` 外层再包一层,把异常收进 `errors[]`),不会让一行坏数据拖垮整份 transcript。

## Codex 怎么转换

**输入形状和 Claude Code 完全不同。** Codex 走 OpenAI Responses API 的事件流,`--json` 输出的每一行是一个**细粒度的生命周期事件**,不是"一条消息"。而且事件的 type 字段本身就不稳定——parser 第一步是 `const eventType = data.type || data.event || data.kind`,三个字段轮流试,这是应对 Codex 跨版本 / 跨 wire API 命名漂移的防御写法。

**转换逻辑是一个大 `switch(eventType)`,不是 if/else 链**,分支比 Claude Code 多得多,因为 Codex 的事件粒度更细:

- `message` / `chat` / `response` → 一条 `message`,`role` 从 `data.role` 或者猜 `data.from === "assistant"`。
- `function_call` / `tool_call` / `tool_use` / `action`(四个同义 type 名全部映射到同一逻辑)→ 一条 `tool_call`;`name` 依次尝试 `data.function?.name || data.name || data.tool || data.action`;`args` 优先解析 OpenAI 式的 `function.arguments`(JSON 字符串,需要再 `JSON.parse`),否则退回 `data.arguments || data.input || data.params`。
- `function_result` / `tool_result` / `tool_response` / `action_result` → 一条 `tool_result`。
- `thinking` / `reasoning` / `thought` → 一条 `thinking`。
- `thread.started/completed`、`turn.started/completed/failed` → 当成控制流事件,`turn.failed` 转成 `error`,其余转成一条内容是事件名本身的 `system` 消息(纯占位,不是真正有信息量的内容)。
- `response.created/completed/cancelled/failed` → 只有 `response.failed` 才产事件(转 `error`),其余三个丢弃——**这是这份 parser 里唯一"读了但故意不产出事件"的分支**,因为这几个是流控制信号,对断言没有价值。
- `output_text.delta` / `output_text.done` → 流式文本增量,转成 `assistant` 消息(意味着一次真实回复可能在这里被拆成好几条 `message` 事件,和 Claude Code "一次性给完整文本"不一样)。
- `item.started` / `item.completed` → 再按 `data.item.type` 分二级:
  - `reasoning` → `thinking`。
  - `command_execution` → **`started` 产 `tool_call`(shell,`args.command`),`completed` 产 `tool_result`(`result.output` 取 `aggregated_output`,`result.exitCode` 取 `exit_code`,`success` 判 `status === "completed" && exitCode 是 0 或未定义`)**——shell 命令的开始和结束是两个独立事件,靠"先后顺序"隐式配对,不靠 id。
  - `agent_message` → `assistant` 消息。
- `default`(没认出的 type):再按数据形状猜——有 `role` 字段就当消息,有 `function`/`tool` 字段且带 `result`/`output` 就当 `tool_result`,否则当 `tool_call`。这是最后一道兜底,处理型号漂移到连 `eventType` 都认不出的情况。

**`normalizeToolName`(Codex 专属映射表,和 Claude Code 的完全不共享,且 Codex 版会先 `toLowerCase()` 再查表)：**

| 原始名(小写后) | canonical |
|---|---|
| `read_file` | `file_read` |
| `write_file` / `create_file` / `delete_file` | `file_write` |
| `edit_file` / `patch_file` | `file_edit` |
| `shell` / `bash` / `execute` / `run` / `exec` / `terminal` | `shell` |
| `fetch` / `http_request` / `curl` | `web_fetch` |
| `web_search` / `search` | `web_search` |
| `glob` / `find_files` / `list_files` | `glob` |
| `grep` / `search_files` / `ripgrep` | `grep` |
| `ls` / `list_directory` / `dir` | `list_dir` |
| 认不出的 | `unknown` |

## 两份 parser 对比暴露的设计事实

- **Claude Code 的分支数(~6 个 if/else)远少于 Codex(~15 个 switch case)**,不是因为哪份代码写得更细,而是两家 CLI 的 transcript **颗粒度不同**:Claude Code 一行大致等于"一条完整消息 / 一次工具调用",Codex 的 Responses API 把同一件事拆成多个生命周期事件(`item.started` → `item.completed`,`response.created` → `response.completed`)。parser 的复杂度是被上游协议形状决定的,不是可以统一简化掉的。
- **`normalizeToolName` 映射表不共享,每个 agent 各写一份**,即便两家都有等价的"读文件""跑 shell"概念。没有一张全局的"规范名 ← 各家别名"总表,复用发生在**结构**(都产出同一个 `ToolName` 联合类型)而不是**数据**(映射表本身)上。
- **文件路径 / URL / 命令的提取函数(`extractFilePath` / `extractUrl` / `extractCommand`)在两份 parser 里几乎逐字重复**,只是取的字段名优先级顺序不同(Claude Code 先试 `args.path`,Codex 先试 `args.path` 但也认 `args.endpoint`)。新增一个 agent = 复制这一整套函数再改字段名,没有抽成共享 helper。
- **tool_call 和 tool_result 不是靠 id 配对的。** `TranscriptEvent` 没有 `callId` 这类字段,聚合层靠"数组里最后一个还没被填 `exitCode` 的 shellCommand"这种**顺序假设**去把 call 和 result 拼起来(见下一节)——如果两个工具调用交叠或乱序,这个假设会配错。

## 聚合层:`generateSummary` 完全不认识 agent

`parsers/index.ts` 的 `generateSummary(events)` 是纯函数,输入只有 `TranscriptEvent[]`,不知道这条流是哪个 agent 产的。它靠一个"暗号字段"读文件路径:

```typescript
// tool_call 分支
const path = (args._extractedPath || args.path || args.file) as string;
if (path) filesModified.add(path);
```

`_extractedPath` 由两份 parser 各自在**行解析之后的一趟后处理**里补上(两边写法几乎一样):

```typescript
// claude-code.ts 和 codex.ts 都有这一段(后处理,不在逐行解析里)
if (['file_read', 'file_write', 'file_edit'].includes(event.tool.name)) {
  const path = extractFilePath(args);
  if (path) event.tool.args = { ...args, _extractedPath: path };
}
if (event.tool.name === 'web_fetch') {
  const url = extractUrl(args);
  if (url) event.tool.args = { ...args, _extractedUrl: url };
}
if (event.tool.name === 'shell') {
  const command = extractCommand(args);
  if (command) event.tool.args = { ...args, _extractedCommand: command };
}
```

`generateSummary` 只认 `_extractedPath` / `_extractedUrl` / `_extractedCommand` 这三个暗号字段,读不到才退回去猜通用字段名兜底。**提取(这个字段在这家 CLI 的私有参数里叫什么)和聚合(这些字段怎么计数 / 去重)被这个命名约定彻底切开**——新增一个 agent,只要在它自己的 parser 后处理里填好这三个暗号字段,`generateSummary` 一行不用改。

**call/result 配对是顺序性的,不是 id 性的。** shell 命令的成功状态是这样接上的:

```typescript
case 'tool_result':
  const lastCmd = shellCommands[shellCommands.length - 1];
  if (lastCmd && lastCmd.exitCode === undefined) {
    lastCmd.success = event.tool.success;
    // 从 result 里再抠一次 exitCode
  }
```

"数组里最后一条还没写 exitCode 的记录"就是这次 result 对应的 call——这是可行的,因为 Codex/Claude Code 的工具调用在 transcript 里基本是严格顺序的(等上一个工具跑完才发起下一个),但这个假设没有 id 兜底,一旦上游并发发起多个工具调用,配对就会错。

## 采集层:两份 parser 之前,原始数据从哪来

- **Claude Code(纯磁盘旁读):** `captureTranscript()` 把沙箱工作目录的斜杠换成短横线拼出 `~/.claude/projects/{workdir-with-dashes}`,shell 出 `ls -t *.jsonl | head -1` 找最新一份,`sandbox.readFile()` 整份读回来当 `transcript`。这份文件是 Claude Code 自己为会话续接（resume）才写的,agent-eval 只是读。
- **Codex(两条通道,各管各的用途):**
  - **主 transcript:** 直接把 `codex exec --json` 的 `stdout + stderr` 拼起来,`extractTranscriptFromOutput()` 过滤出"看起来像 JSON 对象"的行(`trim().startsWith('{') && endsWith('}')`)当作 transcript——这是 stdout 捕获,不是磁盘读。
  - **第二条通道,只为了拿"实际用的模型":** 从 stdout 里先抓一个 `thread.started` 事件拿到 `thread_id`,再用它去 `~/.codex/sessions` 磁盘上 `find` 对应的 session JSONL 文件读出来,从里面找 `turn_context` 事件的 `payload.model` ——因为经网关请求的模型名和网关实际路由到的模型可能不一致,只有磁盘上的 session 文件会记录真实值。**同一个 agent 的"转换用" transcript 和"读实际模型用"的数据来源是两条不同的采集路径**,不是一份数据复用两次。

## 落地:注入沙箱给断言用

`injectTranscriptContext(sandbox, rawTranscript, agentName, model)`(`agents/shared.ts`)只做三件事:解析 transcript、取 `summary`、写文件——不写 `events`:

```typescript
const transcript = rawTranscript ? parseTranscript(rawTranscript, agentName, model) : null;
const context = { o11y: transcript?.summary ?? null };
await sandbox.writeFiles({ '__agent_eval__/results.json': JSON.stringify(context, null, 2) });
```

整个函数包在 `try/catch` 里静默失败("best-effort: don't fail the eval if context injection fails")。这一步在 `agent.run()` 里、跑 `EVAL.ts` 校验**之前**调用,`EVAL.ts` 读 `__agent_eval__/results.json` 拿到的就只有聚合后的 `summary`,拿不到原始 `events`——细粒度的"第几步调用了什么工具"在这一层已经不可见了,只剩计数和去重后的列表。

## 这次读源码对 niceeval 的启发

- **`callId` 配对是比"数组里最后一条未配对记录"更稳的设计。** niceeval 的 `action.called` / `action.result` 靠显式 `callId` 配对,不依赖工具调用严格顺序发生这一假设——agent-eval 这份实现在并发/乱序工具调用下会错配,是个真实的设计取舍对比,不是理论问题。
- **"暗号字段 + 通用兜底"这个具体写法值得抄**,尤其是"提取"和"聚合"分离这一点;但**提取函数本身在多个 agent parser 间被复制而非共享**,是可以直接避免的重复,新写 parser 时不必照抄这一部分。
- **一个 agent 的"采集"可以是多条互不相干的通道**(Codex 的 stdout 转写 vs 磁盘读实际模型),不是"一个 agent 一种采集方式"——设计 adapter 的采集逻辑时要按"这份数据要用来干什么"分别决定怎么采,而不是假设一种机制能满足所有需求。
- **`Agent.run()` 是一个每个 agent 重写一遍的单体函数**(建沙箱、传文件、装 CLI、跑命令、抓 transcript、注入上下文、跑校验、采 diff、关沙箱,claude-code.ts 和 codex.ts 里这一整套流程几乎逐行重复),生命周期没有被收进一个共享的运行器骨架里。niceeval 把这套骨架收进运行器(`setup` 一次 / `send` 每轮一次 / git 基线与 diff 由 runner 统一管),adapter 只写"这几行不同"的部分——这是两边在"core 拥有多少"这条线上最大的架构分歧。

## 相关阅读

- [Adapter 契约](../contract.md) / [Adapter 写法](../authoring.md) —— niceeval 自己的 Agent 契约、逐 API 适配义务、能力分档、采集层设计。
- [Observability](../../../observability.md) —— niceeval 的标准事件流(`callId` 配对)、OTLP trace、 artifact 落盘。
- [References](../../../references.md) —— 调研其它外部项目(如 agent-eval 的 playground/view)学到什么。
