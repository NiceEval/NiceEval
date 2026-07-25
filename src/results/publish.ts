// 发布预算(见 docs/feature/record/library.md「复制与瘦身:copySnapshots」)。
// 结果数据分两类:.niceeval/ 是本地事实根,不是默认可提交目录;任何要离开本机的拷贝是
// 发布拷贝,经 copySnapshots 这一条管线产出。管线只做选择、归拢与整文件大小预检,
// 不改写内容——保密边界由格式在采集侧划定(env 值与命令 stdout/stderr 不进结果文件)。

/** 发布前整文件预检的单文件上限(50 MiB,为 GitHub 100 MB 硬限保留余量);不是可调旋钮。 */
export const PUBLISH_FILE_MAX_BYTES = 50 * 1024 * 1024;
