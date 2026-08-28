# 测试体系

niceeval 的测试体系采用“真实用户 Journey + 原生结果断言”。
本目录是仓库测试机制的唯一正式入口，不再维护并行的 Roadmap、候选方案或代码原型。

用 `pnpm run repo docs test --help` 发现测试与产品契约的 Trace 投影；它不是代码测试 runner。

## 目标

测试体系同时优化五件事：

- **测真实结果**：从安装后的 Library、CLI、HTTP、浏览器或真实 adapter 协议进入，断言用户拿到的结果；
- **稳定**：小更改只修改真实契约影响范围内的 owner，不连带修改无关测试文件；
- **可靠**：同一提交、输入与运行条件重复执行时不意外失败；
- **能定位**：单边界 E2E 只跨一条公开边界，Journey 在每个必要接缝检查，失败报告标出阶段和原始收据；
- **易阅读**：命令、动作、独立预期和历史 bug 引用留在同一个原生测试文件。

稳定与可靠是自动化测试的准入条件，不是测试完成后的优化项。
Bug 修复统一从公开入口的 E2E 红灯开始；只有无法固定的外部条件、安全限制或 Provider 阻塞才改由 AI 通过真实生产入口验收。

真实场景 Repo 是表现和运行手段，不是新的测试语义。它就是一个普通用户项目，含自己的
`package.json`、lockfile、NiceEval 依赖、config、Eval、Experiment、Report、服务和测试。
测试仍然要明确执行 `pnpm exec niceeval exp`，再以 `query discover / explain / run` 或 `view` 断言过程与结果，不能用“这个 repo 跑过了”代替测试命题。

功能测试与 Adapter 测试使用两组不同 Repo。CLI、Runner、Report、Package 与 Lifecycle 使用自己的确定性消费项目；
`adapter/` 是协议 collection。AI SDK、Codex CLI、Claude Code、OpenCode、Bub 与确定性 UI Message Stream fixture 都是独立叶子 Repo，
各自安装候选包并拥有结果根。两组只共用根 runner 与机械 Testkit，不互借 fixture、依赖或运行结果。

## Owner 选择顺序

每个稳定用户目标或公开结果按同一顺序裁决：

1. 从产品契约列出用户目标与公开结果，不读取现有测试来反推义务。
2. 目标跨越多个公开接缝时，由一个最小 Journey E2E 拥有，并在终态所需接缝设置检查点。
3. 一个原子公开结果只跨一条真实边界时，由单边界 E2E 拥有。
4. 只有前两种 E2E 无法直接、稳定地制造输入并观察同一错误结果时，才保留最小 Unit 例外。
5. 选定形态后才检查现有 owner；命题相同就修正或复用，不并排增加测试。
6. 没有稳定、可靠且长期收益足以抵偿维护成本的自动化命题时，不写自动化测试，改做本次 AI 真实验收。

现有测试没有保留资格。复核从零开始，每条 Unit 都先与 E2E 比较，而不是与其它 Unit 比较。
“算法重要”“分支独有”“方便定位”或“没有另一条 Unit”都不能说明 E2E 做不到；无法给出具体反例时直接删除。

没有“公式”“schema”“纯逻辑”这类整类 Unit-first 豁免。代码位于哪个源码目录，也不决定测试形态。

目录仍只有 Unit 与 E2E 两个执行层，但两层不是平级的默认选择：

| 形态 | 证明什么 | 身份 |
|---|---|---|
| Journey E2E | 安装后的候选包完成一个跨公开接缝的用户目标 | 产品主 owner |
| 单边界 E2E | 安装后的候选包交付一个原子公开结果 | 产品主 owner |
| Unit | E2E 无法稳定区分的确定性风险 | 有证据的例外 |

`Journey` 是 E2E 体裁，不是第三层。Testkit 与根 E2E runner 是测试执行所需的普通代码，不另建一种测试身份；runner 的行为由
真实场景执行和 CI 收据验收，不再维护 `test/unit/e2e-runner/` 模拟套件。另一条轴只回答产品域：Eval、CLI、Report、Package、Runner、Adapter、Sandbox / Lifecycle。

## Bug 修复的 E2E TDD

Bug 修复先从安装后的候选包和公开生产入口建立 E2E 红灯，再修改生产代码：

1. 从 Feature 契约确定长期用户结果和公开观察，不从当前实现反推 expected。
2. 同一结果已有 E2E owner 时加强它的 fixture 或断言；没有合格 owner 时新增一个最小 Journey 或单边界 E2E，不并排复制矩阵。
3. 用 fix parent、历史 checkout 或最小逆补丁运行同一 owner，保存最早失败阶段和红灯收据；红灯必须来自真实候选、公开入口与独立 expected。
4. 修改生产根因后运行同一 owner 转绿，并按本篇可靠性门验收。Unit、源码直调、私有落盘文件和复制生产算法的 fake 都不能代替红灯。

