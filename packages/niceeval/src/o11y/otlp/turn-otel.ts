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
//      (Effect semaphore),把「本轮结束时新到且未被消费的 span」归给本轮。
//      一旦按 traceId 命中过一次,守卫解除,后续并发随便开、只按 traceId 归属。

import { randomBytes } from "node:crypto";
import { Effect, Semaphore } from "effect";
import type { TraceSpan } from "../../types.ts";
import { makeTraceReceiver, type TraceReceiver } from "./receiver.ts";

export interface TurnSpans {
  /** traceparent 命中时是本轮生成值；窗口归属时是实际 span 的 traceId，供 timing 直接挂树。 */
  traceId: string;
  /** 归属到本轮的 span。 */
  spans: TraceSpan[];
  /** 本轮归属用的是 traceparent 还是时间窗口(日志/守卫用)。 */
  attribution: "traceparent" | "window";
  /** 本轮请求的宿主 wall-clock 边界，供 attempt 收尾归属迟到导出。 */
  window: { startMs: number; endMs: number };
}

type AttemptWindow = readonly { startMs: number; endMs: number }[];

/** 一个 agent(= 一个被测进程)整个 run 的 OTLP 通道:receiver + 归属状态。 */
export class AgentOtelChannel {
  /** traceparent 已确认生效(收到过带我们 traceId 的 span)→ 并发守卫解除。 */
  private confirmed = false;
  /** 未确认时只允许一轮完整地经过 send → settle → window attribution。 */
  private readonly serialization = Semaphore.makeUnsafe(1);
  /** 已归属过的 span(spanId),共享流里不能重复分给两轮。 */
  private readonly consumed = new Set<string>();

  constructor(readonly receiver: TraceReceiver) {}

  /**
   * 跑一轮:fn 拿到本轮的 W3C trace context headers(spread 进请求头 / 注入子进程 env),
   * 返回后 settle 接收器、归属本轮 span。Effect failure 与 interruption 原样透传给 owning
   * session fiber；未确认 traceparent 前整段(含 fn)串行。
   */
  runTurnEffect<T, E, R>(
    fn: (headers: Readonly<globalThis.Record<string, string>>) => Effect.Effect<T, E, R>,
  ): Effect.Effect<{ result: T } & TurnSpans, E, R> {
    return Effect.suspend(() => {
      const traceId = randomBytes(16).toString("hex");
      const headers = { traceparent: `00-${traceId}-${randomBytes(8).toString("hex")}-01` };
      const execute = Effect.gen(function* (this: AgentOtelChannel) {
        const turnStartMs = Date.now();
        const result = yield* fn(headers);
        const turnEndMs = Date.now();
        // 给本轮最后一批导出留落地时间(SimpleSpanProcessor 即发;Batch 的 5s 定时兜不住,
        // 迟到的由 attempt 末尾 sweep 按 traceId 捞回)。
        yield* this.receiver.settle(200, 1200);
        return yield* Effect.sync(() => this.attributeTurn(result, traceId, turnStartMs, turnEndMs));
      }.bind(this));

      // Semaphore 的 permit 在 success、failure 与 interruption 下都会归还；确认前已排队的轮
      // 仍按旧链顺序完成，确认后的新轮才允许真正并行。
      return this.confirmed ? execute : this.serialization.withPermits(1)(execute);
    });
  }

  /** 是否仍在串行守卫下(日志提示用)。 */
  get serialized(): boolean {
    return !this.confirmed;
  }

  /** attempt 末尾:按本 attempt 的 traceId 集合捞迟到的 span(Batch 导出等)。 */
  sweepEffect(traceIds: ReadonlySet<string>, attemptWindows?: AttemptWindow): Effect.Effect<TraceSpan[]> {
    if (traceIds.size === 0 && (attemptWindows === undefined || attemptWindows.length === 0)) {
      return Effect.succeed([]);
    }
    return this.receiver.settle(200, 1000).pipe(
      Effect.andThen(Effect.sync(() => {
        const late = this.receiver
          .collect()
          .filter((span) => {
            if (this.consumed.has(span.spanId)) return false;
            // Exact traceparent attribution remains authoritative even when remote
            // clocks skew outside host time; discrete turn windows only add deferred
            // candidates, so another concurrent attempt's gap is never a window.
            return traceIds.has(span.traceId) ||
              (attemptWindows !== undefined && attemptWindows.some(
                (window) => span.endMs >= window.startMs && span.startMs <= window.endMs,
              ));
          });
        for (const span of late) this.consumed.add(span.spanId);
        return late;
      })),
    );
  }

