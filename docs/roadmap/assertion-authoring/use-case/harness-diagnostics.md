# 用 show 完成两道单轮 Harness 诊断

断言签名与求值语义的契约单源在 [Library](../library.md)、[Rule](../matching.md) 与 [Architecture](../architecture.md)。
本页从用户要完成的任务出发，展示两道完整 Harness 怎样组合这些能力。

两个场景都只发送一条用户消息。
Agent 在同一 Turn 内运行、诊断、必要修复并回复；Eval 不用第二轮提示提醒遗漏步骤。

每条 Assertion 都是在调用点直接写出的 `t.*`、`turn.*` 或 `t.sandbox.*` 调用。
示例不预声明 matcher、RegExp、JSON rule 或共享规则构造器。

这些示例描述 Roadmap 目标契约。
下游若提前采用，应保留 TypeScript error 暴露尚未落地的签名，不能用旧 Match AST 或类型断言伪装实现。

## 用户共同需要什么

用户不是在测试某个 Adapter 的工具名，也不是要求 Agent 生成一份机器专用 JSON。
用户要确认：

- Agent 真正运行了非 dry-run experiment；
- 结果诊断经过公开 `niceeval show`，而不是读取 `.niceeval` 私有文件；
- Agent 看过前一步结果后才继续下一步；
- 最终回复把 show 中的证据和修复建议对应起来；
- 文件修改没有越过任务允许的范围。

确定性的 command 顺序、可观察工具输入、运行状态和 Sandbox diff 由机器 Assertion 检查。
动态 locator、Human 输出含义与回复建议需要关联完整 tool calls 和 message，因此由 `turn.judge.llm()` 检查。

## A：修好 Python 起点，再判断复验与接受

### 用户任务

Fixture 有 `cases/alpha`、`cases/beta`、`cases/gamma` 与 `cases/delta` 四项。
`experiments/local.ts` 的 Sandbox image tag 起初指向只有 Node、缺少 Python 的 runtime。

用户要求 Agent：

1. 先运行一次非 dry-run `niceeval exp local`；
2. 用 `niceeval show` 确认 Python 基建错误；
3. 只把目标 experiment 的 runtime tag 改成 Python 版本；
4. 按候选 NiceEval 版本的 carry / rerun 语义完成可信复验；
5. 再用 `show` 核对 current 与 history，判断哪些结果可以接受；
6. 在最终回复中解释证据和决定。

这道题评的是一条完整诊断旅程，不是分别为 `exp`、`show`、`accept` 凑存在性分。

### Harness 调用

```ts
const turn = await t.send("运行 local experiment，用 niceeval show 诊断并修复缺少 Python 的基建；完成可信复验，判断可接受的结果，最后说明依据。禁止直接读取 .niceeval、evals 或 agents 下的内部材料。");
turn.toolOrder([{ command: ["niceeval", "exp", "local"], excludes: ["--dry", "--dry-run"] }, { command: ["niceeval", "show"] }, { command: ["niceeval", "exp", "local"], excludes: ["--dry", "--dry-run"] }, { command: ["niceeval", "show"] }], { sequential: true }).gate();
turn.toolInputsExclude({ paths: [".niceeval", "evals", "agents"] }).gate();
turn.succeeded().gate();
t.sandbox.changedPaths(["experiments/local.ts"]).points(3).gate();
t.sandbox.fileChanged("experiments/local.ts", { beforeIncludes: "runtime:node", afterIncludes: "runtime:python" }).points(2).gate();
turn.judge.llm({ name: "最终 current 结果", rubric: "只依据本轮 niceeval show 的公开输出判断：最终 current leaderboard 必须恰好是 cases/alpha、cases/beta、cases/gamma、cases/delta 四项，其中 3 passed、1 failed、0 errored；不能用回复中的自报数字代替 CLI 证据。", scoreMode: "binary" }).points(3).gate();
turn.judge.llm({ name: "接受历史正确", rubric: "结合本轮完整 show 输出判断：cases/alpha、cases/beta、cases/gamma 各恰好一条 attempt，verdict 依次为 passed、passed、failed，且都有 acceptedFrom；每条 acceptedFrom 只显示 config:sandboxLayer 与 plan:physical 两类差异，from/to 是公开字符串，但不要求泄露 literal image tag。cases/delta 恰好两条真实 attempt，顺序为 errored 后 passed，二者都没有 acceptedFrom。不得依靠回复自报或私有文件。", scoreMode: "binary" }).points(6).gate();
turn.judge.llm({ name: "候选版本复验与建议", rubric: candidateVersion.startsWith("0.9.") ? "候选是 0.9.x：确认修复后确实重新执行完整 local experiment，并根据 show 正确解释接受范围；不要求该版本没有的 rerun flag。" : "候选是 0.12+：确认修复后强制全量真实执行，通常使用 --rerun all 或可由工具证据证明等价的做法，不能把自动重试 errored 与携入旧结果冒充全量复验；最终接受判断必须与 show 证据一致。", scoreMode: "binary" }).points(4).gate();
```

