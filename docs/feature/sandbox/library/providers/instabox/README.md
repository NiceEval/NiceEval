# Instabox

`instaboxSandbox()` 用固定 snapshot ID 或模板标识声明一个 template-bearing layer。每条 Attempt 从该起点创建独立 Machine；起点不在运行中构建。内部实现见 [Instabox Provider 架构](../../../architecture/providers/instabox.md)。

```ts
interface InstaboxSandboxOptions {
  readonly snapshotId?: string;
  readonly templateId?: InstaboxTemplateId;
  readonly template?: InstaboxTemplateId;
  readonly lifetimeMs?: number;
  readonly spec?: InstaboxMachineSpec;
  readonly resources?: { readonly vcpus: number; readonly memMiB: number };
  readonly pathPrepend?: readonly string[];
}

instaboxSandbox({ snapshotId: "sn_example", lifetimeMs: 60 * 60 * 1000 });
```

`InstaboxTemplateId` 支持官方模板标识（如 `universal`、`agent-browser`、`android`、`ci`）与自定义模板名称。`snapshotId` 必须是 `sn_` 开头的具体 ID，优先于模板标识。省略时使用 `templateId`，`template` 是别名；两者都提供时以 `templateId` 为准，都省略时使用 `universal`。计划、命令定位与创建请求统一使用 `templateId`。

显式 `lifetimeMs` 是 60 秒至 24 小时的整秒毫秒数，不得短于 Attempt 剩余时限与 30 秒收尾预留；省略时按 [服务端寿命](../../reuse.md#两种时间不能混用)派生。服务端 `deleteAfterSeconds` 提供失联后的回收上界，正常结束和取消仍立即删除 Machine。

`InstaboxMachineSpec` 接受官方标准命名 `instabox-small`、`instabox-medium`、`instabox-large`、`instabox-xlarge`、`instabox-2xlarge`，以及数值别名 `2/4`、`4/8`、`8/16`、`16/32`、`32/64`。`INSTABOX_MACHINE_SPECS` 导出各规格的 `vcpus` 与 `memMiB`，内存按 1024 MiB/GiB 换算。显式 `resources` 优先于 `spec`；都省略时使用 `instabox-medium`，即 4 vCPU、8192 MiB。计划保留配置求值后的资源与显式传入的 `spec`；无效规格在配置校验时报错。显式资源仍由账户配额校验。

宿主设置 `INSTABOX_API_KEY`，并安装可选依赖 `ssh2@1.17.0`。服务地址固定为 `https://api.instabox.sh`。Key 与临时 SSH token 只保存在运行时内存，不进入公开配置、身份、命令事实或 Sandbox。创建关闭 Vault 与 Org Secrets 自动注入。

Snapshot 必须提供 Linux x64 GNU 系统、Bash、Git、Node.js 22 或更新版本，以及允许免密 sudo 的非 root 登录用户。工作目录为 `/data/home/workspace`，文件和命令默认使用 snapshot 的登录身份；单条命令只额外支持 `user: "root"`。`pathPrepend` 按声明顺序作用于所有受管命令。平台和工具在 Machine ready 后检查，失败立即回收。

该 Provider 的实例仅属于一条 Attempt。不支持留存、复用或 Nested Docker requirement。声明式 before 前缀在派发前由 Run 准备一次并保存为 NiceEval 拥有的 snapshot，每个 Attempt 从它创建独立 Machine；snapshot 保存磁盘，不保存进程、内存或 tmpfs。规则见[远端 snapshot Before cache](../../../architecture/providers/instabox.md#远端-snapshot-driver)。`otlpHost` 为 `null`，Runner 在 Sandbox 内启动 receiver。命令不受 HTTP exec 的 600 秒限制。超时或取消先精确终止该命令的进程组，确认后拒绝返回，Machine 与其它进程继续可用；不能确认终止时才退休整台 Machine，并在确认删除后拒绝返回，规则见[命令 timeout 与取消](../../operations.md#命令-timeout-与取消)。

Snapshot 由项目的 Instabox 原生构建脚本管理，必须等到 `ready` 才写入配置。它保存系统文件和 `/data`，不保存进程；基础 snapshot 不应含 Agent 登录凭据。起点属于其 org，不能假定跨账户可见。OCI 导入会叠加 Instabox 系统文件，生成的 snapshot 与原 Docker image 是不同 Sandbox 起点。

公共入口、隔离文件读写、原生 argv、流式输出、双向 stdin、取消后的资源终态与 snapshot 保留共同组成验收路径。真实服务未验证的能力不能由模拟通过替代。

## 现场接入与回收

原生 CLI 的分工见 [CLI · 原生 CLI 现场接入与资源管理](../../../cli.md#原生-cli-现场接入与资源管理)。Instabox 现场使用以下命令：

- 开发者交互调试：`instabox ssh <sandboxId>`；
- Coding Agent 非交互排查：`instabox exec <sandboxId> -- <command>`；
- 查看实例列表与状态：`instabox list`；
- 销毁特定实例：`instabox rm <sandboxId>`；
- 暂停或恢复实例：`instabox pause <sandboxId>` / `instabox resume <sandboxId>`。
