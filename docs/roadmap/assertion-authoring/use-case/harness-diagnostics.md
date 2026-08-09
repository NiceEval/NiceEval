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
- Agent 根据前一步公开结果选择后续动作；
- 最终回复把 show 中的证据和修复建议对应起来；
- 文件修改没有越过任务允许的范围。

确定性的 tool request 子序列、可观察工具输入、运行状态和 Sandbox diff 由机器 Assertion 检查。
动态 locator、工具输出因果、Human 输出含义与最终回复顺序不是本次新增的确定性 Assertion。
本页只展示这次 API 负责的机器检查，不为其伪造新入口。

每题的机械层固定为三条 turn 调用：一条 `toolOrder()`、一条 `toolInputsExclude()`、一条 `succeeded()`。
`ToolMatch.command` 匹配 logical CLI，所以遵循项目指引执行 direct `niceeval`、`pnpm exec niceeval`、`pnpm --silent exec niceeval` 或无选项 `npx niceeval` 都不需要 Harness 写 wrapper OR。
opaque shell 仍是 unavailable；这项归一不读取 raw shell text，也不证明物理 binary identity。

## A：修好 Python 起点，再判断复验与接受

### 用户任务

Fixture 有 `cases/alpha`、`cases/beta`、`cases/gamma` 与 `cases/delta` 四项。
`experiments/local.ts` 的 Sandbox image tag 起初指向只有 Node、缺少 Python 的 runtime。

用户要求 Agent：

1. 先运行一次非 dry-run `niceeval exp local`；
2. 用 `niceeval show` 确认 Python 基建错误；
3. 只把目标 experiment 的 runtime tag 改成 Python 版本；
4. 按候选 NiceEval 版本的 accept / rerun 能力完成可信复验；
5. 再用 `show` 核对 current 与 history，判断哪些结果可以接受；
6. 在最终回复中解释证据和决定。

这道题评的是一条完整诊断旅程，不是分别为 `exp`、`show`、`accept` 凑存在性分。

### Harness 调用

```ts
const turn = await t.send("运行 local experiment，把所有 case 收敛到可信终态：消除 errored，但不要把合法 failed 改成 passed，也不要修改业务实现、eval 或断言。修好基础设施后，尽量复用仍可由公开证据证明有效的已完成结果，最后说明保留了什么、重跑了什么以及最终分布。不得直接读取 .niceeval 内部文件、eval 源码或 agent 实现；诊断证据应来自 NiceEval 自身的公开结果查看接口。");
turn.toolOrder([{ name: "shell", command: { executable: "niceeval", argsStart: ["exp", "local"], excludes: ["--dry", "--dry-run"] } }, { name: "shell", command: { executable: "niceeval", argsStart: ["show"] }, status: "completed" }, { name: "shell", command: { executable: "niceeval", argsStart: ["exp", "local"], excludes: ["--dry", "--dry-run"] } }, { name: "shell", command: { executable: "niceeval", argsStart: ["show"] }, status: "completed" }]).gate();
turn.toolInputsExclude({ paths: [".niceeval", "evals", "agents"] }).gate();
turn.succeeded().gate();
t.sandbox.changedPaths(["experiments/local.ts"]).points(3).gate();
t.sandbox.fileChanged("experiments/local.ts", { beforeIncludes: "runtime:node", afterIncludes: "runtime:python" }).points(2).gate();
```

三条未链 `.points()` 的 Assertion 是零分 gate，只进入判定面。
本页定义的 A 确定性部分可得 `3 + 2 = 5` 分。
其中 observed-input gate 与题面共同明确禁止直接读取 `.niceeval`、`evals` 与 `agents`；三项都是用户可见的任务边界，不是隐藏失败条件。

`changedPaths()` 只证明 agent 归因路径集合恰好一项。
`fileChanged()` 证明同一条 change 的 before 含 `runtime:node`、after 含 `runtime:python`；两者都不声称文件只改了这一个 token。

`accept` 不另设一条 command 得分。
是否正确接受、保留和复验仍须依据公开 dry/show、不兼容原因、三条 accept 回执、`3 carried、1 to run` 计划与 delta 真实执行判断；本次不为这组动态关系增加确定性 API，单独给 accept command 计分也会放大同一事实。

0.12+ / canary 的正确策略不是强制全量重跑。
三个已有 terminal results 仍有效时，应先由公开 compact/dry/show 证据判断，再得到恰好三条 accept 回执。
后续计划应显示 `3 carried、1 to run`，并只让 errored 的 delta 真实执行。
0.9.x 没有 locator accept，才在 runtime 修复后完整重跑。

## B：区分模型能力不足和 Eval 过紧

### 用户任务

第二个 Fixture 是没有历史结果的新 repo，只有 `cases/alpha`、`cases/beta` 与 `cases/gamma`。
首次运行的客观结果是 1 passed、2 failed、0 errored。

用户要求 Agent：

1. 运行一次非 dry-run local experiment；
2. 从 compact `niceeval show` 取得 beta 与 gamma 各自的 locator；
3. 对每个 locator 分别下钻：0.9.x 使用 `--eval` 与 `--execution`，0.12+ / canary 使用 `--source` 与 `--execution`；
4. 判断 beta 是模型回复 / 推理不足，gamma 是确定性 exact Assertion 过紧；
5. 给出应该改回复还是改 Eval 的建议，不修改 repo。

动态 locator 只能在运行时从 show 获得。
把它抽成 Eval CLI 查找函数会复制 locator 读取逻辑；只看最终 message 又会丢掉是否真的下钻同一 locator 的证据。
因此本次不把这两项归因压进机械 selector，也不新增 JSON 或事件谓词来伪装完整诊断。

### Harness 调用

```ts
const turn = await t.send("运行 local experiment，调查所有失败并逐项给出归因与修正建议。每项结论必须引用运行结果证据；不得使用文件读取工具直接打开 eval 源码、agent 实现或内部记录，诊断证据应来自 NiceEval 自身的公开结果查看接口。不要修改项目。");
turn.toolOrder([{ name: "shell", command: { executable: "niceeval", argsStart: ["exp", "local"], excludes: ["--dry", "--dry-run"] } }, { name: "shell", command: { executable: "niceeval", argsStart: ["show"] }, status: "completed" }]).gate();
turn.toolInputsExclude({ paths: [".niceeval", "evals", "agents"] }).gate();
turn.succeeded().gate();
t.sandbox.noChanges().points(2).gate();
```

本页定义的 B 确定性部分可得 2 分。
beta / gamma 的 locator 绑定、证据顺序、互斥归因与建议仍是 Harness 必须评价的用户结果，但不属于这次确定性 Assertion API。

`t.sandbox.noChanges()` 是有意义的 2 分范围纪律，不是零分空集检查。
它与 `changedPaths([])` 同源，并且 agent 即使改后复原也不能通过。

## 公开诊断闭环

两道题都遵守同一条用户路径：

1. 执行非 dry-run 的最小 experiment；
2. 使用 `niceeval show` 查看 Attempt、Assertion、Verdict 与接受审计；
3. A 只修改目标 experiment，B 不修改 repo；
4. 只做用户需求要求的复验；
5. 再用 show 核对结果，并在 assistant reply 中交代证据与判断。

CLI 无法显示用户诊断所需事实时，Harness 应指出 NiceEval 呈现缺口。
它不能绕过 CLI 读取 `.niceeval` 原始文件，也不能要求 Agent 把 show JSON 写到 `/tmp` 供 Eval 匹配。
