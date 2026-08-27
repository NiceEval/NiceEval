# ZIP64、TAR 与 PAX

> 观察日期：2026-08-25

ZIP 与 TAR 都能把多个 named entries 封装进一个可搬运文件。
它们的成熟工具链很有价值，但 archive member 不是 NiceEval owner/family/Content 的自然模型。

## ZIP64

ZIP 为每个 entry 写 local file header、data 与可选 data descriptor，并在尾部写 central directory。
data descriptor 允许 writer 在开始 entry 时还不知道 CRC 与最终大小。
ZIP64 扩展把大 entry、offset 与 archive count 提升到 64-bit 表示。

central directory 提供按 entry name 的随机定位。
entry CRC32 提供随机损坏检测，但不提供 cryptographic logical digest。

对 NiceEval 的限制是：

- active append 或 update 最终仍要形成新的 central directory；
- central directory 关闭 archive entries，不关闭 family/reference/capture 语义；
- 规范允许大量通用 metadata、重复 name 与多种 compression/encryption 形态；
- hostile reader 仍须限制 entry count、name/path、ratio、size、offset 与 overlap；
- 多个 rolling ZIP files 仍需 outer catalog 与 exact Run Seal。

ZIP profile 可以禁止 extraction，只允许按固定 canonical name 读取 entry bytes。
这能避免 path traversal 成为业务能力，但不会自动提供 collection item index 或 logical Content segment order。

## TAR/PAX

TAR 是 512-byte records 组成的顺序 archive。
member header 通常先声明 size，payload 后补齐到 record boundary；PAX 扩展保存较大的 size 与可扩展 metadata。

TAR 支持顺序创建与未压缩 archive append，工具链非常成熟。
它没有标准随机读取 index；header checksum 只保护 header，不校验 member payload。
whole-archive gzip/zstd 等压缩还会削弱按 member seek 与 append。

未知长度 logical Content 若成为一个 TAR member，writer 必须先知道 size、使用私有分段 member，或先 staging 再写 archive。
任何选择都需要 NiceEval profile 定义 logical handle 与 ordered segments。

## 研究判断

ZIP64/TAR 最适合发布/export transport，而不是 active Record 的唯一真相。
它们确实能替代“把目录打成一个文件”的封装代码，却不能替代 item log、transaction、lazy business index、unknown-family migration 或 exact Seal。

若未来目标只是把已经 sealed 的 opaque Run directory 交付给外部系统，ZIP64 比新 storage protocol 更合理。
若目标是边 capture 边 durable append，它不比 MCAP 或 SQLite 更贴近工作负载。

## 官方资料

- [PKWARE ZIP APPNOTE 6.3.9](https://pkwaredownloads.blob.core.windows.net/pkware-general/Documentation/APPNOTE-6.3.9.TXT)
- [GNU tar manual](https://www.gnu.org/software/tar/manual/tar.html)
- [GNU tar compression constraints](https://www.gnu.org/software/tar/manual/html_section/Compression.html)
