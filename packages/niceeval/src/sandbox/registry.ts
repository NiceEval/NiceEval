// 活动沙箱登记表 + 强制清理兜底。
//
// 中断(Ctrl+C)时,正常路径靠 Effect 的 Sample finalizer 跑 sb.stop() 停容器。但 finalizer
// 这条路不是 100% 可靠:vsb.stop() 这类远端调用可能慢/挂,用户等不及再按一次 Ctrl+C,进程
// 就被硬退了 —— 沙箱成了孤儿(只有本身带超时的 provider 才会自己回收它;local 这类不会)。
//
// 这里维护一份独立于 Effect 的登记表,让 cli 在「二次中断 / graceful 清理超时 / 正常返回后」
// 都能直接、带超时地强停所有还活着的沙箱。stop 不再静默吞异常(原 `.catch(() => {})`),失败打到
// stderr,这样孤儿至少留下痕迹可查。

import { Effect } from "effect";
import type { Sandbox } from "../types.ts";
import { t } from "../i18n/index.ts";
import { reportDiagnostic } from "../runner/feedback/sink.ts";

const live = new Set<Sandbox>();

// 单个 stop 的默认超时:vsb.stop() 偶发慢/挂,清理不能无限等。到点就放弃、记一笔,
// 让流程继续走到退出 —— 没停掉的沙箱会继续运行并计费,直到 provider 自己的超时(如果有)回收它。
const DEFAULT_STOP_TIMEOUT_MS = 8_000;

export function registerSandbox(sb: Sandbox): void {
  live.add(sb);
}

/** 留存提交成功后把沙箱移出本次 run 的内存强清集合(不 stop——现场归持久注册表管理)。 */
export function unregisterSandbox(sb: Sandbox): void {
  live.delete(sb);
}

export function liveSandboxCount(): number {
  return live.size;
}

/**
 * 带超时地停单个沙箱。只有真实成功才从登记表移除；失败 / 超时保留所有权，让同轮后续
 * 强清可以重试，进程退出后也仍可由 provider 元数据认领。异常打到 stderr 不再静默吞。
 * 供 Sample finalizer 与兜底强清共用,避免重复实现 stop 语义。
 */
export async function stopSandbox(sb: Sandbox, timeoutMs = DEFAULT_STOP_TIMEOUT_MS): Promise<void> {
  let stopped = false;
  try {
    // 超时走 Effect Clock/Sleep:到点 timeoutFail 中断等待 fiber,不再手工维护 timer。
    // sb.stop() 是 provider Promise 叶子,原样保留,失败/超时都不从登记表移除,供同轮重试。
    await Effect.runPromise(
      Effect.tryPromise({
        try: () => sb.stop(),
        catch: (cause) => cause,
      }).pipe(
        Effect.timeoutFail({
          duration: timeoutMs,
          onTimeout: () => new Error(t("sandbox.stopTimeout", { timeoutMs })),
        }),
      ),
    );
    stopped = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 稳定 key 不含具体 sandbox id:同一类失败(如 provider 限流导致大批 stop 超时)去重折叠成
    // 一条永久事件、count 累加,而不是刷屏出几十行几乎相同的诊断;具体是哪个沙箱失败进 data。
    reportDiagnostic({
      key: "sandbox-stop-failed",
      severity: "warning",
      message: t("sandbox.stopFailed", { id: sb.sandboxId, message: msg }).trimEnd(),
      data: { sandboxId: sb.sandboxId, message: msg },
    });
  } finally {
    if (stopped) live.delete(sb);
  }
}

/**
 * 兜底强清:并发停掉所有还登记着的沙箱(各自带超时、各自兜错,绝不抛)。返回尝试停的数量。
 * cli 在二次中断 / graceful 清理超时 / 正常返回后调用 —— 正常跑完时登记表已空,是个 no-op。
 */
export async function stopAllSandboxes(timeoutMs = DEFAULT_STOP_TIMEOUT_MS): Promise<number> {
  const all = [...live];
  if (all.length === 0) return 0;
  reportDiagnostic({
    key: "sandbox-force-cleanup",
    severity: "warning",
    message: t("sandbox.forceCleanup", { count: all.length }).trimEnd(),
    data: { count: all.length },
  });
  await Promise.allSettled(all.map((sb) => stopSandbox(sb, timeoutMs)));
  return all.length;
}
