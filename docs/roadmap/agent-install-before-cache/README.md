# Agent 安装进入 before 缓存

本方向让云 Sandbox 上的一批 Attempt 只安装一次 Agent CLI。它还没有被采用为当前契约：下面五个问题定下之前，实现仍以 [Agent Ensure](../../feature/adapters/architecture/agent-ensure.md) 为准，安装在每条 Attempt 的 `agent.ensure` 相位执行。

## 要解决的问题

官方安装层在每条 Attempt 里重新安装同一版本的 CLI。真实批次里，一格的安装要几十秒，24 格就是 24 次。
现在能做的只有把 CLI 预装进镜像或 template，让探测直接命中；探测未命中时写出的原因告诉作者差在哪一项。
预装要求作者自己维护一份与官方配方一致的镜像，这正是 before 缓存本来可以代劳的事。

## 已定的方向

- 只有作者显式选择时才提前安装。默认行为不变，已发布的结果不受影响。
- 选择提前安装会改变这个 Experiment 的结果身份，因为作者的 before 会观察到已经装好的 CLI。
- 只有以纯数据描述的官方安装计划可以进入缓存；任意安装回调保持逐 Attempt 真实执行。
- 不为此新增带分支的准备步骤。安装计划由“写入 payload”与“一条命令”组成，命令内部完成探测、安装与复检。

## 定下之前不能实现的五个问题

1. **安装计划的封闭形状。** staged payload 怎样成为不可变输入，命令的用户、路径、子进程变量、目标平台与 libc 怎样进入身份，缓存内容里不能出现什么。
2. **与作者 before 的先后。** 提前到哪里才算合法，作者怎样声明安装依赖自己准备的运行时，以及缺失、重复与成环时的错误。
3. **每种 Provider 能力下由谁执行、执行几次。** Run 级准备、逐 Attempt 捕获、不支持捕获、opaque barrier 前后、restore 降级与 bypass，各给一行次数表。
4. **失败与事实归谁。** Run 级准备在任何 Attempt 派发之前执行，它的失败不能写成某条 Attempt 的安装失败；命中缓存的 Attempt 也不能声称自己执行过安装。
5. **Sandbox 复用。** 安装前缀怎样进入 reset baseline 的身份，哪些目录与用户状态在 reset 后保留，带不同安装依赖的配对能否共池。

## 采用条件

五个问题各自写成可验收的规则并经过独立评审之后，把规则写进 Agent Ensure、Sandbox Layer 与 Before cache 三页，再用 `concord roadmap start` 采用。
