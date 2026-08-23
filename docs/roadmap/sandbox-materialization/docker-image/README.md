# Docker Image

## 唯一公共入口

Docker 的单容器 template 只暴露 `dockerImage()`，不再提供 `dockerImageSandbox()` 或 `dockerfileSandbox()`。输入是判别联合：

```ts
interface DockerPublishedImage {
  readonly image: string;
  readonly platform?: string;
  readonly lifetimeMs?: number;
}

interface DockerBuildImage {
  readonly context: string | URL;
  readonly dockerfile?: string;
  readonly buildArgs?: Readonly<Record<string, string>>;
  readonly target?: string;
  readonly platform?: string;
  readonly lifetimeMs?: number;
}

declare function dockerImage(
  options: DockerPublishedImage | DockerBuildImage,
): SandboxLayer<"template-bearing">;
```

`image` 与 `context` 恰好出现一个。`context` 的相对 string 以声明文件所在 package 的模块位置完成路径 resolution。可发布库应导出由 `new URL("./docker/", import.meta.url)` 定位的 URL，避免把消费项目 cwd 当路径基准。`dockerfile` 相对 context，默认是 `Dockerfile`。

`lifetimeMs` 属于 Sandbox 实例计划，不进入镜像 BuildKey。其它 Docker 运行字段继续由 Sandbox contract 拥有；Plugin 不得通过 build contribution 暗改它们。

## 构建、BuildKey 与 cache

build 分支在 physical Sandbox 创建前求出 BuildKey。它至少包含：

- Dockerfile 内容与 image builder revision；
- `.dockerignore` 过滤后的 context 路径、类型、权限与内容；
- 规范化 build args、target 与目标 platform；
- 经过 identity 查找的基础镜像稳定值。

绝对 context 安装路径不进入 BuildKey 或 Record。manifest 保存内容摘要、相对 Dockerfile、规范化选项、目标 platform、builder revision 与最终 locator。

同一 Run、同一 cache domain、同一 BuildKey 使用 single-flight：第一个请求查询 cache，miss 时构建并发布，其它请求等待后复用。后续 Run 只有在同一 domain 仍有精确命中时才复用。cache 被回收、Docker daemon / provider domain 改变、基础镜像稳定 identity 变化或 entry 无法验证时重新构建。

因此产品承诺是“首次 miss 构建，后续精确命中复用”，不是“永远只构建一次”。库存、lease、归因与安全回收继续由 [Provider Cache 生命周期](../cache-lifecycle/README.md)拥有。

## Remem package 示例

```ts
// @memorybench/remem-niceeval
export const REMEM_DOCKER_CONTEXT = new URL("./docker/", import.meta.url);
```

package 的发布文件清单必须包含 `docker/remem.Dockerfile` 及其 context 文件。消费方显式选择 template：

```ts
sandbox: dockerImage({
  context: REMEM_DOCKER_CONTEXT,
  dockerfile: "remem.Dockerfile",
  lifetimeMs: 5 * 60 * 60_000,
})
```

这取代预制 `REMEM_DOCKER_IMAGE` 常量和独立的手工预构建脚本，但不把 Dockerfile 变成 Plugin contribution。
