# Architecture

fastevals 把一个评测过程拆成四段职责:**发现**要跑什么、**驱动**被测对象产生结果、**评分**得出判决、**报告**落盘与回传。核心拥有这四段里对所有被测对象都一样的部分;被测对象的差异被收进 `Agent`(契约)/ `Adapter`(你写的实现)/ `Sandbox` 三层。

这条边界是有意为之的,理由见 [Vision](vision.md)。本篇给出模块分层、数据流,以及一次运行的端到端时序。

## 系统总览

```text
                          ┌──────────────────────────── core ────────────────────────────┐
  evals/                  │                                                               │
  ├─ *.eval.ts ──────────►│  Discovery ──► Runner ──► Scoring ──► Verdict ──► Reporters    │
  └─ fixtures/*/          │   (发现)       (调度)     (评分)      (判决)      (报告)         │
       PROMPT.md          │                  │                                  │          │
       EVAL.ts            │                  │ 驱动                              ▼          │
                          └──────────────────┼──────────────────────────  .fastevals/<run>/ │
                                             │
                                             ▼  对接口分发,不按名字分支
                          ┌──────────── Agent(自实现 Adapter)────────────┐
                          │  进程内 adapter   远程 adapter   沙箱 adapter   │
                          │  (你的 agent)    (你的服务)    ┌─────┴─────┐  │
                          │                               │ claude-code│  │
                          │                               │ codex / bub│  │
                          │                               └─────┬──────┘  │
                          │                                     ▼         │
                          │                               ┌── Sandbox ──┐ │
                          │                               │ docker      │ │
                          │                               │ vercel / 三方│ │
                          │                               └─────────────┘ │
                          └────────────────────────────────────────────────┘
```

四段职责是**单向数据流**:发现产出一批 `Eval`,运行器逐个对 Agent `send` 得到 `RunResult`,评分器把 `RunResult` 折叠成 `Assertion[]`,判决把断言折叠成一个 `Verdict`,报告器消费 `Verdict` + 工件。没有反向耦合 —— 评分器不知道 agent 的 transport 是进程内、HTTP 还是沙箱 CLI,它只看 `RunResult`。

## 模块分层

设想中的源码树(实现时以此为骨架):

```
src/
├─ index.ts                 # 公开导出:defineEval / defineAgentEval / defineConfig
├─ define-eval.ts           # 会话型 eval 定义 + 校验
├─ define-agent-eval.ts     # 沙箱型 eval 定义 + 校验
├─ define-config.ts         # 项目配置
├─ types.ts                 # 核心类型(Eval / Agent / RunResult / Verdict …)
│
├─ context/                 # `t` 上下文的构建
│  ├─ session.ts            #   会话驱动(send / respond / 多会话)
│  ├─ assertions.ts         #   作用域断言收集器
│  └─ sandbox-context.ts    #   沙箱型 `t`(diff / transcript / sandbox 句柄)
│
├─ expect/                  # 值级断言库(includes / equals / matches / similarity …)
│
├─ scoring/
│  ├─ scoped.ts             # 作用域断言(succeeded / calledTool / toolOrder …)
│  ├─ judge.ts              # LLM-as-judge
│  └─ verdict.ts            # 判决计算
│
├─ agents/                  # —— 连到 AI 的全部特殊性都在这里(自实现 Adapter)——
│  ├─ types.ts              #   Agent / Adapter 接口 + 能力位
│  ├─ define-agent.ts       #   defineAgent / defineSandboxAgent
│  ├─ registry.ts           #   注册表(按名字选)
│  ├─ shared.ts             #   沙箱型共享:prepareWorkspace / diff / 验证 / transcript 注入
│  ├─ claude-code.ts        #   内置沙箱 adapter
│  ├─ codex.ts
│  └─ bub.ts
│
├─ sandbox/                 # —— 沙箱型 agent 在哪里跑的全部特殊性都在这里 ——
│  ├─ types.ts              #   Sandbox 接口
│  ├─ resolve.ts            #   后端选择(auto / docker / vercel / …)
│  ├─ docker.ts
│  └─ vercel.ts
│
├─ o11y/                    # transcript 归一化 + o11y 派生
│  ├─ types.ts
│  └─ parsers/              #   各 agent 的 transcript 解析器
│
├─ runner/
│  ├─ run.ts                # 主调度(有界并发 / 重试 / 早停)
│  ├─ discover.ts           # eval & fixture 发现
│  ├─ fingerprint.ts        # 指纹缓存
│  └─ reporters/            # console / junit / json / 第三方
│
└─ cli.ts                   # CLI 入口
```

边界规则一句话:**`agents/` 和 `sandbox/` 之外的任何文件,都不应出现 agent 名字或 sandbox 名字的行为分支。** 核心拿到的是接口,不是名字。

## 两个授权面,共享一切下游

fastevals 有两个写 eval 的入口,但它们汇流到同一套评分 / 运行 / 报告:

| | `defineEval`(会话型) | `defineAgentEval` / Fixture(沙箱型) |
|---|---|---|
| 灵感来源 | eve evals | Vercel agent-eval |
| Task 形态 | `t.send(...)` 序列 | `PROMPT.md` |
| 典型 Agent | 进程内 / 远程 agent(会话型) | 沙箱 agent(coding agent + Sandbox) |
| `t` 暴露什么 | `send`/`reply`/`calledTool`/`judge` | 上述 + `sandbox`/`diff`/`transcript`/测试 |
| 评分手段 | expect + 作用域断言 + judge | 上述 + 跑 `EVAL.ts` |
| 共享 | **Scorer、Verdict、Runner、Reporter、Config、工件格式全部共享** | 同 → |

这张表是整个架构的中心论点:**两种范式只在"如何产生结果"上不同,在"如何判分、如何调度、如何记录"上完全一致。** 所以它们能住在同一个库里,而不是两个库。

## `t` 上下文:能力决定形状

`test(t)` 收到的 `t` 不是一个固定对象,而是**按 Agent 能力组装**出来的。核心看 Agent 声明的能力位,把对应的动作混进 `t`:

- 任何 Agent → `t.check` / `t.require`(值级断言)、`t.log`、`t.skip`、`t.signal`、`t.judge`。
- 声明 `conversation` 能力 → `t.send` / `t.respond` / `t.reply` / `t.newSession`。
- 声明 `tool-observability` 能力 → `t.calledTool` / `t.toolOrder` / `t.usedNoTools`。
- 声明 `workspace` 能力(沙箱型)→ `t.sandbox`(命令/文件)、`t.diff`(生成/删除的文件)、`t.transcript`(归一化事件 + o11y)。

作者写 `t.calledTool` 时若 Agent 不支持工具观测,在类型层面就拿不到这个方法(TS 条件类型),不会跑起来才报错。

## 一次运行,端到端

以一个沙箱型 agent eval 为例(会话型是它的子集,跳过 2–4、9–10):

1. **加载配置。** CLI 合并 标志 → 环境变量 → `fastevals.config.ts` → 默认值。
2. **发现。** 扫 `evals/`,收集 `*.eval.ts` 与含 `PROMPT.md` 的 fixture;据路径推导 id,排序;按过滤器(id 前缀 / `--tag`)筛。
3. **指纹与缓存。** 对每个 eval 算 `(fixture 内容 + 配置)` 指纹;已通过且指纹未变的,标记跳过(除非 `--force`)。
4. **建尝试列表。** 每个 eval × `runs` 次 → 一批 attempt。为每个 eval 建一个 `AbortController`(供早停)。
5. **有界并发调度。** 维持至多 `maxConcurrency` 个 attempt 在飞;池满则 `Promise.race` 等任一完成再补位。可疑的"秒挂"(< 5s 且非超时)按指数退避重试。
6. **驱动 Agent。** 对沙箱型 agent:`Sandbox.create` → 上传 workspace files(藏起 test files)→ `git init` 打基线 → 跑 `hooks.sandbox.setup` → 装依赖 + 装 agent CLI → `agent.send()` 在沙箱里跑 agent → 抓 transcript。
7. **采集结果。** `git diff HEAD` 得到生成/删除的文件;把 transcript 解析成标准事件流,派生 o11y,注入 `__fastevals__/results.json`。
8. **验证 + 评分。** 上传 test files → 跑 `EVAL.ts`(Vitest)与配置的 npm scripts;同时运行作用域断言、值级断言、judge。全部折叠成 `Assertion[]`。
9. **判决。** `verdict.ts` 把断言 + 执行错误 + 跳过原因折叠成 `passed`/`failed`/`scored`/`skipped`。
10. **早停。** 若该 attempt 通过且开了 `earlyExit`,`abort()` 掉同一 eval 的其余 attempt。
11. **报告。** 每个 eval 完成即在串行报告队列上回调 `onEvalComplete`(不阻塞执行池);全部完成后回调 `onRunComplete`,落盘工件到 `.fastevals/<run>/`。
12. **退出码。** 有 `failed`(或 `--strict` 下有 `scored`)→ 非零退出,供 CI 判红。

## 错误隔离

三类错误被分开处理,避免一个 case 拖垮整批:

- **断言失败** —— 正常路径,折叠进判决,不抛。
- **执行器异常**(超时、网络、沙箱起不来)—— 在单 eval 边界被 catch,该 eval 记为 `failed` 并附错误,其余 eval 照跑。
- **作者错误**(`test` 里抛了非断言异常)—— 同样被 catch 进该 eval 的 `error`,不污染别人。

沙箱型还可选 AI 失败分类(model / infra / timeout),把"是模型不行还是基础设施抖了"自动归类,详见 [Observability](observability.md)。

## 相关阅读

- [Vision](vision.md) —— 为什么核心不许按名字分支。
- [Runner](runner.md) —— 调度、并发、重试、早停、缓存的细节。
- [Agents 与 Adapters](agents-and-adapters.md)、[Sandbox](sandbox.md) —— 三层的契约。
- [Scoring](scoring.md) —— 评分与判决。
