# E2E CI(设计提案,未实现)

> 状态:设计提案。本文描述 niceeval 的端到端 CI 测试方案——用真实的 `niceeval exp` 全链路(发现 → 调度 → 断言 → 评分 → 工件 → 退出码)验证框架和官方适配路径,而不是只跑 typecheck。当前 `.github/workflows/ci.yml` 只有 typecheck / site:build / docs 校验,没有任何 workflow 真正执行过 eval。

## 1. 目标

一次 e2e CI 要同时证明五件事:

1. **完整路径**:从 `evals/` 发现、experiment 展开运行矩阵、`t.*` 断言收集、gate/soft 判决、`.niceeval/<run>/` 工件落盘,到进程退出码,每一环都被真实执行并被机器校验——包括"该红的时候红"(deliberate-fail 必须 exit 1),不是只测 happy path。
2. **一套 suite,全矩阵 100% pass**:所有 SDK 适配项目共用**同一份** eval/experiment 定义(单一事实来源,见第 3 节),CI 把每个项目都跑一遍,期望全部 pass——任何一个 SDK 的适配层回归都会把矩阵打红。
3. **正反验证所有功能**:套件对每个功能都配正反两条用例——该调工具时 `t.calledTool`、不该调时 `t.notCalledTool`/`t.usedNoTools`、HITL 有 approve 也有 deny、会话有记忆也有 `newSession` 隔离;再加 deliberate-fail/error 验证"断言真的会挂"。防止"断言永真"这类静默失效。
4. **重复运行统计**:一个 experiment 配 `runs: 100, earlyExit: false`,验证 100 次重复的调度、并发、pass 率计数正确(niceeval 的字段就叫 `runs`,不叫 pass/trials;`earlyExit` 不关掉的话第一次通过就会 abort 其余 attempt,拿不到完整分布)。
5. **官方适配矩阵**:内建 `uiMessageStreamAgent`、`fromAiSdk`/`fromClaudeSdkMessages`/`fromCodexThreadEvents`/`fromPiAgentEvents` 转换器、自写 `defineAgent` 映射,以及沙箱型 claude-code / codex / bub × docker / e2b / vercel,每条官方路径至少一条 CI 覆盖。

## 2. 现状盘点

### tier1 的 eval 只当证据看,不复用

e2e 从 tier1 拷的是**被测应用和 adapter**(各 SDK 真正不同的部分);eval/experiment 套件在 e2e 里围绕功能覆盖矩阵**全新编写**,不搬 tier1 五个项目的 eval 文件——那些是文档叙事的示例,职责不同。但 tier1 的 eval 仍然值得盘点一次,因为它们是"一套 eval 能不能字面共享"的现成证据:`examples/zh/tier1/{ai-sdk-v7,claude-sdk,pi-sdk,langgraph}` 四个项目的 `evals/` 文件名完全一致(`basic-qa` / `weather-tool` / `hitl-approve` / `hitl-deny` / `session-isolation`;`codex-sdk` 是 coding agent,另有 `create-file` / `run-command`),实际 diff 过,**字面并不同构**,差异全部来自 SDK 协议本身:

- claude-sdk 的工具名是 MCP 命名空间下的 `mcp__demo-tools__get_weather`,不是裸的 `get_weather`;
- basic-qa 是否断言 `t.maxTokens` 取决于该 SDK 协议给不给 usage(UI Message Stream 协议帧里没有 usage,pi-sdk 的 `message_end` 里有);
- codex-sdk 没有 HITL 和 weather 工具,功能集不同。

所以 e2e 的"一套 eval"不能靠字面复制或软链实现,要靠参数化新写(见第 3 节);tier1 的这些差异正好告诉我们 profile 里要有哪些开关。另外源码层面确认:`src/runner/discover.ts` 固定扫 `<root>/evals` 与 `<root>/experiments`,`walkFiles` 用 Dirent 的 `isDirectory()/isFile()` 判断——**symlink 条目两者都返回 false,逐文件或逐子目录软链不会被发现**;整个 `evals/` 目录本身做软链虽可行(readdir 跟随路径),但前提是文件逐字同构,上面已经否定了。

### 框架侧对 CI 重要的事实(源码已确认)

