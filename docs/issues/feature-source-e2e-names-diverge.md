# Feature, source and E2E directories use different names for one feature

Feature、源码目录与 E2E 仓库对同一个功能使用了不同的名字，违反 `docs/feature/README.md` 的命名规则与 T-34。按 Feature 目录名统一后，找一个行为不再需要先查源码地图。

| Feature 目录 | 源码目录 | E2E 仓库 |
|---|---|---|
| `adapters` | `agents`、`adapter.ts` 及同级 `adapter-*.ts` | `adapter` |
| `experiments` | `experiment` | 归在 `runner` |
| `plugins` | `plugin` | `plugins` |
| `insight` | `view` | `insight`、`report` |
| `inspection` | `inspection`、`show` | `inspection` |
| `run` | `run`、`record` | `record` |

期望：源码目录与 E2E 仓库改用 Feature 目录名；`show` 并入 `inspection`，`record` 作为 `run` 的内部存储子目录。包的公开导出路径（`niceeval/adapter`、`niceeval/plugin` 等）是公开 API，是否随之改名单独裁决，不在本项范围内。

复现：`ls docs/feature packages/niceeval/src e2e`。来源：2026-11-12 按品味审查项目结构；不含秘密或私有资料。改名只移动文件与更新 import，不改变行为，可按功能逐个进行。
