# 宿主运行条件错误：进现场重跑准备命令排查

## 解决什么问题

在沙箱前置准备（`before` 命令、依赖安装、构建）或 Agent CLI 启动阶段失败时，Attempt 的 Verdict 通常为 `errored`。此时被测 Agent 甚至尚未正式接管执行，缺少对话历史或模型调用链，错误通常仅表现为非零退出码或进程启动失败。

要准确定位沙箱准备为何失败，最有效的方式是在失败时保留现场，并通过底层 Provider 的原生命令在容器中手动重跑那条失败的准备指令，查看原生的标准错误输出。

## 全流程

1. 启动评测并指定失败时暂停或保留现场：

   ```bash
   niceeval exp local onboarding/tool-first --pause-on-failure
   ```

2. 发生错误时，NiceEval 阻断自动销毁流程，终端显示原生调试指引：

   ```text
   ⏸ Attempt paused on failure. Sandbox retained for debugging.
     ➜ Debug natively: docker exec -it a3f9c2d1 /bin/bash
     ➜ Or execute:      docker exec a3f9c2d1 apt-get update
   Press [Enter] to resume cleanup and exit...
   ```

3. 开发者利用底层原生命令连入沙箱：

   ```bash
   docker exec -it a3f9c2d1 /bin/bash
   ```

4. 在现场中手动执行失败的准备动作，观察最真实的底层报错信息：

   ```bash
   # 手动重跑失败的依赖安装命令
   npm install --frozen-lockfile
   # 或重跑构建
   cargo build
   ```

   通过终端观察原汁原味的报错：是镜像缺少 gcc/make 等编译工具？网络镜像源无法连通？还是 Node.js 版本不兼容？

5. 排查清楚后，在 NiceEval 终端按回车结束挂起并触发销毁。

6. 在 Sandbox 声明或配置中补充缺失的系统依赖：

   ```typescript
   // 在 sandbox layer 中补充系统依赖动作
   .before(command("apt-get", ["install", "-y", "build-essential"], {
     id: "install-build-deps",
     user: "root",
   }))
   ```

7. 重新发起评测，验证准备动作全部顺利通过。

## 边界

- 挂起与留存仅保留现场供人工排障或 Coding Agent 非交互排查，不提供现场续跑或自动修补机制。
- 若使用 `--keep-sandbox` 进行离线排查，排障结束后直接运行 `docker rm -f <sandboxId>` 或 `instabox rm <sandboxId>` 销毁。

## 相关阅读

- [Sandbox CLI](../cli.md) —— 运行期断点与原生命令指引。
- [在现场反复验证假设](sandbox-retain-validate-scene.md) —— 调试定位与假设检验。
