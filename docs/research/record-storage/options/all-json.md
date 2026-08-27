# 候选一：全 JSON

> 状态：已研究，不推荐

每个 Run 保存一份 canonical JSON；所有结构化事实、collection 和 Content 都在同一 document 中。
binary 需要 base64，text 需要 JSON escaping。

## 物理形态

```text
record/
├── record.json
└── runs/
    └── <run-id>.json
```

writer 在 local staging 形成完整 JSON，验证后以 no-replace rename 发布。
reader 必须至少对包含目标值的完整 document 做语法 parse。

## 收益

- 格式和工具链最简单；
- Git、diff、手工检查与 emergency recovery 最直接；
- 不需要 database runtime、manifest、segment 或 pack protocol；
- 单文件 publication 容易解释。

## 无法消除的成本

- binary base64 至少引入编码膨胀；
- append 一个 item 需要重写整份 Run；
- `JSON.parse()` 和 canonical encode 的峰值内存随整份 Run 增长；
- 读取一个 family metadata 仍可能加载无关 Artifact bytes；
- 修改 storage/core metadata 会重写所有业务材料；
- 深层或巨大 snapshot 继续触发 JSON shape/byte limits。

分块 base64 字符串或 `part-1`/`part-2` 字段不会改变根因；它只把物理 chunk 泄漏进业务 schema。

## 判断

全 JSON 只适合所有 payload 都小、有界、常一起读取的系统。
NiceEval 已经允许单个 64 MiB Content，并有真实 Assertion material 超过 JSON 预算的问题条目，所以不能把它作为下一代 Record 的默认物理层。

短、常读、需要筛选的字段仍应保持 JSON 语义；排除的是「所有 bytes 都必须内联一份 JSON」，不是排除 JSON 本身。
