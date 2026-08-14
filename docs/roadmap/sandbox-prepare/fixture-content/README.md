# Fixture 内容命令

## 用户需要

把一份本地 fixture 文件或目录放进每个 Attempt 的 Sandbox，底层写法由三项原语组成：

- `registerSandboxContent()` 取得内容 digest；
- `defineSandboxCommand()` 声明稳定 identity；
- `sandbox.putContent()` 执行原子传输。

常见场景可以使用一条 identity-aware 短写：

```ts
const starter = putFixture({
  id: "starter-repo",
  revision: "1",
  source: new URL("./fixtures/starter/", import.meta.url),
  target: "/app",
});

export default defineEval({
  sandbox: sandboxLayer().prepare(starter),
  async test(t) {
    await t.send("完成 /app 中的任务。");
  },
});
```

## 只是 command 糖

`putFixture()` 返回普通 `StableSandboxCommand`。
它不增加 `fixture:` 字段、Fixture owner、setup hook、执行频次或新的上传协议。

命令仍在所属 Eval / Experiment layer 的 `prepare()` 位置逐 Attempt 执行。
template owner、命令顺序、错误归属、reset 与 Sandbox reuse 都完全沿用 Sandbox Layer。

## Identity

内容 digest、target、`id` 与 `revision` 进入 command identity。
本地内容变化会使旧 Attempt 不能携带，即使作者忘记提高 revision。

`revision` 表示 wrapper 周围仍可能存在的作者语义版本。
只改内容不必提高它；改变目标布局约定或下游解释方式时必须提高。

## 研究取舍

外部框架的 fixture 并不是同一层原语。
[Eve](../../../research/assertion-api-dx/eve.md) 的 `mockModel` 替换外部 model 边界，[Pydantic Evals](../../../research/assertion-api-dx/pydantic-evals.md) 的 `setup` / `teardown` 属于 experiment lifecycle；它们都不等于把本地目录放进每个 Sandbox。

`putFixture()` 因而不照搬某家的 fixture owner。
它只压缩 NiceEval 已有的 content registration、stable command identity 与 `putContent()` 三步，既缩短调用点，又不扩张 lifecycle。

## 不做什么

- 不接受 `fixture: { files, setup }` 这类混合配置。
- 不把直接执行的 shell setup 变成隐式 lifecycle。
- 不负责隐藏判据；Agent 不应看见的材料继续走 criteria/private 边界。
- 不执行网络下载、template build 或跨 Sandbox cache。
- 不替代 `checkout()`；远端仓库与镜像缓存继续由内置 checkout 命令负责。

## 入口

- [Library](library.md) —— 签名、示例与展开语义。
- [Architecture](architecture.md) —— planning、identity、错误与安全边界。