- **退出码**:全过/跳过 → 0;任一 failed 或 errored → 1;框架崩溃 → 2(`src/cli.ts:414`)。CI 判成败首选退出码,细分读 `summary.json`。
- **指纹缓存会静默跳过上次 passed 的 eval**(`src/runner/run.ts:117-135`)。CI 必须加 `--force`,或保证 `.niceeval/` 不跨 run 复用,否则回归会被缓存掩盖。
- **judge 无 key 时 no-op**(`src/scoring/judge.ts:162`):不配 judge key,`t.judge.autoevals.*` 断言静默跳过、不判红。mock 层利用这一点零 key 跑;"judge 真的在判"要单独在有 key 的层验证。
- **可用 flags**:`--runs`、`--no-early-exit`、`--force`、`--junit <path>`、`--strict`、`--max-concurrency`。**不要用** `--json`(死 flag)、`--reporter`(不存在)、`--agent`/`--model`(exp 下报错)、`--sandbox`(已移除)。
- **`runs` 的语义**:每个 `(agent × model × eval)` 组合跑 `runs` 次;被 earlyExit abort 的 attempt 不计入分母。

## 3. 核心设计:`e2e/` 里一份共享套件 + 每个 SDK 一个薄项目

新建 `e2e/` 目录(与 `examples/`、`src/` 平级),里面三种东西:一份**全新编写**的共享 eval/experiment 定义(不复用 tier1 的 eval 文件)、从 tier1 拷来的被测应用与 adapter、每个 SDK 一个只剩"绑定"职责的薄 niceeval 项目:

```text
e2e/
  shared/                        # 唯一一份 eval / experiment 定义(单一事实来源)
    profile.ts                   # AgentProfile 类型:工具名、能力开关
    evals.ts                     # weatherTool(p) / basicQa(p) / hitlApprove(p) ... 的 factory
    experiments.ts               # ciExperiment(agent, p) / pass100(agent, p) factory
    verdicts.ts                  # deliberateFail() / deliberateError() factory(只进 verdicts 实验)
  apps/                          # 被测应用,从 examples/zh/tier1/<name> 拷来,加确定性 mock 开关
    ai-sdk-v7/  claude-sdk/  codex-sdk/  pi-sdk/  langgraph/
  projects/                      # 每个 SDK 一个 niceeval 项目:adapter + profile + 3 行 stub
    ai-sdk-v7/
      niceeval.config.ts
      agents/ai-sdk-v7.ts        # 拷自 tier1——adapter 是各 SDK 真正不同的部分,不共享
      profile.ts                 # 该项目的能力声明(见下)
      evals/weather-tool.eval.ts # stub:export default weatherTool(profile)
      evals/...                  # 其余 stub,一 eval 一文件,保住可读的 eval id
      experiments/ci.ts          # stub:export default ciExperiment(agent, profile)
    claude-sdk/  codex-sdk/  pi-sdk/  langgraph/
    mock-ai-sdk/                 # 纯框架项目:defineAgent + fromAiSdk 消费本地 mock server
    mock-http/                   # 纯框架项目:defineAgent + 手写映射,自定义 JSON 协议
  scripts/
    mock-server.mjs              # mock-ai-sdk / mock-http 共用的确定性本地 server
    verify.mjs                   # 元校验:跑 CLI 子进程,对照期望表检查退出码 + summary.json
```

### 3.1 为什么是 factory + profile,不是软链

eval 定义本来就不 import agent(agent 由 experiment 绑定),所以共享 eval 在框架模型上是顺的;挡路的只有两件事:discover 只认 `<root>/evals` 下的实体文件(symlink 条目不被发现,见第 2 节),以及各 SDK 的协议差异(工具名、usage、HITL 支持)。两个问题一个解法——共享层导出**参数化的 factory**,每个项目用一个 `profile.ts` 声明自己的协议现实,`evals/` 下只放 stub 文件喂给 discover:

```typescript
// e2e/shared/profile.ts
export interface AgentProfile {
  weatherToolName: string;       // "get_weather" 或 "mcp__demo-tools__get_weather"
  usage: boolean;                // 协议是否携带 usage(决定 basic-qa 是否断言 maxTokens)
  hitl: boolean;                 // 是否支持 approve/deny(codex-sdk 为 false)
  sandboxTools: boolean;         // 是否是 coding agent(决定 create-file/run-command 是否生效)
}
```

```typescript
// e2e/projects/claude-sdk/profile.ts
import type { AgentProfile } from "../../shared/profile.ts";

export default {
  weatherToolName: "mcp__demo-tools__get_weather",   // MCP 命名空间是协议现实,不抹平
  usage: true,
  hitl: true,
  sandboxTools: false,
} satisfies AgentProfile;
```