只有无法固定的外部条件、安全限制或 Provider 阻塞才允许暂停 E2E TDD。开工前必须写明具体阻塞；随后把当前 candidate 安装到隔离消费项目，从公开入口执行代表性动作，并在 PR Test impact 保存 candidate Git SHA / tarball digest、运行条件、命令、公开观察、cleanup 与未守护风险。测试重置、工期或内部实现标签不构成例外。

## 风险边界

| 风险 | 默认主 owner | 允许的 Unit 例外 |
|---|---|---|
| 公共 Library API、opaque Record 的 CLI / Report 行为 | 安装后 package API 或 Report Repo 的单边界 E2E | E2E 无法穷举的非法输入或算法矩阵 |
| Eval、Context 与公开 Assertion 契约 | Eval 场景 Repo | 无法由真实 Eval 稳定区分的纯算法矩阵 |
| 选择、聚合、归一、schema | 对应用户结果的 Journey 或单边界 E2E | 具名错误算法的最小等价类 |
| 安装、exports、外部 cwd、CJS / ESM | Package 场景 Repo | 无 |
| argv、pipe、PTY、exit、机器输出 | CLI 场景 Repo | 无法由真实 PTY 稳定制造的纯布局算法 |
| query、view、HTTP、浏览器与视觉结果 | Report 场景 Repo | 无法由浏览器稳定穷举的纯组合算法 |
| 并发、取消、signal 与 orphan | Lifecycle E2E 拥有资源终态 | barrier / fake clock 拥有可控竞态次序 |
| Adapter 产品语义 | 确定性 UI Message Stream E2E | NiceEval 自有词表上的纯归一或错误分类 |
| 真实 Provider | live Adapter 兼容性检查 | 不接管确定性产品语义 |

一条风险只在一个位置展开完整矩阵。其它层只有在能排除不同错误实现时才留最小代表。
不能把同一场景换成 human、JSON、DOM 和 snapshot 各测一遍。

## 稳定性：变更预算

稳定的定义是：小更改只修改真实契约影响范围内的测试，不连带修改无关测试文件。

PR 审查直接从 base diff 列出所有新增、删除、重命名或实质改写的产品测试、fixture、expected 与 harness，
再从产品契约和可观察行为的变化独立推导受影响 owner，逐文件核对测试 diff，不依赖 PR 描述自报。
以下预算是 blocking 规则：

- 公开结果不变的内部重构，产品测试、fixture 与 expected 的预算为零；私有路径移动只能修改一个集中 seam 或 harness。
  若必须批量跟改，说明测试锁住了实现细节，必须恢复稳定边界、迁移或删除这些测试。
- 每个新增的独立用户目标只新增一个 Journey 主 owner；目标只有一个原子公开结果时才使用一个单边界 E2E。
  多个可独立失败的用户目标必须逐个列出契约与 owner，不能以“同一功能”为由压进一个测试；既有用户结果不变时不修改其 owner。
- 公开契约变化只修改实际结果发生变化的 owner。多个测试文件同改时，每个文件都必须拥有独立公开结果；
  “同一 Feature”“顺便增加测试涉及范围”或实现文件同批变化都不能扩大预算。
- Snapshot 或 golden 只有在 owner 已声明的稳定表示实际变化时才能更新；批量确认输出变化不能代替逐项核对契约与 expected。
- Bug 修复必须先由安装后的旧候选经公开入口取得 E2E 红灯，再修改生产代码；先加强本应捕获它的既有 owner，
  没有合格 owner 时才新增一个最小 Journey 或单边界 E2E。只有无法固定的外部条件、安全限制或 Provider 阻塞才可改做
  AI 真实验收；测试重置、工期或内部实现标签不构成例外。Unit、源码直调或私有落盘文件不能代替红灯，红灯必须杀死旧实现。
- 测试设施变化只修改集中机械适配层，产品 expected 不随 runner、executor 或内部 receipt 改写。Testkit、根 E2E runner
  与 workflow 不建立独立测试分类，也不用 Vitest 扫描 YAML 或源码结构来证明测试流程。专门的测试退役 PR 只修改声明的迁移集合，
  并逐项给出 retain、replace 或 delete 的证据。
- Report、Runner、Record 的新 owner 接管前必须做 contract-preserving perturbation：分别改变内部 DTO、组件树或 class，
  调度器、receipt 或模块布局，私有存储或 reader，同时保持公开结果不变。演练前后测试源码、fixture 与 expected 必须零 diff 并保持全绿；
  再注入一个真正改变公开结果的 mutation，确认对应 owner 在最早相关阶段变红。

