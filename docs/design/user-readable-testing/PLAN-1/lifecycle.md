# 方案 1：Lifecycle

**相关文档**：[README](README.md) · [Architecture](architecture.md) · [Use Cases](use-case/README.md) · [CASES](../CASES.md)

## Owner

现有 unit / E2E 测试 owner 继续拥有 fixture、执行器、matcher 与收尾。
新增 Registry 只读取静态 Behavior / Proof 元数据，不接管测试运行。
各自治 E2E 仓库继续拥有自己的 `scripts/e2e.ts` 和 evidence。

## 声明与执行

```text
普通测试 + Behavior 元数据
  → 本仓 guard 校验 ID、契约、主证明与 boundary 引用
  → 根 guard 只读聚合
  → 原生 unit 或自治 E2E 入口执行测试
  → matcher 报告 Behavior、媒介、身份与 evidence
```

机制测试没有用户行为后果时不登记。
本方案不移动测试文件，因此按用户任务阅读仍依赖生成索引跳转。

## E2E Fresh / Reuse

```text
fresh
  → 仓库本地 prepare
  → 安装候选并生产一次 evidence
  → freeze
  → 各媒介 matcher 只读

reuse
  → 本仓入口核对 manifest identity
  → 选择 Behavior
  → 只读重跑 matcher
```

candidate、producer、外部依赖、运行条件或 prepare 配置不匹配时拒绝 reuse。
本方案只给新场景规定冻结规则；旧脚本的可变共享根按触达迁移，因此在迁移完成前仍可能依赖执行顺序。

## 次数

| 动作 | fresh | reuse | 每个测试 |
|---|---:|---:|---:|
| 生成静态 Registry | CI 1 | 0 | 0 |
| 安装候选与昂贵取证 | 每个 world 1 | 0 | 0 |
| media parse | 0 | 0 | 1 |
| matcher | 0 | 0 | 至少 1 |

## Cases

- C1 / C3 / C8：只增加身份与导航，不改变既有 fixture 生命周期。
- C2：同一 evidence 交给不同 matcher。
- C4：原生 Effect / Vitest 生命周期保持不变。
- C5–C7：沿用自治 E2E fresh / reuse；旧可变脚本是明确迁移债务。
