# E2E CI(部分落地)

> 状态:核心骨架已落地并在本地跑绿(2026-07-07)。`e2e/` 目录已建:shared factory/profile 套件、从 tier1 拷来的五个被测应用(`e2e/apps/`)、五个 SDK 薄项目(`e2e/projects/`)、`e2e/scripts/verify.mjs`——全矩阵 6 次 CLI 调用(5 个 ci 全绿 exit 0 + ai-sdk-v7 verdicts 按期望 exit 1)全部符合期望表。**沙箱矩阵部分落地(2026-07-09)**:4.2 表格前两行——claude-code × docker、codex × docker——已建成 `e2e/projects/claude-code` / `e2e/projects/codex` 并在本地跑绿(sandbox-smoke + basic-qa/session-isolation/create/modify/run-command + skills/MCP 正反配对 + verdicts;verify.mjs 加了对应期望行,pre 检查从端口探活换成 docker daemon 可达)。与 4.2 原文的偏差如实记:eval 集比"只跑 sandbox-smoke"宽(adapter 的 `skills:` / `mcpServers:` / `--resume` 链路都纳入了正反配对);codex 的"trace.json 产生"专项断言未加(tracing 链路已在跑、日志可见 span 数,断言留给 nightly 落地时)。skill 载体选 `Effect-TS/skills`(单 skill、触发条件明确);`npx skills add` headless 卡死修在 adapter(加 `-y -a <agent>`,见 `memory/npx-skills-add-headless-hang.md`);skill/MCP 断言的协议差异全部进 profile(`skillDetection` / `mcpToolName`,实测结论见 `memory/claude-code-skill-tool-name-not-load-skill.md`、`memory/codex-no-native-skill-tool.md`、`memory/mcp-tool-naming-claude-vs-codex.md`)。**workflow 已接线**:`.github/workflows/e2e.yml` 的 L0 job + GitHub secrets 已建(2026-07-07);2026-07-09 新增 `e2e-sandbox` job(nightly cron + 手动 dispatch,跑 `verify.mjs sandbox` 组;L0 job 收窄为 `verify.mjs sdk` 组,沙箱矩阵不做全量 PR 门禁),verify.mjs 的过滤参数因此支持 `sdk` / `sandbox` 两个组名。同日追加三处 workflow 调整:①`e2e-sandbox` 增加**按改动路径的 push 触发**——`detect-sandbox-paths` job 对比 `github.event.before..sha` 的 diff,命中 `src/sandbox/`、`src/agents/`、`e2e/projects/{claude-code,codex}/`、`e2e/shared/`、`e2e/scripts/` 或 e2e.yml 本身才跑沙箱矩阵,判不出 base(新分支/force push)时 fail-open 当命中;②concurrency 从 workflow 级拆到 job 级——SDK 矩阵保持新 push 顶掉旧的,沙箱矩阵改为 `cancel-in-progress: false`(当天实测两次 20+ 分钟的沙箱 run 被后续 docs push 连环取消,workflow 级 cancel 会让长 job 永远跑不完);③落地 4.2 说的"nightly 失败发 GitHub issue"(同名 open issue 追评,只对 schedule 事件发,push 触发的失败在 commit 状态里已可见)。**尚未落地**:`aisdk-transformer` / `http-mapping` 两个纯框架项目、示例冒烟 job(第 6 节,P0 文档债也还没修)、L1 的完整模型矩阵(第一块)、沙箱矩阵的 bub × docker / e2b / vercel 三行。与原提案的实现偏差:verdicts fixture 挂在最便宜的 ai-sdk-v7 上(纯框架项目未建);`ciExperiment(agent)` 不吃 profile——能力过滤靠"stub 文件是否存在",ci/verdicts 切分靠 `evals` 谓词按 `deliberate-` 前缀(沙箱项目再加 `feature-` 前缀把 skills/MCP 正例切给单独的 features 实验,由挂了对应配置的 agent 跑);profile 实际字段是 `weatherToolName / calcToolName / usage / sandboxTools / workspaceDir` 加沙箱矩阵新增的 `workspace / skillName / skillDetection / skillInstallDir / mcpToolName`(hitl 由 `calcToolName` 非空推导);`e2e/apps` 不是逐字节拷贝而是**只保 backend 的协议夹具**——前端、vite/开发工作流、langgraph 的 node 侧文件和 Jaeger compose 都已裁掉(前端不参与被测协议,裁掉能显著缩短 CI 安装),将来 tier1 → e2e/apps 的 drift check 对比范围只框 `src/backend/`;另注意 `budget` 护栏对不报 usage 的 agent 无法执行(见 `memory/e2e-suite-landing-gotchas.md`)。
>
> 本文其余部分保持原提案文本——用真实的 `niceeval exp` 全链路(发现 → 调度 → 断言 → 评分 → artifact → 退出码)验证框架和官方适配路径,而不是只跑 typecheck。当前 `.github/workflows/ci.yml` 只有 typecheck / site:build / docs 校验,没有任何 workflow 真正执行过 eval。**e2e 全程不允许假 AI**:所有被测应用和框架级项目都调真实模型,CI 里的 key 从 GitHub Actions secrets 注入,本地开发者自己在 `.env` 放真实 key——这和 `examples/zh/origin` 那 6 个示例的既有政策一致(见 `memory/origin-examples-real-ai-credentials.md`),e2e 不搞例外。

