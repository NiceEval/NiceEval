import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export const IMAGE_TAG = "niceeval-e2e-openclaw:local";

export function ensureDockerImage(): void {
  const inspect = spawnSync("docker", ["image", "inspect", IMAGE_TAG], { stdio: "ignore" });
  if (inspect.status === 0) return;
  console.log("[openclaw] building docker image " + IMAGE_TAG + " ...");
  const build = spawnSync("docker", ["build", "-t", IMAGE_TAG, "docker"], { stdio: "inherit" });
  if (build.status !== 0) throw new Error("docker build failed for openclaw");
  if (!existsSync("docker/Dockerfile")) throw new Error("missing docker/Dockerfile");
}