  private attributeTurn<T>(
    result: T,
    traceId: string,
    turnStartMs: number,
    turnEndMs: number,
  ): { result: T } & TurnSpans {
    const fresh = this.receiver.collect().filter((span) => !this.consumed.has(span.spanId));
    const matched = fresh.filter((span) => span.traceId === traceId);
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
      // OTLP export can arrive after fn returns. Accept spans that overlap the
      // request's start boundary or start during the request (including settle).
      // Remote clock skew can make this conservative: prefer missing data over
      // mixing a late span from the previous turn into the current one.
      const windowed = fresh.filter(
        (span) => span.endMs >= turnStartMs && span.startMs <= turnEndMs,
      );
      const spansByTrace = new Map<string, TraceSpan[]>();
      for (const span of windowed) {
        const traceSpans = spansByTrace.get(span.traceId);
        if (traceSpans === undefined) spansByTrace.set(span.traceId, [span]);
        else traceSpans.push(span);
      }
      const candidates = [...spansByTrace.entries()]
        .map(([candidateTraceId, candidateSpans]) => {
          const latestEndMs = Math.max(...candidateSpans.map((span) => span.endMs));
          const coversTurnEnd = candidateSpans.some(
            (span) => span.startMs <= turnEndMs && span.endMs >= turnEndMs,
          );
          return { candidateTraceId, candidateSpans, latestEndMs, coversTurnEnd };
        })
        .sort(
          (a, b) =>
            Number(b.coversTurnEnd) - Number(a.coversTurnEnd) ||
            Math.abs(turnEndMs - a.latestEndMs) - Math.abs(turnEndMs - b.latestEndMs) ||
            b.latestEndMs - a.latestEndMs ||
            a.candidateTraceId.localeCompare(b.candidateTraceId),
        );
      const selected = candidates[0];
      spans = selected?.candidateSpans ?? [];
      attribution = "window";
    }
    for (const span of spans) this.consumed.add(span.spanId);
    // 窗口归属证明的是“这批新 span 属于本轮”，并不证明应用采用了我们生成的
    // traceparent。把合成 id 写进 turn 会导致 timing 永远匹配不到实际 span；单 trace
    // 窗口直接记录真实 id，多 trace 的其余部分仍由 eval.run leftovers 如实保留。
    const attributedTraceId = attribution === "window" && spans[0] !== undefined ? spans[0].traceId : traceId;
    return {
      result,
      traceId: attributedTraceId,
      spans,
      attribution,
      window: { startMs: turnStartMs, endMs: turnEndMs },
    };
  }
}

/**
 * run 级共享池:每个 agent 一个通道(懒建)。固定端口模式(defineConfig({ telemetry: { port } }))
 * 下全部 agent 共用一个通道 —— 端口只有一个,归属守卫也必须全局共享。
 */
export class OtelReceiverPool {
  private readonly channels = new Map<string, AgentOtelChannel>();
  private readonly mutex = Semaphore.makeUnsafe(1);
  private closed = false;

  constructor(private readonly fixedPort?: number) {}

  channel(agentName: string): Effect.Effect<AgentOtelChannel, Error> {
    const key = this.fixedPort !== undefined ? "*fixed-port*" : agentName;
    return this.mutex.withPermits(1)(Effect.suspend(() => {
      if (this.closed) return Effect.fail(new Error("OTLP receiver pool is closed"));
      const existing = this.channels.get(key);
      if (existing !== undefined) return Effect.succeed(existing);
      return makeTraceReceiver(this.fixedPort ?? 0).pipe(
        Effect.map((receiver) => {
          const channel = new AgentOtelChannel(receiver);
          this.channels.set(key, channel);
          return channel;
        }),
      );
    }));
  }

  /** Invocation owners compose this release directly in their scoped finalizer. */
  closeEffect(): Effect.Effect<void> {
    return this.mutex.withPermits(1)(Effect.suspend(() => {
      if (this.closed) return Effect.void;
      this.closed = true;
      const channels = [...this.channels.values()];
      this.channels.clear();
      return Effect.forEach(
        channels,
        (channel) => channel.receiver.close,
        { concurrency: "unbounded", discard: true },
      );
    }));
  }

}
