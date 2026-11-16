/** A runtime-visible unit, with no implicit conversion or arithmetic. */
export type Unit = "ms" | "seconds" | "tokens" | "usd" | "ratio" | "count" | "bytes";
declare const quantityBrand: unique symbol;
/** Brands a finite number with its runtime unit; comparisons require matching units and perform no implicit conversion. */
export type Quantity<U extends Unit = Unit> = {
  readonly value: number;
  readonly unit: U;
  readonly [quantityBrand]: U;
};

const units: ReadonlySet<string> = new Set(["ms", "seconds", "tokens", "usd", "ratio", "count", "bytes"]);
export function isQuantity(value: unknown): value is Quantity {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { value?: unknown; unit?: unknown };
  return (
    typeof candidate.unit === "string" &&
    units.has(candidate.unit) &&
    typeof candidate.value === "number" &&
    Number.isFinite(candidate.value)
  );
}
function quantity<U extends Unit>(value: number, unit: U): Quantity<U> {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new RangeError(`${unit}() requires a finite number.`);
  if (unit === "ratio" && (value < 0 || value > 1)) throw new RangeError("ratio() requires a value in [0, 1].");
  return Object.freeze({ value, unit }) as Quantity<U>;
}
/** Constructs a millisecond quantity. Nonfinite values throw, and seconds are not converted implicitly. */
export const ms = (value: number): Quantity<"ms"> => quantity(value, "ms");
/** Constructs a quantity in seconds. Nonfinite values throw; use ms explicitly for millisecond observations. */
export const seconds = (value: number): Quantity<"seconds"> => quantity(value, "seconds");
/** Constructs a token quantity for unit-aware comparisons. Nonfinite values throw; the constructor does not count or tokenize text. */
export const tokens = (value: number): Quantity<"tokens"> => quantity(value, "tokens");
/** Constructs a US-dollar quantity for cost comparisons. Nonfinite values throw; the amount is in dollars rather than cents. */
export const usd = (value: number): Quantity<"usd"> => quantity(value, "usd");
/** Constructs a ratio in [0,1]. Values outside that range or nonfinite values throw; pass 0.95 rather than 95 for 95 percent. */
export const ratio = (value: number): Quantity<"ratio"> => quantity(value, "ratio");
/** Constructs a count quantity for unit-aware comparisons. Nonfinite values throw; this constructor does not enforce integer or nonnegative values. */
export const count = (value: number): Quantity<"count"> => quantity(value, "count");
/** Constructs a byte quantity for unit-aware comparisons. Nonfinite values throw; no implicit conversion from text length occurs. */
export const bytes = (value: number): Quantity<"bytes"> => quantity(value, "bytes");

export function formatNumericUnit(value: number, unit?: string): string {
  if (unit === "ratio") return `${Number((value * 100).toPrecision(12))}%`;
  if (unit === "usd") return `$${value}`;
  return unit === undefined ? String(value) : `${value} ${unit}`;
}