```typescript
// e2e/projects/claude-sdk/evals/weather-tool.eval.ts —— 整个文件就这三行
import { weatherTool } from "../../../shared/evals.ts";
import profile from "../profile.ts";

export default weatherTool(profile);
```

```typescript
// e2e/shared/evals.ts(节选)
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";
import type { AgentProfile } from "./profile.ts";

export function weatherTool(p: AgentProfile) {
  return defineEval({
    description: "问天气必须调用天气工具(正调)",
    async test(t) {
      await t.send("北京今天天气怎么样?");
      t.succeeded();
      t.calledTool(p.weatherToolName, { input: { city: "北京" } });
      t.notCalledTool("send_email");
      t.check(t.reply, includes("25"));
    },
  });
}

export function noToolChitchat(p: AgentProfile) {
  return defineEval({
    description: "寒暄不该调用任何工具(反调)",
    async test(t) {
      await t.send("你好,介绍一下你自己。");
      t.succeeded();
      t.usedNoTools();
      t.notCalledTool(p.weatherToolName);
    },
  });
}
```

断言逻辑改一处、全矩阵生效;某个 SDK 的协议差异只体现在它自己的 profile 里,diff 一眼可见。experiment 同理:`ciExperiment(agent, profile)` 按 profile 过滤 eval 集(`hitl: false` 的项目不排 hitl 用例),每个项目的 `experiments/ci.ts` 也是 3 行 stub。

**防静默失配**:profile 关掉一个能力,对应 eval stub 就不该存在于该项目——verify.mjs 按 profile 算出每个项目的期望 eval 数,和 `summary.json` 的 results 数对账,防止"少排了用例还全绿"。

### 3.2 apps:拷贝自 tier1,允许受控漂移

`e2e/apps/<name>` 从 `examples/zh/tier1/<name>` 拷贝,保留原有的高位端口分配,只加一件事:**确定性 mock 开关**——CI 要 100% pass,被测应用就不能连真模型。规则和现有 `examples/zh/ai-sdk` 的 `AGENT_MODE=mock` 一致:提示词含"天气"就走一次天气工具调用并回答含 "25" 的固定文案,否则纯文本寒暄作答。mock 发生在**模型层**,SDK 的协议栈(流式帧、工具调用事件、HITL 中断)全部真实走一遍——这正是 e2e 要测的东西。

各 SDK 的 mock 可行性不同,按下表分层(不确定的先验证再落地,验证结果记 `memory/`):

| app | mock 策略 | 进 PR 门禁? |
|---|---|---|
| ai-sdk-v7 | app 内加 mock 分支(AI SDK 支持自定义 LanguageModel,或规则函数直出) | 是 |
| langgraph | LangChain 系有 FakeChatModel 类工具,Python 侧替换模型即可 | 是 |
| pi-sdk | 待验证 pi SDK 的模型注入点;不可行则留 nightly | 待验证 |
| claude-sdk | Claude Agent SDK 走 claude CLI → Anthropic API,mock 要 `ANTHROPIC_BASE_URL` 指本地 API 形状 mock,可行性待验证;不可行则留 nightly | 待验证 |
| codex-sdk | 同理,待验证 codex 的 base-url 注入;不可行则留 nightly | 待验证 |

拷贝的代价是和 tier1 漂移。缓解:`scripts/sync-tiers.mjs` 已经在做 origin → tier1 的同步,给它加一条 tier1 → `e2e/apps` 的 check(允许 mock 开关相关文件在白名单里差异),`pnpm tiers:check` 顺带守住。e2e/apps 的定位是"协议保真的测试夹具",不承担 tier1 的文档叙事职责,允许它为可测性加代码。

### 3.3 mock-ai-sdk / mock-http:不依赖任何 app 的框架基线

即使 claude-sdk / codex-sdk 的 mock 验证不可行,PR 门禁也必须有一个永远零依赖的全绿基线。`e2e/projects/mock-ai-sdk` 和 `mock-http` 不需要 `e2e/apps` 里的任何应用,只消费 `scripts/mock-server.mjs` 起的本地确定性 server:

