# show --json 输出进管道时在 128KB 处截断

## 现象

2026-07-30 MemoryBench dogfooding(niceeval 0.11.3)真机复现:同一条命令,重定向到文件是完整的
505081 字节合法 JSON,管给 python3 / jq 只剩恰好 131072 字节(128KB),JSON 解析必挂:

```sh
$ niceeval show --exp codex-e2b --history --json | wc -c
  131072          # 截断
$ niceeval show --exp codex-e2b --history --json > hist.json; wc -c < hist.json
  505081          # 完整
```

这个坑很隐蔽:`--json` 的用途就是喂给下游工具,而管道恰恰是唯一会坏的用法;报错表现为下游的
「JSON 语法错误」,第一反应会去怀疑自己的解析脚本而不是 niceeval。

## 根因(未逐行核实,形态高度吻合)

Node 在 stdout 为 pipe 时写入是异步的,`process.exit()` 不等缓冲 flush 完就终止进程;
截断点恰为 2^17 字节是异步写只冲出部分缓冲的典型形状。`src/cli.ts` 的 show 路径在输出后
裸调 `process.exit(0)`(653 / 658 / 689 一带)。stdout 为 TTY 或文件时写入同步,所以只有
管道坏。单测收集的是字符串、e2e 若重定向文件也测不出,只有真管道路径会红。

## 修法（已修）

`d8d5a84b`（2026-07-31）把 show 路径的裸 `process.exit(code)` 改为设置 `process.exitCode` 后返回，
让事件循环自然冲完 stdout。修复注释与代码都落在 `src/cli.ts` 的 show 分支。

## 回归 kill 收据

旧实现的真机收据已经记录在上方：同一份 505081 字节 JSON 经 pipe 只交付 131072 字节，最早在 JSON parse 失败；
重定向文件则完整。目标 E2E owner 是
`docs/roadmap/testing/example/repos/cli/test/show-json-pipe.test.ts`：它让安装后的 CLI stdout 进入父进程 pipe，
同时断言字节数超过旧阈值、严格 JSON 可解析，并读到尾部独立 sentinel。恢复 `d8d5a84b^` 的裸 `process.exit(code)` 时，
该测试会在 parse 或尾部 sentinel 处失败，而不是只用“命令退出 0”冒充完整交付。
