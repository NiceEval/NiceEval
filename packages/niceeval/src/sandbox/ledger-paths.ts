/** 隔离 provider 内的私有分类账路径；runner 与 detached keep 共用唯一口径。 */
export const DEFAULT_LEDGER_GIT_DIR = "/tmp/.niceeval-ledger";
/** 整相导出文件的 runner 私有落点，与 ledger 使用同一固定前缀。 */
export const DEFAULT_LEDGER_EXPORT_DIR = "/tmp/.niceeval-ledger-export";
