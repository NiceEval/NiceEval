# Docker 下载忽略目录仍完整传输归档

Docker downloadDirectory 先完整读回目录归档，再在宿主按路径分段过滤 ignore。只读沙箱还把完整归档编码为 base64，经 exec 传输。公开入口的真实 Docker 代理测量显示：忽略一个 8 MiB 的 node_modules 文件后，下载阶段仍接收 11,348,419 字节；最终宿主文件虽正确，传输开销未被消除。

应在沙箱内创建归档时按字面量目录名排除，再传输剩余内容。保留任意深度 basename 过滤，包含 glob 字符的名字按字面量处理，源目录自身不因 basename 命中而被忽略。只读与可写 Docker 均需验证；归档命令失败不能被 base64 管道掩盖。真实 Unix socket 透明代理只计量下载屏障之间的响应字节，不模拟 Docker API。
