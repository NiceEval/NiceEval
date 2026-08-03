# Record 怎么测

契约来源：

- [Record](../../../feature/record/README.md)
- [Architecture](../../../feature/record/architecture.md)
- [Library](../../../feature/record/library.md)
- [标注 Eval 源码 / Attempt 证据](../../../concepts.md)

Record 测试分为落盘格式、读取分类、身份、artifact 懒加载、writer 与 `publish`。
不要用一个巨大目录同时承担这些责任。
选择口径、覆盖与时效归 [sample.md](sample.md)。

本篇不 fake：构造数据，并为每例创建独立的真实临时目录，测试 writer、reader 与选择逻辑。
真实运行的落盘与读回由 [E2E 功能域 · 报告与读面](../e2e/report.md)验收。

## Fixture 规范

**内存记录图**用于身份与聚合前对账测试。
Builder 必须要求写出会影响身份与选择的字段——`startedAt` 不由全局自增器偷偷生成，因为它是去重身份的一部分；测试读者必须能从 case 看出两条记录应该相同还是不同（规则见 [Harness](harness.md)）：

```ts
interface AttemptSpec {
  readonly evalId: string;
  readonly attempt: number;
  readonly startedAt: string;
  readonly verdict: "passed" | "failed" | "errored" | "skipped";
}
```

**临时落盘树**用于 writer/reader、版本识别、crash 残留和 artifact 懒加载。
每例创建独立 `mkdtemp` 目录、收尾删除；每个 case 只写形成该分类所需的最小文件，不复制一份完整 `.niceeval` 树。

## 观察面

- **落盘面**：writer 写出的 JSON 文件内容与层级归属。
  断言字段**不存在**同样有效——TypeScript 保证不了 JSON 没有冗余字段。
- **读取面**：`openRecord()` 句柄的分类（experiments / unreadable）、`evidenceState` 三态、artifact 方法返回值。
- **身份面**：locator、身份四元组、ref 归属。

写读两面在 round-trip 测试里互相对账：writer 写出的 reader 必须能读回，且事实位于契约声明的唯一位置。

## 覆盖规范

- **落盘格式**：
  - `run.json` 开始写入，`snap.finish()` 唯一一次补 `completedAt` 与 Run 级 diagnostics。
  - `result.json` 只含 attempt 级事实；Run 级字段以「不存在」断言。
  - 不落 `runId` / `invocationId` / Run Manifest 或跨实验成员关系。
  - 目录独占创建并处理撞名；artifact 省略时不生成，`null` 与 `[]` 语义分离。
  - 截断只有一个落点，并守住 UTF-8 字符边界；源码两层按内容哈希去重。
  - locator 确定性派生；携带条目原样复制，不重新计算。
  - 目录名只是可逆编码投影，权威身份在字段；轮标签在 `diff.json`、时间树与 send 标注中逐字相等。

