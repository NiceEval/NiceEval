const HEX = "0123456789ABCDEF";

/**
 * Package-owned display seam for ExperimentId. Valid Unicode stays literal;
 * malformed UTF-16 becomes a reversible code-unit representation before it
 * enters the scalar-only Report document.
 */
export function displayClassicExperimentId(experimentId: string): string {
  if (isWellFormedUtf16(experimentId)) {
    return experimentId;
  }
  return `utf16-code-units:"${escapeUtf16CodeUnits(experimentId)}"`;
}

function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (isHighSurrogate(codeUnit)) {
      if (!isLowSurrogate(value.charCodeAt(index + 1))) {
        return false;
      }
      index += 1;
    } else if (isLowSurrogate(codeUnit)) {
      return false;
    }
  }
  return true;
}

function escapeUtf16CodeUnits(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (isHighSurrogate(codeUnit) && isLowSurrogate(value.charCodeAt(index + 1))) {
      escaped += value[index]! + value[index + 1]!;
      index += 1;
      continue;
    }
    if (codeUnit === 0x5c) {
      escaped += "\\\\";
    } else if (codeUnit === 0x22) {
      escaped += "\\\"";
    } else if (codeUnit === 0x08) {
      escaped += "\\b";
    } else if (codeUnit === 0x09) {
      escaped += "\\t";
    } else if (codeUnit === 0x0a) {
      escaped += "\\n";
    } else if (codeUnit === 0x0c) {
      escaped += "\\f";
    } else if (codeUnit === 0x0d) {
      escaped += "\\r";
    } else if (
      codeUnit <= 0x1f
      || (codeUnit >= 0x7f && codeUnit <= 0x9f)
      || isHighSurrogate(codeUnit)
      || isLowSurrogate(codeUnit)
    ) {
      escaped += unicodeEscape(codeUnit);
    } else {
      escaped += value[index]!;
    }
  }
  return escaped;
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff;
}

function unicodeEscape(value: number): string {
  return `\\u${HEX[(value >>> 12) & 0xf]}${HEX[(value >>> 8) & 0xf]}${HEX[(value >>> 4) & 0xf]}${HEX[value & 0xf]}`;
}