## 1. 目标

一次 e2e CI 要同时证明五件事:

1. **完整路径**:从 `evals/` 发现、experiment 展开运行矩阵、`t.*` 断言收集、gate/soft 判定、`.niceeval/<experiment>/<snapshot>/` artifact 落盘,到进程退出码,每一环都被真实执行并被机器校验——包括"该红的时候红"(deliberate-fail 必须 exit 1),不是只测 happy path。
2. **一套 suite,全矩阵可靠通过**:所有 SDK 适配项目共用**同一份** eval/experiment 定义(单一事实来源,见第 3 节),CI 把每个项目都跑一遍。真实模型跑真实调用,单次尝试允许抖动,但有限重试(见 4.1)吸收不了的失败一定是真回归——任何一个 SDK 的适配层回归都会把矩阵打红,不会被"模型这次没答好"这种噪音长期掩盖,也不会被 retry 永久掩盖。
3. **正反验证所有功能**:套件对每个功能都配正反两条用例——该调工具时 `t.calledTool`、不该调时 `t.notCalledTool`/`t.usedNoTools`、HITL 有 approve 也有 deny、会话有记忆也有 `newSession` 隔离;再加 deliberate-fail/error 验证"断言真的会挂"。防止"断言永真"这类静默失效。
4. **重复运行统计**:一个 experiment 配 `runs: N, earlyExit: false` 跑重复调度、并发、pass 率计数(niceeval 的字段就叫 `runs`,不叫 pass/trials;`earlyExit` 不关掉的话第一次通过就会 abort 其余 attempt,拿不到完整分布)。真实模型调用要花钱,PR 门禁上 `N` 取小值(如 10),完整的大样本统计(如 100)挪到 nightly 跑,见第 4 节。
5. **官方适配矩阵**:内建 `uiMessageStreamAgent`、`fromAiSdk`/`fromClaudeSdkMessages`/`fromCodexThreadEvents`/`fromPiAgentEvents` 转换器、自写 `defineAgent` 映射,以及沙箱型 claude-code / codex / bub × docker / e2b / vercel,每条官方路径至少一条 CI 覆盖。

## 2. 现状盘点

### tier1 的 eval 只当证据看,不复用

e2e 从 tier1 拷的是**被测应用和 adapter**(各 SDK 真正不同的部分);eval/experiment 套件在 e2e 里围绕功能覆盖矩阵**全新编写**,不搬 tier1 五个项目的 eval 文件——那些是文档叙事的示例,职责不同。但 tier1 的 eval 仍然值得盘点一次,因为它们是"一套 eval 能不能字面共享"的现成证据:`examples/zh/tier1/{ai-sdk-v7,claude-sdk,pi-sdk,langgraph}` 四个项目的 `evals/` 文件名完全一致(`basic-qa` / `weather-tool` / `hitl-approve` / `hitl-deny` / `session-isolation`;`codex-sdk` 是 coding agent,另有 `create-file` / `run-command`),实际 diff 过,**字面并不同构**,差异全部来自 SDK 协议本身:

- claude-sdk 的工具名是 MCP 命名空间下的 `mcp__demo-tools__get_weather`,不是裸的 `get_weather`;
- basic-qa 是否断言 `t.maxTokens` 取决于该 SDK 协议给不给 usage(UI Message Stream 协议帧里没有 usage,pi-sdk 的 `message_end` 里有);
- codex-sdk 没有 HITL 和 weather 工具,功能集不同。

