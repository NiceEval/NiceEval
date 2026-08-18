# OMP Adapter

## adapter-omp-target-compatibility

`adapter/omp` 的长期目标是从安装后的候选包导入 `ompAgent`，再运行 Oh My Pi 的真实非交互 CLI。
场景随后从公开 CLI 读回本轮 Eval 的 verdict、代表 execution evidence 与 timing。目标命题只承诺 OMP 的上游兼容性，
不接管通用 Eval、CLI 或 Report 语义。

当前处于 TDD 红灯阶段：候选包会导出 `ompAgent`，但工厂构造时明确抛出 OMP 专属的 `not implemented` sentinel。
因此状态是 `unproven`，不得称为 live owner、covered 或已经完成接管。测试仍保留目标 `passed/1` oracle，不把 sentinel
断言成通过；后续真实实现必须让同一 owner 穿过 CLI、`send`、结果封存与公开读回后转绿。

本阶段的红灯收据必须证明 candidate pack、隔离安装与 `niceeval/adapter` named export 查找成功。
Experiment discovery 必须确实调用工厂，而且首个产品失败是 OMP sentinel，不能是 lockfile、Testkit 注入、配置或 runner
prepare 失败。
