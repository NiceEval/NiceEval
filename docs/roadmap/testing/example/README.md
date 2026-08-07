# 测试代码 Example

这里不是一叠脱离现场的 test，也不是一套新的 E2E 框架。示例先按执行层分开：`unit/` 放核心仓库里的确定性
Unit；`repos/` 放 E2E 场景 Repo。`repos/` 下每个叶子都是一个独立用户项目，拥有自己的 `package.json`、
`e2e.json`、config、Eval、Experiment、fixture 和测试文件。功能测试与 Adapter 测试使用两组不同的 Repo：
前者位于 `e2e/<feature-id>/`，后者位于 `e2e/adapter/<adapter-id>/`。这里集中展示代码，只是便于设计评审。

测试运行器直接复用成熟工具：非浏览器场景使用 Vitest，报告与浏览器 Journey E2E 使用 Playwright Test。
NiceEval 只实现外侧的薄 runner：选择 Repo、打候选 tarball、复制到隔离目录、安装并核验候选身份、准备
Docker / secret、收集 artifact 和执行 cleanup。它不解码产品结果，也不替测试计算 expected。
两套 Repo 的放置判断与依赖边界见 [`repos/README.md`](repos/README.md)。

```text
example/
├── testkit/                       # 跨测试类型的目标 API 与正文草案；不是场景 Repo
├── unit/
│   ├── record/tool-name-normalization.test.ts
│   └── sandbox/e2b-detached-state.test.ts
└── repos/
    ├── cli/                       # ┐
    ├── runner/                    # │ NiceEval 功能场景 Repo
    ├── report/                    # │ 子功能与 Journey 是测试文件
    ├── lifecycle/                 # │
    ├── package/                   # ┘
    ├── adapter/                   # Adapter 兼容性 Repo collection
    │   ├── ai-sdk/
    │   ├── codex-cli/
    │   └── local-protocol/
    └── <其它确有不同依赖或 executor 的 Repo>/
```

## 命名规则

命名只回答四件事，不再增加 `Mechanism` 或 `Result` 类型名：

1. 第一层目录写执行层：`unit` 或 E2E 的 `repos`；
2. Unit 子目录写产品 owner；E2E Repo ID 写稳定消费现场，例如 `runner`、`report`、`adapter/codex-cli`；
3. 子功能与 Journey 写进文件名，例如 `carry-reuse.test.ts`、`first-eval-to-debug.spec.ts`；
4. `test()` 标题写场景与长期结果，不写被调用的私有辅助函数。

新增**功能命题**若能共享 package graph、config、executor、lane 和隔离策略，就在对应功能 Repo 增加文件。
新增**适配器命题**只能进入 `adapter/<id>`；每个真实 SDK / CLI 仍各自拥有叶子 Repo。
两组 Repo 不因都执行 `pnpm exec niceeval` 而合并，也不互借 fixture、依赖或结果根。

这与已调研项目的结构一致：Vite 用 `playground/<project>/__tests__`，Vitest 用 `test/e2e/fixtures/<project>`。
Playwright 用 `tests/<product-area>/*.spec.ts`。三者都用产品域与行为定位测试，没有建立名为 `mechanism` 的测试层。
证据见 [框架工具自身的 E2E 对照](../../../research/framework-e2e/README.md)。

跨 Repo 已经重复的机械能力会收进独立 [官方 Testkit](../testkit.md)，而不是再造产品 DSL。
各 Repo 已迁移后的代码与完整 API 草案见 [`testkit/`](testkit/README.md)。

## 一条测试到底在哪里运行

以 [`runner/test/carry-reuse.test.ts`](repos/runner/test/carry-reuse.test.ts) 为例：

```sh
# cwd = NiceEval 根目录；runner 复制 Runner Repo、注入候选 tarball，再把参数传给 Vitest
pnpm e2e --repo runner -- --run test/carry-reuse.test.ts

# cwd = 已安装候选包的 Runner 隔离 Repo 根目录
pnpm test --run test/carry-reuse.test.ts
```

测试正文随后从该 Repo 根目录执行完整用户命令：

```sh
pnpm --silent exec niceeval exp carry --rerun all --json
pnpm --silent exec niceeval exp carry --dry --json
pnpm --silent exec niceeval exp carry --json
```

因此 `cwd`、Repo、测试入口和被测 CLI 都可见。需要改 config / eval 的 case 只改 runner 创建的私有副本，
不会改完再写回共享文件。

## 三种可读代码形状

- [CLI pipe](repos/cli/test/show-json-pipe.test.ts)：完整 argv 后立即检查 exit / stream，再 parse 结构化结果；历史 bug 的
  `regression:` 与长期测试标题分开。选择与进程出口分别在
  [`experiment-selection.test.ts`](repos/cli/test/experiment-selection.test.ts) 和
  [`process-streams-and-exit.test.ts`](repos/cli/test/process-streams-and-exit.test.ts)，不会因同属 CLI 就合并到一个宽泛文件。
- [Runner 状态变化](repos/runner/test/carry-reuse.test.ts)：具名 argv 在文件头可见，mutation 发生在私有副本，
  每次 dry / run 都在最近一步比较 reused 身份。
- [Journey E2E](repos/report/test/first-eval-to-debug.spec.ts)：不用一条最终页面断言概括整段流程，
  而是在 list、dry、run、history、execution、href 各接缝留下检查点。

