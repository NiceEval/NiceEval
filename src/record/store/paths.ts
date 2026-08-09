// Store 物理布局只在本模块命名。上层只通过 backend capability 操作，不把路径或可变
// metadata 当作 public API。所有 path 都由已经规范化的 absolute root 派生。

import { join } from "node:path";

export interface LocalStorePaths {
  readonly root: string;
  readonly marker: string;
  readonly objects: string;
  readonly control: string;
  readonly layout: string;
  readonly lease: string;
  readonly fencing: string;
  readonly journal: string;
  readonly staging: string;
  readonly pins: string;
  /** 跨进程 GC 的独占 barrier；只在 GC 开始时创建。 */
  readonly gcBarrier: string;
  /** 每个会改变 GC root / object 集合的单步操作在此登记 admission ticket。 */
  readonly gcAdmissions: string;
  /** read lease 必须跨 reopen / process 可见，GC 才能读取完整 root snapshot。 */
  readonly readLeases: string;
}

/**
 * marker 与 objects 是 unbound Store 的全部初始可观察物；Layout、journal、staging、pin
 * 均只在需要时创建。控制面不放进 object namespace，避免 GC 或 mirror 误把可变文件当对象。
 */
export function localStorePaths(root: string): LocalStorePaths {
  const control = join(root, "control");
  return Object.freeze({
    root,
    marker: join(root, "marker.json"),
    objects: join(root, "objects", "sha256"),
    control,
    layout: join(control, "layout.json"),
    lease: join(control, "write-lease.json"),
    fencing: join(control, "fencing.json"),
    journal: join(control, "journal.json"),
    staging: join(control, "staging"),
    pins: join(control, "pins"),
    gcBarrier: join(control, "gc-barrier.json"),
    gcAdmissions: join(control, "gc-admissions"),
    readLeases: join(control, "read-leases"),
  });
}

/** v1 只允许确认过的 SHA-256 hex；caller 必须先由 protocol validator 验证 descriptor。 */
export function localObjectPath(paths: LocalStorePaths, sha256Hex: string): string {
  return join(paths.objects, sha256Hex.slice(0, 2), sha256Hex.slice(2, 4), sha256Hex);
}

export function localStagingPath(paths: LocalStorePaths, transactionId: string): string {
  return join(paths.staging, `${transactionId}.json`);
}

export function localPinPath(paths: LocalStorePaths, pinId: string): string {
  return join(paths.pins, `${pinId}.json`);
}

export function localReadLeasePath(paths: LocalStorePaths, leaseId: string): string {
  return join(paths.readLeases, `${leaseId}.json`);
}
