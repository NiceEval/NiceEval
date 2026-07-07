---
name: pnpm11-allowbuilds-placeholder-blocks-install
description: "pnpm 11 给新依赖的 build script 写 allowBuilds 占位符('set this to true or false')并让 pnpm install 直接 exit 1——加带 postinstall 的依赖后必须手改 pnpm-workspace.yaml 才能继续"
metadata:
  type: infra-bug
---

**现象**：给 `package.json` 加了 `braintrust`(optional peer + devDependency)后,`pnpm run typecheck` 触发的依赖预检执行 `pnpm install`,报 `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: braintrust@3.20.0` 且 **exit 1**——不是警告,整条命令链(typecheck / test)全部失败。

**根因**：本仓库用 pnpm 11 的 `allowBuilds` 白名单管依赖 build script(见 `pnpm-workspace.yaml`,已有 esbuild/sharp/ssh2 等决策)。遇到白名单外的新依赖,pnpm 11 会自动往 `pnpm-workspace.yaml` 写一行占位符 `braintrust: set this to true or false`,并把 install 判为失败,直到人把占位符改成真值。`pnpm approve-builds` 是交互式的,agent 环境用不了。

**修法**：直接编辑 `pnpm-workspace.yaml`,把占位符改成 `true` / `false` 再 `pnpm install`。纯 SDK 类依赖(如 `braintrust`,postinstall 与库功能无关)一律 `false`;只有运行期真依赖原生构建产物的(如 sharp)才 `true`。适用于今后给仓库加任何带 build script 的依赖。
