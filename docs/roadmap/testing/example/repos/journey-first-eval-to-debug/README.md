# journey-first-eval-to-debug 场景 Repo（docs 示例）

新手旅程的独立消费 Repo **不带 config**，由 `niceeval init` 生成。
它自带 `evals/onboarding/{passes,fails}.eval.ts` 与 `experiments/onboarding.ts`。
后者使用本地确定性 agent `agents/fixture.ts` 和 `defineDirectAgent`，不连接任何 provider。

本 Repo 证明跨域用户目标闭合：init → list → dry → exp → history → locator →
execution → view --out → 浏览器。每个接缝立即检查。
通过 eval 的完成由 `result` 事件计数（`passed: 1`）与历史读回
（`onboarding/passes` 的 `passed` verdict）双重证明。
失败 Attempt 的 locator 从公开 history 取得，再由 `show --execution` 与导出站浏览器连续消费。

## 怎么跑

```sh
# 在 NiceEval 根目录；runner 复制本 Repo 并注入候选 tarball
pnpm e2e --repo journey-first-eval-to-debug

# 在已经安装候选包的隔离 Repo 根目录
pnpm test          # 首次需要 pnpm exec playwright install chromium
```

测试自己跑 `niceeval init` 起头，之后每条命令都在调用点，不读 `.niceeval/` 私有布局。
浏览器段直接使用 Playwright Test 的 `page` fixture、web-first assertion、trace 和截图；
没有 Vitest 外壳，也没有自写 `chromium.launch()` 生命周期。

## lockfile 规则（正式）

- 本目录是 docs 示例，**不签入、不手写** `pnpm-lock.yaml`：文档里手写的 lockfile 必然
  过期，只制造"看起来可复现"。真实实现时 `pnpm install` 生成 lockfile 并随代码签入。
- 根 runner 在**临时副本**里把 `niceeval` 依赖替换成候选 tarball，安装后核对实际 executable
  到的包与 tarball 指纹一致；独立 checkout 不注入候选时，测的就是 lockfile 锁定的
  已发布的对照版本（本示例依赖声明 `niceeval ^0.4.6`）。
- 本目录不是 pnpm workspace 成员；真实 e2e Repo 需要自带只含 `packages: []` 的
  `pnpm-workspace.yaml`，让自己成为 workspace root、不向上并入父级。

## 内容

| 路径 | 角色 |
|---|---|
| `agents/fixture.ts` | 本地确定性 direct agent，每轮回复同一段文字 |
| `evals/onboarding/passes.eval.ts` | 第一条通过的评测（`t.succeeded()`） |
| `evals/onboarding/fails.eval.ts` | 故意失败的评测（永远等不到的字面量），演示定位流程 |
| `experiments/onboarding.ts` | `defineExperiment({ agent, evals: ["onboarding/"] })` |
| `test/first-eval-to-report.test.ts` | init → list → dry → exp → history → execution → view → 浏览器 |
| `playwright.config.ts` | 浏览器、超时、trace、截图与失败文件目录 |
| `test/support/` | 本 Repo 自有的进程收据、临时目录与机械断言辅助 |