- **身份与编码**（[locator 的唯一性](../../../feature/record/architecture.md#locator-的唯一性)）：

  - `runId` 在一份已持久化 Run 内恒定，目录改名 / 移动后读回同值；同一 experimentId + startedAt 重跑得到**不同**的 runId——区分力场景要证明它不可从业务身份重建。
  - 目录名编码可逆：`encode` 后 `decode` 回完整 `experimentId`；两个只在非安全字符上不同的 id 编码后**不撞**同一目录名（旧的有损清洗会撞，这是这条的区分力）；`.` / `..` 整段编码后不具路径语义。
  - locator 形态是 `@` + scheme + 12 位 Crockford base32，共 14 字符；由 `{runId, evalId, attempt}` 派生，同元组恒同值。
  - **碰撞两侧**：写入侧登记时命中已存在且身份元组不同，抛 `LocatorCollisionError` 并中止该 attempt，不覆盖也不换值；读取侧 `resolveLocator` 命中多条抛 `AmbiguousLocatorError` 并列出候选，不返回其中任意一条。
    三种失败（`Malformed` / `NotFound` / `Ambiguous`）各自可分辨。
- **读取分类**：`run.json` 的 schemaVersion 不匹配、坏 JSON、缺 run.json 各归各的 skipped reason，并携带诊断字段。
  无关 JSON / 目录静默忽略；绝不扫描旧文件名或用业务字段组合猜格式。
  未知可选字段与未知 artifact 被接受；未收尾 Run 不是 skipped，attempt 照常可读。
  每类坏数据用形成该分类的最小文件构造。
- **身份**：身份键四字段全部可从数据读到（`experimentId` / `evalId` 直达，`attempt` / `startedAt` 在 `attempt.result`）；reader 忠实保留携带产生的重复、不擅自去重；「缺才补」的字段拼合优先级； `ref` 指向条目所在落盘。
  去重算法本身归 [sample.md](sample.md)。
- **`configHash` 与携带资格**：`configHash` 落在 `run.json` 上、缺失时读取面如实为 `undefined`；`schemaVersion` 不同的历史 Run 不参与携带。
- **schema 14 与覆盖分词**：writer 必须写完整 `AttemptRecord.evidenceCoverage`，reader 不接受缺字段或旧 `coverage` 冒充它；`sample.coverage` 仍只属于 Sample，不因持久化字段改名而改变。格式头示例与常量均为 14。
  另外三条各自成立：
  - **进 configHash 的每个字段都在 `run.json` 上找得到。**
    `agent` / `model` 在顶层， `reasoningEffort` / `flags` / `strict` / `judge` / 顶层 sandbox 投影在 `ExperimentRunInfo`。
    这条按数据面守护，拿契约里的输入清单比对投影的键集合，少落一个就红。
    配置面的差异解释要靠它重算历史侧的配置身份。
    `judge` 只落 `model` / `baseUrl`，`apiKeyEnv` 指向的凭据不落。
  - **携带条目的 `fingerprint` 按本 Run 口径重打**，一份 Run 里的条目因此共享一个指纹口径。
     fixture 要让「原指纹 ≠ 本 Run 指纹」的携带条目落盘后仍等于本 Run 指纹。
  - **`niceeval accept @<locator>` 新建的条目另落 `acceptedFrom`。**
    来源 locator、旧/新指纹与逐条差异摘要都要往返；`opaque:no-manifest` 两侧值算不出时只保留 selector。
    它是这条结果为何在新口径下成立的唯一记录。
- **`manifests.json` 落盘**：与 `run.json` 同层、逐 eval 一份，配置面 / 源码面 / 数据面三块都要往返读回。
  只跑了一半的 Run 也已经有它——它在规划期一次写成，不随 attempt 完成回写，fixture 要有「Run 未收尾但清单已在」这一格。
  历史 Run 没有这个文件时读取面如实为缺失，不合成一份空清单。
- **超时归属落盘**：超时产生的 `errored` 条目带 `error.timeout` 三个字段——触发层、`limitMs`、来源层，三者原样往返。
  两个触发层各要一条，`attempt-deadline` 的来源层按四层来源各一条区分力格，`command-timeout` 的来源恒为 `command`；非超时的 `errored` 不带这个字段，缺失与写空对象不合并成同一种 fixture。
- **执行耗时与出身两个新字段**：`executionMs` 落盘且等于 `durationMs` 减去 `sandbox.queue` 那一段（fixture 要有非零排队，否则两者相等、这条测试没有区分力）；`sandbox.reused` 只在复用运行的 attempt 上出现，与 `kept` 互不干扰、可同时省略。
  两者都是可选字段，读取面对缺失的历史落盘不报错。
- **`evidenceState` 三态**：`local` / `borrowed` / `dangling` 各自可达且不合并。
  fixture 分别构造同目录 artifact、`artifactBase` 指向存活原 Run、原 Run 目录已删除三种落盘树。
  `dangling` 时 `artifacts` 列表仍声明写过该文件，懒加载返回 `null`；消费方能够观察两者差值。
- **artifact 懒加载**：七个方法（`commands` / `events` / `trace` / `o11y` / `agentSetup` / `diff` / `sources`）缺文件一律返回 `null`，不抛错。
  携带条目按候选顺序查询 `artifactBase`；测试还覆盖 `sources()` 解引用去向、磁盘截断事实和同 handle 记忆化。
  缺失、空、有值三态不合并成同一种 fixture 默认值。
- **标注源码与证据装配**：
  - `SourceArtifact.role === "entry"` 唯一决定主干。
  - 带位置的断言、给分与 send 沿 project / package / unavailable 路径归属。正文缺失或行号越界不降级成 unmapped；只有真正没有位置的记录进入未映射分组。
  - 递归汇总区分 passed / failed / unavailable、挣分 / 满分与前置中止；标注按统一发生序排列。
  - 测试覆盖轮与 turn 的配对和错位保护、无幻影尾空行，以及 CRLF/LF 归一。
  - `AttemptEvidence` 携带完整树而非单文件投影。能力位取决于数据真实存在，identity 与 locator 原样一致，execution 与 span 按 call id 关联。
- **Usage 落盘**：每个字段只在协议真实提供时写入。fixture 区分省略、零值与非零值；没有请求计数的协议不得写 `requests: 1`。
  - OpenAI 系口径在落 `inputTokens` 前扣除缓存明细且不产生负数；Anthropic、pi 等互斥口径如实转发。
  - fixture 让扣与不扣的结果可区分；缺缓存字段时保留输入总量。每个生产点各锁一条字段映射，扣减下限只集中证明一次。
- **facts 落盘**：sandbox hook 与 agent 上下文写入 `AttemptRecord.facts`，experiment hook 写入 `RunMeta.facts`。Runner 自动决定层级。
  - 测试覆盖同 key 后写覆盖、key 词法、非标量值报错，以及 experiment facts 与 `completedAt` 同批封口。
  - facts 不参与 verdict、指纹或 `configHash`；读取面把两级 facts 原样读回，不合并。
- **命令退出证据落盘**：`commands.json` 只在有 Sandbox 命令时生成，文件存在性与 `AttemptRecord.artifacts` 一致。
  - evidence 的 timingNodeId、phase、display、exitCode、checked、stdout、stderr 按 Runner 封口后的值原样往返：未登记内容不改，`CommandOptions.sensitiveValues` 命中的子串已经是 `<redacted>`。超过 256 KiB 的输出也不复用 events 的逐值截断。
  - 携带按 artifactBase 懒加载；`publish({ artifacts: ["commands"] })` 解引用复制后不留回退指针。
- **publish 与 resolveLocator**：目标非空时报错，预检失败不留半成品；文件大小预检报告整体失败与明细。
  产物经解引用、去重并补 `knownEvalIds` 后自包含，复制条目的 `evidenceState` 恒为 `local`。
  源含 `dangling` 条目时整体失败并列出 attempt；`resolveLocator` 只查内存，错误类别可分辨。
- **开放 activity key 的往返与未知 key 读取**（[两层时间模型](../../../feature/record/architecture.md#两层时间模型生命周期锚点与开放-activity)）：

  - writer 接受第三方未知 `ActivityKey` 原样落盘；`openRecord` 读回同一棵树，不因 key 不在官方词表而拒绝。
  - 未知 key 对 `durationMs` / `executionMs` / verdict / deadline 零影响。
    fixture 要有「官方 key + 未知 key 同树」且口径只跟锚点走的区分力格。
  - 官方 reader 不依赖任何 registry 才能展示未知节点。
- **Run / attempt 双时钟域**：

  - `RunMeta.timings` 的 offset 相对该 Run 单调时钟起点；`PhaseTiming.children` 相对该 attempt 起点。
  - 两域 offset 不得混算，也不得拿远端 OTel 绝对时间硬对齐。
  - fixture 同刻写入两边 activity，断言读回各自相对本域起点。
  - 共享构建只出现在 Run 域，不复制进任何 attempt 的 `executionMs`。
- **`TimingOrigin` 的 attempt / run 两支**：

  - attempt 支必带 Runner 打开的 `LifecyclePhase`，可选 `timingNodeId` 指向该锚点下 activity。
  - run 支必带指向 `RunMeta.timings` 的 `timingNodeId`，不伪造 attempt 锚点。
  - 构建失败的依赖 attempt 全部 `errored`，且 origin 指向同一个 Run timing node。
  - 缺失 timing 时允许只写 attempt 锚点，或写无 `origin` 的 Run diagnostic；三态不合并。
- **publish / carry 对 timing 引用的忠实保留**：

  - attempt 的 `phases` 与 activity 子树随 `result.json` 原样携带、原样 publish，不得回写或裁剪。
  - `publish` 恒复制 `run.json`，`timings`、`sandboxBuilds` 与 origin 引用随之完整保留。
  - 携带条目不继承本 Run 的 `RunMeta.timings` / `sandboxBuilds`（与 `RunMeta.facts` 同规则）。
  - 携带条目上 run scope 的 `timingNodeId` 经 `artifactBase` 回原 Run 解引用。
- **`sandboxBuilds` 与 `timingNodeId` 引用完整性**：

  - 每个实际查询或构建过的 BuildKey 一条 provenance，多 attempt 引用同一条。
  - `timingNodeId` 指向同份 `RunMeta.timings` 里对应的 `sandbox.build`；本表不复制 duration。
  - `status` 四值（`hit` / `built` / `failed` / `cancelled`）各要区分力格。
  - cache hit 也留下有界查询 activity；完全携带、无需查询的 BuildKey 不造假记录。
  - writer 保证 `timingNodeId` 可解引用；reader 对解引用失败按数据缺失回退。

## 不这样测

- 不让 builder 隐藏 startedAt、attempt、experimentId 等身份字段。
- 不只断言 writer 写出了某个文件；还要断言事实位于正确层级且 reader 能读回。
- 不用一份巨大黄金目录覆盖版本、身份与 artifact 三类分类。
- 不把 `null`、空数组、零和缺文件合并成同一种 fixture 默认值。
- 不在测试里复刻 locator 派生算法再对答案；期望值写死在 case 里。