- **mock-ai-sdk**:`defineAgent` + 官方 `fromAiSdk` 转换器。server 的 `/chat` 返回贴近 AI SDK `generateText` 结果形状的 JSON(`fromAiSdk` 不 import `ai` 包、只认形状,见 `src/agents/ai-sdk.ts`),adapter `fetch` 后用 `fromAiSdk` 转标准事件流,不手写映射。
- **mock-http**:`defineAgent` + 手写映射,自定义 JSON 协议,实现参照 `examples/zh/ai-sdk/adapter/adapter.ts` 裁剪。

两个项目复用同一份 shared 套件(profile:`usage: false, hitl: false`),分别覆盖"官方转换器"和"自写映射"两条官方支持的事件流生成方式。`runs: 100`、deliberate-fail/error、缓存行为这些框架级专项也都挂在这两个项目上,因为它们最便宜、最确定。

deliberate-fail / deliberate-error 这类"故意红"的 fixture 只进 `verdicts` 实验(不进 `ci`),由 verify.mjs 以"期望 exit 1"的方式正向消费——这是第 1 节"正反验证"在退出码层的那一半。

## 4. 三层执行模型

按"需要什么秘密、花多少钱、多久跑一次"分三层:

| 层 | 触发 | 秘密/外部依赖 | 跑什么 |
|---|---|---|---|
| **L0 框架 + 适配矩阵**(mock) | 每个 PR + push main | 无 | `e2e/projects/*` 全矩阵:mock-ai-sdk / mock-http 必跑;apps 里 mock 已落地的 SDK 项目逐个纳入。共享套件 100% pass + verdicts 期望 exit 1 + `runs: 100` 统计 + 缓存行为 |
| **L1 示例冒烟**(mock) | 每个 PR + push main | 无 | `examples/zh/ai-sdk` 在 `AGENT_MODE=mock` 下真的能 `niceeval exp` 跑绿——保证公开示例不烂 |
| **L2 真实层** | nightly cron + 手动 dispatch | 各家 API key;Docker | e2e/projects 切真模型跑同一份套件(验证 mock 没有把真实协议测歪)+ 沙箱矩阵 + judge 真产分 |

L0/L1 是合并门禁;L2 是每日健康信号(真模型有随机性,不阻塞 PR)。注意 L0 里"CI 起 app"不违反 tier1 的"eval 不代管进程"原则——起应用的是 CI workflow(扮演用户),不是 eval 框架。

### 4.1 L0 的 100% pass 语义

mock 是确定性的,所以期望值是精确的,verify.mjs 对每个项目断言:

- `ci` 实验:exit 0,且 `passed === 期望 eval 数 × runs, failed === 0, errored === 0`;期望 eval 数由该项目 profile 推出(对账防少排,见 3.1)。
- `verdicts` 实验(仅 mock-ai-sdk / mock-http):exit 1,failed 与 errored 计数符合期望。
- `pass-100` 实验(仅 mock-ai-sdk):`runs: 100, earlyExit: false, maxConcurrency: 16`,断言 `passed === 200`(正反两条 eval × 100)。任何一次计数不对都说明调度/评分/汇总有回归。

### 4.2 L2:真实适配层(nightly)

两块内容。第一块:e2e/projects 里已接真模型开关的项目,用**同一份共享套件**跑 `--runs 2`,加 judge key 顺带验证 judge 断言真的产出分数而非 no-op;真模型允许波动,失败发通知(GitHub issue / 通知渠道)而不是标红 main。

第二块:沙箱矩阵,按"官方适配器 × 沙箱后端"取最小生成集,不做全叉乘:

| Job | agent | sandbox | 秘密 | eval 集 |
|---|---|---|---|---|
| claude-code × docker | `claudeCodeAgent()` | `dockerSandbox()` | `ANTHROPIC_API_KEY` | `sandbox-smoke` + `examples/zh/coding-agent-skill` 子集(`--runs 1`) |
| codex × docker | `codexAgent()` | `dockerSandbox()` | `CODEX_API_KEY` | `sandbox-smoke`;额外断言 `trace.json` 产生(codex 是唯一原生发 OTLP 的内置 agent,顺带覆盖 tracing 接收链路) |
| bub × docker | `bubAgent()` | `dockerSandbox()` | `BUB_API_KEY` | `sandbox-smoke` |
| claude-code × e2b | `claudeCodeAgent()` | `e2bSandbox({ template: "fasteval-agents" })` | `ANTHROPIC_API_KEY` + `E2B_API_KEY` | `sandbox-smoke` |
| claude-code × vercel | `claudeCodeAgent()` | `vercelSandbox()` | `ANTHROPIC_API_KEY` + Vercel token | `sandbox-smoke`(注意 vercel session 寿命 ~360s 上限,eval 要够小) |

