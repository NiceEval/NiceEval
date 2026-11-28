# Eval usage reads have no declaration, so usage-coverage changes cannot be conditioned into identity

### Expected workflow

When an Adapter changes how it reports usage coverage, a project can identify the Evals whose results depend on that coverage before planning a run. Those Evals receive the relevant behavior identity. Evals that cannot observe the change retain their execution identity.

### Current gap and impact

A NiceEval Eval can read usage during an Attempt through `t.usage`, `session.usage`, `turn.usage`, or a matcher context. Coverage can change a token quantity from `exact` to `lower-bound` and change the result of an upper-limit assertion. The Eval definition has no way to declare that it depends on usage coverage. The planner computes the execution identity before the Eval runs.

An Eval can choose an accessor using a runtime value. A source scan for known usage API names misses that accessor, and a revision for the entire Adapter would invalidate Evals that never read usage. The Codex native retry coverage correction retains existing execution identities, so a prior result can remain eligible for reuse even when a fresh run would yield a different usage snapshot.

### Usage example

In an Eval whose deterministic Agent fixture replies with a property name, this callback reads the Turn's usage when the reply is `usage` and reads its reply when the reply is `reply`. Both executions have the same Eval definition.

```ts
async test(t) {
	const turn = await t.send("fixture");
	const observed = Reflect.get(turn, turn.reply);
	t.note("observed", JSON.stringify(observed) ?? null);
}
```

### Version and provenance

Observed while investigating the official Codex Adapter on NiceEval `main` at `eead2ba98424a81f7b29fb9d1f9a011831293919`, Linux, Node 24.22.2, pnpm 12.21.0, and Codex 0.171 app-server v2. The Codex protocol regression uses a deterministic JSON-RPC fixture and the public `attempt.usage` query. The dynamic accessor example needs no Provider, credentials, or network access. This report contains no private results, credentials, or vulnerability details.


