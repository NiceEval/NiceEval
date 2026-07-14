# 测试体系定稿两层：unit 确定性 + E2E 全真实，否决离线集成层

**裁决**（2026-07-14，用户定案）：测试体系只有两层——单元测试（fixture 驱动、确定性、无网络无 key）与 E2E（真实模型、真实协议、真实沙箱）。中间不设任何离线集成档，模型调用成本不构成测试设计约束。定稿落在 `docs/engineering/testing/README.md`（总览）、`docs/engineering/unit-tests/`（方法论 + harness + 每 Feature 架构/用例两页）、`docs/engineering/e2e-ci/README.md`（真实层 + 仓库 Eval 预算 + 破坏性变更矩阵修复）。

**曾选方案**：review 阶段曾提议新增「离线 CLI 集成层」——scripted agent 穿真实 CLI 进程跑完整流程、断言退出码与 `--json` 输出，作为 unit 与 E2E 之间的无 key 回归层；并建议 E2E 矩阵首批从 9 仓库收缩到 3-4 个。

**否决理由**（用户）：「不需要离线兼容。全部用真的。AI 不贵。」mock 一个协议等于自己再实现一遍协议，维护成本和失真风险都高于真实调用费用；协议失真恰好会掩盖 adapter 最该发现的错误。E2E 的本机回路就是带 key 直接 `pnpm e2e --repo <id>`，与 CI 完全一致。矩阵不收缩，破坏性变更的逐仓库修复是仓库自治换来的预期成本，用 Eval 预算（每仓库最小闭环）与固定修复顺序（contract 仓库先行、按 group 逐组）控制，不回退共享 factory。

**同批确立**（同次迭代的配套裁决）：

- 变更预算判据：一次改动允许变化的测试 = 契约 diff 影响面；实现重构导致无关测试变红按缺陷处理并记 memory（`docs/engineering/testing/README.md`）。
- 示例页不瘦身、按体裁拆两页：`<feature>/README.md` 测试架构（fixture/观察面）+ `<feature>/cases.md` 用例登记表（契约 → 场景矩阵），用户明确要求保厚度、拆而不删。
- 拆页时修正了两处旧测试文档与 Feature 契约的漂移：budget 示例曾断言「已花 + 在飞预留」，`docs/runner.md` 定稿是只按已完成实测花费、不做预测性节流；Results 选择示例曾用「逐 eval 取最新快照」口径，`docs/feature/results/library.md` 定稿是快照粒度 `latest()` + partial-coverage 警告。
