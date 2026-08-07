# 新体系如何避免旧测试问题

本篇专门回答“为什么这样改能减少反复改 test”。依据来自 Git 历史、现行测试与 memory，不把“新方案更简洁”当作自证。

目标不是让测试永远不变。公开契约、用户任务或历史 bug 的区分条件变化时，owner 测试就应该改；要消除的是内部 DTO、
CSS、候选常量、脚本顺序和元平台结构变化造成的无关跟改。

## 历史读数

在 `c12aeeb27d4f` 上按 [`docs/engineering/testing/churn.md`](../../engineering/testing/churn.md) 的六个月口径运行：

```text
跟改  总改  文件
46    58    src/runner/run.test.ts
42    45    src/show/show.test.ts
38    43    src/runner/attempt.test.ts
38    42    src/runner/feedback/human.test.ts
35    38    src/view/view-report.test.ts
32    34    src/report/components/attempt-detail/attempt-components.test.tsx
28    32    src/report/components/compute.test.ts
28    31    src/report/runtime/dual-render.test.tsx
23    24    src/runner/fingerprint.test.ts
```

“跟改”表示同一 commit 同时修改了生产 `src/` 和该测试。这个数字只能找调查对象：其中可能包含合法契约同改、rename 或批量重构，
所以不做 CI 门禁，也不能直接用来给文件定罪。下面只引用已经逐 commit 核对过的代表问题。

## Commit 证据与新防线

### 1. 内部 DTO 变化扩散到无关测试

`84d46091 test(record): migrate fixtures to evidence schema v14` 为一次 evidence schema 迁移同时修改了 20 个测试文件，
共 135 行新增、17 行删除；Report、Show、Runner 等测试都要给手写对象补字段。

**根因**：测试直接构造完整生产 DTO，内部合法形状同时成了大量测试的 fixture 契约。

**新防线**：

- Unit 用最小领域 builder，只显式填写本 case 有语义的字段；
- E2E 不手写 Run / Attempt DTO，而是让真实 Eval / Experiment 经候选包产生结果；
- 只有旧 Record 兼容性测试手写格式 fixture，并固定独立 schema version。

**验收**：给生产 DTO 增加一个不参与公开结果的字段时，E2E 不应修改；受影响 Unit 只能是该字段的语义 owner。

### 2. 测试与候选实现共享同一个答案

`5c5f5b95` 曾把 E2E fixture 的 schema version 改成从候选 `niceeval/results` 导入
`RESULTS_SCHEMA_VERSION`，目的是让 fixture 自动跟随。`89ba8e64` 随后改回独立字面量 `9`，commit 内的注释明确指出：
reader 与 fixture 可以一起错而测试仍绿。

**根因**：actual 和 expected 来自同一个候选实现，减少了跟改，却也消灭了回归区分力。

**新防线**：expected 只来自签入 fixture、公开契约或测试字面量；动态 locator 可以从上一步公开命令取得，但 verdict、sentinel、
page 类别和规范工具名不能从候选反推。

**验收**：把候选常量或 enumerator 故意改错，新测试必须红；只改复用设施不能让 actual 与 expected 一起移动。

### 3. 名叫 E2E，实际没有经过发布包和外部宿主

`89ba8e64` 删除了三条根仓库 pseudo-E2E 及其 fixture：
`e2e-cli-output-profiles`、`e2e-linked-consumer-report`、`e2e-sandbox-hooks`。
同一 commit 把真实 package consumer 加到独立 `e2e/report`，共 680 行新增、1,229 行删除。

`b44420d3` 的 CommonJS bug 更直接。`npm init -y` 产生的 CommonJS 宿主里，`niceeval init` 刚生成的 TS config
在下一条 `list` 就装载失败。当时新增的 `test/package-exports.test.ts` 只能守住 exports 条件和双 loader hook；
真实 `init → list` 仍需要外部消费项目证明。

**根因**：根仓库源码、workspace package resolution 和 mock 宿主掩盖了安装、bin、loader、exports 与外部 cwd 的组合边界。

**新防线**：每个场景 Repo 有独立 package / lockfile；根 runner 复制后注入候选 tarball，核对实际 executable 身份；Package Journey E2E
直接执行 `pnpm exec niceeval init` 和 `pnpm exec niceeval list`。

**验收**：把 Repo 复制到仓库外仍能运行；禁止 workspace link、相邻源码 import 和直接执行 `src/cli.ts`。

### 4. Adapter mock 与生产代码共享了虚构的 SDK 形状

`0cef7946` 修复 E2B `Sandbox.list()` 被当成数组的问题：真实 SDK 返回 `SandboxPaginator`，生产代码却用
`as unknown as` 绕过类型。后续 `285990d7` 才补 paginator / 多页 reconcile tests；`4b37775c` 又在 detached inspect
路径修复了同一假设，而旧 `keep.test.ts` 的 mock 也返回数组，稳定地为错误实现背书。

