// FeedbackRenderer:human / json 两种 profile(见 docs/feature/experiments/cli.md)各实现
// 一份的插件契约。FeedbackCoordinator(coordinator.ts)是这份契约唯一的调用方 —— renderer 不
// 知道、也不需要知道事件从哪来、该不该去重、什么时候该 tick,这些全部由 coordinator 保证好
// 了才调用这里;renderer 只管「拿到一个已经确定要展示的 typed 事件 / 已经更新好的状态,
// 该画成什么样」。
//
// human.ts / json.ts 分别实现这份接口。

import type {
  AttemptLifecycleEvent,
  DurableFeedbackEvent,
  FeedbackTickEvent,
  RunFeedbackState,
} from "../types.ts";

/**
 * 方法命名对应 docs 里「coordinator 负责:撤下动态区域 → 永久写一行 → 在下方重建」的三步:
 * clearDynamic → appendDurable → redrawDynamic。coordinator 保证三步按序、原子执行(内部单
 * 队列串行处理一个事件的三步,不会被下一个事件插入打断);json 没有「动态区域」概念,
 * 两个 clear/redraw 钩子留空不实现即可 —— coordinator 探测到未实现就跳过,不会因为可选方法
 * 缺失而报错。
 */
export interface FeedbackRenderer {
  /**
   * 一条永久事件落地(见 `DurableFeedbackEvent`):human 打一行、json 按 NDJSON 事件追加到
   * stdout。两种 profile 都必须实现 —— 这是最基本的职责,即便某个 profile 选择对
   * 某个 `event.type` 不输出任何可见内容(如 json 暂存 "summary"，等 "receipt" 到达后一次写出
   * eval 结论与最终 receipt),也要显式接住、不抛错。
   *
   * 同一个逻辑事件(如两次 `key` 相同的 "diagnostic")可能被调用多次 —— coordinator 只保证
   * `RunFeedbackState.diagnostics` 里的去重计数正确,不代为决定「该不该重复打印」;renderer
   * 自己决定重复出现时是刷新一行还是静默吸收计数(human dashboard 通常选后者,见 cli.md
   * 「同一 dedupeKey 并发出现时只留一条并显示次数」—— 在只能追加、不能回改 scrollback 的
   * 终端模型下,这意味着首次之后的调用大多是no-op,只靠 state 里的 count 保证信息不丢)。
   */
  appendDurable(event: DurableFeedbackEvent, state: RunFeedbackState): void | Promise<void>;

  /**
   * 即将落地一条永久事件 / 一条 activity 之前,若当前画着动态区域(human dashboard)先撤下。
   * 返回后 coordinator 紧接着调用 appendDurable(或 activity),再(若仍处于「运行中」阶段)
   * 调用 redrawDynamic —— 三者被 coordinator 视为一个原子操作,renderer 不需要自己处理并发/
   * 交错。json 不实现即可。**必须幂等**:当前没有画任何动态内容时调用也必须安全(coordinator
   * 在 stopDynamic() 收尾时会无条件再调用一次)。
   */
  clearDynamic?(): void | Promise<void>;

  /** appendDurable(或 activity)之后,若动态区域还应该存在,在这里重建(human dashboard 专用)。
   *  run 收尾阶段(coordinator.stopDynamic() 之后)不会再调用这个钩子 —— 见 coordinator.ts
   *  的「结束后不允许再重建动态区域」。 */
  redrawDynamic?(state: RunFeedbackState): void | Promise<void>;

  /**
   * 不进入 `RunFeedbackState`、不去重的瞬时活动文本(如 docker 镜像拉取进度、vercel session
   * rotate 成功通知),详见 `sink.ts` 的 `reportActivity`。作用域明确、需要覆盖更新的长期步骤走
   * `ScopedFeedback.progress`;这条通道只承载无状态的一次性宿主活动文本。coordinator 仍按
   * clearDynamic → activity → redrawDynamic 的顺序调用;不实现就等价于「provisioning
   * retry/backoff 不逐次输出」——json 的目标行为
   * (见 cli.md 信息分级表)天然由「不实现这个可选方法」满足,不需要 renderer 自己判断 profile。
   */
  activity?(text: string, state: RunFeedbackState): void | Promise<void>;

  /**
   * 运行级时钟 tick(见 `FeedbackTickEvent`):human 用它判断要不要重画 dashboard(自行做
   * 4fps/1Hz 节流 —— coordinator 只保证「这是一次重画机会」,不承诺 tick 间隔恰好等于某个
   * profile 需要的帧率);json 用它判断距上一次永久事件是否已超过固定的 30 秒空闲阈值
   * (coordinator 不知道这个数字,由 renderer 自己维护),超过则自行追加一条
   * heartbeat(通过自己的输出通道,不是再回调 coordinator——heartbeat 不是需要去重/计入
   * RunFeedbackState 的永久事件)。
   */
  onTick?(event: FeedbackTickEvent, state: RunFeedbackState): void | Promise<void>;

  /** attempt 生命周期事件(见 `AttemptLifecycleEvent`):human 用它驱动 active slot 的内容;
   *  json 不实现 —— 机器流不逐条展示 active 状态(见 cli.md 的信息分级表)。 */
  onLifecycle?(event: AttemptLifecycleEvent, state: RunFeedbackState): void | Promise<void>;

  /**
   * coordinator 关闭时的最后一次机会 —— 在 `finish()` 内部,已经完成 stopDynamic() 且已经把
   * "summary"/"receipt" 两个永久事件送进 appendDurable 之后才调用。之后保证不会再收到任何调用。
   * 适合释放 renderer 自己持有的资源(如未 unref 的句柄);不适合再写任何输出 —— 该写的已经
   * 通过 appendDurable 写完。
   */
  close?(): void | Promise<void>;
}
