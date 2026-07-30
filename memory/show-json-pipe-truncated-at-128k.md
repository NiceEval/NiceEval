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

## 修法(未修)

大输出后不要裸 `process.exit()`:改设 `process.exitCode` 让进程自然退出,或显式等待
stdout write 回调 / `drain` 后再退。修的时候全查 `src/cli.ts` 里所有「先写大输出、后
`process.exit`」的路径(show / view 数据导出同形),并配一条真开管道子进程的回归用例。
