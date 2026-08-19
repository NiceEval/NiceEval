---
title: 'E2E takeover 把标题零命中的 skipped 当作 pass'
severity: 'major'
---

## Expected Behavior

`pnpm e2e takeover ... -- --run <file> -t <title>` 的每个 target 阶段必须至少执行一个测试；标题零命中或全部 skipped 应使 takeover 非零退出，并明确分类为配置错误。

## Current Behavior

标题 `uiMessageStreamAgent 只接受在 [DONE] 前完整形成的 Turn` 未转义传给 Vitest `-t` 时，`[DONE]` 被解释为正则字符集，三个 isolated copy、same-copy 两次与 target-single 都报告 `1 skipped` / `0ms tests`。takeover 却把每个阶段记为 `pass`，最终 exit 0；只有 repo-default-parallel 实际执行了五个测试。

## Possible Solution

在 takeover 校验每份原生测试收据的 collected/executed/passed/skipped 数量：target 阶段必须 executed > 0 且 skipped < collected；same-copy 的两次 invocation 分别校验。零命中应拒绝收据，不能只看进程 exit code。

## Minimal Reproducible Example

```sh
pnpm e2e takeover --candidate /tmp/pr66-late-green.tgz --repo adapter/local-protocol --artifact-root /tmp/pr66-late-title-takeover -- --run test/disconnect.test.ts -t "uiMessageStreamAgent 只接受在 [DONE] 前完整形成的 Turn"
```

查看 `/tmp/pr66-late-title-takeover/takeover-summary.json`：target 阶段显示 pass，但 Vitest 输出均为 `Tests 1 skipped (1)`。

## Context

candidate sha256 `9d913c3579f1c89da972a73f1a9ddbef35adcfd43243a450c7079f679c72d9a3`；正确的临时规避是给标题中的方括号加正则转义并确认每个 target 阶段实际运行 1 test。
