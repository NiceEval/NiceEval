# 测试组合、Owner 与退役

本篇管理“哪些自动化测试值得存在”，不建立运行时 Registry。目标不是测试最多或行命中率最高。
每个能够稳定、可靠自动化的用户结果应有一个最小主 owner；不自动化的结果没有长期 owner。
Unit 只作为可证伪的例外，同一矩阵不在多层复制。

## Owner 的存在资格

| 身份 | 必须回答 | 数量规则 |
|---|---|---|
| Journey E2E | 用户要完成哪个跨接缝目标？哪些检查点只服务这个终态？ | 每个用户目标一个主 owner |
| 单边界 E2E | 用户拿到哪个原子结果？为什么必须经过这条真实边界？ | 每个原子结果一个主 owner |
| Unit 例外 | 哪类错误算法会通过？为什么 E2E 无法稳定制造、穷举或区分？ | 每个具名风险一个最小矩阵 |

下列理由不能单独让测试存在：新增函数、分支、DTO 字段、DOM class、snapshot、line coverage，或“离实现近一点更放心”。

## 零基复核

测试清单不是契约。复核时先隐藏现有测试，只从 Feature 契约列出应由真实入口证明的用户结果，再选择 Journey 或单边界 E2E。
现有 owner 只是在形态确定后可复用的实现，不享有保留推定。

每条 Unit 只与 E2E 比较：若场景 Repo 能稳定制造输入，并从公开输出或资源终态观察同一错误结果，就删除 Unit。
与其它 Unit 不重复、涉及额外分支、失败更容易定位，均不是例外理由。保留方必须给出 E2E 做不到的具体条件；缺少该证明即删除。

`pnpm test` 报告的 Unit 最多 200 条，Testkit 不设独立 Unit 套件。这个数字只阻止套件重新膨胀，
不授权任何测试存在，也不能通过合并独立断言规避。

## Owner 表

每个产品域在自己的 testing 文档维护一张小表，目标形状如下：

| Owner ID | 用户结果 / 确定性风险 | 形态 | 文件 | Lane | 历史 bug |
|---|---|---|---|---|---|
| `#show-json-pipe` | `show --json` 经 pipe 完整交付 | 单边界 E2E | `e2e/cli/test/show-json-pipe.test.ts` | PR / release | `d8d5a84b` |
| `#commonjs-init-list` | CJS 项目 `init → list` | Journey E2E | `e2e/package/test/commonjs-init-list.test.ts` | PR / release | `b44420d3` |
| `#codex-tool-identity` | Codex CLI 工具事件读回为 `shell` | Adapter E2E | `e2e/adapter/codex-cli/test/tool-identity.test.ts` | main / nightly | — |

表只回答 owner 和运行档，不复制 argv、fixture、expected 或步骤。执行真相仍在测试文件，lane 真相在 Repo project metadata。
测试文件第一行写 `// owner: <文档路径#Owner-ID>`，一份文件只指向一个 owner。

Journey 的检查点只证明终态所需身份、接线和前置事实。
拥有独立输入、独立 expected、独立修复动作，或能与终态独立失败的命题，必须拆到另一 owner 文件。

## 唯一矩阵 Owner

一个等价类只在一个位置完整展开。例如真实项目“只重跑发生变化的 Eval”先由单边界 E2E 拥有；只有该结果无法区分
fingerprint 漏掉哪类输入时，才由已登记的 Unit 例外穷举最小输入矩阵。human、JSON、Report 和 runner 不再各复制一份矩阵。

其它层若要保留代表，必须指出它排除的不同错误实现：

- schema unit 证明编码形状；
- CLI 单边界 E2E 证明安装后进程与落盘接线；
- Journey E2E 证明跨域的 locator 能继续交给 show / view；
- 三者不是因为“多测一层”，而是观察不同边界。

## Fixture 与 Oracle

Unit fixture 只显式填写本 case 有语义的字段；机械默认值由测试专用 builder 补齐。builder 只造输入，不计算预期。

E2E 不手写内部 Run、Attempt 或 Report DTO；它们通过真实 Eval / Experiment 产生结果，再从公开 CLI、包导出、
HTTP 或浏览器读取。只有“旧 Record 兼容性”本身是契约时，才签入最小旧格式 fixture，并把 schema version 写成独立字面量。

