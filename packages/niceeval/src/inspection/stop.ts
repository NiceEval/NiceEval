import type { readInspectionAssertions } from "./facts.ts";
import type { InspectionAttemptResult } from "./results.ts";

export function stoppedAssertion(
  assertions: ReturnType<typeof readInspectionAssertions>,
): InspectionAttemptResult["stoppedAt"] {
  if (assertions.state !== "available") return { state: "unavailable", reason: "not-recorded" };
  const entry = assertions.value.entries.find(
    (entry) => entry.control.state === "available" && entry.control.value === "stopped",
  );
  if (entry !== undefined)
    return { state: "available", value: { entryId: entry.entryId, label: entry.display.label ?? entry.entryId } };
  if (assertions.value.entries.some((entry) => entry.control.state === "unavailable"))
    return { state: "unavailable", reason: "not-recorded" };
  return { state: "available", value: null };
}
