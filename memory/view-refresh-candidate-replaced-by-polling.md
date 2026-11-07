# View polling replaces the snapshot being prepared for refresh

Operational View eagerly imported a candidate whenever the Record publication clock changed. Run creation and closure now correctly participate in that clock, so polling could prepare an intermediate snapshot before new Attempts appeared, or retire a candidate while the browser was preparing it. PR 229 browser CI showed a successful refresh retaining the old Attempt; the installed public browser red also reproduced a rejected commit.

The existing Insight contract gives polling only an update hint and fixes a fresh snapshot when the user requests Refresh. The correction reads the latest cutoff on GET, imports on explicit refresh POST, and coalesces concurrent imports. Background reads cannot replace a prepared candidate. Existing Host leases and the CLI scope retain resource ownership; shutdown waits for any pending import and retires its result.

The unchanged operational refresh Journey verifies atomic publication, history navigation, preparation cancellation, unchanged refresh, uncertain commit recovery, and process cleanup. Formal red: nered_7RZWQMZY2SC563PS on the PR 229 installed candidate.
