---
name: langgraph-e2e-hitl-resume-register-before-send
description: "e2e/repos/langgraph 的自建 SSE bridge 里,并发跑 HITL eval 时 /api/chat/resume 偶发 404 no pending interrupt——根因是先把 interrupted 帧发给客户端再登记 pending queue,已定位并修复(登记必须先于发送)"
metadata:
  type: infra-bug
---

**现象**：`e2e/repos/langgraph` 的 `src/backend/server.py`(自建 HTTP/SSE bridge,把真实
`graph.stream(..., subgraphs=True)` 翻译成 `fromLangGraphEvents()` 认识的协议帧)在
`niceeval exp langgraph --force`(`maxConcurrency: 2`,四条 Eval 里 `hitl` 一条会触发
interrupt)偶发这样的错误:

```
niceeval: errored ... eval=hitl ... reason="POST /api/chat/resume 失败: 404 {\"error\": \"no pending interrupt for requestId ...\"}"
```

单独跑 `niceeval exp langgraph hitl` 或降到 `maxConcurrency: 1` 从未复现;只在并发下、且
概率性地出现——和 [claude-sdk-concurrent-hitl-approve-race](claude-sdk-concurrent-hitl-approve-race.md)
现象相似(并发 HITL 打同一个自建 server 出 404),但这条的根因**已经定位清楚且已修复**,不是
子进程/SDK 内部竞争那类未查明问题。

**根因**：`_stream_chat` 原来的顺序是"先把 `lifecycle: interrupted` 帧写给客户端,再调用
`_await_decision(interrupt_id)`(内部才把 `queue.Queue` 登记进全局 `_pending` dict)"。
`_agent.stream()` 命中 interrupt 后,帧已经通过 socket flush 出去,客户端(niceeval adapter)
读到帧、返回 `waiting`、eval 框架立刻发起 `t.respond(...)` → `POST /api/chat/resume`——这个
往返可以在**同一个 Python 进程的这条请求线程真正执行到 `_pending[id] = queue` 那一行之前**就
完成,只要 GIL 把这条线程调度让给了同一进程里另一个并发 eval 的请求处理。这不是理论风险,
两次真机跑就复现了一次。隐含的错误假设是"网络往返总比同进程后续代码执行慢",并发场景下不成立。

**修法**：把"登记 pending queue"提到"发送 interrupted 帧"**之前**——命中 interrupt 后先调
`_register_pending(interrupt_id)` 把 `queue.Queue` 存进 `_pending`,再执行
`for frame in frames: send(frame)`。这样客户端最早也要等帧真正发出后才能发起 resume,而那时
`_pending` 已经有条目了,时序上不再依赖谁先谁后的运气。适用场景:任何自建 HTTP/SSE bridge
实现"停轮-恢复"语义(不止 LangGraph,任何要在多轮/多 eval 并发下把"服务端记下等待状态"和
"通知客户端已经在等待"这两件事拆成两步做的场景)都要检查这个顺序——`await`/线程阻塞点必须放在
"客户端已经不可能抢先"的地方之后,不能放在"通知客户端"之后才登记。落点：
`e2e/repos/langgraph/src/backend/server.py` 的 `_register_pending` + `_stream_chat` 主循环。