所以 e2e 的"一套 eval"不能靠字面复制或软链实现,要靠参数化新写(见第 3 节);tier1 的这些差异正好告诉我们 profile 里要有哪些开关。另外源码层面确认:`src/runner/discover.ts` 固定扫 `<root>/evals` 与 `<root>/experiments`,`walkFiles` 用 Dirent 的 `isDirectory()/isFile()` 判断——**symlink 条目两者都返回 false,逐文件或逐子目录软链不会被发现**;整个 `evals/` 目录本身做软链虽可行(readdir 跟随路径),但前提是文件逐字同构,上面已经否定了。

另外,tier1 各项目本来就已经在调真实模型——`claude-sdk`/`pi-sdk`/`langgraph` 的 backend 用 `process.env.AGENT_MODEL ?? "deepseek-v4-flash"` 走 DeepSeek 兼容端点,`codex-sdk` 默认 `"gpt-5.4"` 走 Codex 代理,凭据映射和 `examples/zh/origin` 一致(见 `memory/origin-examples-real-ai-credentials.md`)。e2e/apps 直接复用这套映射即可,不需要为"跑得起来"发明新机制,只需要在 CI 里把对应 key 从 GitHub Actions secrets 注入(见第 3.2、7 节)。

### `examples/zh/ai-sdk` 的 README 是需要清理的过期文档

`examples/zh/ai-sdk/README.md` 现在写着"默认是 `AGENT_MODE=mock`,不需要 API key",但实测 `src/server.ts`、`src/ai-sdk-runtime.ts`、`src/models.ts` 里**完全没有** `AGENT_MODE` 分支或任何 mock provider——`resolveModel()` 无条件要求真实 `OPENAI_API_KEY`/`DEEPSEEK_API_KEY`,`.env.example` 里也不提 `AGENT_MODE`。这条 mock 声明本身就是过期文档,不是 e2e 该保留或恢复的能力——落地 L1(第 6 节)之前要先把 README 这几行改成真实 key 说明,而不是去"实现"一个文档里写着但代码里没有、而且按项目政策也不该有的 mock 分支。

### 框架侧对 CI 重要的事实(源码已确认)

- **退出码**:按 eval 级折叠判定(任一 attempt 通过 → 该 eval 通过,`foldEvalVerdict`;被 runs+earlyExit 重试吸收的失败不计红)——折叠后全过/跳过 → 0;任一 eval failed 或 errored → 1;框架崩溃 → 2(`src/cli.ts` 末尾 + `src/shared/verdict.ts`)。CI 判成败首选退出码,细分读落盘的每个 attempt `result.json`(注意判决只逐条记在 attempt 级,没有 run 级的 passed/failed 聚合字段,见 `memory/cli-exit-code-attempt-level-not-eval-level.md`)。
- **指纹缓存会静默跳过上次 passed 的 eval**(`src/runner/run.ts` 的 `runEvals()`,以 `cacheKey`/`computeFingerprint` 为核心)。CI 必须加 `--force`,或保证 `.niceeval/` 不跨 run 复用,否则回归会被缓存掩盖。
- **judge 无 key 时 no-op**(`src/scoring/judge.ts` 的 `resolveJudge()`/`buildJudge()`,`if (!resolved.apiKey) return noOpJudge()`):不配 judge key,`t.judge.autoevals.*` 断言静默跳过、不判红。e2e 里"judge 真的在判"必须显式配 judge key 验证,不能靠这条 no-op 蒙混过关——这一点和是否用真实模型无关,是两个独立的开关。
- **可用 flags**:`--runs`、`--no-early-exit`、`--force`、`--junit <path>`、`--json <path>`(RunSummary 落成 JSON)、`--strict`、`--max-concurrency`。**不要用** `--reporter`(不存在)、`--agent`/`--model`(exp 下报错)、`--sandbox`/`--watch`(不存在,按未知 flag 报错)。
- **`runs` 的语义**:每个 `(agent × model × eval)` 组合跑 `runs` 次;被 earlyExit abort 的 attempt 不计入分母。

## 3. 核心设计:`e2e/` 里一份共享套件 + 每个 SDK 一个薄项目

新建 `e2e/` 目录(与 `examples/`、`src/` 平级),里面三种东西:一份**全新编写**的共享 eval/experiment 定义(不复用 tier1 的 eval 文件)、从 tier1 拷来的被测应用与 adapter、每个 SDK 一个只剩"绑定"职责的薄 niceeval 项目:

