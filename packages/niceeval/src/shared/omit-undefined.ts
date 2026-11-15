/**
 * 宽可选值到精确可选类型的边界转换。
 *
 * NiceEval 自有类型的可选属性默认写 `x?: T | undefined`,值为 `undefined` 与键缺失等价。
 * 只有键是否存在会被观察的边界(Record JSON、身份摘要材料、覆盖默认值的合并补丁、
 * 第三方精确可选类型)才要求键缺失。规则见 `docs/engineering/code-style/README.md#可选属性`。
 */
export type OmitUndefined<T extends object> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** 返回去掉值为 `undefined` 的自有可枚举键后的浅拷贝;其它值(含 `null`)原样保留。 */
export function omitUndefined<T extends object>(value: T): OmitUndefined<T> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as OmitUndefined<T>;
}
