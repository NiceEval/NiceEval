# `--pause-on-failure`：发生异常时挂起现场，通过原生 CLI 直连排查

## 解决什么问题

评测运行失败或前置动作异常时，默认流程会立刻执行 teardown 销毁沙箱实例，排查者来不及检查现场。
自建中间层伪终端代理往往存在终端控制符冲突与信号转发缺陷；Coding Agent 遇到交互式 shell 也会挂起阻塞。
通过 `--pause-on-failure` 或 `--breakpoint=before-agent`，NiceEval 暂停当前 Attempt 的自动销毁，并交付对应 Provider 的原生命令指引。

## 全流程

1. 启动评测并指定失败挂起选项：

   ```bash
   niceeval exp install/canary install/db-gpt --pause-on-failure
   ```

2. 出现异常或断点触发时，Attempt 暂停收尾并在终端输出原生调试命令：

   ```text
   ⏸ Attempt paused on failure. Sandbox retained for debugging.
     ➜ Debug natively: instabox ssh niceeval-97511d9a
     ➜ Or execute:      instabox exec niceeval-97511d9a -- ps aux
   Press [Enter] to resume cleanup and exit...
   ```

3. 接入现场排查：

   - 开发者直接另起终端界面，粘贴原生命令（如 `instabox ssh niceeval-97511d9a` 或 `docker exec -it <container> bash`）进入交互式 shell。
   - Coding Agent 则使用非交互式命令（如 `instabox exec niceeval-97511d9a -- cat /tmp/error.log`）单次读取输出并排查，避免交互式挂起。

4. 排查完毕后，在 NiceEval 运行终端按下回车键，框架恢复生命周期并完成沙箱的正常销毁与资源回收。

## 边界

- NiceEval 不自建中间层终端转发服务，保持 core 中立与稳定性。
- 沙箱保留底层 Provider 的超时 TTL 保护，避免长期闲置造成资损。

## 相关阅读

- [Sandbox CLI](../cli.md) —— 失败挂起与断点机制。
- [`--keep-sandbox`](sandbox-retain-run-condition-error.md) —— 事后留存与注册表管理。