任何超出预算、缺少唯一 owner、复制已有矩阵，或因内部实现小改而连带修改的测试，都必须在合入前修正。
[PR 模板的 Tests section](../../../.github/PULL_REQUEST_TEMPLATE.md#tests)负责保存逐文件最终源码、删除处置与共享验证收据；
[测试跟改率](churn.md)只用于事后发现长期偏差，不能代替本次审查。

## 可靠性：重复运行

新增、接管或实质修改确定性自动化 owner 时，必须通过固定接管门：

- 在三个彼此隔离的 Repo 副本中各运行一次；
- 在同一副本中连续运行两次，证明没有上轮状态漂移；
- 所属 Repo 按默认并行运行一次，证明不依赖顺序或独占共享状态；
- 按文件与标题单项运行一次；
- 对进程、server、container 与 Sandbox 取得资源终结收据。

这些运行使用同一 candidate digest、checkout、lockfile、fixture、seed、时钟策略与运行镜像。
语义 Verdict 和实体关系必须相同；动态 ID、临时端口与 duration 不要求逐字相同。
确定性自动化 owner 禁止测试级 retry；任一次意外失败、retry 后转绿、默认并行失败或遗留资源都属于可靠性失败。

真实 Provider 不承担确定性产品可靠性。确定性协议 counterpart 通过上述接管门；live Adapter 只断言稳定协议事实。
每次新增或实质修改 live owner 都在可信 PR 的 affected 集或显式 full E2E 中完成真实运行与公开读回。live Repo 不用重复 takeover 证明 provider 确定性。
结构化外部故障不算 pass，可由同一 candidate 的 AI 真实兼容性验收替代；两者都没有时状态是“未证明”。

## 不自动化

不自动化不是测试层，也不是长期 owner。Bug 修复只在无法固定的外部条件、安全限制或 Provider 阻塞时进入本路径；没有既有 owner 时应新增最小 E2E，不能用测试重置、工期或内部实现标签跳过。非 Bug 变更仍按长期区分收益、稳定性、可靠性与维护成本裁决。

PR Test impact 按 [PR 模板](../../../.github/PULL_REQUEST_TEMPLATE.md#tests)保存本次 AI 真实验收及未守护风险。
不创建空测试、mock 假 pass 或伪 owner。Docker-in-Docker 依赖不可固定的宿主内核、daemon 权限和嵌套网络时属于适用例。
安全或发布关键行为既无可靠自动化、又无本次真实验收时必须阻断。

## 测试正文约束

`owner:`、`regression:` 与 `issue:` 是受管关系 mutation，不是普通注释编辑面。命令必须验证 owner 的唯一 contract、Problem-only regression、direct Issue provenance、公开入口 E2E 红绿门与可靠性接管条件；写入前执行关系 preflight，并以短时 receipt 约束实际 publication。手写 metadata、标题或普通 Markdown mention 都不能建立、替换或删除这些关系。

- 每个测试文件第一行写 `// owner: <docs path#anchor>`；一个文件只拥有一个稳定结果或一个具名 Unit 风险。
- 单边界 E2E 的一个 `test()` 只承诺一个用户可观察结果；Journey E2E 的一个 `test()` 只承诺一个完整用户目标。
- Journey 检查点只证明终态所需前提。独立输入、expected、修复动作或可独立失败的命题必须拆到另一文件。
- 完整 argv 留在调用点；允许 `runProcess()` 隐藏 spawn 细节，不允许 `runScenario("report")` 隐藏用户动作。
- 预期来自公开契约、签入 fixture 或测试中字面量，不能从候选包枚举、解码后再生成自己的 expected。
- 结构化输出先 parse，再按稳定身份比较；只有短且逐字承诺的反馈使用 golden。
- 浏览器沿页面真实 `href` 断言 URL、HTTP、产品已声明的可访问身份和可见结果，不拼 target 路径，也不臆造不存在的
  role / label；不稳定能力先记产品缺口。
- 历史回归写 `regression: memory/<条目>.md`，标题仍描述长期结果。新 case 必须能杀死旧实现。
- 复用设施只拥有临时目录、进程、server、parser、artifact 和 cleanup 等机械能力；浏览器生命周期默认交给 Playwright Test。

## 失败怎样定位

E2E 不承诺指出生产源码行，但要把问题收窄到最近的公开接缝：

1. `prepare`：项目、依赖、fixture、Docker service 或 secret 未就绪；
2. `invoke`：安装后的命令、HTTP 请求或浏览器动作没执行成功；
3. `observe`：stdout、JSON、HTML、协议事件或 artifact 不可读；
4. `outcome`：观察合法，但用户结果错误；
5. `cleanup`：进程、容器、sandbox 或临时目录未释放。

单边界 E2E 用于指出坏在哪条公开边界，Journey E2E 用最近检查点指出坏在哪个域间接缝；需要源码级区分力时，
再配一条最小 Unit。禁止为了定位在产品里加入测试专用探针。

## 本地与 GitHub CI

本地与 CI 共用根入口和同一个候选 tarball 注入链：

```sh
pnpm e2e test --lane pr
pnpm e2e test --repo report
pnpm e2e test --repo report -- --run test/exported-targets.test.ts
pnpm e2e test --lane main --repo adapter/codex-cli
```

- PR 先由 Nx project graph 选择受影响 E2E；同仓可信 PR 对选中集合使用 main lane 和最小 secret 白名单，Fork 与 Dependabot 使用无密钥 pr lane；
- main、nightly 与 release 都运行各自声明的完整 Repo 集，不按 diff、成本、Docker 或 provider 类型降频；
- release 先生成最终 tarball，验收通过后发布同一字节与 digest；
- workflow 只负责 checkout、运行时、矩阵、cache 和 artifact，选择、注入、executor、重试和失败分类都在根 runner；
- 不使用 `pull_request_target` 或 `workflow_run` 让不可信 PR 代码读取 secret。

Unit 总量是退化护栏，不是行命中率目标。`pnpm test` 报告的 Tests 数不得超过 200；Testkit 不设独立 Unit 套件。
`test.each` 展开的每个 case 都计入。不能把独立命题合并进一个大测试规避上限，也不为接近上限而补测。

完整执行契约见 [本地与 CI](e2e/execution.md)；project graph、合法空计划、fallback 与 owner 维护见
[任务图与 E2E 选择](../task-orchestration/README.md)。

## 文档地图

- [Architecture](architecture.md) —— 数据流、分类、oracle、失败与复用设施边界；
- [官方 Testkit](testkit.md) —— 跨 Repo 的进程、严格数据解码、等待与资源终结原语；
- [测试组合与退役](portfolio.md) —— Journey portfolio、owner、变更预算、矩阵去重与迁移规则；
- [Unit](unit/README.md) —— 确定性语义例外的存在资格和写法；
- [E2E](e2e/README.md) —— 单边界测试、Journey、Adapter 与 Lifecycle；
- [E2E 测试正文](e2e/README.md) —— 原生测试文件、命令收据、阶段、失败分类与浏览器写法；
- [真实场景 Repo](e2e/scenario-repos.md) —— 项目形状、候选注入、隔离和 adapter backend；
- [本地与 CI](e2e/execution.md) —— host / Docker、lane、Actions、release 与 artifact；
- [任务图与 E2E 选择](../task-orchestration/README.md) —— Nx project graph、affected、fallback 与管理收据；
- [测试跟改率](churn.md) —— 用历史读数识别绑定实现细节的测试；
- [`unit/<feature>.md`](unit/README.md#feature-测试文档) —— Unit 例外类别、Fixture 与矩阵 owner；
- [Eval](e2e/eval.md)、[`e2e/adapter/`](e2e/adapter/README.md)、[CLI](e2e/cli.md)、[Record](e2e/record.md)、[Report](e2e/report.md) —— 各域的长期结果 owner。

历史缺陷的现象、根因与反直觉修法只留在 [`memory/`](../../../memory/INDEX.md)。
正式测试义务只由本目录的 owner 文档与对应产品契约定义。

## 目标闭包

- 根 runner 生成并核对唯一待测 tarball；每个场景 Repo 在隔离副本安装同一 artifact，并保留原始进程收据和单文件重跑入口。
- Testkit 跟随 checkout 测试并按 runner invocation clean-build 一次；场景 Repo 只在隔离副本安装该目录依赖，不产生第二份 tarball 信任链。
- 每个自动化测试文件只有一个稳定 owner；Journey 不把独立结果压进同一个 `test()`。
- JSON pipe、CommonJS package 与 Adapter 工具身份各有能杀死对应旧错误的 owner。
- Report 单边界 E2E 只读消费证据；会修改配置、结果或服务的流程拥有私有项目副本与结果根。
- Journey E2E 跨 CLI、Report 等产品域，并在每个公开接缝立即检查身份与结果。
- PR、main、nightly 与 release lane 共用同一发现、注入、执行、分类和 artifact 协议。
- 新 owner 通过公开契约、历史错误 kill、重复运行接管门与单项重跑后接管，同批删除被替代 owner。
- 无法满足稳定与可靠要求的行为不写自动化测试，由 PR Test impact 保存本次 AI 真实验收与未守护风险。
