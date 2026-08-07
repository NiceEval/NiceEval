# 测试代码 Example

这里不是一叠脱离现场的 test，也不是一套新的 E2E 框架。示例先按执行层分开：`unit/` 放核心仓库里的确定性
Unit；`repos/` 放 E2E 场景 Repo。`repos/` 下每个叶子都是一个独立用户项目，拥有自己的 `package.json`、
`e2e.json`、config、Eval、Experiment、fixture 和测试文件。正式实现时，这些叶子分别放进 `e2e/<repo-id>/`；
这里集中展示代码，只是便于设计评审。

测试运行器直接复用成熟工具：非浏览器场景使用 Vitest，报告与浏览器 Journey E2E 使用 Playwright Test。
NiceEval 只实现外侧的薄 runner：选择 Repo、打候选 tarball、复制到隔离目录、安装并核验候选身份、准备
Docker / secret、收集 artifact 和执行 cleanup。它不解码产品结果，也不替测试计算 expected。

```text
example/
├── unit/
│   ├── record/tool-name-normalization.test.ts
│   └── sandbox/e2b-detached-state.test.ts
└── repos/
    ├── cli/                       # 一个独立 consumer Repo
    ├── report/                    # 一个独立 consumer Repo
    ├── adapter/                   # collection；每个叶子仍是独立 Repo
    │   ├── ai-sdk/
    │   ├── codex-cli/
    │   └── local-protocol/
    └── <其它产品域场景 Repo>/
```

## 命名规则

命名只回答四件事，不再增加 `Mechanism` 或 `Result` 类型名：

1. 第一层目录写执行层：`unit` 或 E2E 的 `repos`；
2. Unit 子目录和 E2E Repo ID 写产品 owner，例如 `record`、`cli`、`report`、`adapter/codex-cli`；
3. 文件名写可观察行为，例如 `show-json-pipe.test.ts`、`exported-navigation.spec.ts`；
4. `test()` 标题写场景与长期结果，不写被调用的私有辅助函数。

这与已调研项目的结构一致：Vite 用 `playground/<project>/__tests__`，Vitest 用 `test/e2e/fixtures/<project>`。
Playwright 用 `tests/<product-area>/*.spec.ts`。三者都用产品域与行为定位测试，没有建立名为 `mechanism` 的测试层。
证据见 [框架工具自身的 E2E 对照](../../../research/framework-e2e/README.md)。

## 一条测试到底在哪里运行

以 [`runner-carry/test/carry-reuse.test.ts`](repos/runner-carry/test/carry-reuse.test.ts) 为例：

```sh
# cwd = NiceEval 根目录；runner 复制 runner-carry、注入候选 tarball，再把参数传给 Vitest
pnpm e2e --repo runner-carry -- --run test/carry-reuse.test.ts

# cwd = 已安装候选包的 runner-carry 隔离 Repo 根目录
pnpm test --run test/carry-reuse.test.ts
```

测试正文随后从该 Repo 根目录执行完整用户命令：

```sh
pnpm --silent exec niceeval exp smoke --rerun all --json
pnpm --silent exec niceeval exp smoke --dry --json
pnpm --silent exec niceeval exp smoke --json
```

因此 `cwd`、Repo、测试入口和被测 CLI 都可见。需要改 config / eval 的 case 只改 runner 创建的私有副本，
不会改完再写回共享文件。

## 三种可读代码形状

- [CLI pipe](repos/cli/test/show-json-pipe.test.ts)：完整 argv 后立即检查 exit / stream，再 parse 结构化结果；历史 bug 的
  `regression:` 与长期测试标题分开。选择与进程出口分别在
  [`experiment-selection.test.ts`](repos/cli/test/experiment-selection.test.ts) 和
  [`process-streams-and-exit.test.ts`](repos/cli/test/process-streams-and-exit.test.ts)，不会因同属 CLI 就合并到一个宽泛文件。
- [Runner 状态变化](repos/runner-carry/test/carry-reuse.test.ts)：具名 argv 在文件头可见，mutation 发生在私有副本，
  每次 dry / run 都在最近一步比较 reused 身份。
- [Journey E2E](repos/journey-first-eval-to-debug/test/first-eval-to-report.test.ts)：不用一条最终页面断言概括整段流程，
  而是在 list、dry、run、history、execution、href 各接缝留下检查点。

