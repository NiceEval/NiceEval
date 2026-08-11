// 单个可变 capability 的操作序列。GC admission 只负责 Store-wide snapshot 线性化；同一
// transaction / lease / pin 的 terminal transition 还必须在本对象内排队，不能要求调用方自行
// 避免并发的 commit、renew、abort 或 close。

export class LocalCapabilitySerial {
  #tail: Promise<void> = Promise.resolve();

  run<A>(operation: () => Promise<A>): Promise<A> {
    const result = this.#tail.then(operation);
    // 后继永远在 settled 后继续；前一操作的 typed failure 必须传回自己的 caller，却不能让
    // capability 永久卡在一个 rejected queue 上。
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
