// 变更分类账(runner/ledger.ts)GIT_DIR / 导出目录的覆盖登记表,按 sandboxId 做键。
//
// 多数 provider 每次创建都是全新隔离文件系统(容器 / microVM),固定的沙箱内路径天然不会跨
// 实例互相踩踏。宿主本身即工作树的 provider(如 local)不享有这份隔离——同一台宿主机上先后
// 或并发跑的多个 attempt 共享同一个 /tmp,分类账若固定用同一个宿主路径,会在同机多次运行之间
// 相互覆盖彼此的 git 索引与 HEAD。
//
// 这里不是在 ledger.ts 里认 provider 名分支:ledger.ts 只问「这个 sandboxId 有没有登记过覆盖
// 路径,没有就用默认值」,登记者是谁、为什么要登记完全不需要 ledger.ts 关心(核心不出现
// `provider == local` 分支,见 docs/architecture.md)。

export interface LedgerPaths {
  /** 覆盖 runner/ledger.ts 的 GIT_DIR(私有分类账 git 目录)。 */
  gitDir: string;
  /** 覆盖 runner/ledger.ts 的整相导出目录。 */
  exportDir: string;
}

const overrides = new Map<string, LedgerPaths>();

/** provider 在创建沙箱实例时登记一份专属路径(如 local 在 create() 里调用)。 */
export function registerLedgerPaths(sandboxId: string, paths: LedgerPaths): void {
  overrides.set(sandboxId, paths);
}

/** provider 在 stop() 里注销(不影响磁盘上的目录本身——删除由调用方另行负责)。 */
export function unregisterLedgerPaths(sandboxId: string): void {
  overrides.delete(sandboxId);
}

/** ledger.ts 的读取入口:没有登记过就返回 undefined,调用方落到自己的默认常量。 */
export function ledgerPathsFor(sandboxId: string): LedgerPaths | undefined {
  return overrides.get(sandboxId);
}