```text
e2e/
  shared/                        # 唯一一份 eval / experiment 定义(单一事实来源)
    profile.ts                   # AgentProfile 类型:工具名、能力开关
    evals.ts                     # weatherTool(p) / basicQa(p) / hitlApprove(p) ... 的 factory
    experiments.ts               # ciExperiment(agent, p) / passN(agent, p) factory
    verdicts.ts                  # deliberateFail() / deliberateError() factory(只进 verdicts 实验)
  apps/                          # 被测应用,从 examples/zh/tier1/<name> 拷来,原样保留真实调用
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
    aisdk-transformer/           # 纯框架项目:defineAgent + 官方 fromAiSdk,进程内直调真实 DeepSeek
    http-mapping/                # 纯框架项目:defineAgent + 手写映射,进程内直调真实 DeepSeek REST
  scripts/
    verify.mjs                   # 元校验:跑 CLI 子进程,对照期望表检查退出码 + 落盘的快照/result.json
```

### 3.1 为什么是 factory + profile,不是软链

eval 定义本来就不 import agent(agent 由 experiment 绑定),所以共享 eval 在框架模型上是顺的;挡路的只有两件事:discover 只认 `<root>/evals` 下的实体文件(symlink 条目不被发现,见第 2 节),以及各 SDK 的协议差异(工具名、usage、HITL 支持)。两个问题一个解法——共享层导出**参数化的 factory**,每个项目用一个 `profile.ts` 声明自己的协议现实,`evals/` 下只放 stub 文件喂给 discover:

```typescript
// e2e/shared/profile.ts(与源码同步)
export interface AgentProfile {
  weatherToolName: string | null;  // "get_weather" 或 MCP 命名空间名;coding agent 为 null
  calcToolName: string | null;     // 经审批门控的计算器;不支持 HITL(codex-sdk)为 null
  searchToolName: string | null;   // 网络搜索工具;只有 ai-sdk-v7 的被测应用注册了
  usage: boolean;                  // 协议是否携带 usage(决定 basic-qa 是否断言 maxTokens)
  sandboxTools: boolean;           // 是否是 coding agent(决定 create-file/run-command 等是否生效)
  workspaceDir?: string;           // coding agent 的工作目录(eval 直接读磁盘核实)
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

**防静默失配**:profile 关掉一个能力,对应 eval stub 就不该存在于该项目——verify.mjs 按 profile 算出每个项目的期望 eval 数,和落盘的 attempt `result.json` 数对账,防止"少排了用例还全绿"。

### 3.2 apps:拷贝自 tier1,真实 key 从 secrets 注入

`e2e/apps/<name>` 从 `examples/zh/tier1/<name>` 拷贝,保留原有的高位端口分配,**不加任何 mock 分支**——tier1 里这些应用本来就已经是真实调用(`AGENT_MODEL ?? "deepseek-v4-flash"` / Codex 代理),e2e 直接复用同一套凭据映射即可。CI 里跑这些应用时,workflow 把 `DEEPSEEK_API_KEY`(claude-sdk / pi-sdk / langgraph / ai-sdk-v7,分别走 Anthropic 兼容和 OpenAI 兼容两个 base URL)、`CODEX_API_KEY`(codex-sdk)从 GitHub Actions secrets 注入进子进程环境,本地开发者跑同样的套件就在自己的 `.env` 里放同一把 key(和 tier1 项目现在的开发方式完全一致,没有新概念)。

为了让 PR 门禁的花费可控,e2e/apps 统一钉住**便宜模型**(DeepSeek `deepseek-v4-flash` / Codex 代理默认模型),更贵的模型对比矩阵挪到 4.2 的 nightly 层。

拷贝的代价是和 tier1 漂移。缓解:`scripts/sync-tiers.mjs` 已经在做 origin → tier1 的同步,给它加一条 tier1 → `e2e/apps` 的 check,`pnpm tiers:check` 顺带守住。e2e/apps 的定位是"协议保真的测试夹具",不承担 tier1 的文档叙事职责,允许它为可测性加代码(比如把端口做成可配置的),但不允许加假响应。

### 3.3 aisdk-transformer / http-mapping:不依赖任何 app 进程的框架基线

PR 门禁需要一个启动成本最低、最便宜的真实基线,不依赖起 5 个 SDK app 进程。`e2e/projects/aisdk-transformer` 和 `http-mapping` 不需要 `e2e/apps` 里的任何应用——adapter 在进程内直接调真实 DeepSeek,不经过任何被测服务器:

```typescript
// e2e/projects/aisdk-transformer/agents/aisdk-transformer.ts(示意)
import { defineAgent } from "niceeval";
import { fromAiSdk } from "niceeval/agents/ai-sdk";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import { z } from "zod";

