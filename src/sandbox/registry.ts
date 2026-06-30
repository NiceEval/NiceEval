// 活动沙箱登记表 + 强制清理兜底。
//
// 中断(Ctrl+C)时,正常路径靠 Effect 的 Scope finalizer 跑 sb.stop() 停容器。但 finalizer
// 这条路不是 100% 可靠:vsb.stop() 这类远端调用可能慢/挂,用户等不及再按一次 Ctrl+C,进程
// 就被硬退了 —— 沙箱成了孤儿(只能等后端 session/TTL 过期)。
//
// 这里维护一份独立于 Effect 的登记表,让 cli 在「二次中断 / graceful 清理超时 / 正常返回后」
// 都能直接、带超时地强停所有还活着的沙箱。stop 不再静默吞异常(原 `.catch(() => {})`),失败打到
// stderr,这样孤儿至少留下痕迹可查。

import type { Sandbox } from "../types.ts";

const live = new Set<Sandbox>();

// 单个 stop 的默认超时:vsb.stop() 偶发慢/挂,清理不能无限等。到点就放弃、记一笔,
// 让流程继续走到退出 —— 没停掉的沙箱靠后端 session/TTL 兜底过期。
const DEFAULT_STOP_TIMEOUT_MS = 8_000;

export function registerSandbox(sb: Sandbox): void {
  live.add(sb);
}

export function liveSandboxCount(): number {
  return live.size;
}

/**
 * 带超时地停单个沙箱。成功 / 失败 / 超时都从登记表移除(失败的靠后端过期兜底),
 * 异常打到 stderr 不再静默吞。供 Scope finalizer 与兜底强清共用,避免重复实现 stop 语义。
 */
export async function stopSandbox(sb: Sandbox, timeoutMs = DEFAULT_STOP_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sb.stop(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`stop 超时(${timeoutMs}ms)`)), timeoutMs);
      }),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`  · [sandbox] 停沙箱 ${sb.sandboxId} 失败(已忽略,靠后端过期兜底):${msg}\n`);
  } finally {
    if (timer) clearTimeout(timer);
    live.delete(sb);
  }
}

/**
 * 兜底强清:并发停掉所有还登记着的沙箱(各自带超时、各自兜错,绝不抛)。返回尝试停的数量。
 * cli 在二次中断 / graceful 清理超时 / 正常返回后调用 —— 正常跑完时登记表已空,是个 no-op。
 */
export async function stopAllSandboxes(timeoutMs = DEFAULT_STOP_TIMEOUT_MS): Promise<number> {
  const all = [...live];
  if (all.length === 0) return 0;
  process.stderr.write(`  · [sandbox] 强制清理 ${all.length} 个沙箱…\n`);
  await Promise.allSettled(all.map((sb) => stopSandbox(sb, timeoutMs)));
  return all.length;
}
