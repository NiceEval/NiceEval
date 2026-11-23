# OpenSandbox

`openSandbox()` 通过 OpenSandbox 服务 API 创建远端 Sandbox。内部实现见 [OpenSandbox Provider 架构](../../../architecture/providers/opensandbox.md)。

服务与 execd 使用配套的 `release-1.1.1`，SDK 使用 `1.1.1`。旧 `execd:v1.1.0` 不支持本 Provider 所需的原生 argv。

安装可选依赖 `@alibaba-group/opensandbox`，并在运行 NiceEval 的宿主配置 `OPEN_SANDBOX_DOMAIN` 与 `OPEN_SANDBOX_API_KEY`。地址使用完整 HTTPS URL；本机开发可显式使用 HTTP。凭据不注入被测 Sandbox。底层 runtime 由 OpenSandbox 服务端选择；NiceEval 不要求声明。入口只对可信宿主开放，或为 HTTP/WebSocket 的全部路径提供前置鉴权。上游 Docker proxy 不受控制 API key 保护，不能直接暴露到公网。

```typescript
import { openSandbox } from "niceeval/sandbox";

const sandbox = openSandbox({
  lifetimeMs: 60 * 60 * 1000,
  image: "node:24-bookworm",
  targetPlatform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" },
  resources: { cpu: "1", memory: "2Gi" },
});
```

`OpenSandboxOptions` 接受必填 `image: string` 与 Linux `targetPlatform`，可选的有限 `lifetimeMs: number`，以及可选 `resources: { cpu?: string; memory?: string }`、`user: string`、`pathPrepend: readonly string[]`。正式实验使用 digest-pinned 镜像。工作目录为 `/home/sandbox/workspace`；默认以 execd 的 root 用户运行，`user` 接受 `/etc/passwd` 中的用户名或数字 uid，单条命令可另选身份。

显式 lifetimeMs 是作者选择的实例寿命，由服务校验，不能短于有界 Attempt 的剩余时限加 30 秒收尾预留。正常结束和取消均提前销毁，不等待寿命耗尽。命令超时或取消会销毁整个 Sandbox。保留与 Sandbox 复用不受支持。digest-pinned 镜像可使用 rootfs before cache，服务须配置公开 Snapshot API 与持久镜像存储。普通容器不提供专用 kernel 或内部 Docker daemon，不能满足 Nested Docker requirement。

rootfs 缓存在派发前由 Run 准备一次，同一批 Attempt 都从同一份 snapshot 启动；它不保存进程、卷或 tmpfs。准备时发现新增挂载或已知敏感字节，不发布缓存，Attempt 照常执行剩余 before。运行中的服务应在 command barrier 后启动；Docker 镜像可先导出为 rootfs 内归档，再在恢复后导入独立 daemon。`sandboxCache.before` 与 CLI bypass 同时控制 lookup 和 publication。快照请求发出后失败会让依赖该前缀的配对在派发前失败，不重复已执行的 action。完整规则见[远端 snapshot Before cache](../../../architecture/providers/opensandbox.md#远端-snapshot-driver)。

镜像必须以 root 启动 execd，并提供 Bash 和 Git。`user` 控制命令与 Agent 的身份，HOME、USER、LOGNAME 从该用户的 `/etc/passwd` entry 取得；调用方可显式替换这些变量。

`codexAgent` 与 `claudeCodeAgent` 使用双向受管进程；镜像必须提供 Node.js 22 或更新版本。服务接入验收必须证明销毁成功响应代表实例及其进程已经终止；仅受理异步删除不能作为回收确认。该要求按服务行为验证，不按 runtime 名称判断。
