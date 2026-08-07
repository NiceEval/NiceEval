# 决策

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [EVIDENCE](EVIDENCE.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md)

## 结论

采纳 [PLAN-4](PLAN-4/README.md)：真实场景 Repo 与原生结果断言。

目标体系保留 unit 与 E2E 两种证明边界，但不再建立 Behavior / Proof / Recipe / World / Observed 的全仓运行模型。

- Unit 用最小 fixture 证明纯逻辑、错误分类、schema 与可控竞态。
- 每个场景 Repo 都是自包含 NiceEval 用户项目，拥有真实 config、Eval、Experiment、Report 与必要服务。
- 场景 Repo 安装候选 tarball，只从公开入口进入，以原生 Vitest 写单边界 E2E 或 Journey E2E。
- 跨 Repo 的机械能力由精确锁定、独立于产品 artifact 的 Testkit 提供；产品 gate 只替换 NiceEval candidate。
- Repo 是执行现场，不是测试语义；测试命题仍按用户结果、历史 bug 与产品域组织。
- Repo manifest 只拥有 lane、executor、能力、命令与 artifact。
- 历史 bug 在对应长期 E2E 中留下 `regression` 引用，并用旧 commit 或逆补丁做 kill 验证。
- 本地与 GitHub Actions 调用同一个根 runner；PR 无密钥，真实 adapter 在可信 lane 执行。

## 对照

| 判据 | PLAN-1 | PLAN-2 | PLAN-3 | PLAN-4 |
|---|---|---|---|---|
| G1：一屏读懂任务 | 中 | 需要跨声明与 typed view | Case 紧凑、driver 分散 | 高；命令、动作、预期同文件 |
| G2：标题与断言一致 | review + matcher | Registry + matcher | claim 可守护 | review + 原生断言 |
| G3：Unit 精确 | 高 | 高 | 高 | 高 |
| G4：产品契约单源 | 可满足 | 可满足 | 影子模型风险最高 | 高；测试只留链接 / bug 引用 |
| G5：oracle 独立 | 取决于 matcher | typed view 容易藏计算 | driver 容易复制算法 | 高；预期在正文可审查 |
| G6：变化预算 | 中 | 元模型也会跟改 | 联合变化面最大 | 高；按消费边界隔离 |
| G7：定位与单项重跑 | 中 | 元数据最全、跳转最多 | 信息全、调试链最长 | 高；原生文件 / 标题 + 阶段 artifact |
| G8：真实边界 | 保留 | 保留 | 保留 | 保留，且场景 Repo 本身就是用户现场 |
| G9：增量采用 | 高 | 中 | 低 | 最高 |
| G10：本地 / CI 同构 | 未解决 | 需先建 World runtime | 需先建 Projection runtime | 直接由根 runner 与 executor 完成 |

PLAN-4 牺牲机器生成的全仓 Behavior 图，换取更低的误抽象风险和更直接的维护路径。
当前历史证据主要显示“真实边界没跑到、测试从错误层观察、旧脚本难单项运行”，没有证明需要建设第二套产品对象模型。

## 为什么否决 PLAN-2 作为终态

PLAN-2 试图一次解决覆盖登记、证据缓存、失败来源、并发、执行频率与测试作者体验。
它的 `report-target-closure` 示例因此被拆成 Behavior、Recipe、World、execution、browser wrapper、Observed matcher、mechanism owner、Registry 和 retirement 文件。

这带来三个直接问题：

1. 结果断言只占很小一部分，读者要先理解平台对象才能判断测试是否正确；
2. `world.siteExport().targetClosure()` 一类 helper 可能从候选产物计算成功条件，oracle 独立性不再一眼可审；
3. 示例没有场景 Repo 自己的 package、lockfile、manifest 与 CI lane，反而没有展示声称的真实 repo 边界。

Behavior ID 与 evidence provenance 本身有价值，但不值得成为每条高价值测试的必经层。
失败 artifact 已能记录候选 digest、命令、路径和阶段；长期覆盖关系由领域目录、Feature 测试说明与历史 bug 表审查。

## 为什么不选其它候选

### PLAN-1

PLAN-1 迁移容易，但 Behavior Registry 和媒介 matcher 仍会把测试语义拆到声明与 helper。
适合保留的成果只有：结构化输出先 parse、浏览器使用可访问身份、PTY 显式建模、短文本才用 golden。
这些规则直接进入 PLAN-4 的原生测试，不需要 Behavior wrapper。

### PLAN-3

PLAN-3 为 World、Action 与 Claim 建立领域判别联合，再由 Projection 执行。
它最容易生成覆盖图，也最容易成为 NiceEval 的影子实现。
现有重复尚未证明维护 driver 与 Projection 的成本合理。

## 测试分层裁决

| 证明对象 | 所有者 |
|---|---|
| 纯计算、选择、聚合、schema、错误分类 | Unit |
| 并发、retry、lock、clock | 使用 barrier / fake clock 的 Unit |
| 候选 package exports、外部 cwd、CJS / ESM | Package 场景 Repo |
| CLI 进程、pipe、PTY、exit、机器出口 | CLI 场景 Repo |
| show / view、HTML、HTTP、浏览器语义与交互 | Report 场景 Repo |
| 官方 adapter 的 SDK / CLI / provider 兼容性 | 每个 Adapter 的 live 场景 Repo |
| 跨 CLI / Report 的完整用户目标 | Journey E2E 场景 Repo |
| signal、teardown、orphan、下一次消费者 | Lifecycle 场景 Repo |

本地协议 server 或 Docker fixture 可以证明 NiceEval 自有的 transport 与错误处理，但不能替代 live adapter 兼容性。

## 本地与 CI 裁决

- 根 runner 构建一次候选 tarball 并注入隔离场景 Repo。
- Host 与 Docker 是 executor；本地进程、Compose、真实 SDK 和 remote provider 是被测 backend，两者分开声明。
- 默认本地与 PR 都运行无密钥 `pr` lane。
- `push main` 跑便宜 live smoke；nightly 跑完整 adapter / lifecycle；release 在发布前跑 blocking 矩阵。
- PR 不运行带 secrets 的任意代码，也不使用 `pull_request_target` 绕过。
- release 验收与发布同一 tarball，digest 贯穿安装、摘要和 artifact。
- 只有结构化确认的 infrastructure 失败可在新副本重试一次；断言和 cleanup 失败不重试。

## 采用落点

定稿目标写回 [`docs/roadmap/testing/`](../../roadmap/testing/README.md)：

- 总纲与领域 / 边界矩阵；
- Unit 存在资格；
- 真实场景 Repo 与 Journey 契约；
- 本地、Docker 与 GitHub Actions 的统一执行链；
- 历史 bug escape audit；
- CLI、Report、Package 与 Adapter 的可读代码示例。
- 独立 Testkit 的 stable-outer 信任链、最小 API 与迁移门槛。

PLAN-2 专用的 World、DSL、Portfolio Registry 与 execution registration 不进入 Roadmap。

## 复审触发条件

只有同时出现以下证据，才重新引入更强声明层：

- 至少两个独立场景 Repo 重复同一稳定领域 parser；
- 重复已经造成真实漏测或错误诊断；
- 提取后测试正文更短，独立预期仍留在调用点；
- 新层在历史逆补丁上比原生测试更有区分力；
- 本地单项重跑不需要理解额外 registry / world 生命周期。

满足条件时先提取纯机械 parser，不直接恢复全仓 Behavior 平台。
