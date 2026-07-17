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

Bub 支持 `skills`、`pythonPlugins` 和安装后按序运行的 `postSetup` 钩子（见 [Adapter · 安装后运行脚本](../../library/coding-agent-extensions.md#安装后运行脚本postsetup)），不接受 Claude/Codex 的 `mcpServers` 或原生 `plugins` 字段。Python package 集合属于安装 checkpoint key，配置变化必须触发重新安装。

行为轨来自 Bub tape JSONL；session 由 Adapter 管理。缺少显式 call ID 的旧事件只能按位配对，因此并发工具完整性取决于原始 tape 是否提供稳定关联字段。Usage 和 cost 从 run 事件读取。

Bub 原生 OTLP 可以配置为时间轨，span mapper 只影响瀑布图。

## 预制环境

Bub 没有 provider 官方 template；NiceEval 用固定版本配方（钉死 Bub 与 OTel 插件 commit）构建公共模板 `correctroads-default-team/niceeval-bub`，并在环境里写安装规格 marker。Adapter 只信任指纹完全匹配的预装环境，不把 PATH 上任意一个 `bub` 当成兼容版本；`pythonPlugins` 集合参与指纹 hash（factory 与 Adapter 共用规范化代码，顺序、空白、重复项不制造假差异），集合不同就回退完整安装。构建带自有插件的模板见 [Sandbox · 预制环境](../../../sandbox/library/prebuilt-environments.md)。
