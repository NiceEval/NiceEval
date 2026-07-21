# `--reuse-sandbox`:本地冒烟一批 eval,N 次冷启动折成一次

## 解决什么问题

改了公共 prompt、adapter 配置或共享夹具,想在本地把整组 eval 快速过一遍,看有没有明显挂。默认模式每个 attempt 一套全新沙箱:12 道题就是 12 次「起容器 + slim 镜像补系统依赖 + `npm install` + 装 agent CLI」。这批题共享同一套安装,重复付 12 次冷启动,总耗时被准备工作主导,真正跑题的时间只占零头。

## 全流程

1. 用 eval 前缀收窄选题,带上 flag:

   ```bash
   niceeval exp memory/commit0 onboarding --reuse-sandbox
   ```

2. PLAN 与启动反馈如实标注模式(契约见[串行复用 · 入口](../serial-reuse.md#入口短暂的-cli-flag---reuse-sandbox不是-experiment-配置)):复用一个沙箱、并发钉成 1、结果不进缓存与 CI。期望形态:

   ```text
   reuse mode: one hot sandbox, serial (concurrency pinned to 1)
   workdir-only reset between evals — $HOME / global installs persist; results excluded from cache
   ```

3. 第一题开跑前付**唯一一次**安装:`createSandbox` → `sandbox.setup` 链 → `SandboxAgent.setup`,落成温基线。
4. 之后每题只重放自己的 `EvalDef.setup` / `test(t)` 夹具;题与题之间 runner 把 workdir `git reset --hard` 回温基线再 `git clean`(尊重分类账排除清单,`node_modules` 这类目录不动),下一题近乎立即开跑。
5. 结束反馈照常给判定汇总与 FAILED / NEXT;这些 attempt 落盘时带 `reuse` 标记,`show` / `view` 照常可查。

## 边界

- **结果只当冒烟信号。** 上一题写进 `$HOME`、全局安装或后台进程的东西会留给下一题;「串起来挂、单独跑过」出现时,用默认模式重跑那一题确认。
- **与缓存双向绝缘。** 复用 attempt 永不被后续 run 的指纹跳过采信;本次也不消费携带,整批每一题都真实过一遍热道。要留一份可采信的通过记录,去掉 flag 再跑。
- **挂了想留现场?** `--keep-sandbox` 与 `--reuse-sandbox` 互斥(创建前报错)——换默认模式对那一题单独 `--keep-sandbox` 重跑,流程见 [keep-sandbox 用例](keep-sandbox-env-errored.md)。

## 相关阅读

- [串行复用](../serial-reuse.md) —— 温基线分层、诚实边界、与缓存/留存的组合。
- [CLI](../cli.md) —— `--keep-sandbox` 与 `sandbox` 命令组。