三条未链 `.points()` 的 Assertion 是零分 gate，只进入判定面。
A 的可得分总数固定为 `3 + 2 + 3 + 6 + 4 = 18`。

`changedPaths()` 只证明 agent 归因路径集合恰好一项。
`fileChanged()` 证明同一条 change 的 before 含 `runtime:node`、after 含 `runtime:python`；两者都不声称文件只改了这一个 token。

current、history 与候选版本三项都是 gate。
任何一项错误都会使 outer verdict failed，不会只丢分却留下 headline passed。

`accept` 不另设一条 command 得分。
接受行为是否成立、范围是否安全已经由公开 history 证据与候选版本判断共同检查，重复计分会放大同一事实。

## B：区分模型能力不足和 Eval 过紧

### 用户任务

第二个 Fixture 是没有历史结果的新 repo，只有 `cases/alpha`、`cases/beta` 与 `cases/gamma`。
首次运行的客观结果是 1 passed、2 failed、0 errored。

用户要求 Agent：

1. 运行一次非 dry-run local experiment；
2. 从 compact `niceeval show` 取得 beta 与 gamma 各自的 locator；
3. 对每个 locator 分别查看 `--source` 与 `--execution`；
4. 判断 beta 是模型回复 / 推理不足，gamma 是确定性 exact Assertion 过紧；
5. 给出应该改回复还是改 Eval 的建议，不修改 repo。

动态 locator 只能在运行时从 show 获得。
把它抽成 Eval CLI 查找函数会复制 locator 读取逻辑；只看最终 message 又会丢掉是否真的下钻同一 locator 的证据。
因此两条 Judge 都读取完整 Turn。

### Harness 调用

```ts
const turn = await t.send("运行 local experiment，只用 niceeval show 下钻 beta 和 gamma 的失败；区分模型能力不足与 Eval 断言过紧，给出各自应该修改什么的建议。不要修改 repo，也不要读取 .niceeval、evals 或 agents 下的内部材料。");
turn.toolOrder([{ command: ["niceeval", "exp", "local"], excludes: ["--dry", "--dry-run"] }, { command: ["niceeval", "show"] }], { sequential: true }).gate();
turn.toolInputsExclude({ paths: [".niceeval", "evals", "agents"] }).gate();
turn.succeeded().gate();
t.sandbox.noChanges().points(2).gate();
turn.judge.llm({ name: "beta 归因", rubric: "同时检查完整 tool calls、show 输出和最终 message：compact show 必须显示 cases/alpha、cases/beta、cases/gamma 的首次结果为 1 passed、2 failed、0 errored，并识别 cases/beta 的 locator；后续 --source 与 --execution 必须使用同一个 beta locator。证据必须显示候选给出 18，而客观要求是 20；结论应建议修正回复或推理，不应修改 Eval。", scoreMode: "binary" }).points(6).gate();
turn.judge.llm({ name: "gamma 归因", rubric: "同时检查完整 tool calls、show 输出和最终 message：Agent 必须从 compact show 识别另一个属于 cases/gamma 的 locator，并让 --source 与 --execution 使用同一个 gamma locator。证据必须表明候选行为在题意上正确，但 exact Assertion 比题面更严格；结论应建议修改 Eval，不应要求改写正确回复。", scoreMode: "binary" }).points(6).gate();
```

B 的可得分总数固定为 `2 + 6 + 6 = 14`。
两条 Judge 都链 `.gate()`；任一 locator 绑定、证据或归因错误都会使 outer verdict failed。

`t.sandbox.noChanges()` 是有意义的 2 分范围纪律，不是零分空集检查。
它与 `changedPaths([])` 同源，并且 agent 即使改后复原也不能通过。

## 公开诊断闭环

两道题都遵守同一条用户路径：

1. 执行非 dry-run 的最小 experiment；
2. 使用 `niceeval show` 查看 Attempt、Assertion、Verdict 与接受审计；
3. A 只修改目标 experiment，B 不修改 repo；
4. 只做用户需求要求的复验；
5. 再用 show 核对结果，并在 assistant reply 中交代证据与判断。

CLI 无法显示 Judge 所需事实时，Harness 应把结果判为失败并指出 NiceEval 呈现缺口。
它不能绕过 CLI 读取 `.niceeval` 原始文件，也不能要求 Agent 把 show JSON 写到 `/tmp` 供 Eval 匹配。
