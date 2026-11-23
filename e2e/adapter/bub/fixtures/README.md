# Bub protocol sample

`bub-0.6.1.tape.jsonl` captures two turns in one Bub 0.6.1 session with a loopback Chat Completions server.
The first turn invokes `fs_write` and then returns text. The resumed turn returns only text. Each model call reports usage with cache and reasoning tokens.
The fixture redacts the system instructions and normalizes the temporary workspace path.

`replay.mjs` feeds the captured tape into the public Adapter through a Sandbox fixture. `test/protocol.test.ts` also appends synthetic unknown events to exercise diagnostics.