维护时先判断公开结果是否改变。若只改了内部 DTO、目录、CSS 或 executor，以上测试的 expected 不应跟着改；若公开契约有意变化，
只修改该结果的唯一 owner。新 bug 先加强 owner 并验证旧实现会红，不以复制一条相似测试代替。完整判断表见
[Portfolio · 修改测试的决策门](../portfolio.md#修改测试的决策门)，首轮错误草稿对账见 [REVIEW](REVIEW.md)。

## 场景 Repo 索引

| 类型 | 独立 Repo 与代表代码 | 根目录命令 | 主要证明 |
|---|---|---|---|
| CLI | [`experiment-selection.test.ts`](repos/cli/test/experiment-selection.test.ts)、[`process-streams-and-exit.test.ts`](repos/cli/test/process-streams-and-exit.test.ts)、[`show-json-pipe.test.ts`](repos/cli/test/show-json-pipe.test.ts) | `pnpm e2e --repo cli` | 选择、exit/stdout/stderr、大 JSON pipe 完整性 |
| Report | [`repos/report/test/exported-navigation.spec.ts`](repos/report/test/exported-navigation.spec.ts) | `pnpm e2e --repo report` | history → locator → 导出页实际 href → 正确 Attempt |
| Package | [`repos/package-commonjs/test/commonjs-init-list.test.ts`](repos/package-commonjs/test/commonjs-init-list.test.ts) | `pnpm e2e --repo package-commonjs` | 候选包安装到 CommonJS consumer 后 `init → list` |
| Runner / carry | [`repos/runner-carry/test/carry-reuse.test.ts`](repos/runner-carry/test/carry-reuse.test.ts) | `pnpm e2e --repo runner-carry` | dry plan 与真实 dispatch 一致；配置变化与部分补跑 |
| Runner / history | [`repos/runner-history/test/history-dedup.test.ts`](repos/runner-history/test/history-dedup.test.ts) | `pnpm e2e --repo runner-history` | attempt 身份追加与携入去重 |
| Lifecycle | [`repos/lifecycle-interrupt-cleanup/test/sigint-teardown-orphan.test.ts`](repos/lifecycle-interrupt-cleanup/test/sigint-teardown-orphan.test.ts) | `pnpm e2e --repo lifecycle-interrupt-cleanup` | SIGINT、teardown、owned backend 消失、下一消费者 |
| Journey E2E | [`repos/journey-first-eval-to-debug/test/first-eval-to-report.test.ts`](repos/journey-first-eval-to-debug/test/first-eval-to-report.test.ts) | `pnpm e2e --repo journey-first-eval-to-debug` | `init → list → dry → exp → show → view → browser` |
| Adapter / live AI SDK | [`repos/adapter/ai-sdk/test/tool-identity.test.ts`](repos/adapter/ai-sdk/test/tool-identity.test.ts) | `pnpm e2e --repo adapter/ai-sdk` | 真实 SSE / model / tool identity；main/nightly |
| Adapter / live Codex CLI | [`repos/adapter/codex-cli/test/tool-identity.test.ts`](repos/adapter/codex-cli/test/tool-identity.test.ts) | `pnpm e2e --repo adapter/codex-cli` | 真实 CLI / Docker / canonical tool；main/nightly |
| Adapter / local protocol | [`repos/adapter/local-protocol/test/local-backend-failure.test.ts`](repos/adapter/local-protocol/test/local-backend-failure.test.ts) | `pnpm e2e --repo adapter/local-protocol` | 无密钥 HTTP 5xx 传输与错误分类；PR |
| Unit / Record | [`unit/record/tool-name-normalization.test.ts`](unit/record/tool-name-normalization.test.ts) | `pnpm exec vitest run --config docs/roadmap/testing/example/unit/vitest.config.ts` | NiceEval 自己拥有的确定性规范名映射 |
| Unit / Sandbox | [`unit/sandbox/e2b-detached-state.test.ts`](unit/sandbox/e2b-detached-state.test.ts) | 同上 | 分页输入如何折叠为 detached 状态；live SDK 兼容性仍归 E2E |

每个 Repo 的 README 还给出“进入隔离 Repo 后”的直接命令。正式 Repo 会签入安装生成的 lockfile；
这里不手写一份注定过期的示意 lockfile。

## Adapter 为什么是多个 Repo

Adapter 不是一个平铺测试文件夹。[`repos/adapter/`](repos/adapter/README.md) 是 collection，
`ai-sdk`、`codex-cli`、`local-protocol` 各自是独立 consumer、依赖图、secret 条件和结果根。
以后增加 Claude Code、OpenCode、Bub 或 E2B 时，按同一形状增加叶子 Repo；不把多个适配器写入一份
package 与一份 `.niceeval` 结果中。示例只表达结构和 oracle，不要求为了读文档真的搭完所有付费后端。

## 浏览器为什么不用自写生命周期

Report 与带浏览器的 Journey 直接由 Playwright Test 执行：测试接收 `page` fixture，使用 web-first assertion，
失败时保留 trace / screenshot，browser context 与 worker cleanup 交给 Playwright。测试只保留 NiceEval 领域动作：
运行 `exp/show/view`、读取页面实际 `href`、点击并核对同一个 locator。

只有将来出现 Vite 那类“大量 playground 共用远端浏览器与自有 dev server”的明确性能需求，才考虑专用
browser fixture；当前不应由 Vitest 再包一层 `chromium.launch()`。

## 从错误草稿学到了什么

[`REVIEW.md`](REVIEW.md) 逐条说明首轮草稿为什么会假绿、难读或反复改 test，以及这些问题如何变成
当前设计规则。完整历史证据保存在
[`memory/readable-test-examples-false-green-review.md`](../../../../memory/readable-test-examples-false-green-review.md)。
