# dockerSandbox 默认镜像没有 python3，ponytail-csv-sum 永远跑不过

## 现象

`examples/zh/coding-agent-skill` 的 `ponytail-csv-sum` eval 在默认 docker 沙箱里必失败：
agent 正确写出了 `sum_sales.py`（csv 标准库、极简），但 `t.sandbox.runCommand("python3", ["sum_sales.py"])`
返回退出码 127（`python3: command not found`），`输出结果为 351.0 或 351` 的 gate 断言失败。
agent 自己在会话里也发现了（`which python*` → "no python found"）并明确说明脚本正确但没有运行时。

## 根因

`dockerSandbox()` 不带 `image` 时按 runtime 选默认镜像 `node:*-slim`（见 `src/sandbox/docker.ts` 的
`DOCKER_IMAGES`），slim 镜像不含 python3。eval 假设沙箱里有 python3，但实验配置没有声明这个依赖。
失败长得像 agent 能力问题（stdout 断言不过），其实是环境缺依赖——容易误判成模型退步。

## 修法

- 给需要 python 的实验显式指定镜像：`dockerSandbox({ source: { type: "image", image: "node:24" } })`（完整版 Debian 镜像自带 python3），
  或预制一个 node+python 模板镜像。
- 判别技巧：看 events 里 shell 调用的退出码，127 = 命令不存在 = 环境问题，不是 agent 问题。