维护时先判断公开结果是否改变。若只改了内部 DTO、目录、CSS 或 executor，以上测试的 expected 不应跟着改；若公开契约有意变化，
只修改该结果的唯一 owner。新 bug 先加强 owner 并验证旧实现会红，不以复制一条相似测试代替。完整判断表见
[Portfolio · 修改测试的决策门](../portfolio.md#修改测试的决策门)，首轮错误草稿对账见 [REVIEW](REVIEW.md)。

共享机械 API 单独见 [`testkit/README.md`](testkit/README.md)。它不是功能 Repo，也不是 Adapter Repo，只用于评审两组测试
怎样复用命令收据、严格解码与资源 cleanup。

## 功能测试 Repo 索引

| 类型 | 独立 Repo 与代表代码 | 根目录命令 | 主要证明 |
|---|---|---|---|
| CLI | [`experiment-selection.test.ts`](repos/cli/test/experiment-selection.test.ts)、[`process-streams-and-exit.test.ts`](repos/cli/test/process-streams-and-exit.test.ts)、[`show-json-pipe.test.ts`](repos/cli/test/show-json-pipe.test.ts) | `pnpm e2e --repo cli` | 选择、exit/stdout/stderr、大 JSON pipe 完整性 |
| Report | [`repos/report/test/exported-navigation.spec.ts`](repos/report/test/exported-navigation.spec.ts) | `pnpm e2e --repo report` | history → locator → 导出页实际 href → 正确 Attempt |
| Package / CommonJS | [`repos/package/test/commonjs-init-list.test.ts`](repos/package/test/commonjs-init-list.test.ts) | `pnpm e2e --repo package` | 候选包安装到 CommonJS consumer 后 `init → list` |
| Runner / carry | [`repos/runner/test/carry-reuse.test.ts`](repos/runner/test/carry-reuse.test.ts) | `pnpm e2e --repo runner` | dry plan 与真实 dispatch 一致；配置变化与部分补跑 |
| Runner / history | [`repos/runner/test/history-dedup.test.ts`](repos/runner/test/history-dedup.test.ts) | `pnpm e2e --repo runner` | attempt 身份追加与携入去重 |
| Lifecycle / interrupt | [`repos/lifecycle/test/interrupt-cleanup.test.ts`](repos/lifecycle/test/interrupt-cleanup.test.ts) | `pnpm e2e --repo lifecycle` | SIGINT、teardown、owned backend 消失、下一消费者 |
| Report / Journey | [`repos/report/test/first-eval-to-debug.spec.ts`](repos/report/test/first-eval-to-debug.spec.ts) | `pnpm e2e --repo report` | `init → list → dry → exp → show → view → browser` |

这些 Repo 验收 NiceEval 自己拥有的功能。需要 Agent 时使用各 Repo 签入的确定性 `agents/fixture.ts`；它们不安装
`@ai-sdk/openai`，不启动 Codex CLI，也不从 Adapter Repo 借一份运行结果。长 Journey 同样在功能 Repo 的私有副本里完成。

## Adapter 兼容性 Repo 索引

| 类型 | 独立 Repo 与代表代码 | 根目录命令 | 主要证明 |
|---|---|---|---|
| Adapter / live AI SDK | [`repos/adapter/ai-sdk/test/tool-identity.test.ts`](repos/adapter/ai-sdk/test/tool-identity.test.ts) | `pnpm e2e --repo adapter/ai-sdk` | 真实 SSE / model / tool identity；main/nightly |
| Adapter / live Codex CLI | [`repos/adapter/codex-cli/test/tool-identity.test.ts`](repos/adapter/codex-cli/test/tool-identity.test.ts) | `pnpm e2e --repo adapter/codex-cli` | 真实 CLI / Docker / canonical tool；main/nightly |
| Adapter / local protocol | [`repos/adapter/local-protocol/test/local-backend-failure.test.ts`](repos/adapter/local-protocol/test/local-backend-failure.test.ts) | `pnpm e2e --repo adapter/local-protocol` | 无密钥 HTTP 5xx 传输与错误分类；PR |

Adapter Repo 只为证明某个外部入口的协议兼容性保留最小 `exp → public readback` 路径。这几条 CLI 命令是观察手段，
不让 Adapter Repo 接管 CLI、Runner、Report 或 Journey 的功能矩阵。

## Unit 索引

| 类型 | 代表代码 | 根目录命令 | 主要证明 |
|---|---|---|---|
| Unit / Record | [`unit/record/tool-name-normalization.test.ts`](unit/record/tool-name-normalization.test.ts) | `pnpm exec vitest run --config docs/roadmap/testing/example/unit/vitest.config.ts` | NiceEval 自己拥有的确定性规范名映射 |
| Unit / Sandbox | [`unit/sandbox/e2b-detached-state.test.ts`](unit/sandbox/e2b-detached-state.test.ts) | 同上 | 分页输入如何折叠为 detached 状态；live SDK 兼容性仍归 E2E |

每个 Repo 的 README 还给出“进入隔离 Repo 后”的直接命令。正式 Repo 会签入安装生成的 lockfile；
这里不手写一份注定过期的示意 lockfile。

移动或删除示例后，收尾要检查并删除本次产生的空目录，避免目录树继续展示已经不存在的分类。

## Adapter 为什么是多个 Repo

Adapter 不是功能测试 Repo 的一种 fixture，也不是一个平铺测试文件夹。[`repos/adapter/`](repos/adapter/README.md) 是独立 collection，
`ai-sdk`、`codex-cli`、`local-protocol` 各自是独立 consumer、依赖图、secret 条件和结果根。
以后增加 Claude Code、OpenCode、Bub 或 E2B 时，按同一形状增加叶子 Repo；不把多个适配器写入一份
package 与一份 `.niceeval` 结果中，也不拿这些 Repo 运行通用功能 Journey。示例只表达结构和 oracle，
不要求为了读文档真的搭完所有付费后端。

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
