# 升级后刷新项目指引

## 用户目标

NiceEval 发了新版本。用户想让 agent 完成升级，并保证之后 agent 读到的是新版本的文档和写法。

## 起始状态

仓库已经接入旧版本的 NiceEval，项目指引由旧版本的 `niceeval init` 写入。
本篇是预期用法，输出均为预期结果。

## 完整路径

1. 用户让 agent 升级。 {#ask}

   ```text
   把 niceeval 升到最新稳定版，该改的地方一起改掉。
   ```

2. agent 升级依赖并刷新项目指引。 {#refresh}

   ```sh
   pnpm up niceeval
   pnpm exec niceeval init
   ```

   预期结果：锁文件指向新版本。`init` 只替换自己标记之间的内容与自己拥有的 skill 文件，
   用户写在标记之外的内容、已有的配置和评估文件保持不变。

3. agent 读新版本的升级页。 {#read}

   预期结果：agent 重新读取 `node_modules/niceeval/INDEX.md`，在教程分区找到对应版本的升级页并照做。
   它不沿用上一个对话里记住的旧写法。

4. agent 核对选择与计划。 {#verify}

   ```sh
   pnpm exec niceeval list
   pnpm exec niceeval exp <experiment> --dry
   ```

   预期结果：评估照常被发现。`--dry` 逐条说明旧结果可以沿用，还是因为升级需要重跑及其原因。
   需要付费重跑时，agent 先把范围和原因告诉用户。

## 结果

`node_modules/niceeval/INDEX.md` 的路径没有变，所以即使忘了刷新，旧的项目指引仍然指向新版本的文档。
刷新只更新指引的措辞与 skill 的内容。

| 情形 | 用户看到的结果与下一步 |
|---|---|
| 升级后类型检查或发现报错 | agent 按升级页逐项迁移，不回退版本来绕过 |
| `--dry` 显示全部需要重跑 | agent 报告原因与预计规模，由用户决定是否重跑 |
| 项目指引的标记被手工改坏 | `init` 报告无法定位标记并说明怎样恢复，不猜测边界 |

## 相关契约

- [Format](../format.md#项目指引)：标记、替换范围与校验。
- [Experiments · Cache](../../experiments/architecture/cache.md)：升级后哪些结果可以沿用。
