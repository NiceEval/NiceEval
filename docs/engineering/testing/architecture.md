# 测试体系 Architecture

本篇定义测试从用户目标到 owner 的依赖方向。测试框架使用原生 Vitest / Playwright；通用层只负责编排和机械收据，
不再引入 Behavior、Recipe、World、Observed 或 Registry 作为作者必经模型。

## 依赖方向

```text
稳定用户目标 / 原子公开结果
              │
              ▼
       从产品契约列出结果
              │
       ┌──────┴──────┐
       ▼             ▼
 Journey E2E    单边界 E2E
 跨公开接缝       一个公开结果
       └──────┬──────┘
              ▼
  E2E 能否稳定制造并区分风险？
       ┌──────┴──────┐
      能             不能
       │              ▼
       │        最小 Unit 例外
       │              │
       └──────┬───────┘
              ▼
     原生断言 + 原始失败收据
```

所有自动化形态都无法同时满足稳定与可靠要求时，不再向下发明测试形态。
该变更使用 AI 真实验收，并在 PR Test impact 中声明未守护风险。

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

## 三层观察白名单

测试证据分成三层，不能把“为了诊断而收集”误当成“可以据此判对错”：

| 层 | 可以读取 | 可以影响 verdict |
|---|---|---|
| Harness attestation | NiceEval candidate digest、包实际加载路径、lock identity、Testkit 副本内 directory dependency identity / installed realpath | 是；只判断被测身份与设施可信度 |
| Outcome oracle | 公开 CLI、JSON / NDJSON / JUnit、package exports、Record API、HTTP、真实 href、已声明的可访问身份与视觉结果 | 是；判断用户结果 |
| Diagnostic only | 私有存储、完整日志、trace 与内部 artifact | 否；只进入失败附件 |

Outcome 测试不得 import 根 `src/`、候选内部子路径或生产类型，不得读取私有 `.niceeval` 路径、内部 DTO、函数与调用顺序。
浏览器断言不得依赖内部 hydration 全局量、template ID、DOM class、布局实现属性，或自行拼接 attempt 文件路径。
私有 artifact 删除、改名或改变布局时，测试 verdict 必须不变。

E2E 有两组隔离 Repo。`cli`、`runner`、`record`、`report`、`package` 与 `lifecycle` 是功能场景，使用确定性本地 fixture 验收
NiceEval 自己拥有的行为；`adapter/<id>` 是兼容性场景，使用对应真实 SDK / CLI 或协议故障端。两组只共用机械 Testkit，
不共用依赖图、fixture、secret、`.niceeval` Record root 或领域 expected。

## 从用户目标选择测试形态

按下列顺序选择 owner：

1. 只从产品契约列出用户目标与公开结果，不把现有测试当成需求清单。
2. 一个用户目标跨多个公开域时，写 Journey E2E，并在终态所需接缝立即检查。
3. 一个原子结果只跨一条真实边界时，写单边界 E2E。
4. E2E 无法直接、稳定地制造输入并观察同一错误结果时，登记并写最小 Unit 例外。
5. 形态确定后才检查现有 owner；命题相同就复用，不并排增加测试。
6. 上述自动化都无法满足稳定与可靠要求时，不写自动化测试，改做本次 AI 真实验收。

纯输入输出不是 Unit 的自动准入理由。公共 Library 与 Record 格式从安装后 package export 进入单边界 E2E。
聚合、归一与 schema 先由用户结果 owner 证明，Unit 只保留 E2E 无法表达的最小算法矩阵。
Unit 之间是否重复与存在资格无关；每条 Unit 的反方都是 E2E 能否直接证明同一结果。

Journey 可以有多个检查点，但检查点只能证明终态所需身份、接线或前置事实。
一个命题拥有独立输入、独立 expected、独立修复动作，或能与终态独立失败时，必须拆成另一 Journey 或单边界 E2E。

## Prepare、Invoke、Observe、Outcome、Cleanup

每条测试正文都应能被读成五个阶段，但无需为阶段建立 DSL：

```ts
test("导出报告能打开带 failed Verdict 的 Attempt", async () => {
  const run = await runProcess(/* invoke: pnpm exec niceeval exp … */);
  expect(run.exitCode, run.diagnostic()).toBe(1); // outcome

  const report = parseJson(await showRun(runId)); // observe
  const attemptRoute = onlyFailedAttemptRoute(report);

  const exported = await runProcess(/* invoke: pnpm exec niceeval view --run <runId> --out … */);
  expect(exported.exitCode, exported.diagnostic()).toBe(0); // outcome

  await expectAttemptPageToOpen(attemptRoute); // observe + outcome
});
```

场景 Repo 的复制、依赖安装和服务启动属于 `prepare`，由 runner 和项目 fixture 明确报告。
`cleanup` 无条件执行，失败附加到更早的错误，不能遮蔽原始 outcome。

## 单文件可读性契约

E2E 文件从上到下保持同一信息顺序：

