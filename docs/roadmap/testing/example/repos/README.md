# E2E 场景 Repo 索引

这里有两套独立的真实消费项目。它们共用根 runner 与 `@niceeval/testkit`，但不共用场景 Repo、依赖图、fixture、secret、
`.niceeval` RecordStore 或领域 expected。

## 功能场景 Repo

| Repo | 功能 owner | 现场 |
|---|---|---|
| [`cli/`](cli/README.md) | argv、选择、stream、exit 与机器输出 | 本地确定性 Agent |
| [`runner/`](runner/README.md) | carry、history 与真实 dispatch | 本地确定性 Agent |
| [`report/`](report/README.md) | show、view、导出、浏览器与跨功能 Journey | 本地确定性 Agent + Playwright |
| [`lifecycle/`](lifecycle/README.md) | signal、teardown、owned resource 与下一消费者 | 本地 owned backend |
| [`package/`](package/README.md) | 安装、CJS / ESM、exports 与外部 cwd | 真实 candidate tarball consumer |

这些 Repo 验收 NiceEval 自己拥有的行为。即使一条功能 Journey 需要 Agent，它也使用所属功能 Repo 的签入 fixture，
不会改去 `adapter/ai-sdk` 或 `adapter/codex-cli` 运行。

## Adapter 兼容性 Repo

[`adapter/`](adapter/README.md) 下每个叶子都是另一份真实消费项目：

- `adapter/ai-sdk` 验 AI SDK 的真实 stream、工具与模型边界；
- `adapter/codex-cli` 验 Codex CLI、Docker sandbox 与规范工具身份；
- `adapter/local-protocol` 用同一公开协议注入可控 transport failure，但不冒充 live 兼容性。

Adapter 测试中的 `exp`、`show` 与 Report readback 是观察协议证据的最短路径，不让它接管通用功能矩阵。

## 新测试放在哪里

1. 去掉具体 SDK / CLI 名后，命题仍是 NiceEval 自己应保证的结果：放进对应功能 Repo。
2. 命题依赖某个上游的真实事件、鉴权、usage、session、工具身份或版本：放进 `adapter/<id>`。
3. 只是跨多个 NiceEval 功能的用户目标：放进最终结果 owner 的功能 Repo，并为 mutation 创建私有项目副本。
4. 只有 package graph、secret、executor、lane 或资源所有权不同，才增加 Repo；子功能只增加行为命名的测试文件。
5. 历史 Bug 不增加 Repo。先加强原 Feature owner；旧实现 kill 成立后，再用 `regression: memory/**` 附上历史凭据。

两套 Repo 唯一共享的是机械能力：argv 收据、严格 JSON / NDJSON、等待、临时副本与资源 cleanup。任何
`runExperiment()`、`expectCarry()`、`openAttempt()` 或 adapter 事件解释都不进入 Testkit。