**根因**：mock 由测试自行发明第三方形状，actual 和 fixture 共享同一个错误假设；只有 happy-path 单页数据也无法区分遍历算法。

**新防线**：Adapter Unit 直接从真实 SDK `ReturnType` 派生 mock 类型，至少包含两页；禁止双重类型断言重写上游接口。
真实 provider Repo 另证鉴权、版本和远端协议，确定性 fault proxy 证错误处理，两者不替代类型 / 分页矩阵。

**验收**：安装支持下限与当前 SDK 都做 typecheck / contract test；把 paginator 错改成数组遍历时 Unit 立即红，live E2E 失败仍保留
provider 操作和原始 cause，不退化成后续 Report 缺对象。

### 5. 宿主单测与真实读面重复，长期跟着外壳改

`022c0adc test: show/view 宿主单测退役,用法错误矩阵移交 e2e/report` 删除
`src/show/show.test.ts` 662 行和 `src/view/view-report.test.ts` 444 行；memory 给出它们当时的跟改率为 42/44、35/37。
零 token 的 CLI 用法错误矩阵迁入真实 `e2e/report`，只有 dev server 模块重载这类 E2E 无法区分的机制留在
`src/view/data.test.ts`。

**根因**：测试按“show/view 代码在哪”分层，而不是按“用户结果需要哪条边界、独有机制需要哪种区分力”分层。

**新防线**：CLI / Report 的参数、进程和宿主结果归场景 Repo；纯装载、计算和重载机制留 unit。每个矩阵只有一个 owner，
不在宿主 unit 和 E2E 各抄一遍。

**验收**：公共用法错误改动只修改对应场景 Repo 的 E2E 文件；内部 loader 重构只修改对应的 module reload Unit。

### 6. 共享可变 evidence 让测试依赖调用顺序

`031ce196` 描述并修正了一次 Report E2E 顺序问题：`verifyReadback` 末尾额外执行两次 `niceeval exp main`，改变“当前”快照；
晚于它运行的只读验证因此找不到原 locator。修复只能把 `verifyRenderStructure` 排在 mutation 之前，并写注释保护顺序。

**根因**：一个线性脚本把只读验证和会改变共享 `.niceeval` 的动作放在同一个隐式世界，文件顺序成了隐藏契约。

**新防线**：只读 E2E 可共享 prepare 后冻结的 evidence；会改变当前结果的测试使用自己的结果根或项目副本。
只有 package graph、executor 或资源所有权也不同，Journey 才增加 Repo；每个 Repo 和每次重试都从新副本开始。

**验收**：随机调整只读测试顺序仍绿；Journey E2E 单独运行仍绿；任何测试不能靠“必须排最后”的注释维持正确性。

### 7. 浏览器测试断言实现手段，页面重构就反复修改

`9fddf75d` 建立 Report component scenarios。后续 `35fa0937`、`f4f8d6d8`、`a008903e` 等页面 / 样式变更
继续触及同一批场景。
[`memory/e2e-browser-scenario-probe-loop-brittleness.md`](../../../memory/e2e-browser-scenario-probe-loop-brittleness.md)
列出了四种具体症状：

- 探测任意未展开节点；
- 断言 `.niceeval-row-hidden`；
- `waitForTimeout(100)` 固定等待；
- 只检查 `.niceeval-metric-matrix` class 存在。

**根因**：测试把 DOM 机制、等待方式和偶然 class 当成用户结果，失败也无法区分链接、路由、渲染还是交互。

**新防线**：先检查 URL / HTTP，再用 role、label、实体身份和 web-first assertion 检查可见结果；固定 sleep、实现 class 和
探测循环禁止进入新测试。

**验收**：只改 CSS class 或无障碍语义不变的 DOM 包装，E2E 不改；故意断开 target URL、路由或实体身份时，在最近检查点红。

### 8. 为管理测试再建一套比测试更大的平台

`32f2df7f docs(testing): 收拢测试方案并补真实 example` 一次增加 71 个文档 / 示例文件、5,519 行。
一个简单的 Report target example 被拆成 15 个文件，分别承载 Behavior、Recipe、World、Execution、Observed、Registry、
Retirement 等对象。读者需要跨文件后才能看到真实动作与结果；示例也没有自己的 package、lockfile、manifest 或 CI lane。

`998ebeef` 也曾通过删除重复的逐 case 文档清单净删 1,862 行，说明“把证明关系复制到更多登记文件”本身会形成维护面。

**根因**：用元模型同时管理证明范围、缓存、并发、作者体验与治理，测试正文反而退居末端。

