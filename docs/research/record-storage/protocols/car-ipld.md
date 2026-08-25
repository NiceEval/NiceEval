# CAR 与 IPLD

> 观察日期：2026-08-25
>
> 规范状态：CARv1 Final；CARv2 Draft

CAR 保存 content-addressed IPLD blocks。
它提供流式 block framing 与 CID 校验；CARv2 再提供可选的 digest-to-offset index。

## CARv1

CARv1 由一个 DAG-CBOR header 与后续 block sections 组成。
每个 section 是 `varint length + CID + block bytes`，适合顺序写入和扫描。

CARv1 header 列出 root CIDs，但规范明确指出：

- deterministic block order 由应用 profile 决定；
- root 不保证整个 DAG closure 都存在；
- archive 可以含不属于 root DAG 的 blocks；
- 原生格式没有 index；
- 需要区分完整 archive 时，应使用外部 whole-file digest。

因此 CID 能证明“这段 block bytes 匹配 key”，不能单独证明“这个 Run 没有 missing/extra member”。

## CARv2

CARv2 在完整 CARv1 payload 外增加固定 pragma/header，并在尾部增加可选 index。
header 保存 data offset、data size 与 index offset；index 把 multihash digest 映射到 CARv1 payload offset。

CARv2 主要优化按 CID 随机读取。
它没有增加 Attempt/family order、transaction、capture complete 或 reference closure。
规范当前仍标为 Draft，页面列出的实现成熟度也弱于 MCAP 与 SQLite。

## 可能的 NiceEval profile

```text
raw block
  → bounded Content segment 或 canonical item bytes

DAG-CBOR manifest block
  → owner/family/revision、ordered segment CIDs、references

root CID
  → Run manifest entry point

CARv2 index
  → CID to block offset

NiceEval outer Seal
  → exact block/member inventory 与 publication complete
```

这个 profile 会把 content addressing 提升为 storage identity。
若 NiceEval 不需要跨 Run dedup、CID exchange 或 DAG traversal，CID、multicodec 与 DAG layout 是额外协议成本。

logical Content 还需要 manifest 规定 segment order、overall byteLength 与 overall digest。
collection 也需要 canonical ordinal/identity；CAR block order不能直接成为业务顺序。

## 研究判断

CARv1 是比自定义 `length + digest + bytes` 更成熟的 block framing 候选。
CARv2 index 也可以替代一部分 CID lookup 实现。

但 NiceEval 的主要 lookup key 是 owner/family/handle，不是 CID。
要兑现 ordinary family read，仍需一层 manifest/DAG 与可能的业务 index。
要兑现 exact Run closure、crash publication 与 migration，仍需 NiceEval outer protocol。

CAR/IPLD 只有在 content addressing 本身成为明确产品能力时才值得进入完整 spike。
它不应因为“自带 hash”而自动成为 Record storage 领先候选。

## 官方资料

- [CAR specifications index](https://ipld.io/specs/transport/car/)
- [CARv1 specification](https://ipld.io/specs/transport/car/carv1/)
- [CARv2 specification](https://ipld.io/specs/transport/car/carv2/)
- [IPLD schemas](https://ipld.io/specs/schemas/)