`sandbox-smoke` 也是 shared 里的 factory(`sandboxTools: true` 的 profile 才排):让 agent 创建一个指定内容的文件,断言 `t.sandbox.fileChanged` + `diff` 内容——目标是验证"沙箱起得来、agent 装得上、transcript 读得回",不是考模型能力,所以提示词要简单到几乎不可能失败。

已知约束(来自项目 memory,落地时直接采纳):e2b 的 `base` 模板 node20/481MB 会 OOM,必须用预制的 `fasteval-agents` 模板;vercel 后端默认并发 1(避免 429),session 上限约 360s;沙箱内不要 hardcode `/home/node`。

L2 每个 experiment 都设 `budget`(建议单 job ≤ $2)和 `timeoutMs`,workflow 层再加 job timeout 兜底。

## 5. 元校验脚本(e2e 的"真正的测试")

L0 的本体不是那些 eval——eval 是 fixture;本体是 `e2e/scripts/verify.mjs`:它把 CLI 当黑盒子进程跑,对照期望表校验退出码和 `summary.json`:

```javascript
// e2e/scripts/verify.mjs(示意)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PROJECTS = [
  { dir: "projects/mock-ai-sdk", exp: "ci",       expectExit: 0, expect: exactCounts(profileOf("mock-ai-sdk")) },
  { dir: "projects/mock-ai-sdk", exp: "verdicts", expectExit: 1, expect: { failedAtLeast: 1, erroredAtLeast: 1 } },
  { dir: "projects/mock-ai-sdk", exp: "pass-100", expectExit: 0, expect: { passed: 200, failed: 0, errored: 0 } },
  { dir: "projects/mock-http",   exp: "ci",       expectExit: 0, expect: exactCounts(profileOf("mock-http")) },
  { dir: "projects/ai-sdk-v7",   exp: "ci",       expectExit: 0, expect: exactCounts(profileOf("ai-sdk-v7")) },
  // ... 其余已接 mock 的 SDK 项目
];

for (const c of PROJECTS) {
  const code = runNiceeval(c.dir, ["exp", c.exp, "--force", "--junit", `junit-${c.exp}.xml`]);
  assert.equal(code, c.expectExit, `${c.dir}/${c.exp} 退出码`);
  const summary = JSON.parse(readFileSync(latestRunDir(c.dir) + "/summary.json", "utf8"));
  assertCounts(summary, c.expect);   // exactCounts 按 profile 推期望 eval 数,对账防少排
}
```

verify.mjs 还负责两个专项:

- **缓存行为**:同一 experiment 连跑两次,第二次**不带** `--force` → 断言 summary 里携入的 cached 结果仍计为 passed 且没有真跑(比较 `durationMs` 或 attempt 工件时间戳);第二次**带** `--force` → 断言全部真跑。这把"CI 忘了 --force 会静默跳过"的坑变成被测行为。
- **工件形状**:抽查一个 attempt 目录,断言 `events.json` 是 JSON array、`summary.json` 顶层有 `format/schemaVersion/producer/passed/failed/errored/results[]`、`results[].artifactsDir` 指向存在的目录。防止 results-format 无声漂移。

## 6. L1:示例冒烟层

目的只有一个:公开示例必须能按 README 跑通。首选 `examples/zh/ai-sdk`,因为它的 server 有零 key 的 `AGENT_MODE=mock`:

```yaml
# job 示意
- run: pnpm install --dir examples/zh/ai-sdk
- run: AGENT_MODE=mock node server &   # 起 127.0.0.1:5188,等端口就绪
- run: pnpm exec niceeval list         # eval 发现冒烟
- run: pnpm exec niceeval exp compare-models --runs 1 --force --junit junit.xml
```

验收前提(落地时先确认,不满足就先修示例的 mock):mock 模式下 `weather-tool` 等 gate 断言必须可过——即 mock server 对天气提问要真的产生 `get_weather` 工具调用事件。judge 断言无 key 自动跳过,正好符合本层"零秘密"的定位。

注意 L1 和 L0 的分工:L0 测的是框架和适配层(fixture 允许为可测性改造);L1 测的是"用户照 README 操作会不会翻车"(fixture 一个字都不许为 CI 改)。`examples/zh/tier1/*` 不进 L1——它们的可测化版本已经在 `e2e/apps` 里了。

