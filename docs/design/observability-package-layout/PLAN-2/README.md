# PLAN-2：按采集权威切 physical packages

package 跟随 exact owner、事实权威、不可拆 seal transaction、completeness 与 retention policy。
conversation、usage、timing 等是 package 的 local projections，不再天然等于 durable family。

## 候选 inventory

| owner | package | authority |
|---|---|---|
| Run | timing | Run timing collector |
| Run | diagnostics | Run diagnostic collector |
| Run | Capture Receipt | Run coordinator |
| Attempt | Agent events | Adapter event collector |
| Attempt | OTel | OTel collector |
| Attempt | timing | Attempt coordinator timing collector |
| Attempt | diagnostics | Attempt diagnostic collector |
| Attempt | Capture Receipt | Attempt coordinator |

Assertions、Verdict、Score、Sources、Commands、Evaluation 与 provenance 保持各自现有 package，不被并入
Observability inventory。

## 契约

- 一个 package 可投影多个 local views，但 projector 不能读取第二个 package。
- cross-package anchor 由唯一 issuer 在 capture time mint；Relations 不按文本、时间或位置猜测。
- Receipt 为 owner 选择 representation，并把期望穷尽为 sealed、unsupported 或 not-enabled。
- 没有 Receipt 的 legacy owner 走 legacy projector；同一 owner 不自动 union 两种 representation。
- Projection 只看到本候选裁决后固定的 access 与 closed read result。Receipt 状态进入同一个结果联合，
  不另开私有 reader 入口。

本候选的 `PhysicalLayoutState` 穷尽表达 capture-expectation 与 representation-unavailable。
`PhysicalPackageAccess` 绑定 package kind 与 exact owner，并返回
`PackageReadResult<Value, PhysicalLayoutState>`。其它 packages 不认识这个 state 参数。

```ts
type PhysicalLayoutState =
  | {
      readonly state: "capture-expectation";
      readonly packageKind: PhysicalPackageKind;
      readonly expectation: "unsupported" | "not-enabled";
      readonly reason: CaptureExpectationReason;
      readonly receipt: RecordAttachmentLocator;
    }
  | {
      readonly state: "representation-unavailable";
      readonly receipt: RecordAttachmentLocator;
      readonly result: NonAvailableRecordAttachmentRead;
    };

declare const PhysicalPackageAccessBrand: unique symbol;

interface PhysicalPackageAccess<OwnerKind, Payload>
  extends PackageAccess<OwnerKind, Payload, PhysicalLayoutState> {
  readonly packageKind: PhysicalPackageKind;
  readonly [PhysicalPackageAccessBrand]: {
    readonly ownerKind: OwnerKind;
    readonly payload: Payload;
  };
}

declare function definePhysicalPackageAccess<OwnerKind, Payload>(input: {
  readonly owner: PackageOwnerSelection<OwnerKind>;
  readonly packageKind: PhysicalPackageKind;
  readonly family: RegisteredPhysicalPackageFamily<OwnerKind, Payload>;
}): PhysicalPackageAccess<OwnerKind, Payload>;
```

构造器核对 family registry 中的 owner、package kind 与 schema generation，brand 不可由作者构造。

## 生命周期与失败

producer 先 mint durable anchors，再分别 collect、redact、validate 与 seal packages。coordinator 最后 seal
Capture Receipt；publisher 原子选择 `physical-v1`，并拒绝同 owner 双写 legacy 与 physical representation。

package collection failure 不阻止其它独立 package seal。Receipt 读取失败产生 representation-unavailable，
unsupported/not-enabled 产生 capture-expectation；package 自身仍保留 RecordAttachment 六态。I/O、permission、
closed reader 与 interruption 是 typed Effect failure。

## 取舍

本方案保留采集原子性和 source-qualified observations，减少把同一 observation 拆散后再拼回的成本。
代价是读取一个 usage view 可能 materialize 整份 OTel closure，单 schema migration 的 blast radius 也更大。

## 采用条件

真实 OTel 与 Agent events fixture 必须满足 package closure、内存预算和 redaction gate。旧数据只能经 legacy
projection 读取，或另立 cross-family maintenance migration；不得放宽 owner-local converter。

## Cases

- O1：Agent events 与 OTel 独立 seal，以同一个 issuer-minted anchor 建关系，数值仍保持 source-qualified。
- O2：Receipt 声明 OTel unsupported，Assertions package 仍正常 available。
- O3：没有 Receipt 的旧 owner 只走 legacy branch；`physical-v1` owner 只走 physical branch。

## Limits 与扩展

| package | payload 上限 | item 上限 | closure / package 总上限 |
|---|---:|---:|---:|
| OTel | 2 MiB | 4,096 observations | 30 MiB / 32 MiB |
| Agent events | 2 MiB | 2,048 events | 8 MiB / 10 MiB |
| Attempt / Run timing | 1 MiB | 4,096 intervals | 0 / 1 MiB |
| Attempt / Run diagnostics | 512 KiB | 512 diagnostics | 0 / 512 KiB |
| Capture Receipt | 256 KiB | 64 expectations | 0 / 256 KiB |

Projection scheduler 同时持有的 encoded payload 与 closure leases 总计不超过 256 MiB。同步 projector 返回后
释放 host raw reference；该预算不包含 projected views、Report model 或等待 GC 的对象。

新增 package kind 必须有独立 authority 与 seal 理由。package 内部 index 或 range read 属于未来 storage 设计，
不能由 local view 名字暗示已经存在。
