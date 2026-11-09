# 删除已裁定移除的 Docker Profile 与 dockerAccess 遗留实现

## 观察

2026-11-08 整理 Feature 时确认：[Nested Docker 迁移边界](../feature/sandbox-nested-docker/README.md#docker-profile-migration)要求删除 `dockerAccess.mode: "socket" | "dind"` 的 nested-execution 路径、raw privileged / managed rootless bootstrap、Docker storage profile、fixed slot / seed、activation / watchdog、loop attach 与 raw copy，说明这些写法不属于支持目标。

源码仍完整保留这条路径，并通过公开入口暴露：

- `dockerSandbox()` 仍接受 `dockerAccess`，按 socket、raw DinD 与 managed DinD 分支构造 runtime binding（`packages/niceeval/src/sandbox/layer.ts`）。
- `niceeval docker profile list` 与 `niceeval docker profile doctor <alias>` 仍注册在 CLI（`packages/niceeval/src/docker/cli/contribution.ts`）。
- `packages/niceeval/src/sandbox/docker-profile/` 约 3200 行实现 profile registry、schema、watchdog 控制请求与 Before cache 资格。
- `e2e/lifecycle/test/docker-profile-cold-build.test.ts` 与 `e2e/lifecycle/fixtures/profile-host-fixture.py` 仍以 profile 路径作为验收场景。

这些代码原来的 `@concord-implements` 标注指向已删除的 `docs/feature/sandbox-docker-profiles/`，本次整理已摘除，因此它们不再关联任何现行契约。

## 期望与影响

期望按裁决删除上述实现、CLI 子命令与 E2E 场景。`dockerSandbox()` 收到 `dockerAccess` 时按 Library 的[非法组合](../feature/sandbox-nested-docker/library.md#非法组合)具名拒绝，不再构造旧 binding。

当前影响：作者仍能写出文档声明不支持的配置并得到可运行结果，与"不能降为 fallback"的契约冲突。遗留实现也继续占用测试与维护成本。

## 复现入口与身份

- `niceeval docker profile --help` 仍列出 `list` 与 `doctor`。
- 在 Experiment 中写 `dockerSandbox({ source: { type: "image", image: "..." }, dockerAccess: { mode: "socket", socketPath: "/var/run/docker.sock" } })`，不会在配置阶段被拒绝。

NiceEval checkout HEAD：`9b5f1af70`。Provenance：维护者整理 Feature 边界时的源码与契约比对，无运行凭证或私有资料。

建议标签：`enhancement`、`area:sandbox`、`needs-triage`。已搜 open/closed 的 `docker profile` 与 `dockerAccess`，未发现同一观察。这里只保存本地 draft，不发布远端 Issue。
