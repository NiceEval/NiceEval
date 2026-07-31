// 非沙箱 agent 的 OTLP 接收:run 级共享 receiver + 逐轮 span 归属。
//
// 为什么共享:被测应用是长驻进程,只有一条全局 OTel 管线、一个导出目标(OTEL_* env 进程
// 启动时读一次)——per-attempt receiver 会在第一个 attempt 结束时关掉端口,后续 attempt
// 的 span 全部丢失。所以粒度跟【被测进程】走:每个 agent(= 一个应用)整个 run 共享一个
// receiver;沙箱 agent 不走这里(每沙箱独立进程,per-attempt receiver 天然正确)。
//
// 共享流之下的逐轮归属(设计:docs/observability.md「span 怎么归属到轮」):
//   1. traceparent(并发安全):每轮生成新 trace context 经 ctx.telemetry.headers 交给
//      adapter 随请求带上;应用埋点支持 W3C 传播的,本轮 span 挂在我们给的 traceId 下。
//   2. 窗口(兜底,仅串行可靠):没见过 traceparent 生效前,同 agent 的轮次串行执行
//      (并发守卫),把「本轮结束时新到且未被消费的 span」归给本轮。
//      一旦按 traceId 命中过一次,守卫解除,后续并发随便开、只按 traceId 归属。

import { randomBytes } from "node:crypto";
import type { TraceSpan } from "../../types.ts";
import type { TraceReceiver } from "./receiver.ts";
import { makeTraceReceiver } from "./receiver.ts";

export interface TurnSpans {
  /** traceparent 命中时是本轮生成值；窗口归属时是实际 span 的 traceId，供 timing 直接挂树。 */
  traceId: string;
  /** 归属到本轮的 span。 */
  spans: TraceSpan[];
  /** 本轮归属用的是 traceparent 还是时间窗口(日志/守卫用)。 */
  attribution: "traceparent" | "window";
}

/** 一个 agent(= 一个被测进程)整个 run 的 OTLP 通道:receiver + 归属状态。 */
export class AgentOtelChannel {
  /** traceparent 已确认生效(收到过带我们 traceId 的 span)→ 并发守卫解除。 */
  private confirmed = false;
  /** 串行守卫:未确认 traceparent 时,同 agent 的轮次挨个跑(promise 链当互斥锁)。 */
  private chain: Promise<unknown> = Promise.resolve();
  /** 已归属过的 span(spanId),共享流里不能重复分给两轮。 */
  private readonly consumed = new Set<string>();

  constructor(readonly receiver: TraceReceiver) {}

  /**
   * 跑一轮:fn 拿到本轮的 W3C trace context headers(spread 进请求头 / 注入子进程 env),
   * 返回后 settle 接收器、归属本轮 span。未确认 traceparent 前整段(含 fn)串行。
   */
  async runTurn<T>(fn: (headers: Readonly<globalThis.Record<string, string>>) => Promise<T>): Promise<{ result: T } & TurnSpans> {
    const traceId = randomBytes(16).toString("hex");
    const headers = { traceparent: `00-${traceId}-${randomBytes(8).toString("hex")}-01` };

    const exec = async (): Promise<{ result: T } & TurnSpans> => {
      const result = await fn(headers);
      // 给本轮最后一批导出留落地时间(SimpleSpanProcessor 即发;Batch 的 5s 定时兜不住,
      // 迟到的由 attempt 末尾 sweep 按 traceId 捞回)。
      await this.receiver.settle(200, 1200);
      const fresh = this.receiver.collect().filter((s) => !this.consumed.has(s.spanId));
      const matched = fresh.filter((s) => s.traceId === traceId);
      let spans: TraceSpan[];
      let attribution: TurnSpans["attribution"];
      if (matched.length > 0) {
        this.confirmed = true;
        spans = matched;
        attribution = "traceparent";
      } else if (this.confirmed) {
        // 已确认过 traceparent 的通道只按 traceId 归属 —— 窗口在并发下必混流,不回退。
        spans = [];
        attribution = "traceparent";
      } else {
        spans = fresh;
        attribution = "window";
      }
      for (const s of spans) this.consumed.add(s.spanId);
      // 窗口归属证明的是“这批新 span 属于本轮”，并不证明应用采用了我们生成的
      // traceparent。把合成 id 写进 turn 会导致 timing 永远匹配不到实际 span；单 trace
      // 窗口直接记录真实 id，多 trace 的其余部分仍由 eval.run leftovers 如实保留。
      const attributedTraceId = attribution === "window" && spans[0] !== undefined ? spans[0].traceId : traceId;
      return { result, traceId: attributedTraceId, spans, attribution };
    };

    if (this.confirmed) return exec();

    // 未确认:挂到串行链上。链上的前序轮次结束(含它的 settle)后才开跑,窗口不重叠。
    const prev = this.chain;
    const p = prev.then(exec, exec);
    this.chain = p.catch(() => {});
    return p;
  }

  /** 是否仍在串行守卫下(日志提示用)。 */
  get serialized(): boolean {
    return !this.confirmed;
  }

  /** attempt 末尾:按本 attempt 的 traceId 集合捞迟到的 span(Batch 导出等)。 */
  async sweep(traceIds: ReadonlySet<string>): Promise<TraceSpan[]> {
    if (traceIds.size === 0) return [];
    await this.receiver.settle(200, 1000);
    const late = this.receiver
      .collect()
      .filter((s) => !this.consumed.has(s.spanId) && traceIds.has(s.traceId));
    for (const s of late) this.consumed.add(s.spanId);
    return late;
  }
}

/**
 * run 级共享池:每个 agent 一个通道(懒建)。固定端口模式(defineConfig({ telemetry: { port } }))
 * 下全部 agent 共用一个通道 —— 端口只有一个,归属守卫也必须全局共享。
 */
export class OtelReceiverPool {
  private readonly channels = new Map<string, Promise<AgentOtelChannel>>();

  constructor(private readonly fixedPort?: number) {}

  channel(agentName: string): Promise<AgentOtelChannel> {
    const key = this.fixedPort !== undefined ? "*fixed-port*" : agentName;
    let ch = this.channels.get(key);
    if (!ch) {
      ch = makeTraceReceiver(this.fixedPort ?? 0).then((r) => new AgentOtelChannel(r));
      this.channels.set(key, ch);
    }
    return ch;
  }

  async close(): Promise<void> {
    const all = [...this.channels.values()];
    this.channels.clear();
    await Promise.all(
      all.map((p) => p.then((ch) => ch.receiver.close()).catch(() => {})),
    );
  }
}
