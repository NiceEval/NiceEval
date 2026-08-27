---
format: niceeval.memory/v1
id: setup-prefix-preparation-hides-cli-progress
title: SetupPrefix 预派发构建在 CLI 中没有进度
createdAt: 2026-08-26T19:11:16+08:00
kind:
  type: problem
  state: open
promotions:
  - kind: feature
    current:
      - docs/feature/experiments/cli.md#派发前-sandbox-准备
    history: []
---
# SetupPrefix 预派发构建在 CLI 中没有进度

## 观察

NiceEval-Eval 从安装后的本地 candidate 执行 `pnpm exec niceeval exp harness`。PLAN 显示 12 个 Attempt 后，Human dashboard 连续显示 `0 running · 12 queued`；Incus 实际正在 lookup、构建并发布 provider-native SetupPrefix artifact，但 CLI 没有任何活动行解释这段等待。

## 根因

`prepareSetupPrefixes()` 在 Attempt 派发前串行完成 Incus prepared artifact。普通 BuildKey 已通过 `reportRunActivity()` 投影到 Human CLI，这条较新的 SetupPrefix 路径却给 materialization 注入 `noFeedback()`，也没有发出 Run activity。Attempt 正确地保持 queued，但反馈模型只剩计数，用户无法区分正常冷构建、缓存查询或卡死。

## 修复边界

Prepared-artifact coordinator 应发出一条不占 Attempt permit 的 Run activity：先报告 cache lookup，miss 后以同一 activity 更新 prepare Sandbox 创建、当前 action `i/n`、action ID 与 artifact 发布，最后以 hit、prepared 或 failed 收口。TTY 保留整段 elapsed，非 TTY Human 流追加有界进度标签；这些短期标签不进入 Record 或 `--json` 事件词表。

## 验证状态

旧候选的公开红灯来自 NiceEval-Eval 的真实 Incus `niceeval exp harness` 输出。重新链接 sha256
`3a1d36450e72f9ebb6e30549a497ff8b1ae5993a351a7418feea5cb5b0d42025` 后，以安装后的公开入口运行
`pnpm exec niceeval exp harness/v0.13.3 harness/terminal-bench/cancel-async-authoring`，在 Attempt 启动前观察到：

```text
checking sandbox setup cache · incus · 5 actions · 1 attempt
creating sandbox setup builder · incus · action 1/5 · 1 attempt
```

在真实 TTY 中，同一条 `ACTIVE` activity 从 cache lookup 更新为 action 进度，elapsed 持续增长，而 Attempt 仍保持 queued。验证在付费 Agent turn 前停止；精确删除本次 Incus allocation 后，使用产品 reconciler 取得 active allocation 与 instance 均为零的收据，`niceeval sandbox provider doctor incus --development` 恢复为 `4 free of 4`，`niceeval session list` 为零。Problem 暂时保持 open：仓库正式 E2E 已明确不以普通 Docker SetupPrefix owner 冒充 Incus VM prepared-artifact 行为；未来 Incus E2E owner 接管后才能按 fixed 门关闭。
