# 设计裁决:ExecutionTree 合并 events 与 OTel spans,推翻"两者永不合并"的旧决定

**裁决**(2026-07-12):新增纯函数 `buildExecutionTree(events: StreamEvent[], spans: TraceSpan[])`,把标准事件流(message、thinking、skill.loaded、action.called/action.result、subagent.called/completed、input.requested、compaction、error)与 OTel span 合并进同一棵 ExecutionTree。事件流永远是骨架——节点、顺序、内容不随 OTel 是否存在而改变;OTel 只是可选 enrichment,能通过明确 correlation ID 或 GenAI semantic attributes 关联上事件节点时,给该节点补开始时间、耗时、父子关系与错误状态;缺失或无法唯一关联时,节点保持"timing unavailable",无法关联的 span 作为单独标注的 telemetry-only 节点保留,不按名字/文本猜测合并。web 与 text 面(`--execution`)共用同一棵树,取代原来分裂的 `Trace.tsx`/`Transcript.tsx`(web)与 `traceText`/`transcriptText`(text)两套 renderer。

**曾选方案**:`docs/observability.md` 现行文档记录的决定——events 与 spans 是两条完全独立的读取路径,永不合并;web 面 `Trace.tsx` 画 span 瀑布、`Transcript.tsx` 画事件对话,text 面 `traceText`/`transcriptText` 各自输出,读者要自己在两份输出之间手工对应"发生了什么"和"花了多久"。

**否决理由**:两套独立 renderer 强迫读者(尤其是要自主判断的 agent)手动把"发生了什么"(事件)和"花了多长时间"(span)对应起来——同一次工具调用要在 transcript 里找一遍、再去 trace 里找耗时,两份输出没有共享的锚点。而两者描述的本来就是同一次执行:合并成一棵树、事件当骨架、span 补时间,读者一次遍历就拿到完整信息;没有 OTel 时骨架仍然完整,只是缺时间标注,不会因为合并而丢失"没有 timing 时还能看到发生了什么"的能力。

**日期**:2026-07-12。设计出处:`plan/attempt-evidence-feedback-loop.md`。这是对 `docs/observability.md` 现行"events 与 spans 独立、不合并"决定的显式推翻,重写该文档时需要明确写出这次反转,不能悄悄改掉旧结论。

**已实现**(2026-07 复核):`buildExecutionTree` 落在 `src/o11y/execution-tree.ts`,引入 commit
`60512063`(「合并事件流与 OTel span 为 ExecutionTree,skill.loaded 一等事件」)。`show` 的
`--execution` 切面与报告 web 面都经这棵树取数(`src/show/render.ts` 一侧的调用见
`src/show/render.test.ts`),旧的 `Trace.tsx`/`Transcript.tsx` 双 renderer 已随 view 证据室重写移除
(见 [view-client-fetch-machinery-fully-removed](view-client-fetch-machinery-fully-removed.md))。
