declare const sessionSlotValue: unique symbol;

/**
 * Adapter 私有的会话状态槽。运行时只用 `key` 的 symbol 身份寻址；
 * 非导出品牌让 `T` 在编译期保持不变，不同值类型的 slot 不能互换。
 */
export interface SessionSlot<T> {
  readonly key: symbol;
  readonly [sessionSlotValue]: (value: T) => T;
}

/** 创建一个按 symbol 身份隔离的 Adapter 私有会话状态槽。 */
export function createSessionSlot<T>(name: string): SessionSlot<T> {
  return { key: Symbol(name) } as SessionSlot<T>;
}
