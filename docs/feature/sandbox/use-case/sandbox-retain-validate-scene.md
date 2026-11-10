# 在现场反复验证假设：利用挂起与原生 CLI 排查

## 解决什么问题

一条 eval 稳定失败，开发者通常有三四个候选假设（镜像缺少底层依赖？Agent 配置文件没生效？Fixture 文件路径不匹配？）。
如果每次验证假设都需要重新跑一整轮评测，冷启动与依赖安装每次耗时数分钟，排查成本极高。
通过挂起生命周期或留存现场，结合底层的原生 CLI（Docker 或 Instabox），验证假设可以直接在活现场中敲命令，将排查循环压缩至秒级。

## 全流程

1. 启动评测并指定在失败时暂停现场：

   ```bash
   niceeval exp local onboarding/tool-first --pause-on-failure
   ```

2. 发生失败时，NiceEval 阻断自动销毁，终端与事件流直接打印底层 Provider 的原生直连命令并进入等待：

   ```text
   ⏸ Attempt paused on failure. Sandbox retained for debugging.
     ➜ Debug natively: docker exec -it a3f9c2d1 /bin/bash
     ➜ Or execute:      docker exec a3f9c2d1 ls -la /workspace
   Press [Enter] to resume cleanup and exit...
   ```

3. 开发者另起终端（或 Coding Agent 通过工具单次执行），使用成熟的原生 CLI 直连现场排查：

   ```bash
   # 交互式排查（人类开发者）
   docker exec -it a3f9c2d1 /bin/bash

   # 在容器内部快速验证各项假设：
   # 假设 1: 缺少系统依赖？ → 手动执行构建命令，观察原样报错
   # 假设 2: Agent 配置未生效？ → cat ~/.config/agent.json 核对
   # 假设 3: 评测 Fixture 路径不对？ → ls -la /workspace 对照路径
   ```

   如果是云端 Instabox 沙箱，直接使用 `instabox ssh niceeval-97511d9a` 连入排查。

4. 验证坐实原因后，修改 Eval、Adapter 或 Sandbox Layer 声明，切回 NiceEval 终端按回车释放沙箱。

5. 使用干净沙箱实例重新运行验证修复（干净沙箱才能证明修复不依赖调试期在现场手动修改过的临时状态）。

## 边界

- 现场仅作为排查调试依据，不具备断点续跑或就地重判语义。
- 在沙箱中手动执行的变更属于调试探测，不会自动同步回项目代码或影响已落盘的运行事实。
- 调试结束确认后回车即触发正常受管回收；若使用 `--keep-sandbox` 事后排查，使用底层原生的 `docker rm -f <id>` 或 `instabox rm <id>` 进行销毁。

## 相关阅读

- [Sandbox CLI](../cli.md) —— 运行期断点与原生命令指引。
- [失败挂起与原生直连排查](sandbox-pause-on-failure-debug.md) —— `--pause-on-failure` 用例。
