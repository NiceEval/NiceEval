import { describe, expect, it } from "vitest";
import { inventoryOwnerCounts, taskBuildInventoryState } from "./docker-task-build-cache.ts";

describe("Docker cache inventory ownership projection", () => {
  it("keeps crashed owner claims protected without reporting them active", () => {
    const counts = inventoryOwnerCounts(
      [{ holder: "live" }, { holder: "crashed" }],
      ({ holder }) => holder === "live",
    );

    expect(counts).toEqual({ total: 2, live: 1, unverified: 1 });
    expect(taskBuildInventoryState("sha256:image", "sha256:image", counts.live, counts.unverified))
      .toBe("unverified");
  });

  it("reports active only from a verified image and verified-live lease", () => {
    expect(taskBuildInventoryState("sha256:image", "sha256:image", 1, 0)).toBe("active-leased");
    expect(taskBuildInventoryState("sha256:image", "sha256:image", 0, 0)).toBe("cold-reusable");
    expect(taskBuildInventoryState(undefined, "sha256:image", 1, 0)).toBe("unverified");
  });
});
