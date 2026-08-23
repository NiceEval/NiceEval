---
{
  "format": "niceeval.feedback/v1",
  "id": "20260813115630-friction",
  "title": "测试指南要求 pnpm test 但根 script 不存在",
  "state": "open",
  "reportedAt": "2026-08-13T11:56:30+08:00",
  "source": {
    "kind": "dev",
    "repository": "NiceEval/NiceEval"
  },
  "subject": "repository",
  "claim": "friction",
  "observation": "---\ntitle: '测试指南要求 pnpm test 但根 script 不存在'\nseverity: 'minor'\n---\n\n## Expected Behavior\n\n测试指南要求统一复用 `pnpm test` 时，根 `package.json` 应提供该 script，并运行仓库约定的代码测试入口；如果重置期明确禁止统一入口，指南应给出当前可执行的替代命令。\n\n## Current Behavior\n\n根 `package.json` 没有 `test` script。运行 `pnpm test` 立即以 exit 1 结束且没有输出，无法区分“脚本缺失”与测试失败；直接运行 `pnpm exec vitest run --reporter=verbose` 才能得到 12 files / 45 tests passed。\n\n## Possible Solution\n\n补上与当前 Vitest projects 对齐的根 `test` script，或在测试重置期文档中明确唯一的临时验证入口与预期退出行为。\n\n## Minimal Reproducible Example\n\n在仓库根运行：\n\n```sh\npnpm test\necho $?\nnode -e 'console.log(require(\"./package.json\").scripts.test)'\npnpm exec vitest run --reporter=verbose\n```\n\n前两步分别得到无输出的 exit 1 和 `undefined`；最后一步正常执行并报告测试结果。\n\n## Context\n\n为 Adapter E2E 并发装箱 PR 做统一验收时，按照仓库测试指南执行 `pnpm test`，需要额外排查才确认不是本次改动导致的测试失败。\n",
  "impact": "根 `package.json` 没有 `test` script。运行 `pnpm test` 立即以 exit 1 结束且没有输出，无法区分“脚本缺失”与测试失败；直接运行 `pnpm exec vitest run --reporter=verbose` 才能得到 12 files / 45 tests passed。",
  "memoryRelations": []
}
---
---
title: '测试指南要求 pnpm test 但根 script 不存在'
severity: 'minor'
---

## Expected Behavior

测试指南要求统一复用 `pnpm test` 时，根 `package.json` 应提供该 script，并运行仓库约定的代码测试入口；如果重置期明确禁止统一入口，指南应给出当前可执行的替代命令。

## Current Behavior

根 `package.json` 没有 `test` script。运行 `pnpm test` 立即以 exit 1 结束且没有输出，无法区分“脚本缺失”与测试失败；直接运行 `pnpm exec vitest run --reporter=verbose` 才能得到 12 files / 45 tests passed。

## Possible Solution

补上与当前 Vitest projects 对齐的根 `test` script，或在测试重置期文档中明确唯一的临时验证入口与预期退出行为。

## Minimal Reproducible Example

在仓库根运行：

```sh
pnpm test
echo $?
node -e 'console.log(require("./package.json").scripts.test)'
pnpm exec vitest run --reporter=verbose
```

前两步分别得到无输出的 exit 1 和 `undefined`；最后一步正常执行并报告测试结果。

## Context

为 Adapter E2E 并发装箱 PR 做统一验收时，按照仓库测试指南执行 `pnpm test`，需要额外排查才确认不是本次改动导致的测试失败。
