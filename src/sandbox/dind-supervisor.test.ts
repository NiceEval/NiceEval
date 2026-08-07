// cases: docs/engineering/testing/unit/sandbox.md

import { describe, expect, it } from "vitest";
import {
  DIND_BOOTSTRAP_SOURCE,
  DIND_SHUTDOWN_GRACE_SECONDS,
  DIND_SUPERVISOR_SOURCE,
  dindContainerCommand,
  dindSupervisorRevision,
} from "./dind-supervisor.ts";

describe("DinD provider-owned launcher", () => {
  it("overrides image startup with a constant protocol and reserves shutdown grace", () => {
    const command = dindContainerCommand(1200, "/tmp/niceeval-agent.log");

    expect(command.Entrypoint).toEqual(["sh", "-c"]);
    expect(command.Cmd).toEqual([
      DIND_BOOTSTRAP_SOURCE,
      dindSupervisorRevision(),
      DIND_SUPERVISOR_SOURCE,
      String(1200 - DIND_SHUTDOWN_GRACE_SECONDS),
      "/tmp/niceeval-agent.log",
    ]);
    expect(DIND_BOOTSTRAP_SOURCE).toContain("dind-image-incompatible: missing $tool");
    expect(DIND_BOOTSTRAP_SOURCE).toContain('exec docker-init -- node -e "$1"');
    expect(DIND_SUPERVISOR_SOURCE).toContain("--host=unix:///var/run/docker.sock");
    expect(DIND_SUPERVISOR_SOURCE).toContain('"--shutdown-timeout=2"');
    expect(DIND_SUPERVISOR_SOURCE).not.toContain("tcp://");
  });
});