const deepseek = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

export default defineAgent({
  name: "aisdk-transformer",
  async send(ctx) {
    const result = await generateText({
      model: deepseek.chat("deepseek-v4-flash"),
      messages: ctx.messages,
      tools: {
        get_weather: tool({
          inputSchema: z.object({ city: z.string() }),
          execute: async ({ city }) => ({ city, tempC: 25, condition: "晴" }),
        }),
      },
    });
    return fromAiSdk(result);   // 官方转换器,真实的 generateText 结果直喂
  },
});
```

- **aisdk-transformer**:`defineAgent` + 官方 `fromAiSdk` 转换器,喂真实 `generateText` 结果(不是伪造成 AI SDK 形状的假数据)。
- **http-mapping**:`defineAgent` + 手写映射,直接 `fetch` DeepSeek 的 chat completions REST 接口,自己把 JSON 响应映射成标准事件流,实现参照 `examples/zh/ai-sdk/adapter/adapter.ts` 裁剪。

两个项目复用同一份 shared 套件(profile:`usage: false, hitl: false`),分别覆盖"官方转换器"和"自写映射"两条官方支持的事件流生成方式,都是对真实 DeepSeek 端点的真实调用——省的是"起被测服务器进程"和"更贵的模型"这两项成本,不是省"真实推理"这一项。`runs: N` 统计、deliberate-fail/error、缓存行为这些框架级专项都挂在这两个项目上,因为它们最便宜、启动最快。

deliberate-fail / deliberate-error 这类"故意红"的 fixture 设计成**对模型输出不敏感**——比如断言一个真实压根不会被调用的工具名(`t.calledTool("this_tool_does_not_exist")`),或者给 adapter 喂一个格式错误的输入触发运行时异常——不管真实模型这次答得好不好,这两条断言都必然会挂,不依赖任何伪造的坏响应。只进 `verdicts` 实验(不进 `ci`),由 verify.mjs 以"期望 exit 1"的方式正向消费——这是第 1 节"正反验证"在退出码层的那一半。

## 4. 两层执行模型

不再按"要不要秘密"分层(e2e 全程都要真实 key),而是按"多久跑一次、花多少钱、跑多大的模型/样本量"分两层:

| 层 | 触发 | 模型 & runs | 跑什么 |
|---|---|---|---|
| **L0 PR 门禁**(真实 key,便宜模型) | 每个 PR + push main | `deepseek-v4-flash` 等便宜模型;`runs: 3, earlyExit: true`(第一次过就收尾,吸收单次抖动) | `e2e/projects/*` 全矩阵:aisdk-transformer / http-mapping 必跑;apps 里已接入的 SDK 项目逐个纳入。共享套件通过 + verdicts 期望 exit 1 + `runs` 统计(小样本) + 缓存行为 |
| **L1 真实矩阵**(nightly) | schedule cron + 手动 dispatch | 完整官方模型矩阵(gpt-4o、gpt-5.4 等) + `runs: 20~100`,统计更稳的通过率分布 | 同一份共享套件切到完整模型矩阵 + judge 真产分(配 judge key)+ 沙箱矩阵 |

L0 是合并门禁;L1 是每日健康信号(模型矩阵更贵、样本更大,允许波动,不阻塞 PR)。注意 L0 里"CI 起 app"不违反 tier1 的"eval 不代管进程"原则——起应用的是 CI workflow(扮演用户),不是 eval 框架。`examples/zh/ai-sdk` 的示例冒烟(原第 6 节的"L1")并入 L0 的 PR 门禁,作为独立 job 跑,详见第 6 节。

### 4.1 L0 的通过语义:确定性部分精确断言,模型相关部分容忍抖动

verify.mjs 对每个项目区分两类断言:

- **确定性部分**(和真实模型答得好不好无关):discover 出的 eval 数量按 profile 精确对账(防止少排用例);`verdicts` 实验里 deliberate-fail/error 的失败/报错次数是精确断言,因为这些 fixture 本来就设计成对模型输出不敏感。
- **模型相关部分**(工具是否调对、judge 打分):允许有限重试吸收单次抖动——`runs: 3, earlyExit: true`,一次通过就算过。断言口径从"exact count"改成"通过率下限",例如 `ci` 实验断言 `passed >= 期望 eval 数 × 0.95`(留一点余量给真实模型的单次波动;如果某个 eval 连续 3 次都没过,说明是适配层真回归,不是抖动,矩阵照样打红)。

```javascript
// e2e/scripts/verify.mjs(示意,节选)
const PROJECTS = [
  { dir: "projects/aisdk-transformer", exp: "ci",      expectExit: 0, expect: toleratedCounts(profileOf("aisdk-transformer")) },
  { dir: "projects/aisdk-transformer", exp: "verdicts", expectExit: 1, expect: { failedAtLeast: 1, erroredAtLeast: 1 } },
  { dir: "projects/aisdk-transformer", exp: "pass-n",   expectExit: 0, expect: { passedAtLeast: 18 /* 2 条 eval × 10 runs,留 10% 余量 */ } },
  { dir: "projects/http-mapping",      exp: "ci",       expectExit: 0, expect: toleratedCounts(profileOf("http-mapping")) },
  { dir: "projects/ai-sdk-v7",         exp: "ci",       expectExit: 0, expect: toleratedCounts(profileOf("ai-sdk-v7")) },
  // ... 其余已接入的 SDK 项目
];
```

### 4.2 L1:nightly 真实矩阵 + 沙箱

两块内容。第一块:e2e/projects 里的共享套件切到**完整官方模型矩阵**,`--runs 20` 起步,加 judge key 顺带验证 judge 断言真的产出分数而非 no-op;更大的模型矩阵和样本量本来就更贵更慢,放 nightly 而不是 PR 门禁,失败发通知(GitHub issue / 通知渠道)而不是标红 main。

第二块:沙箱矩阵,按"官方适配器 × 沙箱 provider"取最小生成集,不做全叉乘:

| Job | agent | sandbox | 秘密 | eval 集 |
|---|---|---|---|---|
| claude-code × docker | `claudeCodeAgent()` | `dockerSandbox()` | `ANTHROPIC_API_KEY` | `sandbox-smoke` |
| codex × docker | `codexAgent()` | `dockerSandbox()` | `CODEX_API_KEY` | `sandbox-smoke`;额外断言 `trace.json` 产生(codex 是唯一原生发 OTLP 的内置 agent,顺带覆盖 tracing 接收链路) |
| bub × docker | `bubAgent()` | `dockerSandbox()` | `BUB_API_KEY` | `sandbox-smoke` |
| claude-code × e2b | `claudeCodeAgent()` | `e2bSandbox({ template: "fasteval-agents" })` | `ANTHROPIC_API_KEY` + `E2B_API_KEY` | `sandbox-smoke` |
| claude-code × vercel | `claudeCodeAgent()` | `vercelSandbox()` | `ANTHROPIC_API_KEY` + Vercel token | `sandbox-smoke`(注意 vercel session 寿命 ~360s 上限,eval 要够小) |

`sandbox-smoke` 也是 shared 里的 factory(`sandboxTools: true` 的 profile 才排):让 agent 创建一个指定内容的文件,断言 `t.sandbox.fileChanged` + `diff` 内容——目标是验证"沙箱起得来、agent 装得上、transcript 读得回",不是考模型能力,所以提示词要简单到几乎不可能失败。

已知约束(来自项目 memory,落地时直接采纳):e2b 的 `base` 模板 node20/481MB 会 OOM,必须用预制的 `fasteval-agents` 模板;vercel provider 默认并发 1(避免 429),session 上限约 360s;沙箱内不要 hardcode `/home/node`。

L1 每个 experiment 都设 `budget`(建议单 job ≤ $2)和 `timeoutMs`,workflow 层再加 job timeout 兜底——PR 门禁(L0)因为跑得频繁,单个 job 的 `budget` 应该卡得更紧(建议 ≤ $0.5),便宜模型 + 小 runs 是控制单次 PR 成本的主要手段。

## 5. 元校验脚本(e2e 的"真正的测试")

L0 的本体不是那些 eval——eval 是 fixture;本体是 `e2e/scripts/verify.mjs`:它把 CLI 当黑盒子进程跑,对照期望表校验退出码和落盘的快照(完整示意见 4.1)。verify.mjs 还负责两个专项:

- **缓存行为**:同一 experiment 连跑两次,第二次**不带** `--force` → 断言携入新快照的 cached 结果(`result.json` 带 `artifactBase`)仍计为 passed 且没有真跑(比较 `durationMs` 或 attempt artifact 时间戳,顺带省一次真实调用的钱);第二次**带** `--force` → 断言全部真跑。这把"CI 忘了 --force 会静默跳过"的坑变成被测行为。
- **artifact 形状**:抽查一个快照,断言 `snapshot.json` 顶层有 `format/schemaVersion/producer/experimentId`、每个 attempt 目录下 `result.json` 顶层有 `id/verdict/attempt/assertions`,`events.json` 是 JSON array。防止 results-format 无声漂移。

## 6. L0 里的示例冒烟 job

目的只有一个:公开示例必须能按 README 跑通。首选 `examples/zh/ai-sdk`——落地前必须先完成第 2 节提到的清理:把 README 里"默认是 `AGENT_MODE=mock`"那几行改成真实 key 说明,因为代码里从来就没有这个开关。清理之后,这个 job 和 L0 里其它项目一样,从 GitHub Actions secrets 注入真实 key:

```yaml
# job 示意
- run: pnpm install --dir examples/zh/ai-sdk
- run: node server &                     # 起 127.0.0.1:5188,等端口就绪
  env:
    OPENAI_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
    OPENAI_BASE_URL: https://api.deepseek.com
    AGENT_MODEL: deepseek-v4-flash
