# Sample 怎么测

契约来源：

- [Sample](../../../feature/sample/README.md)
- [Library](../../../feature/sample/library.md)
- [局部补跑之后，两个口径分别给出什么](../../../feature/sample/use-case/partial-rerun.md)

Sample 测试分为当前选择、单 Run 审计、覆盖缺口、来源事实、转换算子、去重和警告全集。
被测对象是**从一份 Record 到一批 attempt 的选择逻辑**；落盘格式与 artifact 读取归 [record.md](record.md)。

本篇不 fake：构造内存记录图或真实临时目录，直接调选择器。
真实运行的端到端读面由 [E2E 功能域 · 报告与读面](../e2e/report.md)验收。

## Fixture 规范

**内存记录图**是本篇的主要输入。
Builder 必须要求写出会影响选择与身份的字段——`startedAt` 不由全局自增器偷偷生成（它是去重身份的一部分），`configHash` 不由 builder 默认填成同一个值（它是跨 Run 拼接的唯一判据）。
测试读者必须能从 case 看出两个 Run 该不该拼在一起、两条 attempt 该不该合并（规则见 [Harness](harness.md)）：

```ts
interface RunSpec {
  readonly experimentId: string;
  readonly startedAt: string;
  readonly configHash: string | undefined;
  readonly completedAt?: string;
  readonly knownEvalIds?: readonly string[];
  readonly attempts: readonly AttemptSpec[];
}
```

**区分力要求**：每条覆盖类别的 fixture 必须让被测规则与它的错误实现得到**不同**答案。
「按 Run 选择」「逐 Eval 拼接」「平铺 attempt 后再选」在同一份 fixture 上必须三个答案互不相同，否则这份 fixture 证明不了任何一条。

## 观察面

- **选择面**：`mode`、`attempts`（当前贡献全集）、`runs`（真实来源集合）。
- **覆盖面**：`coverage[].knownEvalIds` / `missing`，以及每项 `reason` / `previous`。
- **警告面**：`warnings[].kind` 与各自的结构化字段、`command` 有无。
- **身份保持**：每条选中 attempt 的 `ref` 与 locator 仍指向原来源，不被选择过程改写。

## 覆盖规范

- **Notice 解释单源**（[Present: Notice](../../../error-feedback.md#present-notice)）：`NoticeCatalog` 对内建 code 穷尽登记——**缺一条要编译不过**，这一格靠映射类型而不是运行时断言。
  再覆盖：

  - `NiceEvalError.message` 与同一条 catalog 条目**同源**：改 catalog 文案，`message` 跟着变。
    区分力场景是两处不能各写一份——断言 `message` 不是手写常量。
  - `NoticeAction` 是闭集，每个 kind 在 CLI 与 web 各有一个投影；投影函数按 kind 而不是按 code 分支（新增一个 code 不需要动任何宿主投影，这是这条的区分力）。
  - 未知第三方 code 走 fallback 时，输出仍带一条保守下一步，不是只有 code 与 detail。
  - Issue 与 observation 都不带 message / severity / action——断言这些字段在数据形状上不存在。

- **`latestRunSample`**：每个 Experiment 只取最新一次 Run。
  不跨 Run 拼 Eval，也不把 attempt 平铺后再选。
  该 Run 没跑的 Eval 进 `coverage.missing`，不从旧 Run 补。
- **`currentSample`**：按 Experiment × Eval 取包含该 Eval 的最新**可比** Run。
  `configHash` 与基准不等的旧 Run 不贡献，该 Eval 留在缺口里；`runs` 保留全部真实来源，同一 Experiment 可以有多个；不合成报告专用 Run。
  fixture 必须让同一 Experiment 同时有两个存活来源，且其中一个 `configHash` 不同——「拼了不该拼的」与「该拼的没拼」是两个方向的失败，都要有 case 抓。
- **缺 `configHash` 的 Run**：只与自己可比，不参与任何拼接；这条与「configHash 相等」是两个分支，不合并成一个 case。
- **物理 Attempt 不受运行期计划二次过滤**：收窄重跑一题、其余题携带合入同一份快照时，`currentSample` 从物理 registry 看到全部题，不因旧 `selectedEvalIds` 或缺少规划字段塌成单题。
  fixture 经真实 `createWriter` / `writeAttemptFor` / `finish()` 走一遍，不手写 run.json 伪造贡献声明。
  carried 与本次执行条目都进入 `attempts`，但 locator 与 `carried` 来源事实保持原样。
- **覆盖事实**：`knownEvalIds` 用并集分母（本地历史 ∪ 各 Run 携带的 `knownEvalIds`），不是「优先字段」——fixture 要构造「本地并集比 Run 携带的更大」的情形，证明优先字段实现会让分母缩水。
  `missing` 与命令行范围求交。

  同一 fixture 同时含一道从未出现物理 Attempt 的题和一道只有不同 `configHash` 旧结果的题：前者是 `never-run` 且无 `previous`；后者是 `previous-result`，引用最近 locator / verdict / startedAt。两类旧结果都不进入 `attempts`。

  每个 `SampleCoverage` 还携带该 Experiment 的锚点 `run`：

  - `latestRunSample` 锚最新 Run
  - `currentSample` 锚确定可比性配置的最新 Run
  - 全缺口 Experiment（零 attempt、不进 `Sample.runs`）仍有锚点

  fixture 要证明「无锚点」实现会让零 attempt 的 Eval 无法按 agent 归组。
- **来源事实**：`attempt.carried` 是 `artifactBase` 的读取面投影，但不改变当前成员资格、覆盖、计票或 warning。
  fixture 同时含携带条目、本次执行条目与来自可比旧 Run 的条目，三者都保留；任何按来源删结果的实现都应失败。
- **转换算子**：`scope()` / `filter()` 返回新 Sample，不改原样本；原样本的四个面逐字段不变。
  它们同步更新 attempts、historyAttempts、runs、coverage 与有来源作用域的 issues。
  `scope()` 收窄总体分母；`filter()` 保持分母，并把无结果的题计入结构化 `missing`。
  Runs 只保留仍被两组 attempt 引用的真实来源。
- **去重**：身份键 `(experimentId, evalId, attempt, startedAt)`，重复取最新 Run 里的那份且 `ref` 落在最新落盘上；`startedAt` 缺失时宁可不去重也不误删并出 `missing-startedAt` 警告。
  两个选择器都已内置这条——`sample.attempts` 拿到手即去重后。
  去重是选择器内部不变量，不为内部 helper 单独写公开 API 测试。
- **警告全集**：`unfinished-run`、`dangling-evidence`、`unreadable-run`、`missing-startedAt` 四个 kind 各有一条，断言 `kind`、结构化字段齐全、`message` 以下一步收尾、该带 `command` 的带且已替换真实 id。
  `missing-startedAt` 不透出到组件数据。
  未收尾 Run 不进 `unreadable`——它的 attempt 照常被选中，只是同批产生 `unfinished-run`。

## 不这样测

- 不让 builder 隐藏 `startedAt`、`configHash`、`attempt` 等影响选择与身份的字段。
- 不用同一份 fixture 覆盖两个口径——那份 fixture 必然让两者答案相同，于是两条都证明不了。
- 不在测试里复刻选择算法或去重算法再对答案；期望的 attempt 集合写死在 case 里。
- 不把「缺口为空」当成默认期望；每条选择类别都要有一个缺口非空的 case。
- 不断言渲染好的 warning 文案措辞；断言 `kind`、结构化字段与「`command` 是否存在」。
