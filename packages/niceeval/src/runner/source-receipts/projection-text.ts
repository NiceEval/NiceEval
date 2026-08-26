import {
  makeBoundedSafeText,
  utf8ByteLength,
  type NonNegativeSafeInteger,
  type PositiveSafeInteger,
  type SafeText,
} from "../../record/family/source-receipt/model.ts";
import { requiredNonNegative, requiredPositive } from "./support.ts";

export interface RetainedText {
  readonly text: SafeText;
  readonly retainedBytes: NonNegativeSafeInteger;
  readonly omittedBytes?: PositiveSafeInteger;
}

/** Never split a Unicode scalar or retain a non-SafeText source value. */
export function retainSafeText(value: string, maximumBytes: number): RetainedText | undefined {
  const whole = makeBoundedSafeText(value, maximumBytes);
  if (whole !== undefined) {
    return Object.freeze({
      text: whole,
      retainedBytes: requiredNonNegative(utf8ByteLength(value)),
    });
  }
  const totalBytes = utf8ByteLength(value);
  if (totalBytes <= maximumBytes) return undefined;

  let retained = "";
  let retainedBytes = 0;
  for (const scalar of value) {
    const scalarBytes = utf8ByteLength(scalar);
    if (retainedBytes + scalarBytes > maximumBytes) break;
    retained += scalar;
    retainedBytes += scalarBytes;
  }
  const safe = makeBoundedSafeText(retained, maximumBytes);
  const omittedBytes = totalBytes - retainedBytes;
  if (safe === undefined || omittedBytes <= 0) return undefined;
  return Object.freeze({
    text: safe,
    retainedBytes: requiredNonNegative(retainedBytes),
    omittedBytes: requiredPositive(omittedBytes),
  });
}
