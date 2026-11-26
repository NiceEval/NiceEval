--------------------------- MODULE Provider ---------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS P, Cloud, Labels
VARIABLES pc, idx, inflight, live, stopReq, sig, dead, stoppedOther, labelled, timed
v == <<pc,idx,inflight,live,stopReq,sig,dead,stoppedOther,labelled,timed>>
Actors == 1..P
IDs == Actors \X {1,2}
Id(p) == <<p,idx[p]>>
Own(p) == {i \in IDs : i[1]=p}
Init == /\ pc=[p \in Actors |-> "ready"] /\ idx=[p \in Actors |-> 1]
        /\ labelled={} /\ timed={} /\ inflight={} /\ live={} /\ stopReq={} /\ sig={} /\ dead={} /\ stoppedOther=FALSE
\* sandbox/e2b.ts:495-513, sandbox/runtime.ts:911-915. Fresh per-process request (each new
\* Invocation has its own run ID, provider instance ID and provision token). Old requests can finish later.
Request(p) == /\ pc[p]="ready" /\ p \notin sig /\ pc'=[pc EXCEPT ![p]="sent"]
              /\ inflight'=inflight \cup {Id(p)} /\ UNCHANGED <<idx,live,stopReq,sig,dead,stoppedOther,labelled,timed>>
\* Provider accepts request independently of client process. e2b.ts:495-513 (metadata+TTL),
\* docker.ts:1295-1309 (labels), runtime.ts:914 (custom callback decides).
Allocate(i) == /\ i \in inflight /\ inflight'=inflight \ {i} /\ live'=live \cup {i}
               /\ labelled'=IF Labels THEN labelled \cup {i} ELSE labelled
               /\ timed'=IF Cloud THEN timed \cup {i} ELSE timed
               /\ UNCHANGED <<pc,idx,stopReq,sig,dead,stoppedOther>>
\* Provider rejection before allocation is possible at same API boundary. retry.ts:60-70.
Reject(i) == /\ i \in inflight /\ inflight'=inflight \ {i} /\ UNCHANGED <<pc,idx,live,stopReq,sig,dead,stoppedOther,labelled,timed>>
\* sandbox/runtime.ts:1494-1513. Successful reply registers Scope finalizer; sig during acquire unwinds afterward.
Receive(p) == /\ pc[p]="sent" /\ Id(p) \in live /\ pc'=[pc EXCEPT ![p]="owned"]
              /\ UNCHANGED <<idx,inflight,live,stopReq,sig,dead,stoppedOther,labelled,timed>>
\* sandbox/retry.ts:60-67,86-89. Response lost before or after remote allocation.
Lost(p) == /\ pc[p]="sent" /\ pc'=[pc EXCEPT ![p]=IF Labels /\ idx[p]=1 /\ p \notin sig THEN "lookup" ELSE "end"]
           /\ UNCHANGED <<idx,inflight,live,stopReq,sig,dead,stoppedOther,labelled,timed>>
\* sandbox/e2b.ts:335-353; sandbox/retry.ts:87-116. Successful reconciliation kills currently
\* visible allocations for this provision token; it cannot observe a future late physical allocation.
Reconcile(p) == /\ pc[p]="lookup" /\ p \notin sig /\ pc'=[pc EXCEPT ![p]="ready"]
                /\ idx'=[idx EXCEPT ![p]=2] /\ live'=live \ Own(p)
                /\ UNCHANGED <<inflight,stopReq,sig,dead,stoppedOther,labelled,timed>>
\* sandbox/retry.ts:89-113; cancelled/rejected or failed lookup does not start another request.
EndEarly(p) == /\ pc[p] \in {"ready","lookup"} /\ (p \in sig \/ pc[p]="lookup")
               /\ pc'=[pc EXCEPT ![p]="end"] /\ UNCHANGED <<idx,inflight,live,stopReq,sig,dead,stoppedOther,labelled,timed>>
\* sandbox/runtime.ts:1367-1375; runner/attempt.ts:1279-1307. Finalizer asks to stop its own exact handle.
SendStop(p) == /\ pc[p]="owned" /\ pc'=[pc EXCEPT ![p]="closing"]
               /\ stopReq'=stopReq \cup {Id(p)} /\ UNCHANGED <<idx,inflight,live,sig,dead,stoppedOther,labelled,timed>>
\* e2b.ts:407 onward, stop by sandboxId. A queued stop issued before process loss can land after successor create.
ApplyStop(i) == /\ i \in stopReq /\ stopReq'=stopReq \ {i} /\ live'=live \ {i}
                /\ stoppedOther'=stoppedOther \/ ((live \ live') \ {i} # {})
                /\ UNCHANGED <<pc,idx,inflight,sig,dead,labelled,timed>>
\* sandbox/runtime.ts:1335-1375; attempt.ts:1285-1307. Provider may reject stop and remain live.
StopRejected(i) == /\ i \in stopReq /\ stopReq'=stopReq \ {i}
                   /\ UNCHANGED <<pc,idx,inflight,live,sig,dead,stoppedOther,labelled,timed>>
\* sandbox/runtime.ts:1335-1375; attempt.ts:1285-1307. Model subset: stop replies or is lost after send.
Return(p) == /\ pc[p]="closing" /\ pc'=[pc EXCEPT ![p]="end"]
             /\ UNCHANGED <<idx,inflight,live,stopReq,sig,dead,stoppedOther,labelled,timed>>
\* run.ts:3539-3547; attempt.ts:824-860. Cooperative cancellation, and deadlines after admission.
Signal(p) == /\ p \notin sig \cup dead /\ pc[p]#"end" /\ sig'=sig \cup {p}
             /\ UNCHANGED <<pc,idx,inflight,live,stopReq,dead,stoppedOther,labelled,timed>>
\* docs/feature/sandbox/architecture/lifecycle.md:248-255. External fail-stop between any two owner actions.
Crash(p) == /\ pc[p]#"end" /\ p \notin dead /\ pc'=[pc EXCEPT ![p]="end"] /\ dead'=dead \cup {p}
            /\ UNCHANGED <<idx,inflight,live,stopReq,sig,stoppedOther,labelled,timed>>
\* sandbox/cloud-lifetime.ts:5-10; e2b.ts:505-513. Fair backend TTL for cloud, independently of Runner.
Expire(i) == /\ i \in timed /\ i \in live /\ live'=live \ {i}
             /\ UNCHANGED <<pc,idx,inflight,stopReq,sig,dead,stoppedOther,labelled,timed>>
Step == (\E p \in Actors: Request(p) \/ Receive(p) \/ Lost(p) \/ Reconcile(p) \/ EndEarly(p)
                        \/ SendStop(p) \/ Return(p) \/ Signal(p) \/ Crash(p))
        \/ (\E i \in IDs: Allocate(i) \/ Reject(i) \/ ApplyStop(i) \/ StopRejected(i) \/ Expire(i))
Settled == (\A p \in Actors: pc[p]="end") /\ inflight={} /\ stopReq={}
\* External boundary after local programs and network settle: no further client work. runtime.ts:1373.
Done == Settled /\ UNCHANGED v
Next == Step \/ Done
Spec == Init /\ [][Next]_v /\ WF_v(Step)
NoUnknownOrphan == \A i \in live: pc[i[1]]="end" => (i \in labelled \cup timed \cup stopReq)
StaleStopLeavesSuccessor == ~stoppedOther
DiscoverableEventually == <>(Settled /\ live \subseteq labelled)
ReleasedEventually == <>(Settled /\ live={})
=======================================================================
