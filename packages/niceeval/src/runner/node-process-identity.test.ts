// cases: docs/engineering/testing/unit/experiments-runner.md
import { describe, expect, it } from "vitest";
import {
  currentProcessOwnerIdentity,
  exactProcessState,
  makeProcessIdentity,
  type ProcessIdentityRuntime,
} from "./node-process-identity.ts";

const darwinRuntime = (
  overrides: Partial<ProcessIdentityRuntime> = {},
): ProcessIdentityRuntime => ({
  platform: "darwin",
  pid: 41,
  processSessionId: "session-current",
  host: () => "mac.example",
  linuxBootId: () => { throw new Error("unexpected Linux boot read"); },
  linuxProcessStartOf: () => { throw new Error("unexpected Linux process read"); },
  darwinBootSessionUuid: () => "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE\n",
  signalZero: () => undefined,
  ...overrides,
});

describe("exact process identity", () => {
  it("fails closed for remote owners and PID reuse", () => {
    const current = currentProcessOwnerIdentity("test-owner");
    expect(exactProcessState(current)).toBe("alive");
    expect(exactProcessState({ ...current, host: `${current.host}-remote` })).toBe("unknown");
    expect(exactProcessState({ ...current, processStart: `${current.processStart}0` })).toBe("unknown");
    expect(exactProcessState({ ...current, pid: 2_147_483_647 })).toBe("dead");
    if (process.platform === "linux") {
      expect(current.bootId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(current.processStart).toMatch(/^\d+$/u);
    }
  });

  it("keeps Darwin startup usable without treating coarse PID evidence as exact", () => {
    const processIdentity = makeProcessIdentity(darwinRuntime());
    const current = processIdentity.current("darwin-owner");
    expect(current.bootId).toBe("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE");
    expect(current.processStart).toBe("session-current");
    expect(processIdentity.exactState(current)).toBe("alive");
    expect(processIdentity.exactState({ ...current, processStart: "prior-session" })).toBe("unknown");
    expect(processIdentity.exactState({ ...current, pid: 42 })).toBe("unknown");

    const absent = makeProcessIdentity(darwinRuntime({
      signalZero: () => { throw Object.assign(new Error("missing"), { code: "ESRCH" }); },
    }));
    expect(absent.exactState({ ...current, pid: 42 })).toBe("dead");

    const denied = makeProcessIdentity(darwinRuntime({
      signalZero: () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); },
    }));
    expect(denied.exactState({ ...current, pid: 42 })).toBe("unknown");

    for (const darwinBootSessionUuid of [
      () => { throw new Error("sysctl unavailable"); },
      () => " \n",
      () => "not-a-uuid\n",
    ]) {
      const unreadableBoot = makeProcessIdentity(darwinRuntime({ darwinBootSessionUuid }));
      expect(() => unreadableBoot.current("darwin-owner")).toThrow();
      expect(unreadableBoot.exactState(current)).toBe("unknown");
    }

    const rebooted = makeProcessIdentity(darwinRuntime({
      darwinBootSessionUuid: () => "11111111-2222-4333-8444-555555555555\n",
      signalZero: () => { throw new Error("must not inspect a PID from another boot"); },
    }));
    expect(rebooted.exactState({ ...current, pid: 42 })).toBe("dead");
  });
});
