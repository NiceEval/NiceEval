# `--pause-on-failure`：发生异常时挂起现场，通过原生 CLI 直连排查

## 解决什么问题

评测运行失败或前置动作异常时，默认流程会立刻执行 teardown 销毁沙箱实例，排查者来不及检查现场。
自建中间层伪终端代理往往存在终端控制符冲突与信号转发缺陷；Coding Agent 遇到交互式 shell 也会挂起阻塞。
通过 `--pause-on-failure` 或 `--breakpoint=before-agent`，NiceEval 暂停当前 Attempt 的自动销毁，并交付对应 Provider 的原生命令指引。

## 全流程

1. 在项目配置中开启本地开发默认失败挂起，或在命令行临时指定选项：

   ```ts title="niceeval.config.ts"
   import { defineConfig } from "niceeval";

   export default defineConfig({
     // 本地开发默认挂起现场便于排查，CI 流水线自动禁用
     pauseOnFailure: !process.env.CI,
   });
   ```

   或者在单次执行时通过命令行显式指定：

   ```bash
   niceeval exp install/canary install/db-gpt --pause-on-failure
   # 或显式关闭挂起行为：
   niceeval exp install/canary install/db-gpt --no-pause
   ```

2. 出现异常或断点触发时，Attempt 暂停销毁并在终端输出原生调试命令：

   ```text
   ⏸ Attempt paused on failure. Sandbox retained for debugging.
     ➜ Debug natively: instabox ssh niceeval-97511d9a
     ➜ Or execute:      instabox exec niceeval-97511d9a -- ps aux
   Press [Enter] to resume cleanup and exit...
   ```

3. 接入现场排查：

   - 开发者直接另起终端界面，粘贴原生命令（如 `instabox ssh niceeval-97511d9a` 或 `docker exec -it <container> bash`）进入交互式 shell。
   - Coding Agent 则使用非交互式命令（如 `instabox exec niceeval-97511d9a -- cat /tmp/error.log`）单次读取输出并排查，避免交互式挂起。

4. 恢复生命周期或非阻塞收尾：

   - 单任务交互终端下（TTY 且单并发），排查完毕后在运行终端按下回车键，框架恢复生命周期并完成沙箱销毁。
   - 并发执行（并发上限大于 1）或非 TTY（Agent、CI 与自动化管道）运行条件下，框架自动退化为非阻塞现场保留。Attempt 输出现场直连指引后立即完成判定收录并释放并发许可，主 Runner 继续并发推进其它计划 Attempt，不阻塞标准输入。

## 边界

- 挂起是 Attempt 隔离的现场状态，不卡住 Runner 主进程调度，也不阻塞并发队列中其它评测项。
- NiceEval 不自建中间层终端转发服务，保持 core 中立与稳定性。
- 沙箱保留底层 Provider 的超时 TTL 保护与空闲休眠机制，避免长期闲置造成资损。

## 相关阅读

- [Sandbox CLI](../cli.md) —— 失败挂起与断点机制。
- [`--keep-sandbox`](sandbox-retain-run-condition-error.md) —— 事后留存与注册表管理。
