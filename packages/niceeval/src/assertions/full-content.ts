import type { AssertionMaterial, CapturedAssertionSnapshot } from "./api.ts";
import { captureAssertionSnapshot } from "./runtime.ts";
import { encodeAssertionSnapshotJson } from "./snapshot-json.ts";

const contentByMaterial = new WeakMap<AssertionMaterial, string>();

/** @internal Complete data-only content; the Runtime value remains a display preview. */
export function captureFullAssertionSnapshot(value: unknown): CapturedAssertionSnapshot {
  const content = encodeAssertionSnapshotJson(value);
  const { material } = captureAssertionSnapshot(JSON.parse(content), undefined, true);
  contentByMaterial.set(material, content);
  return {
    material,
    coverage: { state: "complete" as const },
    limitations: [],
  };
}

export function transferFullAssertionContent(from: AssertionMaterial, to: AssertionMaterial): void {
  const content = contentByMaterial.get(from);
  if (content !== undefined) contentByMaterial.set(to, content);
}

export function fullAssertionContentOf(material: AssertionMaterial): string | undefined {
  return contentByMaterial.get(material);
}
