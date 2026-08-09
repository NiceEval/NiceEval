# 测试组合、Owner 与退役

本篇管理“哪些测试值得存在”，不建立运行时 Registry。目标不是测试最多或行命中率最高，而是每个会进入发布的
错误都有一个最早、稳定、可读的 owner，并且同一矩阵不在多层复制。

## 两层的存在资格

| 身份 | 必须回答 | 数量规则 |
|---|---|---|
| E2E | 删掉后会放走哪个稳定用户错误？为何 Unit 看不到真实边界？ | 每个结果一个主 owner |
| Unit | 哪一类错误算法会通过？为何 E2E 无法稳定制造或区分？ | 每个具名风险一个矩阵 owner |

下列理由不能单独让测试存在：新增函数、分支、DTO 字段、DOM class、snapshot、line coverage，或“离实现近一点更放心”。

## Owner 表

每个产品域在自己的 testing 文档维护一张小表，目标形状如下：

| 用户结果 / 确定性风险 | 形态 | Owner | Lane | 历史 bug |
|---|---|---|---|---|
| `show --json` 经 pipe 完整交付 | 单边界 E2E | `e2e/cli/test/show-json-pipe.test.ts` | PR / release | `d8d5a84b` |
| CJS 项目 `init → list` | Journey E2E | `e2e/package/test/commonjs-init-list.test.ts` | PR / release | `b44420d3` |
| Codex CLI 工具事件读回为 `shell` | Adapter E2E | `e2e/adapter/codex-cli/test/tool-identity.test.ts` | main / nightly | — |

表只回答 owner 和运行档，不复制 argv、fixture、expected 或步骤。执行真相仍在测试文件，lane 真相在 Repo manifest。

## 唯一矩阵 Owner

一个等价类只在一个位置完整展开。例如 fingerprint 哪些输入参与身份由 unit 表驱动穷举；真实项目“只重跑发生变化的
Eval”由一条单边界 E2E 证明接线。human、JSON、Report 和 runner 不再各复制一份 fingerprint 全矩阵。

其它层若要保留代表，必须指出它排除的不同错误实现：

- schema unit 证明编码形状；
- CLI 单边界 E2E 证明安装后进程与落盘接线；
- Journey E2E 证明跨域的 locator 能继续交给 show / view；
- 三者不是因为“多测一层”，而是观察不同边界。

## Fixture 变化预算

Unit fixture 只显式填写本 case 有语义的字段；机械默认值由测试专用 builder 补齐。builder 只造输入，不计算预期。

E2E 不手写内部 Run、Attempt 或 Report DTO；它们通过真实 Eval / Experiment 产生结果，再从公开 CLI、包导出、
HTTP 或浏览器读取。只有“旧 Record 兼容性”本身是契约时，才签入最小旧格式 fixture，并把 schema version 写成独立字面量。

合理的变化预算：

| 变化 | 允许修改的测试 |
|---|---|
| 内部重构、DTO 增加无关字段 | 不应修改 E2E；只改真正依赖该语义的 Unit |
| 公开输出新增可选字段 | 旧结果测试通常不改；新增结果需要新断言时才改 owner |
| 公开格式破坏性升版 | 对应 contract owner 与显式旧版兼容 fixture |
| 用户任务或结果改变 | 对应 E2E owner 和产品文档 |

目标不是测试永远不改，而是测试变化与公开契约变化同范围。

## 功能归属与 Bug 回归

“功能测试”和“Bug 测试”不是两套平行目录。每条长期测试都先属于一个稳定功能；历史 Bug 只给其中一条有区分力的测试增加回归凭据。
因此不建立 `bugs/`、`issues/` 或按日期分组的套件，也不把 issue 编号写进文件名和 `test()` 标题。

三类文档各自回答不同问题：

| 文档 | 回答的问题 | 测试怎样指向它 |
|---|---|---|
| Feature 契约文档 | 用户长期得到什么行为 | E2E 文件头用 `feature:`；优先链接 `docs/feature/**`，内部 CLI / package 边界链接其稳定 owner 文档 |
| `docs/engineering/testing/**` | 哪些等价类和边界由哪个测试拥有 | Unit 沿用机器检查的 `// cases:`；E2E owner 表只列文件与 lane |
| `memory/**` | Bug 的现象、根因、修法和旧实现 kill 收据 | Unit 用 `// bug:`；E2E 用 `// regression:` |

公开 issue 可以追加一行 `issue:`，但不能替代仓库内的 memory。issue 可能改标题、关闭或迁移；memory 必须保存复现条件、
fix parent 或逆补丁、最早失败阶段，以及为什么这条 oracle 能区分旧实现。

单边界 E2E 指向它唯一跨过的契约。Journey 跨多个产品域时只登记最终用户结果的 owner；中间步骤的次级契约留在步骤旁的
普通注释。这样 `feature:` 仍能回答“这条长流程归谁维护”，不会变成一串每次流程增减都要同步的标签。

