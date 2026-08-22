# 抛出点声明死因:一次命中,按波及范围止损

## 解决什么问题

有两类失败,写代码的人**第一次看到就知道结果**,不该让框架一条条撞:

- **实验级死因**:全实验共享的基建(到内网记忆服务的隧道、每实验专用的 mock server)死了。
  没有声明时,批跑会把死隧道撞几十遍——每条 Attempt 各自创建沙箱、各自跑到探活、各自写入同因执行错误通道事件 并形成 `errored` Verdict，反馈流滚出几十条一模一样的报错,每条都白烧一个沙箱。
  批跑常态是 `attempts: 1`,[run 级 fail-fast](../../../runner.md#首过即停earlyexit) 按「同一 eval 内连续复现」判定,streak 永远凑不齐。
- **eval 级死因**:fixture 损坏(Run 目录没同步、任务仓库 clone 不完整)。
  `attempts: 5` 衡量 agent 稳不稳,前提是五次跑在同一个完好的任务 Sandbox 上——fixture 缺失时五次是同一个确定性死法,分布毫无意义;但这与实验无关,别的 eval 的 fixture 好好的,不能连坐到实验级。

`ExperimentFatalError` / `EvalFatalError` 就是把这个知识在抛出点交给框架:一次命中,停掉对应范围的派发。

## 全流程

1. **选档**。
   判据是死因的归属:来自实验共享的东西(服务、凭据、实验级配置)→ `ExperimentFatalError`;只属于这一条 eval(fixture、任务前置资源)→ `EvalFatalError`。
   声明写在知识所在的那层代码里,任何 per-attempt 阶段可抛。

2. **写声明**。
   每沙箱探活写在 Experiment layer 的 prepare command 里:

   ```ts
   import { ExperimentFatalError } from "niceeval";

   sandbox: e2bSandbox({ template: CODEX_TEMPLATE }).before(async (sandbox, context) => {
     const probe = await sandbox.runCommand("curl", ["-sf", `${serverUrl}/health`]);
     if (probe.exitCode !== 0) {
       throw new ExperimentFatalError(
         `server probe(${serverUrl}) failed — 服务端/隧道已死,修好后更新 .env 重跑`,
         { cause: probe.stderr },
       );
     }
   }),
   ```

   fixture 校验写在 Eval layer 的 `prepare()` 里:

   ```ts
   import { EvalFatalError } from "niceeval";
   import { sandboxLayer } from "niceeval/sandbox";

   sandbox: sandboxLayer().before(async (_sandbox, _context) => {
     if (!existsSync(fixturePath)) {
       throw new EvalFatalError(
         `fixture ${fixturePath} 缺失,所有 Attempt 同因必死——先跑 pnpm fixtures:sync`,
       );
     }
   }),
   ```

   message 会走完反馈流与 Record 诊断的全程,写成「现象 + 下一步」——它是留给修的人(和三天后的你)的字条。

3. **你会看到**。
   第一条撞上的 Attempt 照常收敛 lifecycle，结构化执行错误通道事件 保持所属阶段的原有 code，并形成 `errored` Verdict；同时对应粒度的止损生效,反馈流一条通知:

   ```text
   ✖ experiment codex--nowledge halted (dispatch-halted): server probe(https://…) failed — 服务端/隧道已死,修好后更新 .env 重跑
   ```

   同范围还没派发的 attempt 计入 `unstarted`,完成状态 `incomplete`;已在飞的几条跑完如实落账(并发同时撞死是常态,重复声明只折叠诊断计数)。
   **eval 止损不碰同实验其它 eval,experiment 止损不碰同批其它实验——止损不连坐。**
   事后从 Record 的 `dispatch-halted` 诊断(`data.scope` / `data.evalId`)能原样读回 message；`niceeval show --run <runId>` 的完成状态告诉你这批没跑完整、缺多少。

4. **恢复**。
   修好运行条件后，带 `errored` Verdict 的成员与 `unstarted` 都不具备携带资格；用 `--rerun failed` 重跑失败成员，已 `passed` channel entry 的 Member 照常可携带。
   没有任何「解除标记」要做——止损不跨 invocation。

## 边界

- **实验起跑前就能探的，写在实验级 `setup` 里更早止损。**
  `ExperimentDefinition.setup` 抛错（任何错误，不需要 fatal 错误类）发生在任何 Attempt 派发之前。
  它写 Run-scoped 执行错误通道事件 与 incomplete receipt，不伪造一批带 `errored` Verdict 的 Attempt（见 [Experiments](../../experiments/library.md#实验级共享服务setup-与-teardown)）。
  per-attempt 阶段里的声明兜的是「实验级 setup 过了、死因后来才暴露」的时段。
- **只声明确定性死因,拿不准就不声明。**
  判据是可证明性:共享服务、共享凭据、fixture 确定性缺失属于能证明;「看起来像基建问题」「fixture 服务偶尔超时」不构成——抖动声明下去,会把「本可能第二次就好」的机会一并杀掉。
  错放的代价是多烧几个沙箱,错杀的代价是丢整批样本数据,代价不对称(判据全文见 [README · 分类](../README.md#分类))。
- **止损不可逆。**
  生效后哪怕某条在飞 attempt 侥幸成功也不恢复派发——抖动的服务该修好再跑,不该让调度来回摆。
- **别拿它替代 run 级 fail-fast。**
  没写声明时 streak 推断照常回退;声明的价值是第一次就停、且给出人话修复提示,不是新的止损语义。
- **不影响通过率分母的语义。**
  `unstarted` 进完成状态,不进 verdict 计数——被止损的 eval 的完成态是「没跑完」,不是「失败 N 次」。
- **死因在 run 中途、以第三方错误形态浮出时,抛出点够不着**——那是[写分类器](write-a-classifier.md)的场景;共享服务型实验两个都写才没有缺口。

## 相关阅读

- [README · 分类](../README.md#分类) —— 空间轴判据全文与组合规则。
- [Architecture · 止损执行体](../architecture.md#止损执行体) —— 止损、记账、诊断形状的精确契约。
- [Library](../library.md#实验--eval-作者声明死因的波及范围) —— fatal 错误类要点清单。
- [Runner · 完成状态](../../../runner.md#完成状态) —— `unstarted` / `incomplete` 的记账语义。