- run: pnpm exec niceeval list            # eval 发现冒烟
- run: pnpm exec niceeval exp compare-models --runs 3 --force --junit junit.xml
```

验收前提(落地时先确认,不满足就先修示例本身,而不是加 mock 绕过去):`weather-tool` 等 gate 断言必须能在真实 DeepSeek 调用下稳定通过——即真实模型对天气提问确实会触发 `get_weather` 工具调用。judge 断言没配 judge key 时自动跳过,是否额外配 judge key 走完整评分是 nightly(4.2)的事,不是这个冒烟 job 的职责。

这个 job 和 e2e/projects 矩阵的分工:e2e/projects 测的是框架和适配层(fixture 允许为可测性改造);这个 job 测的是"用户照 README 操作会不会翻车"(fixture 一个字都不许为 CI 改)。`examples/zh/tier1/*` 不用这个 job 覆盖——它们的可测化版本已经在 `e2e/apps` 里了。

## 7. Workflow 编排

新增 `.github/workflows/e2e.yml`:

```yaml
on:
  push: { branches: [main] }
  pull_request:
  schedule: [{ cron: "0 3 * * *" }]   # L1 nightly
  workflow_dispatch:

jobs:
  e2e-matrix:         # L0,PR 门禁
    runs-on: ubuntu-latest
    env:
      DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
      CODEX_API_KEY: ${{ secrets.CODEX_API_KEY }}
    steps: [checkout, pnpm install, 起已接入的 apps, node e2e/scripts/verify.mjs]

  e2e-examples:       # 第 6 节的示例冒烟,PR 门禁
    runs-on: ubuntu-latest
    env:
      DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
    # 见第 6 节

  e2e-nightly:        # L1,仅 schedule / dispatch
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    strategy: { fail-fast: false, matrix: { target: [claude-docker, codex-docker, bub-docker, claude-e2b, claude-vercel, sdk-projects-full-matrix] } }
    runs-on: ubuntu-latest   # ubuntu runner 自带 Docker
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      CODEX_API_KEY: ${{ secrets.CODEX_API_KEY }}
      BUB_API_KEY: ${{ secrets.BUB_API_KEY }}
      E2B_API_KEY: ${{ secrets.E2B_API_KEY }}
      NICEEVAL_JUDGE_KEY: ${{ secrets.NICEEVAL_JUDGE_KEY }}
```

需要建的 GitHub repo secrets:`DEEPSEEK_API_KEY`(claude-sdk / pi-sdk / langgraph / ai-sdk-v7 / examples/zh/ai-sdk 共用,分饰 Anthropic 兼容与 OpenAI 兼容两个 base URL,同一把 key)、`CODEX_API_KEY`(codex-sdk & codex 沙箱)、`ANTHROPIC_API_KEY`(claude-code 沙箱)、`BUB_API_KEY`、`E2B_API_KEY`、Vercel token、`NICEEVAL_JUDGE_KEY`(nightly judge)。值可以复用 `examples/zh/origin` 已经在用的那套凭据(见 `memory/origin-examples-real-ai-credentials.md`),不需要重新申请。

所有 job 统一约定:

- 每次调用 `niceeval exp` 都带 `--force`(禁指纹缓存)+ `--junit <path>`;junit 和整个 `.niceeval/` 目录用 `actions/upload-artifact` 上传,失败时可下载 `events.json` / `trace.json` 排查。
- 成败判据 = 进程退出码;verify.mjs 层再做计数级校验(L0 用容忍区间,见 4.1)。
- 只有 pull_request 触发的 workflow 才能读到 repo secrets(同仓库 PR;fork 来的 PR 默认拿不到 secrets,这是 GitHub 本身的安全模型,不是本设计要解决的问题)——如果未来要支持 fork PR 跑 e2e,需要额外做 `pull_request_target` + 手动审核这类隔离,不在本提案范围内。

## 8. 分阶段落地

1. **P0(先修文档债)**:把 `examples/zh/ai-sdk/README.md` 里过期的 `AGENT_MODE=mock` 声明改成真实 key 说明,确认 `weather-tool` 等 gate 断言在真实 DeepSeek 调用下能稳定通过——这是第 6 节能落地的前提,和 e2e 骨架搭建可以并行。
2. **P1(先立骨架)**:建 `e2e/shared` + `e2e/projects/{aisdk-transformer,http-mapping}` + verify.mjs(共享套件、正反 eval、deliberate-fail/error、`runs: N` 统计),申请 `DEEPSEEK_API_KEY` secret,加 `e2e-matrix` job 进 PR 门禁。这一步依赖最小、成本最低——完整路径、正反断言、重复运行统计、退出码、缓存行为全部落网,factory/profile 机制也在最便宜的项目上定型。
3. **P2**:拷 `examples/zh/tier1/ai-sdk-v7` 进 `e2e/apps`,`e2e/projects/ai-sdk-v7` 接入共享套件、复用 P0 已修好的 secrets——第一个真实 SDK 协议栈进 L0 矩阵,加 `e2e-examples` job。
4. **P3**:langgraph、pi-sdk、claude-sdk、codex-sdk 逐个接入 `e2e/apps` 并纳入矩阵(凭据映射直接照抄 tier1,不需要额外调研)。给 `sync-tiers.mjs` 加 tier1 → e2e/apps 的 drift check。
5. **P4**:补 `sandbox-smoke` factory;开 L1 nightly 的 claude-code × docker(第一条真实沙箱链路),随后铺满 L1 矩阵(codex / bub / e2b / vercel + sdk-projects 完整模型矩阵 + judge)。
6. **之后**:`e2e/projects/{codex-sdk,langgraph}` 的 OTel 瀑布图链路(`spanMapper` / 固定端口)补一条"trace.json 非空"的冒烟断言,纳入 L1;评估 L0 的 retry/容忍区间参数(3.1 提到的 `runs: 3`、95% 阈值)是否需要按项目调整——不同 SDK 的真实抖动率可能不一样。

## 9. 明确不做的

- 不做字面共享:不把同一份 `.eval.ts` 软链/复制进多个项目——discover 不跟随 symlink 条目,且各 SDK 的工具名和能力差异是协议现实,抹平它们等于测一个不存在的协议。共享的单位是 factory,差异收敛进 profile。
- 不和 tier1 共享 eval:`examples/zh/tier1` 的 eval 继续服务文档叙事,e2e 的套件独立编写、独立演进,两边不建同步关系;从 tier1 拷的只有应用和 adapter(受 drift check 约束)。
- 不用任何形式的假 AI/本地 mock server:e2e 全程调真实模型,费用通过便宜模型、小 `runs`、per-experiment `budget` 护栏控制,不通过伪造响应控制;PR 门禁和 nightly 的区别是"模型、样本量、跑多勤",不是"真的假的"。
- 不测"OTel 派生事件"这类断言——OTel 只喂瀑布图,e2e 要测的是它产出了 `trace.json`,不是它替代了事件映射。
- 不用 `--tag` 切分 CI 用例层级；L0 / L1 / L2 的覆盖范围由各 experiment 的 `evals` 过滤器声明，使每层运行哪些 Eval 成为可签入、可审查的配置。
- 不支持 fork 来的 PR 跑需要 secrets 的 e2e job(GitHub 默认不把 secrets 传给 fork PR;需要更严格的隔离方案的话另开提案)。
- 版本字段只做格式契约校验,不把具体 `producer.version` 写死到测试里;版本不兼容的读取行为由 view loader 自己测。
