# Testkit 交付边界

本页比较“怎样交付共享测试设施”。测试分层、场景 Repo 与结果断言仍以
[DECISION](DECISION.md)和 [PLAN-4](PLAN-4/README.md) 为准。

## 已观察到的重复

`docs/roadmap/testing/example/repos/` 的迁移前草稿有 10 个独立场景 Repo，使用 Vitest 或 Playwright Test。
长功能名收束后，目标结构是 5 个功能 Repo 与 3 个 Adapter Repo。迁移前 19 个 `test/support` 文件共 842 行，
CommonJS test 另有约 27 行内联 spawn：

- `runProcess` 与 `parseJson` 各有 9 份实现；
- `parseNdjson` 有 6 份；
- `only` / `defined` 分散在 7 个 Repo；
- CLI、Report、Runner、Adapter、Lifecycle 与 Journey 都要保存进程收据；
- AI SDK 与 Lifecycle 都需要长驻进程、readiness 和失败时终止子进程。
- Runner mutation 与 Report Journey 都需要复制项目后在私有现场修改。

文件数只能证明存在重复，不能单独证明应该发布一个包。真正的抽取依据是：至少两个独立 Repo 使用同一机械契约，
并且抽取后 argv、领域预期与最早失败边界仍留在测试正文。

功能 Repo 与 Adapter Repo 是两套不同的消费项目。它们不能共享 agent、backend、secret、结果或领域动作函数；但进程收据、
严格 JSON / NDJSON 与资源关闭恰好是不含领域语义的共同机械边界，所以允许依赖同一份 Testkit。

## 候选

| 方案 | 优点 | 主要问题 | 裁决 |
|---|---|---|---|
| `niceeval/testing` 子路径 | 安装简单，天然与产品同版 | 外层裁判和被测候选来自同一 artifact；测试设施也成为产品公开 API | 不采用 |
| 独立 `@niceeval/testkit` | 可锁定稳定外层裁判；场景 Repo 仍按普通依赖安装 | 增加独立版本、pack、兼容与发布流程 | 长期方案 |
| 仓库内部相对 import | 不增加发布物 | 场景 Repo 会失去独立消费者身份，容易退化为 pseudo-E2E | 不采用 |
| 每个 Repo 保留本地 support | 信任边界最简单 | 已出现多份分叉实现，修诊断与 cleanup 要反复同步 | 迁移前对照 |

## 决策

先建立**官方内部 0.x Testkit**，源码与 `niceeval` 产品实现零依赖，并作为独立 tarball 安装，而不是相对 import。
它通过独立 meta-tests 后才能发布；发布后，场景 Repo 以精确版本与 lockfile 消费。

产品 E2E 使用 stable-outer / candidate-inner：

```text
精确锁定的 @niceeval/testkit 0.x ── 进程、解码与资源终结裁判
                                  │
                                  ▼
当前提交打出的 niceeval candidate ── 被测对象
```

普通产品 gate 只替换 `niceeval` candidate。根 runner 核对产品 digest、Testkit 版本和 Testkit lockfile integrity，
不得动态选择 `latest`。同一个 gate 不能同时升级产品行为与 Testkit 裁判。

Testkit 改动走独立顺序：

1. 固定 Vitest / Node 驱动 Testkit candidate；
2. 用不依赖 NiceEval 的固定子进程、HTTP 和目录 fixture 验证收据与资源终结；
3. 对 framing、timeout、process tree 和 cleanup 做逆补丁或 mutation kill；
4. 用 pinned known-good NiceEval 跑兼容 smoke；
5. 发布 Testkit 0.x；
6. 用单独依赖升级提交更新场景 Repo 的精确版本和 lockfile；
7. 通过后才删除真实 `e2e/` 中被替代的本地 support。

私有原型没有完成上述闭环前，不进入产品 release gate，也不提前删除旧裁判。
Roadmap Example 只用于评审目标 API，所以已经迁移全部调用点并删除 19 个 support；这不表示真实 `e2e/` 可以跳过上述顺序。

## v1 收缩

v1 接收已经有至少两个独立消费者的能力：

- 完整进程收据与严格的 JSON / NDJSON framing；
- caller-owned `startProcess()` 与默认安全入口 `withProcess()`；
- `only` / `defined`；
- 临时目录；
- 通用输出等待与轮询；
- 显式策略的项目副本；Runner mutation 与 Report Journey 是两个独立消费者。

HTTP fixture 只有 Local protocol 一个消费者，先保留为可撤回的 0.x callback API，并用固定非 NiceEval fixture 验证 listener
关闭。浏览器封装、stdin、NiceEval 输出 schema、locator 读取，以及 `exp()`、`show()`、`carry()`、`journey()` 等产品动作
不进入；它们没有两个相同消费者，或会把领域语义藏进共享层。

## 公开晋级门槛

0.x 只有同时满足下列条件，才从“官方内部 Testkit”晋级为稳定公开包：

1. 已用真实 packed tarball 验证 ESM / CJS exports 与 Node 支持下限；
2. Vitest、Playwright Test、run-only 与 long-lived process pilot 都已迁移；
3. 连续两个 NiceEval release 没有破坏性 Testkit API 变化；
4. 至少两个 NiceEval 仓库外的真实消费者使用同一原语；
5. 没有为了接入而增加大量 Repo adapter，也没有让 argv、diagnostic 或 expected 退化。

Roadmap Example 中约 869 行重复机械代码已被目标 API 替换，只说明调用点值得试点，不证明 API 已经稳定。
