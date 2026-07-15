---
name: sandbox-provision-ratelimit-retry
description: 设计裁决——sandbox provisioning 瞬时错误(限流 + 传输层)退避重试,分类放 provider + 共用瞬时分类器兜底,重试放在 resolve.ts 而不是 runner,不覆盖运行期限流
metadata:
  type: project
---

裁决(2026-07-11):`createSandbox()` 遇到 provider 侧限流(e2b `RateLimitError`、vercel `APIError{status:429}`、docker 拉镜像 429)时,由各 provider 自己的 `classifyProvisionError()` 把原生错误归类成中性 kind(`"rate_limit" | "unknown"`),`src/sandbox/resolve.ts` 的 `createProvider()` 对可重试 kind 做指数退避重试(封顶 4 次 + 全抖动),不可重试的错误(模板不存在、凭据缺失)第一次就抛出。落地:`src/sandbox/errors.ts`(kind + `isRetryableProvisionError`)、`src/sandbox/retry.ts`(`withProvisionRetry`)、各 provider 文件的 `classifyProvisionError`、`resolve.ts` 接线;文档见 `docs/sandbox.md`「Provisioning 失败与重试」。

**曾选方案**:在 `src/runner/run.ts`(调用侧/runner)做统一重试。否决理由:仓库架构边界明确「provider 名的行为分支只允许出现在 sandbox/ 内」(`docs/architecture.md`),runner 不该知道"这是 e2b 还是 vercel 限流";而 `resolve.ts` 的 `createProvider()` 本来就是 provider 分发的唯一入口,是"调用侧"里天然 provider 无关的那一层——把重试放这里,runner 完全不用感知。

**范围裁决**:这次只覆盖"创建沙箱"这一步的限流重试。沙箱创建成功后、运行期间因限流被终止(如并发过高导致的 sandbox kill,见 [[e2b-sandbox]])**不**在这个机制内——运行期问题定性为"应该靠控制并发避免",不是"重试掩盖";如果之后要做运行期重试,那是重跑整个 attempt 的更大范围决定,需要另外裁决(会牵涉 `verdict: "errored"` 目前"确定性、`earlyExit` 时跳过剩余 runs"的语义,见 `docs/sandbox.md` 与 `src/runner/run.ts` 的 errored 注释)。

**踩坑**:调研时发现 `@vercel/sandbox` SDK 自己对单次 fetch 的 429 已经有内部重试(`with-retry.js`,5 次指数退避、读 `Retry-After` header);我们在 `resolve.ts` 加的重试是外层兜底(耗尽内部重试后仍 429,或 `create()` 轮询 session 状态过程中撞限流),两层不冲突但容易被误以为重复造轮子——加之前先确认 SDK 有没有自己的重试层,再决定外层要不要包、包多重。

**再修(2026-07-14,评审否决盲重试)**:同日扩围稿被评审拦下三条——P1 `createSandbox` 并非幂等:`other side closed` / 超时 / 5xx 可能发生在请求已被受理、响应丢失之后,盲重试会在远端积累无人持有 id 的计费实例,且打破「不留无主沙箱」不变量([[sandbox-keep-scene-decision]]);P2 「确定性错误第一次就抛出」的绝对表述被下文自己记录的 e2b envd `500:` 反例违反;P3 vercel SDK 内建 429 重试(5 次)× 外层封顶(4 次)在次数与退避时长两个维度相乘放大。新契约(`docs/feature/sandbox/architecture.md`「Provisioning 失败与重试」):瞬时按**后果**再分拒绝类(限流、连接建立失败——远端确定无实例,直接重试)与歧义类(响应中断/超时/5xx——重试前必须按 create 时写入 provider 元数据的 provision token 对账,查到先销毁再重建;无检索通道的 provider 如 vercel 歧义类第一次抛出);「第一次就抛」收敛为「识别出确定性即抛」+ 误判不对称条款(确定性误判成瞬时只慢不错,代价封顶);vercel 拒绝类外层封顶收窄。曾选「歧义类也盲重试」否决理由即 P1;曾选「断线收养查到的实例」否决理由:重连语义复杂,销毁重建只多付一次本来就要付的冷启动。

**再修(2026-07-15,「拒绝类可盲重试」被真实跑分推翻)**:E2B 实跑 10 evals 出现 14 台实例、4 个 provision token 各对应两台(泄漏台账见 [[e2b-provision-429-duplicate-sandbox]])。根因:「拒绝类 ⇒ 远端没有实例」只对单个请求成立,而被重试的单元是 provider 整个 `create()` 闭包——E2B 在 SDK create 之后还有 `mkdir -p` 初始化请求,它撞 429 时整个闭包抛 `RateLimitError` 被归拒绝类、跳过对账盲重试,复制实例。新契约(`docs/feature/sandbox/architecture.md`「Provisioning 失败与重试」)改成两道防线:① provider `create()` 承担 kill-on-failure(句柄到手后的任何失败先尽力销毁再抛,e2b.ts / docker.ts);② 有对账通道的 provider **任何重试前都对账**、不分拒绝/歧义类,对账排在退避睡眠之后(睡醒再查,检索自己被限流的概率低),对账失败即放弃重试抛原始错误(retry.ts;对账函数不再吞错,实例已不存在视作完成)。曾选「只修 kill-on-failure、保留拒绝类盲重试」否决理由:kill 本身也是网络调用、限流下可能失败,且 SDK create 内部可能多请求,单防线不闭环。

**旧稿(2026-07-14 上午,已被上条取代)**:provisioning 可重试范围从"仅 `rate_limit`"扩到"限流 + 传输层瞬时错误"。触发证据:e2b 真实跑分中 `Sandbox.create` 阶段多次出现 `fetch failed · SocketError other side closed`(locator @1r4kwea6 等,同轮 4 次基建失败里占 2+),按旧裁决被归 `unknown` 直接判死 attempt——而同样的错误消息出现在 `uploadFile` 会被文件 IO 层自动重试,两层双标没有道理。**曾选方案**:向 e2b 提上游 FR 让 SDK 自己重试 create。否决理由:`withProvisionRetry` 的退避/还槽位/activity 汇报机制全在,缺的只是分类器兜底一行逻辑;且旧裁决"其它错误第一次就抛"的论据是"重试对配置错误没有意义",传输错误本不在该论据覆盖内。新契约:provider `classifyProvisionError` 认原生限流后,未认出的错误过一遍 `classifySandboxIoError` 兜底,瞬时 kind 一律退避重试;文档已按新契约重写(`docs/feature/sandbox/architecture.md`「Provisioning 失败与重试」)。附带观察:e2b envd 把 permission denied 包成 `500:` 前缀 message,会被瞬时分类器的 5xx 正则误判成可重试——确定性错误多陪跑几次退避后仍如实抛出,只慢不错,暂不为它加白名单。
