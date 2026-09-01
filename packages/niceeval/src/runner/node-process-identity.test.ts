// cases: docs/engineering/testing/unit/experiments-runner.md
import { describe, expect, it } from "vitest";
import { currentProcessOwnerIdentity, exactProcessState } from "./node-process-identity.ts";

describe("exact Linux process identity", () => {
  it("fails closed for remote owners and PID reuse", () => {
    const current = currentProcessOwnerIdentity("test-owner");
    expect(exactProcessState(current)).toBe("alive");
    expect(exactProcessState({ ...current, host: `${current.host}-remote` })).toBe("unknown");
    expect(exactProcessState({ ...current, processStart: `${current.processStart}0` })).toBe("unknown");
    expect(exactProcessState({ ...current, pid: 2_147_483_647 })).toBe("dead");
  });
});
