# Architecture

niceeval 把一个评测过程拆成四段职责:**发现**要跑什么、**驱动**被测对象产生结果、**评分**得出判定、**报告**落盘与回传。核心拥有这四段里对所有被测对象都一样的部分;被测对象的差异被收进 `Agent`(契约)/ `Adapter`(你写的实现)/ `Sandbox` 三层。

这条边界是有意为之的,理由见 [Vision](vision.md)。本篇给出模块分层、数据流,以及一次运行的端到端时序。

## 系统总览

```text
                          ┌─────────────────────────── core ───────────────────────────┐
  evals/                  │                                                            │
  └─ *.eval.ts ──────────►│ Discovery ──► Runner ──► Scoring ──► Verdict ──► Reporters │
                          │  (发现)       (调度)     (评分)      (判定)       (报告)   │
                          │              │ 驱动                             │          │
                          └──────────────┼──────────────────────────────────┼──────────┘
                                         │                                  ▼
                                         ▼  对接口分发,不按名字分支    .niceeval/<experiment>/<snapshot>/
                          ┌────── Agent(自实现 Adapter) ──────┐
                          │   远程 adapter    沙箱 adapter    │
                          │    (你的服务)   ┌───────────────┐ │
                          │                 │  claude-code  │ │
                          │                 │  codex / bub  │ │
                          │                 └───────────────┘ │
                          │                         ▼         │
                          │                 ┌─── Sandbox ───┐ │
                          │                 │    docker     │ │
                          │                 │ vercel / 三方 │ │
                          │                 └───────────────┘ │
                          └───────────────────────────────────┘
```

四段职责是**单向数据流**:发现产出一批 `Eval`,运行器逐个对 Agent `send` 得到 `Turn`,评分器把 `Turn` 折叠成 `Assertion[]`,再把全部断言折叠成一个互斥的 `Verdict`;报告器消费 `Verdict` + artifact。没有反向耦合 —— 评分器不知道 agent 的 transport 是 HTTP 还是沙箱 CLI,它只看 `Turn`。

## 模块分层

设想中的源码树(实现时以此为骨架):

```
src/
├─ index.ts                 # 公开导出:defineEval / defineConfig
├─ define-eval.ts           # eval 定义 + 校验(会话型/沙箱型由 agent 能力决定,不是两个函数)
├─ define-config.ts         # 项目配置
├─ types.ts                 # 核心类型(Eval / Agent / Turn / Verdict …)
│
├─ context/                 # `t` 上下文的构建
│  ├─ session.ts            #   会话驱动(send / respond / 多会话)
│  ├─ assertions.ts         #   作用域断言收集器(t 级 / turn 级共享同一套)
│  └─ sandbox-context.ts    #   沙箱型 `t`(diff / transcript / sandbox 句柄)
│
├─ expect/                  # 值断言库(includes / equals / matches / similarity …)
│
├─ scoring/
│  ├─ scoped.ts             # 作用域断言(succeeded / calledTool / toolOrder …)
│  ├─ judge.ts              # LLM-as-judge
│  └─ verdict.ts         # 判定计算 → Verdict
│
├─ agents/                  # —— 连到 AI 的全部特殊性都在这里(自实现 Adapter)——
│  ├─ types.ts              #   Agent / Adapter 接口(kind: "sandbox" | "remote",无能力位字段)
│  ├─ define-agent.ts       #   defineAgent / defineSandboxAgent
│  ├─ shared.ts             #   沙箱型共享:diff 采集 / transcript 注入
│  ├─ claude-code.ts        #   内置沙箱 adapter
│  ├─ codex.ts
│  └─ bub.ts
│
├─ sandbox/                 # —— 沙箱型 agent 在哪里跑的全部特殊性都在这里 ——
│  ├─ types.ts              #   Sandbox 接口
│  ├─ resolve.ts            #   provider 选择(auto / docker / vercel / …)
│  ├─ docker.ts
│  └─ vercel.ts
│
├─ o11y/                    # transcript 归一化 + o11y 派生
│  ├─ types.ts
│  └─ parsers/              #   各 agent 的 transcript 解析器
│
├─ runner/
│  ├─ run.ts                # 主调度(有界并发 / 重试 / 首过即停)
│  ├─ discover.ts           # eval 发现
│  ├─ fingerprint.ts        # 指纹缓存
│  └─ reporters/            # console / junit / json / 第三方
│
└─ cli.ts                   # CLI 入口
```

