# 测试体系 Architecture

本篇定义测试从风险到结果的依赖方向。测试框架使用原生 Vitest / Playwright；通用层只负责编排和机械收据，
不再引入 Behavior、Recipe、World、Observed 或 Registry 作为作者必经模型。

## 依赖方向

```text
公开契约 / 历史 bug / 具名确定性风险
                  │
                  ▼
       独立 fixture + 明确 expected
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
      Unit             E2E 场景 Repo
纯逻辑 / barrier      pnpm exec niceeval …
        │                   │
        └─────────┬─────────┘
                  ▼
       原生断言 + 原始失败收据
```

E2E 编排层包在 Repo 外侧：

```text
e2e.json → 选择 Repo → pack 候选 → 复制隔离 → 安装核验 → executor
                                                        │
                                                        ▼
                                      Vitest / Playwright / 用户命令
                                                        │
                                                        ▼
                                        artifact + 阶段摘要 + cleanup
```

编排层不读取 `.niceeval/`，不解码 NiceEval 产品输出，不计算 expected，也不决定测试是否正确。

E2E 有两组隔离 Repo。`cli`、`runner`、`report`、`package` 与 `lifecycle` 是功能场景，使用确定性本地 fixture 验收
NiceEval 自己拥有的行为；`adapter/<id>` 是兼容性场景，使用对应真实 SDK / CLI 或协议故障端。两组只共用机械 Testkit，
不共用依赖图、fixture、secret、结果根或领域 expected。

## 从风险选择测试形态

按下列顺序选择最早而完整的边界：

1. 能用纯输入输出排除错误算法：写 Unit；
2. 风险来自安装、进程、文件、HTTP、浏览器或协议边界：写单边界 E2E；
3. 风险只会在多个公开域串联时出现：写 Journey E2E，并在每个域间接缝检查；
4. 同一风险已经有完整 owner：扩大 owner 的等价类，不并排复制新测试。

“代码在 `src/report`”不自动意味着写 unit；“测试放在 `e2e/`”也不自动意味着它证明了用户结果。

## Prepare、Invoke、Observe、Outcome、Cleanup

每条测试正文都应能被读成五个阶段，但无需为阶段建立 DSL：

```ts
test("导出报告能打开失败 Attempt", async () => {
  const run = await runProcess(/* invoke: pnpm exec niceeval exp … */);
  expect(run.exitCode, run.diagnostic()).toBe(1); // outcome

  const history = parseJson(await showHistory()); // observe
  const locator = onlyFailedAttempt(history).locator;

  const exported = await runProcess(/* invoke: pnpm exec niceeval view --out … */);
  expect(exported.exitCode, exported.diagnostic()).toBe(0); // outcome

  await expectAttemptToOpen(locator); // observe + outcome
});
```

场景 Repo 的复制、依赖安装和服务启动属于 `prepare`，由 runner 和项目 fixture 明确报告。
`cleanup` 无条件执行，失败附加到更早的错误，不能遮蔽原始 outcome。

## 单文件可读性契约

E2E 文件从上到下保持同一信息顺序：

| 位置 | 保留的信息 | 不放入这里的内容 |
|---|---|---|
| 文件头 | Repo ID、NiceEval 根目录重跑命令、隔离 Repo 内命令 | 依赖安装教程 |
| 局部类型 | 本测试实际读取的公开字段 | 完整生产 DTO、候选导出的 schema 常量 |
| 局部函数 | process、parse、唯一项查找、资源关闭等机械操作 | scenario 名到用户动作的映射、领域 expected |
| 测试标题与注释 | 长期用户结果；`feature:` 写契约归属，历史 kill 用 `regression:` 指向 memory | 临时实现函数名、当前 DOM 结构 |
| 测试正文 | 完整 argv 或紧邻的具名 argv、公开观察、字面 expected、最近接缝断言 | 从 actual 反推 expected、无解释的整页 snapshot |

读者只打开这个文件，就应能回答“在哪个 Repo 跑、用户执行什么、预期是什么、最早会在哪一步失败”。
为满足这一点保留两三次相似 argv 是合理成本；只有两个 Repo 已出现相同且稳定的机械协议时才上移复用实现。
抽取后测试标题、argv、sentinel、verdict 和历史回归理由仍留在 owner 文件。

