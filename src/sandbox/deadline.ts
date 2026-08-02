// 时限归属:attempt deadline 是唯一默认(契约见 docs/feature/sandbox/architecture.md
// 「时限归属:attempt deadline 是唯一默认」)。
//
// provider 层**没有独立默认**。单条命令未显式传 `timeout` 时,上限就是 attempt deadline 的
// 剩余量;四层解析链一个上限都没声明时就是没有上限,不替用户发明一条线。理由与 `timeoutMs`
// 的解析链相同:时限多一个链外来源,症状就是「实验声明 20 分钟,命令在整 600 秒被另一层
// 杀掉」——配置的值不生效,报错还落在离配置最远的地方。

import type { CommandOptions } from "./types.ts";
import type { Sandbox } from "./types.ts";
import { sandboxCapabilities } from "./backend.ts";

/** 一条命令这次实际生效的上限,以及它是不是用户显式声明的。 */
export interface CommandLimit {
  /** 缺席 = 这条命令没有上限(没有 deadline,也没人显式给)。 */
  timeoutMs?: number;
  /** `true` = 用户代码给这条命令显式传了 `timeout`,那是有意声明,不是默认值。 */
  explicit: boolean;
}

/**
 * 单条命令的上限:显式 > deadline 剩余量 > 无上限。
 *
 * @param base 创建沙箱时收到的 attempt 上限与截止时刻(都从 attempt deadline 派生)。
 * `deadlineAt` 在场时按**剩余量**算——同一台沙箱上的第二条命令不该重新拿到一整份上限。
 */
export function commandLimit(
  opts: Pick<CommandOptions, "timeoutMs"> | undefined,
  base: { commandTimeoutMs?: number; deadlineAt?: number },
  now = Date.now(),
): CommandLimit {
  if (opts?.timeoutMs !== undefined) return { timeoutMs: opts.timeoutMs, explicit: true };
  if (base.deadlineAt !== undefined) return { timeoutMs: Math.max(1, base.deadlineAt - now), explicit: false };
  if (base.commandTimeoutMs !== undefined) return { timeoutMs: base.commandTimeoutMs, explicit: false };
  return { explicit: false };
}

/**
 * 复用实例的「换一条 attempt deadline」能力(与 `suspend()` / `ensureLifetime()` 同一种
 * 「接口之外的可选能力」)。
 *
 * 一次性沙箱在 create 时就收下 deadlineAt,实例与 attempt 一一对应,所以那条线一辈子不变;
 * 复用实例活得比 attempt 长,create 时那条线只对创建它的那条 attempt 成立,后续承接的每条
 * attempt 都要换成自己的。没有这条能力时,复用实例的每条命令都落回「base 里什么都没有」
 * → provider SDK 自己的默认值(e2b 是 60 秒),于是实验声明的 timeoutMs 完全不生效——
 * 正是本文件顶部注释点名的那个症状,只不过发生在复用路径上。
 */
export interface SandboxCommandDeadline {
  /** `undefined` = 这台实例接下来没有 deadline(四层都没声明上限时的正路径,不发明一条线)。 */
  setCommandDeadline(deadlineAt?: number): void;
}

/** 探到就换线,探不到就什么都不做(provider 没实现 = 它的命令本来就不按 deadline 记账)。 */
export function applyCommandDeadline(sandbox: Sandbox, deadlineAt?: number): void {
  const capability = sandboxCapabilities(sandbox).setCommandDeadline;
  if (capability._tag === "Supported") capability.value(deadlineAt);
}

/**
 * 一条命令撞线时抛的错。带着**归属**一起抛:上限多少、是不是显式声明的——runner 据此把
 * attempt 转成 `errored` 时落 `error.timeout`(见 runner/attempt.ts),不打一个没有归属
 * 说明的 ✗。
 */
export class SandboxCommandTimeoutError extends Error {
  readonly limitMs: number;
  readonly explicit: boolean;
  constructor(message: string, limitMs: number, explicit: boolean) {
    super(message);
    this.name = "SandboxCommandTimeoutError";
    this.limitMs = limitMs;
    this.explicit = explicit;
  }
}