**新防线**：多方案只留在 [Design](../../design/user-readable-testing/README.md)；Roadmap 只写选定方案。运行 manifest 只管宿主条件，
Portfolio 只链接 owner，命令、expected 和 bug 引用留在原生测试文件。Example 直接按 CLI、Report、Adapter 与 Journey E2E 展示。

**验收**：读者只打开一个测试文件，就能指出 argv、actual、expected、旧 bug 和失败检查点；单文件可由原生 test filter 重跑。

### 9. “真实 Repo”必须是独立消费者

文件数量与目录外观不能证明测试拥有真实消费边界。下列六类写法都会让场景 Repo 假绿或无法独立运行：

- 三种 adapter 断言平铺在一个 `adapter/` 下，本地 HTTP cursor 还错误引用了 E2B SDK paginator 的历史 commit；
- CommonJS test 在临时目录只写 `package.json`，没有安装候选包就调用 `pnpm exec niceeval`，并把 `list` 错当成 Experiment 列表；
- Report test 根据 locator 自己拼 target 路径，或使用现行页面不存在的 `aria-label` / `role="tooltip"`；
- Runner test 直接改共享 `niceeval.config.ts`，再依赖 `finally` 写回；
- Lifecycle test 只确认父 PID 消失，却把 Claim 写成“无 orphan”，而且发 SIGINT 时资源可能尚未启动；
- 多条 case 只因“风险相似”就挂历史 commit，没有证明对应 fix parent 会被该断言杀死。
- 验证脚本把 `tsc` 管给 `head` 后读取 `$?`，真实类型错误被管道末端的 `0` 掩盖；调试时启动的 view / mock server 也可能没有收尾。

这些不是 TypeScript 写法瑕疵，而是 proof boundary 错了：目录看似像 E2E，实际没有独立 package / install / state；断言看似精确，
实际观察的是测试自己合成的身份；注释看似有历史依据，实际没有因果证据。

**新防线**：

- `adapter/` 固定为 collection，每个公开 adapter、local protocol fixture 各自一个叶子 Repo；
- 叶子 Repo 自己就是候选包 consumer。二级 consumer 也必须重复注入、安装和 executable 身份核验；
- HTML target 只沿用户实际拿到的 `href` 走；可访问 selector 必须先是产品契约，缺失就登记产品 gap；
- mutation 只在私有副本，lifecycle 观察带 run ID 的 owned resource 并由下一消费者闭环；
- 验证收据保留 producer 的 exit / signal，所有临时服务与进程都进入同一 collect / cleanup 生命周期；
- 只有实际历史 kill 才写 `regression: memory/<条目>.md`；同形但未验证的补充测试只写 Feature，相关 memory 只作解释，
  不能借 commit 或 issue 增加可信度。

**验收**：先审 Repo 是否能独立安装和单跑，再审测试数量。把任一 live adapter Repo 删除时，本地 fixture 不能继续声称该 adapter
兼容。让父进程退出但留下 backend / container 时 Lifecycle 必须红。去掉产品可访问身份时，browser 样例不能靠自造 selector 继续绿。

## 防反复跟改的 Review 规则

测试 diff 出现时先归类：

| 原因 | 处理 |
|---|---|
| 用户结果 / 公开契约改变 | 修改对应 owner，并链接契约 diff |
| 历史 bug 暴露旧 owner 无区分力 | 扩大 owner，做旧实现 kill，删除重复测试 |
| 内部 DTO、函数、DOM class、目录移动 | E2E 不应改；修 fixture / 复用设施边界 |
| 候选常量变化 | 不自动同步 expected；先判断公开契约是否改变 |
| 共享测试顺序变化 | 隔离状态，不加“必须最后”注释 |
| CI 与本地表现不同 | 修统一 runner / executor，不在 workflow 复制分支 |

PR 对测试的说明至少包含：用户结果或具名确定性风险、owner、历史 bug（若有）、本地单项命令、CI lane，以及删除了哪些旧证明。

## 持续复核

1. 每次测试体系迁移前后和至少每半年运行一次 churn 命令；
2. 对排行头部逐 commit 核对是否真有契约变化，不看绝对数字直接定罪；
3. 抽查一个内部无关字段变化，确认没有批量触碰 E2E；
4. 新历史回归在 fix parent / 临时 worktree / 最小逆补丁上做 kill；
5. 随机打乱只读测试顺序，确认没有共享 mutation；
6. 检查 pseudo-E2E、candidate-derived expected、固定 sleep 和完整 DTO fixture 是否重新出现；
7. 把复核发现写进 testing memory，并据此删除或迁移 owner。

Churn 是滞后诊断，不进 CI；历史 kill、候选 identity、单文件重跑和结果断言才是每批迁移的准入证据。
