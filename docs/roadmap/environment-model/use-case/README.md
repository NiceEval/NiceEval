# 环境层用例手册

规则难懂的地方来这里按场景查。
契约单源始终在 [README](../README.md) 与 [Library](../library.md),用例只做搭配与叙事,不复制定义。

- [记忆对照:mempal 装成 experiment 层](memory-condition-layer.md) —— agent 侧环境重的项目怎样甩掉派生 template 与 flags 背身份。
- [每题自带环境](per-task-environment.md) —— terminal-bench 形态:eval 声明 Compose 底座,agent 层现场装。
- [断网题装实验工具](offline-task-staged-layer.md) —— 两头都重的死角:每题底座 × 每实验工具,`prepare` 走 staged 送入。
- [把热路径烘进产物](bake-hot-layers.md) —— 逐层计时说话之后造缓存产物,声明一行不动。

## 选择速查

| 你的项目 | 底座 | 层 | 用例 |
| --- | --- | --- | --- |
| 所有题同一种环境,比 agent / 记忆机制 | spec 默认产物 | agent 层(adapter 自带)+ experiment 层 | [记忆对照](memory-condition-layer.md) |
| 每题自带环境 | eval folder-local source / profile | agent 层 | [每题自带环境](per-task-environment.md) |
| 每题环境 + 每实验的工具 | eval 声明 | agent 层 + experiment 层(`requires` 协商) | [断网题装实验工具](offline-task-staged-layer.md) |
| 任一形态跑热了 | 烘常用层进新产物,在代际边界切换 | 声明不动,退为漂移防护 | [烘进产物](bake-hot-layers.md) |
