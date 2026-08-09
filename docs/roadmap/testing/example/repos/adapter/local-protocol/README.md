# local-protocol 场景 Repo（docs 示例）

无密钥、可控错误的本地协议 Repo：`experiments/local.ts` 用真实官方工厂
`uiMessageStreamAgent`（`niceeval/adapter`）指向仓库自有的本地 HTTP fixture，
只证明 NiceEval 的传输与错误分类。它**不冒充** live 兼容性，也**不伪造** E2B 分页器
（真实 provider 兼容性归 `ai-sdk` / `codex-cli` 的 main / nightly lane；分页矩阵归真实
E2B provider Repo）。因此只进入 PR lane（见 `e2e.json.lanes`），不需要任何 secret。

## 怎么跑

```sh
# NiceEval 根目录；无密钥 PR lane
pnpm e2e --repo adapter/local-protocol

# 已安装候选包的独立 local-protocol Repo 根目录
pnpm test
```

测试自己启动 5xx fixture，再运行 `pnpm exec niceeval exp local --rerun all --json`。
随后从 `niceeval show local/roundtrip --history --json` 读回 errored verdict。
完整命令都在调用点，不读 `.niceeval/` 私有布局。

根 runner 的临时副本隔离不同 invocation；每条会写 `.niceeval` 的 case 还使用自己的项目副本，
让同一 Repo 以后增加测试文件时仍可保留 Vitest 默认并行。HTTP fixture 监听动态端口，不共享固定地址。

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
| `experiments/local.ts` | `uiMessageStreamAgent`，base URL 读 `LOCAL_BACKEND_URL`（测试注入） |
| `evals/local/roundtrip.eval.ts` | 正常消息往返（本 Repo 总把它对准 5xx fixture，断言不执行） |
| `test/local-backend-failure.test.ts` | 5xx → `agent.run` 结构化执行错误 Observation → `errored` Verdict Claim；公开事件带 `agent.run` 阶段与含 `502` 的原因，receipt / history 在明确 GraphRef 上读回该 Claim |
