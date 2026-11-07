# Docker exec 累计重解码导致重复复制与跨块字符损坏

Docker exec 的每次 data 回调在 demuxer.push 前后分别读取累计 stdout/stderr，再按字符串长度切增量。stdout()/stderr() 每次都 concat 全部已收集 Buffer，造成大输出的重复复制；UTF-8 字符跨 chunk 时，前一个累计解码得到的 replacement character 长度还会使后续 slice 丢失完整字符。

改为每条流独立的增量 UTF-8 decoder，把本次完整帧 payload 交付回调，最终结果只合并一次。保留帧拆分处理、串行异步回调、退出与取消收尾。公开 Docker 命令用文件屏障固定分割 UTF-8 字符，并核对 8 MiB 输出的流与最终摘要。性能复杂度还需要同环境公开大文件读取的前后测量；字符完整性红灯不冒充性能测量。
