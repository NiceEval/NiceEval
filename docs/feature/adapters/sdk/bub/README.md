# Bub

使用 `bubAgent` 在 Sandbox 中安装并运行 Bub。

```ts
import { bubAgent } from "niceeval/adapter";

const agent = bubAgent({
  skills: [{ kind: "local", path: "skills/review/SKILL.md" }],
  pythonPlugins: [
    { package: "acme-bub-tools==1.4.0" },
  ],
});
```

Bub 支持 `skills`、`pythonPlugins` 和安装后按序运行的 `postSetup` Hook（见 [Adapter · 安装后运行脚本](../../library/coding-agent-extensions.md#安装后运行脚本postsetup)），不接受 Claude/Codex 的 `mcpServers` 或原生 `plugins` 字段。
Python package 集合属于安装 checkpoint key，配置变化必须触发重新安装。

## 装哪一版 Bub

Bub 从 PyPI 装，版本是 `version` 字段，省略时用 NiceEval 钉的默认版本：

```ts
bubAgent({ version: "0.4.0" })                      // 默认就是它，写出来只为把版本记进实验
bubAgent({                                          // 往回钉一代:插件要一起往回钉
  version: "0.3.9",
  otelPlugin:
    "git+https://github.com/bubbuild/bub-contrib.git@7967e5e74c4b6cfc6f75981461691a2f8d863496#subdirectory=packages/bub-tapestore-otel",
})
```

- **NiceEval 总是钉一个确定版本**，不装 latest：被测对象的版本必须能从实验配置读出来，否则两次跑分不可比。
- **`otelPlugin` 与 `version` 同代才有 tracing。**
  行为轨来自 Bub tape，时间轨来自 `bub-tapestore-otel` 插件，插件按 tape 协议的形态读数据：新插件从 `bub.tape` 取类型（要求 Bub ≥ 0.3.10），旧插件按 republic 的类型校验（配 Bub ≤ 0.3.9）。
  配错代不会安装失败，而是 span 全被拒、时间轨静默为空——所以往回钉 `version` 时必须同批钉配套的 `otelPlugin`（台账见 [memory](../../../../../memory/bub-tapestore-otel-tapeentry-drift.md)）。
- **插件靠 override 装。**
  插件所在 workspace 把 `bub` 声明成 git 依赖，不写 override 的话每次安装都会去拉 Bub 主干——版本失控。
  Adapter 因此总是先写一份把 `bub` 钉成 `bub==<version>` 的 override 文件再安装，用户不需要知道这个细节。
- **`version` 与 `otelPlugin` 都参与 ensure identity**：换任意一个都改变配置身份，也让预装环境的 marker 对不上而触发配对 Installer 的完整安装。

行为轨来自 Bub tape JSONL；session 由 Adapter 管理。
缺少显式 call ID 的旧事件只能按位配对，因此并发工具完整性取决于原始 tape 是否提供稳定关联字段。
Usage 和 cost 从 run 事件读取。

Bub 原生 OTLP 可以配置为时间轨，span mapper 只影响瀑布图。

## 预制环境

Bub 没有 provider 官方 template；NiceEval 用固定版本配方（锁定 Bub 版本与 OTel 插件 commit）构建公共模板 `correctroads-default-team/niceeval-bub` 与公共镜像 `niceeval/bub`，并在环境里写安装规格 marker。

Adapter 的 ensure 只接受 identity marker 完全匹配的预装环境，不把 PATH 上任意一个 `bub` 当成兼容版本。

`version`、`otelPlugin` 与 `pythonPlugins` 集合都参与 identity（factory 与 Installer 共用规范化代码，顺序、空白、重复项不制造假差异）；任一不同就由匹配的新 Installer 完整安装并复检。

构建带自有插件的模板见 [Sandbox · 预制环境](../../../sandbox/library/prebuilt-environments.md)。
