# 写分类器认第三方错误:取证、裁决、声明、验证

## 解决什么问题

错误是 SDK、CLI、网络栈制造的,制造者用不了 niceeval 的 fatal 错误类;回退分类器只认通用形状,认不出私有知识。
两个真实场景:

- **实验作者**：探活只在 setup 阶段跑。
  实验级 `setup` 时隧道还活着、跑到一半死掉，后续失败不再长成「探测 failed」。
  它以第三方错误的形态浮出：agent 在 turn 里调记忆服务撞 `ECONNREFUSED`，turn 失败。
  Attempt 写入执行错误通道事件 并形成 `errored` Verdict，一条条重复。
  回退看不出这是实验级死因(连接错误千千万),adapter 也不认识(它懂自家 CLI 协议,不懂你的实验拓扑)——知道「这个 host 是全实验共享的隧道」的只有你。
  挂载点:`ExperimentDefinition.classifyFailure`。
- **adapter 作者**:对接的 agent 服务有自己的限流表达——不是 429、文案里也没有 "retry later",比如固定短语 `ACME_QUEUE_FULL` 加退出码 75。
  回退只能判不可重试,每次撞上都白白形成 `errored` Verdict，批跑里还可能连续复现触发 fail-fast——协议知识在你手里。
  挂载点:`Agent.classifySendFailure`；是否未受理先由 Adapter 写入 `SendFailure.acceptance`。

两个挂载点走同一条纪律:**取证 → 裁决可证明性 → 挂分类器 → 验证**。

## 全流程

1. **取证**。
   从 `errored` Verdict 所基于执行错误通道事件 的 message 拿到原始文案(分类器读的失败文本与它同源,见 [Architecture · 分类链](../architecture.md#分类链)),确认没有重试摘要后缀(= 当前被判不可重试):

   ```text
   This send returned failed (turn status = failed): agent run exited with code 1 ·
   last error: connect ECONNREFUSED nowledge.trycloudflare.com:443
   ```

实验侧再对照同批:多条 attempt 的失败是否指向**同一个坐标**(同一 host)——泛化的连接错误不算证据。

2. **裁决可证明性**。
   写分类器前必须能回答对应的问题,答不上来就停在这里、保持不声明:

   - 实验侧(空间轴):**兄弟 attempt 为什么必死?** 「`serverHost` 是本实验共享的隧道」这个私有知识就是证明;host 之外的错误答不出这句,不声明。
   - adapter 侧(时间轴):**协议是否给出了可机器验证的受理前拒绝状态?** 查服务文档或服务端代码确认 `ACME_QUEUE_FULL` 对应 admission rejection，并在构造 `SendFailure` 时写 `acceptance: "rejected"`；只有文案、没有协议状态时保持 `unknown`（判据全文见 [README · 分类](../README.md#分类)）。

3. **挂分类器**。
   实验定义上只认自家坐标:

   ```ts
   // experiments/compare/codex-nowledge.ts —— id 从路径推导,不手写
   export default defineExperiment({
     // ... sandbox / setup ...
     classifyFailure({ text }) {
       // serverHost 是本实验共享隧道的 host——对它的连接失败即实验级死因
       if (text.includes(serverHost) && /ECONNREFUSED|ENOTFOUND|connection refused/i.test(text)) {
         return { retryable: false, scope: "experiment", reason: "nowledge_tunnel_down" };
       }
       return undefined; // 其余交给后续链路
     },
   });
   ```

adapter factory 上只认协议短语(完整写法与要点见 [Library](../library.md#adapter-作者classifyturnerror)):

   ```ts
   classifySendFailure(failure) {
     if (failure.acceptance === "rejected" && sendFailureText(failure).includes("ACME_QUEUE_FULL")) {
       return { retryable: true, reason: "acme_queue_full" };
     }
     return undefined; // 其余交给保守回退
   },
   ```

`reason` 用你语境里最贴切的词——开放词表,原样进 activity 与诊断文案,不必伪装成内建的 `rate_limit`。

4. **验证**。
   单元层用按脚本失败的 fake agent 断言分类结果;真实运行里的生效观察面:

   - 实验分类器命中：该失败判为终局（`retryable: false`，不进重试）且携带 `scope: "experiment"`。
     Attempt 照常收敛 lifecycle，执行错误通道事件 形成 `errored` Verdict，实验止损生效。
     反馈流出现 `experiment halted (dispatch-halted)`，并把 `reason` 写进诊断文案。
     余量计 `unstarted`，其它实验不连坐。
     修好后重跑即续跑,止损语义与[抛出点声明](declare-fatal-scope.md)完全相同。
   - adapter 分类器命中:activity 行出现 `turn retry 2/4 (acme_queue_full)`,重试成功的 attempt 结果零痕迹。

## 边界

- **只认自己的坐标,别写通用正则。
  ** `/ECONNREFUSED/` 不带 host 过滤就是把「任何连接错误」都判成实验死因——agent 访问外网抖一下也会误杀整批。
  可证明性来自「这个坐标是我的」这个私有知识,正则越宽,证明越假。
- **快、纯、不抛错。
  ** 分类器抛错按 `undefined` 回落、被吞掉,等于白写;它是旁路,不得用新错误掩盖原始失败。
- **受理证据门仍在你之上(时间轴)。
  ** `acceptance` 为 `started` 或 `unknown` 时,可重试判断会被强制降回不可重试——分类器声明错误类别,执行体持有受理事实的否决权。
- **空间轴从严(adapter 侧)。
  ** adapter 也可以给 `scope`,但只限协议回执能证明「后续每次调用必死」的场景(凭据失效、账号封禁);说不清波及范围就只给时间轴——误扩 scope 停掉的是用户的整批实验。
- **时间轴别给要人修的死因(实验侧)。
  ** 中途死亡的隧道 `retryable: true` 只会让 attempt 在退避里泡到预算耗尽再止损,多烧几分钟没有任何收益;真正的瞬时抖动回退已经认得。
- **别复述回退。
  ** 429、DNS 失败、拒连这些通用形状回退已认得,分类器只写私有知识,其余一律 `undefined` 回落。
- **与抛出点声明互补不是二选一。
  ** 探测 兜「起跑就死」,分类器兜「中途死」;共享服务型实验两个都写,才没有缺口。

## 相关阅读

- [Architecture · 分类链](../architecture.md#分类链) ——各通道的决议序与否决权。
- [README · 声明通道](../README.md#声明通道知识在哪声明就在哪) ——为什么这些知识只能由各自的作者声明。
- [Library](../library.md) ——两个挂载点的签名、要点与完整示例。
- [Adapter · 编写 Adapter](../../adapters/library/writing-an-adapter.md) —— send 与错误从哪里浮出。
