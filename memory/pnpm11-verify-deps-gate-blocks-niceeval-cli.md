# pnpm 11 的 pre-run gate 会在 niceeval 启动前拦死 CLI

## 现象

在消费方项目（如 coding-agent-memory-evals）里跑 `pnpm exec niceeval clean`，报
`[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cpu-features, esbuild, protobufjs, ssh2`
然后 `Command failed with exit code 1: pnpm install`。看起来像 niceeval clean 在跑
install，但 clean（src/cli.ts 的 clean 分支）只删 `.niceeval/`，完全不碰依赖；
报错栈全在 pnpm.mjs 内部（`runDepsStatusCheck` → 同步 spawn `pnpm install`），
niceeval 进程根本没启动过。

## 根因

pnpm 11 两个默认行为变化叠加：

1. `verifyDepsBeforeRun` 默认从关闭改为 `install`——每次 `pnpm run` / `pnpm exec`
   前都做依赖状态检查，发现不一致就自动跑一次 `pnpm install`。
2. `allowBuilds` 取代了 `onlyBuiltDependencies` / `ignoredBuiltDependencies`。
   未审批的带 build script 的包会被 pnpm 自动写进 `pnpm-workspace.yaml`，值是
   占位符字符串 `"set this to true or false"`。占位符不算审批，install 直接以
   ERR_PNPM_IGNORED_BUILDS 硬失败（不再只是警告）。

于是形成死循环：依赖状态永远"未就绪"→ 每次 exec 都触发 install → install 永远
失败。这四个包都是 ssh2 / e2b / esbuild 链带进来的。

## 修法

编辑消费项目 `pnpm-workspace.yaml`，把 `allowBuilds` 占位符改成布尔值：
`esbuild: true`（要下载二进制，必须）；`cpu-features`、`ssh2`、`protobufjs`
的 build script 是可选 native 加速/提示，`false` 即可。或直接跑
`pnpm approve-builds` 交互选择。不推荐用 `verifyDepsBeforeRun: false` 关 gate，
那只是把失败挪到真正 install 的时候。

适用场景：任何用户在 pnpm 11 项目里跑 niceeval 报 "pnpm install failed" 时，
先怀疑是这个 gate，不是 niceeval 的 bug。

代码侧已在 0.2.1 缓解：dockerode / e2b / @vercel/sandbox 从 optionalDependencies
改为 optional peerDependencies（复用 OTel 子路径拆分那次验证过的约束——消费者
tsc 的类型图碰不到 docker.ts/e2b.ts/vercel.ts，resolve.ts 只被 CLI/runner 引用），
消费者不再被强制拖进 ssh2/cpu-features/protobufjs。剩下唯一被 pnpm 11 flag 的是
tsx 带的 esbuild，库侧无解，消费者设 `allowBuilds: esbuild: false` 即可正常装
（esbuild 平台二进制走 @esbuild/* optional deps，build script 只是校验兜底）。
漏装后端 SDK 时运行期报 "X sandbox requires 'Y'. Install it with: pnpm add Y"，
已用 pnpm pack + 干净消费者端到端验证（含 tsc --noEmit 无 TS2307 回归）。
