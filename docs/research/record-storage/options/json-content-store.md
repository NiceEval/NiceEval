# 候选二：JSON envelope + Host 私有 Content store

> 状态：Content-only 重构的领先对照方案

结构化事实、owner/family identity、status 与 Seal 使用 canonical JSON；逻辑 Content 由 Host 自动 inline、写单 object 或拆成 segments。
作者和 family Schema 只看 Content handle。

## 可能的物理形态

下面只说明责任，不预先定 wire layout：

```text
record/
├── record.json
└── runs/
    └── <run-id>/
        ├── core.json
        ├── attachments/...
        ├── collections/...
        └── content/...
```

singleton attachment 可以继续是一份 JSON envelope。
若未来采用 generic collection，items 可以进入 JSONL、固定大小 shard 或逐项 object，并由 Host 建私有 index。
Content manifest 保存 logical byte length、overall digest、ordered segments 与必要的 per-segment integrity。

小 Content 是否 inline、多个小 Content 是否 pack、segment size 多大，都属于 Host storage revision。

## 写入与发布

1. Host 在 portable root 外写 staging item/object/segment；
2. 边读 Content source 边计算 length 与整体 digest；
3. 写满私有 segment 后立即释放该 segment buffer；
4. closure 完整后写 manifest/envelope；
5. Run 的全部 owner/family 与 Seal 验证通过后，以整个 Run directory 的 no-replace rename 发布。

崩溃留下的 unreferenced staging files 不进入 portable root。
published Run directory 是复制和校验单位；不依赖外部 cache。

## 收益

- 最小幅度延续当前 Record 与 blob Roadmap；
- 大 Content 的峰值内存可与 segment size 绑定；
- JSON envelope 仍可 diff、诊断和用 strict decoder 验证；
- 目录 rename 已与多文件 closure 对齐；
- 直接把大 Content pipe 到 export/file，不需要 seal 时重写一次完整 Run database。

## NiceEval 必须自己拥有的协议

- collection JSONL/shard 的 item boundary、canonical order 与 index；
- segment/manifest 的完整性与 orphan cleanup；
- 多文件 transaction 和 envelope-last publication；
- 大量小 Content 的 file-count 与 pack 策略；
- storage revision、unknown family copy 与 migration；
- hostile path、symlink、partial file 与 resource-limit 防御。

若只实现 Content segments，这个清单仍有界。
若再实现 generic collection、分页、唯一索引、transactional reference inventory 与 pack，Host 会逐步重造一部分 embedded database。

## 适用条件

- create-once family 保持为主；
- 主要失败来自大/深材料和 Content 内存；
- direct streaming 与 JSON envelope 可诊断性比单文件更重要；
- Run directory 已足够 portable，不要求每 Run 一个 application file。

## 翻转条件

出现以下事实时应重新比较 SQLite：

- 多个核心 family 正式需要数万 item 的多次 write 和 lazy page read；
- 自管 collection index、unique constraint 与 transactional inventory 开始超过 Content segment 协议；
- 大量小 Content 导致真实 file-count/metadata I/O 问题；
- 产品明确要求一 Run 一文件，而不是 opaque directory。
