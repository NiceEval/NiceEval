---
format: niceeval.docs-node/v1
kind: use-case
relations: {}
---

# Attachment 怎样保存运行事实

用户想保存新的不可恢复事实时，先选择 owner 与 family，再提交 logical value；不设计 table 或文件布局。

```ts
const energy = Record.attempt({
  family: "acme.energy",
  schema: EnergySchema,
  validate: validateEnergy,
});

yield* attempt.records.write(energy, { joules: 42 });
```

Attempt fact 使用 `Record.attempt()`，Run fact 使用 `Record.run()`。
只需要 ordered plain-data items 时使用 `Record.attemptCollection()`。
definition 是 nominal capability，也是 writer/read/reference selector 与 Host contribution。
第三方 package 能贡献 family，但不能取得 connection、SQL、transaction、authorizer 或 maintenance。

## 一个 logical closure

一个 Attachment 的业务 identity 由 exact owner、family、family revision 与 canonical logical data 决定。Host 把它编码为
generic Attachment、item、reference、Content 与 chunk rows，并在 Run Seal 中列出完整 logical inventory。Family 不拥有 table，
unknown family 也能以 raw canonical rows 保留在 Store 与 Snapshot。

Content source 只能经 builder mint logical handle：

```ts
yield* run.records.write(report, ({ content }) => ({
  body: content.text(reportStream),
}));
```

Host 在 SQLite transaction 外读取 Stream、计算 whole digest 与 byte length，再以 bounded chunk batches 提交。reader 取得
immutable Content capability；`byteLength` 不加载 body，`bytes/text` 先做 admission，`stream` 按 chunk rows 读取。

reference 保存 semantic target identity，不复制目标 Attachment，也不授予其 Content capability。Run Seal 验证 exact owner、
family、reference、Content length/digest、missing 与 extra logical rows。

## 读取一个 family

`reader.read(owner, definition)` 只解释请求的 family。无该 family 是 `not-recorded`；known current rows 通过 Schema、
invariant 与 closure 是 `available`；数据损坏是 `invalid`。无关 unknown family 不阻塞局部读取，direct/reference closure 或
完整验证需要它时才返回 `family-definition-required`。

大 collection 不使用完整数组读取。`openCollection()` 返回 count、digest、completion、limitations 与
`LogicalSealIdentity`，另附 self-scoped Stream。每次 Stream execution 取得 generation lease 和自己的 read-only connection。

## 不属于 Attachment 的内容

- Project writer ticket、mailbox 与 snapshot barrier 属于 Record Host 的 local coordination tables；
- Docker/E2B cache registry、Incus allocation/artifact ledger 与 user-level lease/coordination 属于 UserDatabase 的具名 Repository；
- credential 属于 secret boundary；
- matcher、reuse planning 与当前 worktree 属于 behavior；
- total、P95、ranking 与页面树属于固定 Inspection / Delivery；
- OS-user durable state 与 credential reference 进入 `${NICEEVAL_HOME:-~/.niceeval}/niceeval.sqlite` 的具名 Repository；secret 不入库。