边界规则一句话:**`agents/` 和 `sandbox/` 之外的任何文件,都不应出现 agent 名字或 sandbox 名字的行为分支。** 核心拿到的是接口,不是名字。

## 一个授权面,能力决定形状

niceeval 只有一个写 eval 的入口——`defineEval`。会话型和沙箱型不是两个函数,而是**同一个入口,`t` 的形状随引用的 Agent 能力变化**:

| | 会话型 | 沙箱型 |
|---|---|---|
| 典型 Agent | 远程 agent | 沙箱 agent(coding agent + Sandbox) |
| Task 形态 | `t.send(...)` 序列 | 同左——沙箱型的任务照样写在 `t.send(...)` 里,没有另一种任务格式 |
| `t` 暴露什么 | `send`/`reply`/`calledTool`/`judge` | 上述 + `t.sandbox`(文件 IO / 命令执行 / 结果断言 / diff) |
| 评分手段 | expect + 作用域断言 + judge | 上述 + 手工在沙箱里跑命令,再用 `t.check(result, commandSucceeded())` 判定 |
| 共享 | **Scorer、Verdict、Runner、Reporter、Config、 artifact 格式全部共享** | 同 → |

这张表是整个架构的中心论点:**两种范式只在"Agent 的构造证据(`kind` 与 `send` 实际做到了什么)"上不同,在"如何判分、如何调度、如何记录"上完全一致。** 所以它们能住在同一个入口、同一个库里,而不是两个入口或两个库。

## `t` 上下文:构造证据决定形状

`test(t)` 收到的 `t` 对每个 Agent 都暴露同一套宽接口(`TestContext`),但每个方法**实际能不能读到数据**由 Agent 的构造证据决定,不是声明式的能力位——这是唯一的运行时守卫例外:

- 任何 Agent → `t.check` / `t.require`(值断言)、`t.log`、`t.skip`、`t.signal`、`t.judge`,以及 `t.send` / `t.reply` / `t.newSession`(能不能多轮取决于 `send` 有没有接上 `ctx.session` 的续接存取器,不取决于声明)。
- `send` 吐出 `action.*` 事件 → `t.calledTool` / `t.toolOrder` / `t.usedNoTools` 有数据可断;没吐,正断言自然不命中、负断言按事件来源的完整性证明判断可信度(见[适配器契约](feature/adapters/contract.md#能力从哪来构造证明不是问卷))。
- `defineSandboxAgent` 构造(`kind: "sandbox"`)→ `t.sandbox`:文件 IO(`writeFiles` / `readFile`)、命令执行(`runCommand` / `runShell`)和结果断言 / diff(`fileChanged` / `fileDeleted` / `diff` / `file`)都收在这一个命名空间下。评 sandbox 产物用 `t.judge.autoevals.closedQA` 配 `{ on: t.sandbox.diff.get(path) }`。非沙箱型 agent 调用这组方法会立即得到清晰报错(`capabilityGuard`)——这是唯一仍需要运行时拦截的能力,因为没有沙箱就没有文件系统可读。

## 一次运行,端到端

以一个沙箱型 agent eval 为例(会话型是它的子集:第 6 步没有 `Sandbox.create` / git 基线,直接跑 `test(t)`;跳过第 7 步,没有沙箱 diff 可采):

1. **加载配置。** CLI 合并 标志 → 环境变量 → `niceeval.config.ts` → 默认值。
2. **发现。** 扫 `evals/`,收集 `*.eval.ts`;据路径推导 id,排序;按过滤器(id 前缀 / `--tag`)筛。
3. **指纹与缓存。** 对每个 eval 算 `(eval 代码 + 配置)` 指纹;已通过且指纹未变的,标记跳过(除非 `--force`)。
4. **建 attempt 列表。** 每个 eval × `runs` 次 → 一批 attempt。为每个 eval 建一个 `AbortController`(供首过即停)。
5. **有界并发调度。** 全局至多 `maxConcurrency` 个 attempt 在飞(全局信号量);设了 `maxConcurrency` 的实验另有一道实验级信号量,自己排队、不影响同批其它实验(见 [Runner](runner.md#调度有界并发))。可疑的"秒挂"(< 5s 且非超时)按指数退避重试。
6. **准备环境,交给 `test(t)`。** 沙箱型:`Sandbox.create` → 若 `experiment.sandbox` 链上挂了 `.setup()`,先跑这些环境层钩子(装二进制、预热、写 hook 文件,按追加顺序;这一步必须在 git 基线之前,否则它写的文件会被误记成 agent 的改动)→ 打一次空 git 基线 → 若这条 eval 定义了 `EvalDef.setup` 就跑它(任务夹具)→ 跑 agent 自己的 `SandboxAgent.setup`(装 CLI 等)。之后全部交给这条 eval 自己的 `test(t)`:作者按自己的顺序调 `t.sandbox.writeFiles`/`uploadFiles`(手工写入起始文件)、`t.send()`(驱动 agent——adapter 在沙箱里跑 CLI、抓 transcript、解析成标准事件流、注入 `__niceeval__/results.json`)、`t.sandbox.runCommand(..., { cwd })`(手工跑校验命令)——顺序、次数、要不要对 agent 隐藏某些文件,全部是 `test(t)` 里的普通代码决定,核心不插手,也不预设"先上传什么、后上传什么"这种固定编排。
7. **采集生成文件。** `test(t)` 跑完后 `git diff HEAD` 得到生成 / 删除的文件,供 `t.sandbox.diff` / `t.sandbox.fileChanged` 读取。随后 finally 里先跑 `SandboxAgent.teardown`(agent 级收尾),再跑 `experiment.sandbox` 链上的 `.teardown()`(环境层收尾,销毁前最后一步——回存跨 attempt 状态的时机),最后销毁沙箱。
8. **评分。** `test(t)` 里记录的作用域断言、值断言、judge,连同手工校验命令的结果断言,全部折叠成 `Assertion[]`。
9. **判定。** 断言 + 执行错误 + 跳过原因直接折叠成一个互斥的 `Verdict`(`passed`/`failed`/`errored`/`skipped`,没有中间态)。
10. **首过即停。** 若该 attempt 通过且开了 `earlyExit`,`abort()` 掉同一 eval 的其余 attempt。
11. **报告。** 每个 eval 完成即在串行报告队列上回调 `onEvalComplete`(不阻塞执行池),对应 attempt 的判决与 artifact 随之写进该实验快照目录(`.niceeval/<experiment>/<snapshot>/<evalId>/aN/result.json`);全部完成后回调 `onRunComplete`,快照收尾补 `snapshot.json` 的 `completedAt`。
12. **退出码。** 有 `verdict=failed`(含 `--strict` 下 soft 未达标而改判的)或 `verdict=errored` → 非零退出;报告里两者分开列,供 CI 判红和诊断。

## 错误隔离

三类错误被分开处理,避免一个 case 拖垮整批:

- **断言失败** —— 正常路径,折叠进判定,不抛,对应 `verdict=failed`。
- **执行器异常**(超时、网络、沙箱起不来)—— 在单 eval 边界被 catch,该 eval 记为 `verdict=errored` 并附错误,其余 eval 照跑。
- **作者错误**(`test` 里抛了非断言异常)—— 同样被 catch,记为 `verdict=errored`,不污染别人。

沙箱型还可选 AI 失败分类(model / infra / timeout),把"是模型不行还是基础设施抖了"自动归类,详见 [Observability](observability.md)。

## 相关阅读

- [Vision](vision.md) —— 为什么核心不许按名字分支。
- [Runner](runner.md) —— 调度、并发、重试、首过即停、缓存的细节。
- [Agents 与 Adapters](feature/adapters/README.md)、[Sandbox](sandbox.md) —— 三层的契约。
- [Scoring](scoring.md) —— 评分与判定。
