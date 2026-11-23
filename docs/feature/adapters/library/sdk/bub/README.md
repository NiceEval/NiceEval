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

Bub 支持 `skills`、`pythonPlugins` 和安装后按序运行的 `before` Hook（见 [Adapter · 安装后运行脚本](../../coding-agent-extensions.md#安装后运行脚本postsetup)），不接受 Claude/Codex 的 `mcpServers` 或原生 `plugins` 字段。
Python package 集合属于安装 checkpoint key，配置变化必须触发重新安装。
Bub 原生扫描 Sandbox 内的 `.agents/skills/`。Skill 的 frontmatter 要有 `name` 和 `description`，且 `name` 要与目录名一致。

## 装哪一版 Bub

Bub 从 PyPI 安装 `bub[app]==0.6.1`。`version` 可以省略或填写 `"0.6.1"`。其它值在定义期抛出 `TypeError`，错误指向支持版本。

```ts
bubAgent()
bubAgent({ version: "0.6.1" })
```

默认安装同时固定 `republic==0.6.0` 与 `httpx2==2.16.0`，避免相同 Bub 版本因安装日期不同而改变模型请求协议。
Adapter 通过 Republic 的 `api_format=chat` 向 OpenAI 兼容端点发送 Chat Completions 请求。
`otelPlugin` 必须支持 Bub 0.6.1 的 tape 协议，并与 Python 插件集合共同参与安装身份。
Adapter 用 override 固定 Bub 及模型客户端依赖，避免插件的 Git 依赖改变被测版本。

行为轨读取固定版本的 `kind` 与 `payload` tape JSONL。Adapter 管理 session。
工具调用从 `tool_call.calls` 读取 `id`、`name` 与 `arguments`，工具结果与前一批调用按位配对。用量从 `event/run` 读取。
未知事件不进入 `Turn.events`；Adapter 在 Attempt 收尾时追加一条 `agent-event-unrecognized` warning，汇总类型与次数。
同一 session 的每个 Turn 读取本轮新增的 tape，多个 session 的未知事件在同一 Attempt 汇总。`show @locator` 可查看该诊断。
未知事件使该轮事件和动作证据标为 partial，不把未识别轨迹作为完整负断言依据。

Bub 和 OTel 插件经 OTLP 生成时间轨。插件基于 tape 导出 `bub.agent.step` 等 span。

## 上下文长度与 handoff

上下文选择与压缩属于被测 Bub 的行为。Adapter 保持所选版本的原生策略，不在每次 `send` 前另行截断历史。Bub 的 handoff 不保证任意输入都能缩到模型允许的长度内。

`BUB_MAX_TOKENS` 限制输出 token，不是输入长度或压缩阈值。排查溢出时，应同时核对 Bub 版本、模型的上下文长度限制、代理返回的错误文本和 tape 中的 handoff；单次重跑成功不能证明压缩问题已解决。Adapter 仍负责正确传递模型与端点，并保留失败和可用的 tape 证据。

## Prebuilt environment

Bub 没有 provider 官方 template。
NiceEval 用固定版本配方（锁定 Bub 版本与 OTel 插件 commit）构建公共模板 `correctroads-default-team/niceeval-bub` 与公共镜像 `niceeval/bub`。
并在 Sandbox 里写安装规格 marker。

Adapter 的 install 只接受 identity marker 完全匹配的预装 Sandbox，不把 PATH 上任意一个 `bub` 当成兼容版本。

`version`、默认模型客户端依赖、`otelPlugin` 与 `pythonPlugins` 集合都参与身份计算。Factory 与 Installer 共同规范化插件列表中的顺序、空白和重复项。
身份不匹配时，Adapter 在 Sandbox 内安装并复检。

构建带自有插件的模板见 [Sandbox · Prebuilt environment](../../../../sandbox/library/prebuilt-environments.md)。
