# Example：新测试实际会长什么样

本目录是一份真实落盘的目标代码树，不是把代码都写进 Markdown 的伪目录。TypeScript API 是示例作者面，具体
实现可以调整命名；文件责任、依赖方向和 proof 粒度属于目标契约。

```text
example/
├── e2e/report/
│   ├── behaviors/report-target-closure.ts
│   ├── execution/report-targets.ts
│   ├── fixtures/report-targets/
│   │   ├── evals/failed.eval.ts
│   │   ├── experiments/report-targets.ts
│   │   └── reports/targets.tsx
│   ├── recipes/report-targets.ts
│   ├── scripts/e2e.ts
│   ├── support/{browser,contracts,observed}.ts
│   └── test/behavior/deliver-report/report-target-closure.test.ts
├── src/view/report-target-census.test.ts
└── test/portfolio/
    ├── mechanisms/report-target-census.ts
    ├── registry.test.ts
    └── retirements/report-target-closure.ts
```

阅读顺序是 Behavior → Recipe → 测试正文 → execution → runner。Behavior 只声明用户结果；Recipe 只准备带 digest
的只读 World；正文只从公开领域读面观察；execution 决定频率；runner 只装配 prepare / verify。结构 census 是
E2E 无法低成本穷举的唯一机制矩阵，因此留一个 Unit owner。

Retirement 文件只列本批确实删除的两个旧 proof。它不要求把仓库里每个历史测试映射到新 ID；找不到稳定用户
结果、独有错误算法或临时迁移缺口的旧测试可直接删除。

对应设计见 [Report target 闭环](../e2e/use-case/report-target-closure.md)、[Architecture](../architecture.md)与
[Proof Portfolio](../portfolio.md)。
