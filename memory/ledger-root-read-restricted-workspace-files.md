# Ledger 在 Agent 前读不到题目故意限制权限的文件

**现象（2026-08-02，真实 Terminal-Bench `processing-pipeline`）**：题目把 `collect_data.sh` 设成 root-owned mode `0311`，要求 Agent 自己发现并修复权限。NiceEval 在 `workspace.baseline` 阶段先执行普通用户 `git add`，以 `open("collect_data.sh"): Permission denied` errored，Agent 尚未开始，官方任务因此无法被评估。

**根因**：`CommandOptions.root` 已由 Docker、E2B 与 Vercel Provider 兑现，但分类账的 baseline、窗口 commit、导出与 reset 没有读取 Provider 能力，全部沿标准非 root 用户执行。下游用 `chmod` 或 `diff.ignore` 绕开会改变题目，或制造证据盲区。

**修法**：Provider backend 显式登记 root command 能力。分类账只给 runner 私有 Git shell 传 `root: true`，不对 workdir 执行 `chmod` / `chown`，Agent 仍以标准用户运行。无提权能力的 Local 与普通自定义 Provider 保持用户态；普通 workspace 照常工作，真正遇到权限拒绝时错误点名原路径与能力缺口，建议换 root-capable Provider。

**守护**：`src/runner/ledger.test.ts` 用 mode `0311` 文件验证 baseline、窗口 commit 与导出都选择 root command，操作后 uid、gid 与 mode 不变；另以不支持 root 的 Sandbox 验证权限诊断不建议改坏题目条件。
