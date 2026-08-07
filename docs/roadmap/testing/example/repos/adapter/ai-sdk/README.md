# ai-sdk 场景 Repo（docs 示例）

live 适配器 Repo：`experiments/tool-call.ts` 使用真实官方工厂 `uiMessageStreamAgent`
（`niceeval/adapter`）。它只经 HTTP 边界接入**本仓库自带的被测应用**（`src/backend/`）。
该应用是 `useChat` 形状的 UI Message Stream SSE 后端，真实模型经 `@ai-sdk/openai` 接入。

本 Repo 证明：真实协议下工具调用发生了，并以不带命名空间的原始工具名出现。公开执行证据
（`niceeval show --execution --json`）能够读回该 `name`；UI Message Stream 不承诺为任意应用工具补 `tool` 分类。
它进入 main / nightly / release lane
（见 `e2e.json.lanes`），需要真实 provider 凭据。

## 怎么跑

```sh
# NiceEval 根目录；main/nightly/release lane 注入凭据
pnpm e2e --repo adapter/ai-sdk

# 已安装候选包的独立 ai-sdk Repo 根目录；测试自己启停被测应用
pnpm test
```

根 runner 的临时副本隔离不同 invocation；每条会写 `.niceeval` 的 case 还使用自己的项目副本，
让同一 Repo 以后增加测试文件时仍可保留 Vitest 默认并行。被测应用继续使用动态端口，不共享固定监听地址。

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
| `src/backend/` | 被测应用：UI Message Stream SSE 后端（`get_weather` / `calculate` 工具） |
| `experiments/tool-call.ts` | `uiMessageStreamAgent`，URL 读 `AI_SDK_URL`（测试注入） |
| `evals/tool-call/weather.eval.ts` | 天气 prompt → `calledTool("get_weather")`，`notCalledTool("calculate")` |
| `test/tool-identity.test.ts` | 起应用 → 私有项目副本里的 `exp` / `show`：原始工具名与入参保真读回 |
