---
title: 'E2E takeover 把已漂移的默认 suite 算作目标 owner 回归'
severity: 'minor'
---

## Expected Behavior

`pnpm e2e takeover --candidate ... --repo <id> -- --run <target>` 应能区分目标 owner 的不稳定、目标造成的干扰，以及在同一 candidate 下本来就失败的默认 owner；后者应有可核查的 baseline 分类，避免阻断无关目标的可靠性收据。

## Current Behavior

本轮 runner 与 report 的目标 owner 在 3 个 isolated copy、same-copy 双跑和 target-single 全部通过，但 takeover 仍 exit 1。runner 默认并行阶段的 `accept-reanchor.test.ts` 仍断言旧 `niceeval.show` envelope；report 默认并行阶段的 `report-show.test.ts` / `report-export.test.ts` 仍断言 `pricingProfile: null`，而当前 candidate 交付内建 pricing profile。summary 只把它们统一归为 regression，无法表示目标 owner 自身已稳定而默认 suite 契约已漂移。

## Possible Solution

接管前固定一次 default-suite baseline，最终将“目标失败/目标干扰默认 suite/default baseline 已红”分开分类；或者要求 Repo 在进入 takeover 前有独立的全绿 baseline receipt，并在 summary 中引用该 receipt。

## Minimal Reproducible Example

使用同一 candidate 运行：

```sh
pnpm e2e takeover --candidate artifacts/niceeval-candidate.tgz --repo runner --artifact-root artifacts/e2e/takeover-runner-wave -- --run test/group-wave-gap-dispatch.test.ts
pnpm e2e takeover --candidate artifacts/niceeval-candidate.tgz --repo report --artifact-root artifacts/e2e/takeover-report-session-log -- --run test/report.browser.spec.ts -t "经典 MemoryBench"
```

查看两个 `takeover-summary.json`：目标阶段全部通过，`repo-default-parallel` 因上述非目标旧断言失败，命令最终 exit 1。

## Context

candidate sha256 为 `dd477640b99274993e118698ade3a855bf93f9bf143cce148c399654e8f3fa31`。这项摩擦不改变本轮目标 E2E 的普通运行结果，但意味着不能把这两份 takeover summary 宣称为完整接管通过。
