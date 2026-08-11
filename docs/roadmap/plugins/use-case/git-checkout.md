# Plugin use case: repository seed

A Plugin resource can prepare a repository seed that is already available to the Sandbox provider。
The resource demand contains only public repository identity, revision and destination path。 Credential transport and private Git authentication are outside this contract。

```ts
const seed = defineSandboxResource<"docker", SeedDemand, SeedHandle>({
  receiver: "docker",
  behaviorRevision: "1",
  demand: ({ repository, revision, into }) => ({ repository, revision, into }),
  materialize: (demands, context) => acquireSeeds(demands, context),
  prepare: (handle, demand, context) => prepareSeed(handle, demand, context),
  release: (handle, context) => releaseSeeds(handle, context),
});
```

`materialize` reports physical progress and facts once。 `prepare` can check a seed digest and report Attempt-specific timing。
It runs before Plugin Sandbox commands。 The same definition works with fresh and pooled physical Sandboxes。
Core never receives its resource handle。
