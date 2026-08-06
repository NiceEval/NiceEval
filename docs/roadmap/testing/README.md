# NiceEval 测试体系重构

本目录描述尚未落地的目标测试体系，遵守 [Roadmap 约定](../README.md)。
候选比较与取舍在 [Design](../../design/user-readable-testing/README.md)，这里仅保留已经选定的
“真实场景 Repo + 原生结果断言”方案；落地前不改变现行
[`docs/engineering/testing/`](../../engineering/testing/README.md) 契约。

## 目标

新体系同时优化四件事：

- **测结果**：从公开 Library、安装后的 CLI、HTTP、浏览器或真实 adapter 协议进入，断言用户拿到的结果；
- **能定位**：短测试只跨一条公开边界，Journey 在每个跨域接缝检查，失败报告标出阶段和原始收据；
- **易阅读**：命令、动作、独立预期和历史 bug 引用留在同一个原生测试文件；
- **少跟改**：内部 DTO、DOM class 或候选算法变化不能迫使无关结果测试同步改写。

真实场景 Repo 是表现和运行手段，不是新的测试语义。它就是一个普通用户项目，含自己的
`package.json`、lockfile、NiceEval 依赖、config、Eval、Experiment、Report、服务和测试。
测试仍然要明确执行 `pnpm exec niceeval exp/show/view` 并断言过程与结果，不能用“这个 repo 跑过了”代替测试命题。

## 两条分类轴

第一条轴回答“为什么存在”：

| 形态 | 证明什么 | 典型位置 |
|---|---|---|
| Mechanism | 纯计算、schema、错误分类、可控竞态和唯一错误算法 | 根仓库 unit |
| Result | 一组公开动作产生一个稳定用户结果 | 真实场景 Repo 的短 Vitest |
| Journey | 多个产品域串成一个用户目标，逐接缝检查并断言终态 | 独立 Journey Repo |

第二条轴回答“哪个产品域负责”：CLI、Report、Package、Runner、Adapter、Sandbox / Lifecycle。
目录按产品域找 owner，测试标题按结果找命题；unit / E2E 只是执行边界，不再充当需求分类。

## 分层裁决

| 风险 | 最早且完整的证明边界 | 示例 |
|---|---|---|
| 公式、选择、聚合、schema | Unit | Report 聚合口径、fingerprint 输入矩阵 |
| lock、retry、clock、并发闸 | barrier / fake clock Unit | backoff 期间不释放并发槽 |
| 安装、exports、外部 cwd、CJS / ESM | Package 场景 Repo | `init → list` 在 CommonJS 项目可用 |
| argv、pipe、PTY、exit、机器输出 | CLI 场景 Repo | `show --json` 经 pipe 不截断 |
| show / view、导出、HTTP、浏览器动作 | Report 场景 Repo | 导出 target 可达且打开正确实体 |
| SDK / CLI / provider 兼容性 | 对应 Adapter 场景 Repo | 真实工具事件读回规范身份 |
| 跨域完整目标 | Journey 场景 Repo | 初始化、运行、定位失败、导出报告 |
| signal、teardown、orphan | Lifecycle 场景 Repo | 中断后无孤儿且下一次运行可用 |

一条风险只在一个位置展开完整矩阵。其它层只有在能排除不同错误实现时才留一个接线代表，不能把同一场景换成
human、JSON、DOM 和 snapshot 各测一遍。

## 测试正文约束

- 短 Result 的一个 `test()` 只承诺一个用户可观察结果；Journey 的一个 `test()` 只承诺一个完整用户目标。
- 完整 argv 留在调用点；允许 `runProcess()` 隐藏 spawn 细节，不允许 `runScenario("report")` 隐藏用户动作。
- 预期来自公开契约、签入 fixture 或测试中字面量，不能从候选包枚举、解析后再生成自己的 expected。
- 结构化输出先 parse，再按稳定身份比较；只有短且逐字承诺的反馈使用 golden。
- 浏览器断言 URL、HTTP、可访问身份和可见结果，不断言隐藏 class、偶然 DOM 层级或固定 sleep。
- 历史回归写 `regression: <fix commit / memory>`，但标题仍描述长期结果；新 case 必须能杀死旧实现。
- helper 只拥有临时目录、进程、server、parser、浏览器、artifact 和 cleanup 等机械能力。

## 失败怎样定位

E2E 不承诺指出生产源码行，但要把问题收窄到最近的公开接缝：

1. `prepare`：项目、依赖、fixture、Docker service 或 secret 未就绪；
2. `invoke`：安装后的命令、HTTP 请求或浏览器动作没执行成功；
3. `observe`：stdout、JSON、HTML、协议事件或 artifact 不可读；
4. `outcome`：观察合法，但用户结果错误；
5. `cleanup`：进程、容器、sandbox 或临时目录未释放。

Result 测试用于指出坏在哪条公开边界，Journey 用最近检查点指出坏在哪个域间接缝；需要源码级区分力时，再配一条
最小 Mechanism unit。禁止为了定位在产品里加入测试专用探针。

## 本地与 GitHub CI

本地与 CI 共用根入口和同一个候选 tarball 注入链：

```sh
pnpm e2e --lane pr
pnpm e2e --repo report
pnpm e2e --repo report -- --run test/exported-targets.test.ts
pnpm e2e --lane main --repo codex-sdk
```

- PR lane 无密钥，运行 unit、CLI、Report、Package 与确定性 host / Docker Repo；
- main 跑 PR 全集和便宜的真实 adapter smoke；nightly 跑完整 adapter、sandbox 与 lifecycle；
- release 先生成最终 tarball，验收通过后发布同一字节与 digest；
- workflow 只负责 checkout、运行时、矩阵、cache 和 artifact，选择、注入、executor、重试和失败分类都在根 runner；
- 不使用 `pull_request_target` 执行 PR 代码并读取 secret。

完整执行契约见 [本地与 CI](e2e/execution.md)。

## 入口

- [Architecture](architecture.md) —— 数据流、分类、oracle、失败与 helper 边界；
- [测试组合与退役](portfolio.md) —— owner、矩阵去重、历史 bug 与迁移规则；
- [Unit](unit/README.md) —— Mechanism 测试的存在资格和写法；
- [E2E](e2e/README.md) —— Result、Journey、Adapter 与 Lifecycle；
- [真实场景 Repo](e2e/scenario-repos.md) —— 项目形状、候选注入、隔离和 adapter backend；
- [本地与 CI](e2e/execution.md) —— host / Docker、lane、Actions、release 与 artifact；
- [新体系如何避免旧问题](history-problems.md) —— Git 历史证据、对应防线与复核方法；
- [可读代码 Example](example/README.md) —— CLI、Report、Adapter、Journey 与 Unit 的目标测试正文；
- [历史缺陷题库](reference/bugs/README.md) —— 已逃逸 bug 的研究材料。

## 采用顺序

1. 先实现候选 tarball、场景 Repo 隔离、原始进程收据和单文件重跑；
2. 迁移三条已知 escape：JSON pipe、CommonJS package、adapter 工具身份；
3. 拆分 Report 线性脚本为只读 Result 文件，并把会修改证据的流程放进独立 Repo；
4. 加第一条跨 CLI / Report Journey；
5. 接入 PR、main、nightly、release lane；
6. 每批证明新测试能杀死旧 bug 后，删除被替代旧测试，不长期保留双份体系。

稳定后把本目录契约整体迁入 `docs/engineering/testing/`，Design 候选和历史研究继续留在原处。