## 7. Workflow 编排

新增 `.github/workflows/e2e.yml`:

```yaml
on:
  push: { branches: [main] }
  pull_request:
  schedule: [{ cron: "0 3 * * *" }]   # L2 nightly
  workflow_dispatch:

jobs:
  e2e-matrix:         # L0,PR 门禁
    runs-on: ubuntu-latest
    steps: [checkout, pnpm install, 起 mock server 与已接 mock 的 apps, node e2e/scripts/verify.mjs]

  e2e-examples:       # L1,PR 门禁
    runs-on: ubuntu-latest
    # 见第 6 节

  e2e-real:           # L2,仅 schedule / dispatch
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    strategy: { fail-fast: false, matrix: { target: [claude-docker, codex-docker, bub-docker, claude-e2b, claude-vercel, sdk-projects-real] } }
    runs-on: ubuntu-latest   # ubuntu runner 自带 Docker
```

所有 job 统一约定:

- 每次调用 `niceeval exp` 都带 `--force`(禁指纹缓存)+ `--junit <path>`;junit 和整个 `.niceeval/` 目录用 `actions/upload-artifact` 上传,失败时可下载 `events.json` / `trace.json` 排查。
- 成败判据 = 进程退出码;verify.mjs 层再做计数级校验。
- L0/L1 不配置任何 API key secret——judge 断言 no-op 是预期行为,一旦某个 mock 层 job 意外需要 key,说明 fixture 写错了。

## 8. 分阶段落地

1. **P1(先立骨架)**:建 `e2e/shared` + `e2e/projects/{mock-ai-sdk,mock-http}` + verify.mjs(共享套件、正反 eval、deliberate-fail/error、pass-100),加 `e2e-matrix` job 进 PR 门禁。这一步零外部依赖,收益最大——完整路径、正反断言、100 次统计、退出码、缓存行为全部落网,factory/profile 机制也在最便宜的项目上定型。
2. **P2**:拷 `examples/zh/tier1/ai-sdk-v7` 进 `e2e/apps`,加 mock 模型分支,`e2e/projects/ai-sdk-v7` 接入共享套件——第一个真实 SDK 协议栈进 L0 矩阵。同步确认/修好 `examples/zh/ai-sdk` 的 mock 可过 gate 断言,加 `e2e-examples` job。
3. **P3**:langgraph、pi-sdk 逐个验证 mock 注入点并进矩阵;claude-sdk / codex-sdk 的 base-url mock 可行性调研,结论记 `memory/`,不可行的留 L2。给 `sync-tiers.mjs` 加 tier1 → e2e/apps 的 drift check。
4. **P4**:补 `sandbox-smoke` factory;开 L2 的 claude-code × docker(第一条真实沙箱链路),随后铺满 L2 矩阵(codex / bub / e2b / vercel + sdk-projects 真模型 + judge)。
5. **之后**:给 mock 加"确定性失败注入"(如 server 每第 4 次请求返回坏答案)以校验非 0/100 的 pass 率计算;`e2e/projects/{codex-sdk,langgraph}` 的 OTel 瀑布图链路(`spanMapper` / 固定端口)补一条"trace.json 非空"的冒烟断言,纳入 L2。

## 9. 明确不做的

- 不做字面共享:不把同一份 `.eval.ts` 软链/复制进多个项目——discover 不跟随 symlink 条目,且各 SDK 的工具名和能力差异是协议现实,抹平它们等于测一个不存在的协议。共享的单位是 factory,差异收敛进 profile。
- 不和 tier1 共享 eval:`examples/zh/tier1` 的 eval 继续服务文档叙事,e2e 的套件独立编写、独立演进,两边不建同步关系;从 tier1 拷的只有应用和 adapter(受 drift check 约束),也不要求公开示例携带 CI 专用的 mock 开关(`examples/zh/ai-sdk` 本来就有的除外)。
- 不测"OTel 派生事件"这类断言——OTel 只喂瀑布图,e2e 要测的是它产出了 `trace.json`,不是它替代了事件映射。
- 不在 PR 门禁里跑任何真模型——随机性 + 费用 + secret 暴露面都不适合。
- 不用 `--tag` 做 CI 内的用例切分(当前实现只收单值,与文档不一致;分层用 experiment 的 `evals` 过滤器表达,更明确)。
- 版本字段只做格式契约校验,不把具体 `producer.version` 写死到测试里;版本不兼容的读取行为由 view loader 自己测。
