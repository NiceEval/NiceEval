# Vercel Sandbox

`vercelSandbox()` 从 Vercel Sandbox snapshot 创建云端微 VM。factory 的公共形状见 [Library · 起点参数](../../README.md#起点参数与-lifetimems)，内部实现见 [Vercel Sandbox Provider 架构](../../../architecture/providers/vercel.md)。

## 预制实例

Vercel 没有 template registry,也没有 Dockerfile;snapshot 从一台跑起来的 microVM 拍出来。用 Vercel SDK 从官方 runtime(`node24`)起沙箱、装 Agent CLI、调 `.snapshot()` 拿到 `snap_...`,experiment 再引用这个 ID:

```typescript
// scripts/build-vercel-snapshot.ts
import { Sandbox } from "@vercel/sandbox";

const sandbox = await Sandbox.create({ runtime: "node24" });
await sandbox.runCommand({ cmd: "npm", args: ["install", "-g", "@openai/codex@0.144.1"], sudo: true });
const { snapshotId } = await sandbox.snapshot(); // snap_...
await sandbox.stop();
```

Vercel snapshot 只有 Team/Project 共享,没有 E2B `template publish` 对应的公共发布语义。NiceEval 仓库可登记维护者项目的 snapshot ID 供该项目复用,公共用户仍需在自己的 Vercel Project 运行构建脚本。文档和 API 必须把这个权限差异说出来,不能把"拿到 ID"写成"任何账号可启动"。

## 现场接入与回收

原生 CLI 的分工见 [CLI · 原生 CLI 现场接入与资源管理](../../../cli.md#原生-cli-现场接入与资源管理)。Vercel Sandbox 的留存为 stop 后持久，按 sandbox name 寻址：

- 进入：`sandbox connect <name>`；
- 永久删除：`sandbox remove <name>`；`sandbox stop` 只停驻，不是销毁。
