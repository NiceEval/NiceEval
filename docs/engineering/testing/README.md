# 测试体系总览

这篇定义 niceeval 仓库的测试体系：有哪几层、每层的运行契约是什么、改动落在哪里时跑什么，以及"测试老在改"这件事怎样被当成缺陷治理。方法论与用例正文在两个子主题里：

- [单元测试](../unit-tests/README.md)：fixture 驱动的确定性测试，证明契约中的语义、不变量和失败反馈。
- [E2E CI](../e2e-ci/README.md)：真实模型、真实协议、真实沙箱的全链路验收，以独立测试仓库为边界。

## 两层，没有中间层

体系只有这两层。判据是**证明对象**，不是快慢：

| 层 | 证明对象 | 运行时依赖 |
|---|---|---|
| 单元测试（`pnpm test`） | niceeval 自己的语义：评分判定、调度、归一、选择、聚合、反馈 | 无网络、无容器、无 API key |
| E2E（`pnpm e2e`） | niceeval 与真实世界协作正确：真实 SDK 协议、真实模型、真实沙箱、真实安装与进程 | 真实 provider 凭据 |

**真实优先**：凡是要证明"与外部世界协作正确"的测试，直接用真的。E2E 没有离线档、没有 mock 模式、没有为省 API 调用而存在的替身分支；模型调用成本不构成测试设计约束。理由：mock 一个协议等于自己再实现一遍协议，维护成本和失真风险都高于真实调用的费用，而协议失真恰好会掩盖 adapter 最该发现的错误。

单元测试层使用 fixture 与 fake，理由不是省钱，而是**确定性与区分力**——受控时钟、受控 barrier 和有区分力的证据图才能证明调度与判定语义；这些性质真实模型给不了。两层各用各的手段，不存在"用便宜 mock 凑合一下集成"的中间形态。

## 变更预算：无关测试变红是缺陷

测试体系的质量指标是**一次改动允许触碰的测试范围**：

- 一次改动允许变化的测试 = 该次**契约 diff 的影响面**。契约变了，引用该契约的测试、对应 Feature 的用例清单随之重写，这是合法变更，和改文档同一批完成。
- 实现重构不改契约时，任何测试都不应变红。变红说明该测试锁定了实现细节而不是契约——按缺陷处理：改写测试，并把绑定实现的原因记入 `memory/`。
- 新功能只新增自己契约影响面内的测试，不顺手改无关断言；review 时对照对应 Feature 的用例清单（各 Feature 测试目录下的 `cases.md`）核对影响面。

每个 Feature 的 `cases.md` 就是这个影响面的登记表：一条契约对应哪些场景，改这条契约时哪些用例要动，一目了然。

## 运行契约

"好跑"是验收标准，不是愿望：

- `pnpm test` 全量在开发机 60 秒内完成，单个测试文件 5 秒内。不出网、不起容器、不需要任何环境变量或 key；允许使用每例独立的临时目录。超预算的测试要么改设计（通常是 fixture 层级选高了），要么它证明的其实是真实协作——挪去 E2E。
- `pnpm test <路径或名称过滤>` 可以只跑一个 Feature 切片；写测试的人应当能在秒级回路里迭代。
- `pnpm e2e --repo <id>` 是 E2E 的本机回路：注入真实 key 后单仓库直接跑，行为与 CI、crabbox 完全一致。E2E 的耗时预算由每个测试仓库的 `e2e.json` 自己声明。

## 操作卡：改了什么，跑什么

| 改动落点 | 必跑 | 追加验收 |
|---|---|---|
| `src/scoring/`、`src/expect/` | `pnpm test` | 判定语义变化时跑任一 SDK E2E 仓库确认真实证据下判定一致 |
| `src/runner/`、`src/context/` | `pnpm test` | 调度/缓存行为变化 → `pnpm e2e --repo cache-contract` |
| `src/agents/`、`src/o11y/`（adapter 与归一） | `pnpm test` | `pnpm e2e --repo <对应 SDK 仓库>` |
| `src/sandbox/` | `pnpm test` | `pnpm e2e --group sandbox` |
| `src/report/`、show/view | `pnpm test` | — |
| Results 落盘格式或读取面 | `pnpm test` | `pnpm e2e --repo results-contract` |
| CLI flag、发现、退出码 | `pnpm test` + `pnpm run niceeval -- <命令>` 冒烟 | 任一 SDK E2E 仓库走完整验收 |
| niceeval 公开 API 破坏性变更 | `pnpm test` | 按 [E2E 矩阵修复顺序](../e2e-ci/README.md)逐组修复全部测试仓库 |

`pnpm test` 永远是第一道；E2E 按影响面选仓库，不需要每次全矩阵。

## 文档地图

```text
engineering/
├── testing/                 本篇:分层、变更预算、运行契约、操作卡
├── unit-tests/
│   ├── README.md            方法论:核心判据、从契约得到测试、分层、反模式
│   ├── harness.md           共享测试构造器的所有权与稳定性契约
│   └── <feature>/           每个 Feature 一个目录
│       ├── README.md        测试架构:观察面、边界选择、fixture 设计
│       └── cases.md         用例清单与示例代码:契约 → 场景矩阵
└── e2e-ci/
    └── README.md            独立测试仓库、统一执行协议、CI/crabbox、矩阵修复
```
