# `--keep-sandbox`:把分钟级复现压到秒级,在现场反复验证假设

## 解决什么问题

一条 eval 稳定挂,你有三四个候选假设(镜像少依赖?agent 配置没生效?fixture 路径不对?)。默认模式下验证每个假设都要重跑一轮——冷启动 + 安装每轮几分钟,四个假设就是十几分钟的等待。留住失败现场后,验证一个假设 = 在现场里跑一条命令,循环压到秒级([动机](../cli.md))。

## 全流程

1. 失败重跑一次,留下现场。上一轮的 `failed` 终态不会被缓存携带吃掉——留存档内不参与携带,这一条必然真实重跑([契约](../cli.md)):

   ```bash
   niceeval exp local onboarding/tool-first --keep-sandbox
   ```

2. 先读落盘证据缩小假设空间——`niceeval show @1x7f3q9k` 看断言、diff 与事件流,判断挂在哪一段。
3. 进现场,逐个假设试:

   ```bash
   niceeval sandbox enter a3f9c2d1
   # 假设 1:依赖缺失? → 手跑构建命令看报错
   # 假设 2:agent 配置没生效? → cat 配置文件核对
   # 假设 3:fixture 路径不对? → ls 对照 eval 里写的路径
   ```

4. 每次退出 shell 现场自动回休眠,想到新假设再 `enter`,现场保持原样;需要挂着长命令观察时用 `--leave-running` 让它保持运行。
5. 假设坐实后改 eval / spec / adapter,**用默认模式**重跑验证修法(全新沙箱才证明修法不依赖现场里手动改过的状态),绿了再清理:

   ```bash
   niceeval sandbox stop a3f9c2d1
   ```

## 边界

- 现场是只读参考不是续跑点:留存沙箱没有续跑 / 重评语义,`enter` 只恢复现场供人看。
- 在现场手动改过环境后,现场就不再忠实于原 attempt——结论要靠干净重跑坐实。
- 别人(或另一个终端)`enter` 持有 lease 期间,`stop` 会拒绝并报出 holder,不会销毁开着 shell 的现场。

## 相关阅读

- [CLI](../cli.md) —— `enter` 的唤醒/回眠语义、条目级 lease。
- [与 artifact 的分工](../cli.md#与-artifact-的分工) —— 什么问题看落盘、什么问题进现场。
