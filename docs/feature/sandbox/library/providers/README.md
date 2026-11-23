# Sandbox Provider

这里按 Provider 拆分接入说明。每页只记该 Provider 特有的 factory 选项、宿主凭据、起点要求、预制实例构建、Before cache 边界与原生 CLI 现场接入；所有 Provider 共用的写法见 [Library](../README.md)，统一接口见 [Sandbox](../../README.md#provider-统一接口)，内部实现见各页链接的架构页。

## 索引

| Provider | factory | 定位 |
|---|---|---|
| [Docker](docker/README.md) | `dockerSandbox`、`dockerComposeSandbox` | 本地，零云依赖；image / Dockerfile 单容器与原生 Compose case |
| [Vercel Sandbox](vercel/README.md) | `vercelSandbox` | 云端微 VM，从 Team/Project 内的 snapshot 启动 |
| [Incus](incus/README.md) | `incusSandbox` | 每条 Attempt 一台一次性 VM，Nested Docker 的推荐路径 |
| [E2B](e2b/README.md) | `e2bSandbox` | 云端微 VM，从 template 启动 |
| [OpenSandbox](opensandbox/README.md) | `openSandbox` | 经 OpenSandbox 服务 API 创建远端 Sandbox |
| [Instabox](instabox/README.md) | `instaboxSandbox` | 从固定 snapshot 或模板创建独立 Machine |

跨 Provider 的比较留在各自的通用页：case 集合见 [Case · Provider 能力矩阵](../../architecture/case.md#provider-能力矩阵)，Before cache 能力见 [Before cache · Provider 能力](../../architecture/before-cache.md#provider-能力)，预制实例的构建结果与共享边界见 [预制实例](../prebuilt-environments.md)。

## 再接一个 provider

贡献内置 Provider 或只在自己项目里用 `defineSandbox`，两条路径见 [Architecture · 再接一个 provider](../../architecture/README.md#再接一个-provider)；预制实例义务见 [新 provider 的预制实例义务](../prebuilt-environments.md#新-provider-的预制实例义务)。新增内置 Provider 时在本目录加一页并登记到上表。