稳定的定义、逐类预算、逐文件审计与 blocking 条件见[测试总纲](README.md#稳定性变更预算)。

## 功能归属与 Bug 回归

“功能测试”和“Bug 测试”不是两套平行目录。每条长期测试都先属于一个稳定功能；历史 Bug 只给其中一条有区分力的测试增加回归凭据。
因此不建立 `bugs/`、`issues/` 或按日期分组的套件，也不把 issue 编号写进文件名和 `test()` 标题。

三类文档各自回答不同问题：

| 文档 | 回答的问题 | 测试怎样指向它 |
|---|---|---|
| Feature 契约文档 | 用户长期得到什么行为 | Owner anchor 链接对应 Feature 契约 |
| `docs/engineering/testing/**` | 哪些结果和风险由哪个测试拥有 | 测试首行用唯一 `// owner:` 指向 anchor |
| `memory/**` | Bug 的现象、根因、修法和旧实现 kill 收据 | Unit 用 `// bug:`；E2E 用 `// regression:` |

公开 issue 可以追加一行 `issue:`，但不能替代仓库内的 memory。issue 可能改标题、关闭或迁移；memory 必须保存复现条件、
fix parent 或逆补丁、最早失败阶段，以及为什么这条 oracle 能区分旧实现。

单边界 E2E 指向它唯一跨过的契约。Journey 跨多个产品域时只登记最终用户结果的 owner；中间步骤的次级契约留在步骤旁的
普通注释。唯一 `owner:` 回答“这条流程归谁维护”，不会变成一串每次流程增减都要同步的标签。

```ts
// owner: docs/engineering/testing/e2e/report.md#show-json-pipe
// regression: memory/show-json-pipe-truncated-at-128k.md
// issue: https://github.com/owner/repo/issues/123  // 只有真实存在时才写
test("show --json 经 pipe 仍交付完整文档", async () => {
  // argv、公开观察和 expected 仍留在这里。
});
```

没有历史 Bug 的功能测试只写 owner。发现 Bug 后，按[测试总纲的 E2E TDD](README.md#bug-修复的-e2e-tdd)取得旧实现红灯；新断言确实能杀死旧实现时才追加 `regression:`。
若只能证明同类风险而没有 kill 收据，仍只链接 Feature 契约。相关 memory 可以在普通解释注释或 Repo README 中写成
“相关风险”，但不再发明一行看似可机器追踪、实际没有 kill 资格的 `risk:` 元数据。

## 历史 Bug 回归

Bug escape 后先裁决自动化回归或本次 AI 真实验收。选择不自动化时直接修根因，按 PR Test impact 保存公开入口手测和未守护风险，不创建回归 metadata 或伪 owner。选择自动化时按顺序处理：

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

迁移一批旧测试时，在 PR Test impact 提交逐文件或逐 owner 的处置表：

| 旧测试 / owner | 稳定结果或具名风险 | 判定 | 新 owner / Unit 例外理由 | 证据 |
|---|---|---|---|---|
| 线性 CLI 大脚本的一段 | `show --json` 完整交付 | replace | 按结果拆分的 E2E 文件 | mutation + 单项重跑 |
| 内部宿主模拟外部 cwd | 外部项目安装 | delete | Package 场景 Repo 已从 candidate 证明 | 历史错误 kill |
| 完整 DTO snapshot | 无公开契约 | delete | 无 | 不建立替代测试 |
| 独有算法矩阵 | fingerprint 输入等价类 | retain | E2E 无法穷举；稳定 seam | 算法 mutation |

新旧测试不能无限期并行。新 owner 只有同时满足以下条件才接管：

- 当前 candidate 通过；
- 公开 mutation 或历史旧实现在具名检查点变红；
- [可靠性接管门](README.md#可靠性重复运行)全部通过；
- Repo、文件和标题可单项重跑。

接管时同批删除旧 owner。整域使用“都是纯逻辑”作零删除理由，不构成退役证据。

## 不自动化的处置

`automation: none` 是一次变更的验收处置，不是长期 owner。
Bug 修复只有无法固定的外部条件、安全限制或 Provider 阻塞时可以选择本路径；没有合格 owner 时应新增最小 E2E。非 Bug 变更在不应新增 owner、自动化会违反稳定或可靠要求、依赖无法固定、必须复制生产核心算法，或长期区分收益不足以抵偿维护成本时可以选择。

PR Test impact 按 [PR 模板](../../../.github/PULL_REQUEST_TEMPLATE.md#tests)保存本次验收事实。
不创建空测试、mock 假 pass 或伪 owner。Docker-in-Docker 的宿主内核、daemon 权限和嵌套网络无法固定时适用本处置。
安全或发布关键行为既无可靠自动化、又无本次真实验收时必须阻断。

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
9. 它能否通过重复运行接管门；不能时是否应选择不自动化？

前三项需要跨多个声明文件才能回答，或第 5 项无法回答时，先改测试设计，不扩充复用设施或 Registry 掩盖问题。

## 修改测试的 PR 裁决

生产改动让测试失败时，不先更新 snapshot 或 expected。逐类预算与 Snapshot 变化按
[稳定性预算](README.md#稳定性变更预算)裁决，共享状态按[可靠性门](README.md#可靠性重复运行)裁决；
本篇不复制一张无法直接读取 PR diff 的决策表。

## 周期复核

测试跟改率用于每次大迁移前后和至少每半年一次的人工诊断，不作为 CI 红绿门禁。固定命令、历史参照值和本方案如何
固定命令与排查口径见 [测试跟改率](churn.md)。具体历史缺陷的现象、根因与修法只留在 `memory/`。

复核期待看到：内部重构不再批量触碰 E2E；头部高跟改文件能解释为真实契约变化；被迁移的大脚本和 DTO
fixture 不换名字重新长回来。若仍反复修改，优先检查 layer、oracle 和共享状态，不把门槛改成“多写几个测试”。
