---
format: concord.document/v1
id: stream-abort-race-retains-chunks
title: 流式拉取不能反复竞速同一个未结束的取消 Promise
createdAt: 2026-09-28
kind: memory
memoryKind: insight
state: current
epoch: 0
promotions: []
history: []
---
280 MiB 附件验收中，逐块读取和写入仍出现约 303 MiB 的 RSS 增长。问题不是收集了 chunks 数组，而是每次拉取都执行 `Promise.race([iterator.next(), aborted])`，其中 `aborted` 在整个传输期间保持 pending。

共享 pending Promise 持有每次竞速登记的 reaction，已结束的拉取仍可能连带保留其结果。代码表面只处理一个块，不足以证明内存有界。

修法是为每次拉取登记独立的 AbortSignal listener，在拉取完成或失败时移除；取消后停止拉取并请求迭代器 return。不能等待不协作的外部迭代器无限结束。框架自己的写端与部分归档仍须关闭和删除。

安装候选的 `e2e/inspection/test/file-attachments.test.ts` 用 280 MiB 真实文件、64 KiB 块验证 RSS 增长小于 128 MiB，并通过公开附件 operation 核对摘要和首、中、末块。该测试在共享取消 Promise 的候选上取得正式红灯，修法候选已转绿。

生产入口为 `packages/niceeval/src/runner/adapter-attachments.ts`。同一原则适用于所有长期 pending 的 Promise 与重复 race 组合，不限于附件或文件输入。
