# 沙箱内 OTLP collector 端口等待 3s 硬预算、零重试(已修)

**现象**：远程沙箱(e2b / vercel)上偶发 attempt 在 ~8s 就 errored,错误 message 为
`in-sandbox OTLP collector failed to report its port within 3s. Collector log:(empty)`,
重跑同一条即过。8s = 沙箱 create 往返 + writeFiles + 这 3s 等待,agent 一次都没跑起来。
结果里 `error.phase` 标成 `sandbox.create`(不是 telemetry),`code` 是 `unexpected-error`,
所以看板上像是「起沙箱失败」,归因误导。

**根因**：`src/o11y/otlp/sandbox-receiver.ts:81-94` 把「后台起 collector + 等端口文件」折进
一次 `runShell`:`i=0; while [ $i -lt 30 ] && [ ! -s $portPath ]; do sleep 0.1; ... done`
——固定 30 tick × 0.1s = **3s 硬预算**,超时即 `throw`。冷沙箱上 node 进程首次启动 + `listen(0)`
+ 写端口文件超过 3s 就必死,而这条路径上**没有任何一层重试**:

- `runShell` 明确不走 `withSandboxIoRetry`(`src/sandbox/io-retry.ts` 头注释:命令执行有不可
  重复副作用,框架不代重试),`normalizeSandboxPaths` 也只包 file IO;
- `withProvisionRetry`(`src/sandbox/retry.ts`)只覆盖 `create()`,沙箱早就建好了;
- runner 没有 attempt 级重试:`createInSandboxTraceReceiver` 是 `Effect.acquireRelease` 的
  acquire,`Effect.promise` 里 reject → defect → `attempt.ts:543` 的 `catchAllCause` 直接
  兜成一条 errored 结果。

一次冷启动抖动 = 一条永久 errored,且 telemetry 只是证据通道,被测对象根本没跑。

附带的三个小问题(同一处):

1. 失败分支已经拿到 `pid` 却不 kill,collector 进程留在沙箱里(`--keep-sandbox` / 复用沙箱时是
   孤儿);
2. 错误文案里的 `3s` 与循环里的 `30` 各写一处,改预算必漂;
3. `sleep 0.1` 依赖 shell 的小数秒支持,镜像里若是不支持小数的 `sleep`,30 次循环瞬间跑完 →
   0 秒就报 "within 3s"(会伪装成同一个错误)。

**修法**（`src/o11y/otlp/sandbox-receiver.ts` 的 `startCollector` + `src/runner/attempt.ts`）：

- 预算提到常量 `PORT_WAIT_MS = 20_000`(错误文案从常量渲染,不再手写 `3s`),等待改按
  `date +%s` 的**墙钟 deadline**,不数 tick —— `sleep` 的小数秒支持因镜像而异,数 tick 会让不
  支持的镜像瞬间跑完循环还自称等满预算;
- 循环加第二条退出边 `kill -0 $pid || break`:collector 起来就死(镜像没 node、被 OOM kill)
  时立刻回 host,不空等满预算;
- host 侧整段启动重试 `START_ATTEMPTS = 2` 轮,**每轮换一套随机后缀路径**并在重试前 kill 上一
  轮 pid —— 否则上一轮「慢但没死」的 collector 会在重试之后把端口写回旧文件、或和新一轮抢同一
  份 spans;
- 归因:`attempt.ts` 在起沙箱内 collector 前 `enterPhase("telemetry.configure")`。原先这段挂
  在还开着的 `sandbox.create` 上,失败会伪装成「起沙箱失败」,秒级耗时也记错行
  (阶段定义本就是「创建/配置本次 tracing 出口」,见 `docs/feature/experiments/cli.md`)。

覆盖登记在 `docs/engineering/testing/unit/experiments-runner.md`「沙箱内 OTLP 采集器的启动
韧性」,回归测试 `src/o11y/otlp/sandbox-receiver.test.ts`(脚本化 fake 证重试/换路径/杀上一轮;
真实 `/bin/sh` 证生成脚本跑得通、进程已死时不空等)。

「拿不到端口时是杀 attempt 还是降级为 no-op receiver + diagnostic」仍未裁决——本次维持杀
attempt(降级会让依赖 span 的断言无声失分,不能默认打开)。

**2026-08-08 后续**：Docker bridge 的 host-gateway 别名不能证明宿主防火墙允许容器回连；
Docker provider 也改为 `otlpHost === null`，默认使用本页的 Sandbox 内 receiver。适用面因此是
所有不承诺宿主回连、且 agent 声明了 `tracing` 的 Sandbox。Docker Compose 的任意
`mainService` 不保证 Node；缺运行时时 receiver 启动失败只记 supplemental diagnostic，不改判定。
local provider 仍走宿主 receiver。相关 [[e2b-sandbox]]、[[vercel-sandbox-issues]]。
