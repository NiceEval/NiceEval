import type { ProcessReceipt } from "@niceeval/testkit";
import { expect } from "vitest";

/** Asserts the fixed Sources projection by its stable item fields and closed text content. */
export function expectAttemptSource(
  document: ReturnType<ProcessReceipt["attemptSources"]>,
  expected: { readonly path: string; readonly textIncludes: string },
): void {
  expect(document).toMatchObject({
    protocol: "niceeval.query/v1",
    operation: "attempt.sources",
  });
  const projection = document.sources;
  expect(projection).toMatchObject({
    state: "available",
    hasMore: expect.any(Boolean),
    omittedItemCount: expect.any(Number),
  });
  const source = projection.items.find(({ path }) => path === expected.path);
  expect(source, `missing projected source ${expected.path}`).toBeDefined();
  expect(source).toMatchObject({
    path: expected.path,
    sourceItemId: expect.any(String),
    byteLength: expect.any(Number),
    sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    content: { state: "available", text: expect.any(String) },
  });
  expect(source!.content.state).toBe("available");
  if (source!.content.state === "available") {
    expect(source!.content.text).toContain(expected.textIncludes);
  }
}
