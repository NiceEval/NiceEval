import type { ProjectConfig } from 'concord-sdlc/config';

export default {
  "format": "concord.project/v1",
  "projectId": "niceeval-repot-tool",
  "testRoots": [],
  "sourceRoots": ["packages/niceeval/src"],
  "runner": {
    "kind": "node-test",
    "sourceFiles": [],
    "timeoutMs": 60000
  }
} as const satisfies ProjectConfig;
