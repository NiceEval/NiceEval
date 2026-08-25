# Cases

## C1：四路私有 Docker 与 Compose

同一 NixOS deployment 同时派发四条真实 Attempt。每条都能执行 `docker build`、`docker run` 和
`docker compose up/down`，并只能看到自己创建的 container、network 与 volume。第五条在 capacity
可用前保持 queued，不先启动 Agent 或占用错误 allocation。

## C2：4 GiB hard limit

每条 Attempt 的 Docker data volume 报告 4 GiB 逻辑容量。A 写满只让 A 得到结构化
`sandbox-data-limit-exceeded`；B、C、D继续运行。pool 可写容量低于安全阈值时停止新 admission，
但不回收仍有有效 lease 的实例。

## C3：冷运行与暖运行

冷运行从 exact Sandbox template 建立 Sandbox 实例，执行确定性 setup，并发布 verified Provider artifact。
相同输入的暖运行从 artifact 建立私有 clone，命中 OCI/BuildKit cache，仍真实运行 Agent 与 Eval test。
公开 timing 证明 warm 总耗时改善。

## C4：Attempt 间不泄漏

Attempt A 创建私有 image、container、volume、secret file 与 Compose network 后结束。Attempt B 从同一
准备起点启动，不能找到 A 的对象、secret、workspace 改动、daemon event 或 runtime log。

## C5：CLI `SIGKILL`

在 create、ready、Agent turn 和 destroy 四个时点分别强杀 owner。新 control process 能用 durable
ledger 与 Provider inventory fence 旧 generation，并回收 VM、disk、network 与 lease。已经开始的
Agent turn不自动重新发送模型请求或再次执行工具调用。

## C6：宿主重启与部分 activation

宿主在 policy 发布或 Provider 创建中断时重启。系统恢复最后一个 committed execution-domain policy，
隔离 pending generation，并对账 Provider objects。没有对象因 pathname 相似被自动收养。

## C7：局部损坏

一个 allocation、Provider artifact 或 clone 验证失败。系统只 quarantine exact object，继续检查其它
capacity。只有 control plane 无法证明 execution domain、pool 容量或 fencing 时才全局关闭 admission。

## C8：Provider 能力不满足

Experiment 选择的 Provider 没有 Docker、Compose、专用 kernel 或 4 GiB data capacity。planning 在任何
Provider I/O、模型调用或 Attempt dispatch 前失败，并列出缺少的 exact capability。没有 fallback。

## C9：policy 更新但 backing 不变

资源 policy 改变，Provider storage pool 和 artifact manifest identity 未改变。新 allocation 使用新 policy
revision；已发布 artifact 只有在 manifest 全部相等时继承。旧 lease、reservation、pending intent 与
quarantine 不继承。

## C10：旧 pool 不可见

宿主仍存在 `/data/niceeval-dind-pool.img`。新 Provider 不扫描、不打开写、不挂载、不 fsck、不采用也不
删除它。配置显式指向该文件时在 mutation 前报错。

## C11：真实 NiceEval-Eval dogfood

`install/v0.12.0 · install/db-gpt` 与
`harness/v0.12.0 · harness/terminal-bench/regex-log` 并发进入真实 Attempt，产生模型结果与 score。
随后同输入 warm 重跑，公开结果显示 cache hit、duration 改善和完整 cleanup。