```ts
// feature: docs/feature/reports/show/json.md
// regression: memory/show-json-pipe-truncated-at-128k.md
// issue: https://github.com/owner/repo/issues/123  // 只有真实存在时才写
test("show --json 经 pipe 仍交付完整文档", async () => {
  // argv、公开观察和 expected 仍留在这里。
});
```

没有历史 Bug 的功能测试只写功能归属。发现 Bug 后，先加强原 owner；新断言确实能杀死旧实现时，才追加 `regression:`。
若只能证明同类风险而没有 kill 收据，仍只链接 Feature 契约。相关 memory 可以在普通解释注释或 Repo README 中写成
“相关风险”，但不再发明一行看似可机器追踪、实际没有 kill 资格的 `risk:` 元数据。

## 历史 Bug 回归

Bug escape 后按顺序处理：

1. 找本应捕获它的现有 owner；
2. owner 命题正确但 fixture / 断言无区分力时，修它，不并排建第二套；
3. 只有现有 owner 无法表达独立错误算法或真实边界时，才新增测试；
4. 在测试头写 `regression: memory/<条目>.md`，标题仍描述长期结果；
5. 用 fix parent、历史 worktree 或最小逆补丁确认新测试会红；当前候选应绿；
6. 删除被替代的重复测试。

无法杀死旧实现的 case 只能叫补充验证，不能宣称“防住了这个历史 bug”。
按现象类比也不够：HTTP 两页 cursor 不能代替 SDK paginator，普通 5xx 不能代替 pseudo-E2E 的候选包边界，locator 往返也不能
代替共享 mutation 的顺序 bug。`regression` 指向的 memory 需要同时保存旧实现失败的断言与最早失败阶段；没有 kill 收据时
只保留公开契约链接，相关历史只能作为解释材料，不能只挂 commit 或 issue 冒充回归证明。

## 迁移与退役

迁移一批旧测试时提交一张简短对账表：

| 旧测试 | 判定 | 新 owner / 理由 |
|---|---|---|
| 线性 CLI 大脚本的一段 | 拆分 | 按行为命名的 E2E 文件，可按标题单跑 |
| 内部宿主模拟外部 cwd | 删除 | Package 场景 Repo 已从候选 tarball 证明 |
| 完整 DTO snapshot | 删除 / 收窄 | 无公开契约；独有算法留最小 unit |
| 会修改共享 RecordStore 的 readback | 隔离 | 独立 Repo 或独立 `.niceeval` Store，不靠顺序 |

新旧测试不能无限期并行。新 owner 只有通过当前候选、历史 bug kill 和本地单项重跑后才接管；接管同批删除旧 owner。

## 可读性 Review

评审测试按下面顺序读，不需要先找其它声明：

1. 标题承诺的用户结果是什么？
2. 哪一行是真实公开动作，完整 argv 在哪里？
3. expected 是否独立、是否就在附近？
4. 失败会停在哪个 prepare / invoke / observe / outcome / cleanup 阶段？
5. 它杀死哪个旧错误或排除哪个错误算法？
6. 是否已有另一层完整复制同一矩阵？
7. 内部无关字段或 CSS 重命名会不会迫使它修改？
8. 若测试修改 config、结果或服务，它是否只触碰自己的 Repo 副本和 owned resource？

前三项需要跨多个声明文件才能回答，或第 5 项无法回答时，先改测试设计，不扩充复用设施或 Registry 掩盖问题。

## 修改测试的决策门

生产改动让测试失败时，不先更新 snapshot 或 expected；按下面顺序裁决：

| 问题 | 处理 |
|---|---|
| 公开结果没有变化 | E2E 的 expected 不改；若它因 DTO、路径、CSS 或函数名失败，收窄它与实现的耦合 |
| 公开契约有意变化 | 先改产品契约，再只改该结果的唯一 owner；兼容性 owner 仍保留旧格式 fixture |
| 新 bug 逃逸 | 先加强已有 owner 并证明能杀死旧实现；只有新边界无法由它表达时才新增测试 |
| 运行设施变化 | 只改 candidate、process、server 或 cleanup 收据层；领域 expected 不随 executor 改写 |
| Snapshot 大面积变化 | 先检查结构化字段和用户语义；只接受属于该 snapshot owner 的稳定表示变化，不批量确认 |
| 测试需要依赖兄弟顺序 | 分配私有 Repo / `.niceeval` Store；不增加 `serial` 或“必须最后”注释掩盖共享状态 |

这套决策允许真正的契约变化修改测试，同时阻止内部重构把大量 E2E 拖进同一个 diff。

## 周期复核

测试跟改率用于每次大迁移前后和至少每半年一次的人工诊断，不作为 CI 红绿门禁。固定命令、历史参照值和本方案如何
针对旧问题见 [新体系如何避免旧问题](history-problems.md)。

复核期待看到：内部重构不再批量触碰 E2E；头部高跟改文件能解释为真实契约变化；被迁移的大脚本和 DTO
fixture 不换名字重新长回来。若仍反复修改，优先检查 layer、oracle 和共享状态，不把门槛改成“多写几个测试”。