| 位置 | 保留的信息 | 不放入这里的内容 |
|---|---|---|
| 文件头 | 第一行的唯一 `owner:`、Repo ID、NiceEval 根目录重跑命令、隔离 Repo 内命令 | 依赖安装教程 |
| 局部类型 | 本测试实际读取的公开字段 | 完整生产 DTO、候选导出的 schema 常量 |
| 局部函数 | process、parse、唯一项查找、资源关闭等机械操作 | scenario 名到用户动作的映射、领域 expected |
| 测试标题与注释 | 长期用户结果；唯一 `owner:` 链接契约归属，历史 kill 用 `regression:` 指向 memory | 临时实现函数名、当前 DOM 结构 |
| 测试正文 | 完整 argv 或紧邻的具名 argv、公开观察、字面 expected、最近接缝断言 | 从 actual 反推 expected、无解释的整页 snapshot |

读者只打开这个文件，就应能回答“在哪个 Repo 跑、用户执行什么、预期是什么、最早会在哪一步失败”。
为满足这一点保留两三次相似 argv 是合理成本；只有两个 Repo 已出现相同且稳定的机械协议时才上移复用实现。
抽取后测试标题、argv、sentinel、verdict 和历史回归理由仍留在 owner 文件。

每个测试文件第一行用 `// owner: <docs path#anchor>` 指向一个稳定结果或具名风险。
文件内可以用 `test.each` 展开同一等价类，不能加入第二个独立结果。
`regression:` / `bug:` 紧贴真正能杀死旧实现的 case，不能把整文件的其它测试也伪装成回归。
统一的 owner 与历史 Bug 关系见[功能归属与 Bug 回归](portfolio.md#功能归属与-bug-回归)。

## Oracle 独立性

预期必须独立于候选实现：

- 固定 ID、sentinel、page 类别、verdict 和工具规范名来自测试字面量或签入 fixture；
- 动态 Attempt route 可以从公开 `show --run <runId> --json` 的已计划页面索引取得，再用于同一 Run Sample 的下一条公开命令；
- 不调用候选的 `enumerate()` 生成“应该存在的全集”，再验证候选自己的输出；
- 不从候选导出的 schema 常量给手写 fixture 自动升版；公开格式升级要显式修改 fixture；
- 不把产品 parser 复制到通用命令执行器；必须解码复杂公开格式时，parser 留在对应 Repo 并有 malformed case。

允许从运行 A 取得事实，再与运行 B 的独立出口比较；不允许让被测出口同时产生 actual 和 expected。

动态 route 先由公开出口 A 返回；测试必须先用签入 sentinel、Eval ID 或 verdict 验证 A，再把完整 route 作为用户输入交给
同一 Run Sample 的公开出口 B。两个可能共同出错的候选出口互相比对，不构成独立 oracle。确定性 Agent / backend 使用签入协议 fixture 和独立
请求 ledger，不调用候选内部函数计算答案。

## 复用设施预算

跨 Repo 的稳定机械能力由内部 [官方 Testkit](testkit.md) 承载。它是根 workspace 成员，但场景 Repo 只在隔离副本中
消费本次 runner 生成的 invocation-local 不可发布 directory snapshot；不通过 workspace link 或源 checkout 路径运行。能力是否上移按机械契约的消费者判断，不能因为
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
项目复制已经被多类会写结果、配置或导出目录的 case 消费，因此 Testkit 接收显式策略 API；调用点仍明确写出复制源、
排除项和链接策略，不能把 CLI、Runner、Report、Package、Lifecycle 或 Adapter 的领域动作收进 Testkit。

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
- 一个单边界 E2E Repo 可以在 `beforeAll` 生成一次共享证据，随后只读测试并行消费。
- 会写入 Record 的验证必须获得自己的独立 Record root 或独立 Repo，并固定所读 Sample selection，不能靠文件调用顺序保护共享状态。
- 会改配置或 fixture 的 mutation 必须发生在该测试的私有副本，并以新进程消费；禁止修改共享
  `niceeval.config.ts` 后在 `finally` 写回，因为崩溃、并行与 watcher 都会泄漏中间状态。
- Journey E2E 自己拥有一份可变项目，并按命令顺序立即检查；其它测试不读取它的中间状态。
- 场景 Repo 不跨提交复用 `.niceeval`、`node_modules` 或导出站，只缓存包管理器 store 和 Docker layer。

Lifecycle 的 cleanup oracle 必须观察被管理资源本身：带 run ID 的 container / network / volume、backend active-session、
sandbox lease 或同等公开收据。只有父进程 PID 消失不能证明没有子进程或远端 orphan；发 signal 前也必须先等资源进入
可观察的 ready 状态，最后再让一个独立消费者证明资源可重新取得。

## 可靠性接管门

新增、接管或实质修改确定性 owner 时，执行[可靠性：重复运行](README.md#可靠性重复运行)规定的固定组合。
三个彼此隔离的副本检查随机漂移；同一副本连续两次检查残留；Repo 默认并行检查顺序依赖；单项重跑检查独立身份。
这几类运行缺一不可，不能用测试级 retry 把一次意外失败改写成通过。

真实 provider live owner 随常规全量 E2E 频繁运行；provider 随机性不能充当确定性产品可靠性证明，
因此 live Repo 不用重复 takeover 证明确定性。

可靠性接管门只比较稳定语义。动态 ID、临时端口和 duration 可以变化；Verdict、实体关系、公开错误分类和资源终态必须相同。
无法通过接管门的自动化不得降级断言、增加固定 sleep 或改成 mock 核心算法，应按[不自动化](README.md#不自动化)处理。

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