Feature 是每条测试的长期归属，Bug 不是第三种执行层。目录、文件名与标题按功能和可观察结果命名；
`regression:` 只是已证明能杀死旧实现时附加的历史凭据。Unit 的 `// cases:` / `// bug:` 与 E2E 的
`feature:` / `regression:` 怎样对应，统一见[功能归属与 Bug 回归](portfolio.md#功能归属与-bug-回归)。

## Oracle 独立性

预期必须独立于候选实现：

- 固定 ID、sentinel、page 类别、verdict 和工具规范名来自测试字面量或签入 fixture；
- 动态 locator 可以从公开 `show --history --json` 取得，再用于下一条公开命令；
- 不调用候选的 `enumerate()` 生成“应该存在的全集”，再验证候选自己的输出；
- 不从候选导出的 schema 常量给手写 fixture 自动升版；公开格式升级要显式修改 fixture；
- 不把产品 parser 复制到通用命令执行器；必须解码复杂公开格式时，parser 留在对应 Repo 并有 malformed case。

允许从运行 A 取得事实，再与运行 B 的独立出口比较；不允许让被测出口同时产生 actual 和 expected。

## 复用设施预算

跨 Repo 的稳定机械能力由独立的 [官方 Testkit](testkit.md) 承载。它按 stable-outer / candidate-inner 使用：
场景 Repo 精确锁定 Testkit，根 runner 只替换待测 NiceEval tarball。能力是否上移按机械契约的消费者判断，不能因为
功能与 Adapter 属于不同 Repo 集合，就复制两份 process 或严格 JSON 实现。

共享设施只允许拥有机械能力：

- 创建 / 删除临时目录和隔离副本；
- 无 shell 拼接地启动进程或 PTY，捕获 argv、cwd、exit、signal、stdout、stderr 和耗时；
- 启停 HTTP server、Docker service；浏览器场景默认由 Playwright Test fixture 启停 browser / context；
- 严格解码 JSON、NDJSON、XML，保存 trace、screenshot 与 service log；
- 等待端口、URL 或显式状态，并无条件 cleanup。

复用设施不得：

- 根据 scenario 名隐藏完整用户动作；
- 根据候选结果计算 target、verdict、identity 或期望集合；
- 重新实现 Sample、Report、scheduler、adapter 的正确算法；
- parse 失败后退回模糊 substring；
- 在断言阶段悄悄修改共享 evidence。

两个 Repo 出现同一稳定机械 parser 后才提取共享实现；领域预期仍留在测试文件。
项目复制已经由 Runner mutation 与 Report Journey 两个功能 Repo 消费，因此 Testkit 接收显式策略 API。

HTTP server lifecycle 暂时只有 Local protocol 一个消费者，只作为 0.x callback API 试用；path、status、body 和错误阶段仍在
Adapter 测试正文。浏览器和 stdin 不进入 Testkit；Playwright Test 继续拥有 browser / context / page。

专用 browser fixture 不是默认能力；只有大量场景共享远端 browser 的性能收益已经测量并且 Playwright Test fixture
无法表达时才引入，不能为了少写两行就由 Vitest 手动包装 `chromium.launch()`。

## 进程收据

所有公开命令返回同一最小收据：

```ts
interface ProcessResult {
  argv: readonly string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  diagnostic(): string;
}
```

断言失败至少显示完整 argv、cwd、退出状态和 stdout / stderr 尾部；完整版写 artifact。
命令使用 argv 数组，不靠 shell 字符串插值。

## 结构化输出与浏览器

- JSON / NDJSON / XML 必须严格 parse 后比较身份字段、集合和关系；格式错误属于 `observe`，不能变成“缺 substring”。
- 大输出同时断言字节规模、文档可解码和尾部 sentinel，避免只证明“有一些 JSON”。
- HTML 先从用户实际拿到的链接读取 `href`，验证该 URL 与 HTTP 后再验证目标实体；不能根据 locator 猜导出路径再证明自己猜的路径存在。
- Playwright 优先使用产品已声明的 role、label、可见文本和 web-first assertion。role / label 本身也必须由产品契约提供。
  缺少稳定可访问身份时，该 E2E 明确报告产品可测试性缺口，不能在测试里发明 `aria-label` 或 `role="tooltip"`。
- 固定 sleep、实现 CSS class、任意未展开节点探测循环和“有一个 dialog”都不是用户结果。
- screenshot 是诊断 artifact，不是默认 oracle；只有视觉契约才使用稳定的视觉 diff。

## 隔离与证据复用

- 每个 Repo 执行在新的副本中；重试也使用新副本。
- 一个单边界 E2E Repo 可以在 `beforeAll` 生成一次昂贵证据，随后只读测试并行消费。
- 会改变“当前结果”的验证必须获得自己的结果根或独立 Repo，不能靠文件调用顺序保护共享状态。
- 会改配置或 fixture 的 mutation 必须发生在该测试的私有副本，并以新进程消费；禁止修改共享
  `niceeval.config.ts` 后在 `finally` 写回，因为崩溃、并行与 watcher 都会泄漏中间状态。
- Journey E2E 自己拥有一份可变项目，并按命令顺序立即检查；其它测试不读取它的中间状态。
- 场景 Repo 不跨提交复用 `.niceeval`、`node_modules` 或导出站，只缓存包管理器 store 和 Docker layer。

Lifecycle 的 cleanup oracle 必须观察被管理资源本身：带 run ID 的 container / network / volume、backend active-session、
sandbox lease 或同等公开收据。只有父进程 PID 消失不能证明没有子进程或远端 orphan；发 signal 前也必须先等资源进入
可观察的 ready 状态，最后再让一个独立消费者证明资源可重新取得。

## 失败分类

| 分类 | 判据 | 重试 |
|---|---|---|
| Regression | 候选、断言、超时或 cleanup 违反 Repo 契约 | 不重试 |
| Infrastructure | 可结构化确认的 provider 429 / 5xx、网络、runner 或 Docker daemon 故障 | 新副本最多一次 |
| Configuration | 显式选择后缺 runtime、secret、镜像或 daemon | 不重试，启动前失败 |
| Not selected | lane / path 本来不选择该 Repo | 计划中可见，不伪装成 pass |

判不清按 Regression。超时不是自动基础设施错误；cleanup 失败也不能靠重试漂绿。

## 证明关系不是运行时平台

测试文件和标题是执行身份；[Portfolio](portfolio.md) 只维护人可审查的稳定结果、owner、lane 和历史 bug 链接。
它不生成测试代码，也不要求测试重复登记一份元数据。

根 runner 的机器 schema 仅包含 Repo 的运行条件，详见
[真实场景 Repo](e2e/scenario-repos.md)；本地 / CI 生命周期见 [Execution](e2e/execution.md)。
