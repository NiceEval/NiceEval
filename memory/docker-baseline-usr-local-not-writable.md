---
name: docker-baseline-usr-local-not-writable
description: 官方 Docker 基线漏了 Node 工具契约第三条(可写性),USER node 切换后 corepack enable / npm install -g 直接 EACCES;已修
metadata:
  type: project
---

**已修**:[[official-baseline-tool-surface-unified]] 统一的「跨 provider 基线工具面」只显式覆盖了 yarn/python3 两条,漏了 Node 工具契约(见 `docs/feature/sandbox/library/prebuilt-environments.md`「E2B:TemplateBuilder 派生」)的第三条——`/usr/local/bin` 与 `/usr/local/lib/node_modules` 对运行用户可写。E2B 侧 `withNodeToolContract` 早就 chown 给运行用户,Docker 侧的六个 target 全部在装完全局 CLI 后才 `USER node`,构建期这两个目录一直归 root,运行期以 `node` 身份补装或 `corepack enable` 必现 EACCES。

**起因**:2026-08-04 MemoryBench 全量实测撞到——react-datepicker 等题的安装步骤(`corepack enable` 装 yarn)以 `node` 身份直接失败,remem/obelisk 两批从换仓库起连环 errored。MemoryBench 已在派生镜像用 `chown -R node:node /usr/local/bin /usr/local/lib/node_modules` 临时补上并验证有效(该仓库 commit `b43639e`)。

**修法**:`sandbox/docker/Dockerfile` 的 `base` target 在移除内置 yarn 之后新增 `RUN chown node:node /usr/local/bin /usr/local/lib/node_modules`,六个 target(含只用 `$HOME/.local` 的 bub / hermes)全部继承同一次 chown,真机验证过 codex 与 hermes 两个 target。`.github/workflows/docker-image.yml` 的构建自检新增 `corepack enable && yarn --version` 断言(放在「无 yarn」检查之后,避免 corepack 落的 shim 把前一条测红)。文档同步进 `docs/feature/sandbox/library/prebuilt-environments.md`「跨 provider 基线工具面」补第三条。

**版本**:六个 `AGENT_BASELINE_RECIPE_REVISION` 值当时已经 bump 过但从未发布过镜像,本次修复直接并入这次未发布修订,不再额外 +1(`src/agents/coding-cli-versions.ts` 注释同步说明)。MemoryBench 派生镜像的临时 chown 层待 NiceEval 这份修复发布后可删。
