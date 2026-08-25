# Docker 执行配置 —— CLI

`niceeval docker profile list|doctor|exec` 不是 adopted nested-Docker 诊断入口。

adopted doctor 是 [Nested Docker CLI](../nested-docker/cli.md) 的
`niceeval sandbox provider doctor incus`。
它默认检查 reference；`--development` 分开检查 `/data/niceeval-sandbox-dev`。

旧 profile doctor 不能证明 `dedicated-kernel/v1`，也不能用 development 或 raw/managed 绿灯代替 Incus reference。

## 运行

运行 nested Docker 时，Experiment 选择 `incusSandbox()`。
profile 别名、`storageProfile` 与 `niceeval docker profile exec` 不进入这条路径。

## Profile发现

`niceeval docker profile list` 属于待移除的实现缺口。
它不能作为 nested Docker 的容量或 isolation receipt。

## Doctor

`niceeval docker profile doctor` 不是 `niceeval sandbox provider doctor incus`。
reference 失败时，旧 profile doctor 通过不能遮住该失败。

## 不提供任意命令代理

`niceeval docker profile exec` 不是公开 nested Docker 命令面。
NiceEval 不在日常 CLI 里 sudo、mount、loop 或对宿主执行任意 Docker 管理命令。
