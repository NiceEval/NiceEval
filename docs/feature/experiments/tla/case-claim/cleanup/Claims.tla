---- MODULE Claims ----
EXTENDS Naturals, FiniteSets
CONSTANTS N, K, Fixed, Fault
P == 1..N
Keys == 1..K
VARIABLES key, pc, row, seen, reaped, duplicate, retry
v == <<key,pc,row,seen,reaped,duplicate,retry>>
\* Each process requests one case once, with a fresh owner ID. Thus its ID
\* identifies an entire owner+generation tuple, including after takeover.
Init == /\ key \in [P -> Keys] /\ pc = [p \in P |-> "new"]
        /\ row = [k \in Keys |-> 0] /\ seen = [p \in P |-> 0]
        /\ reaped = {} /\ duplicate=FALSE /\ retry = {}
Phase(p,s) == pc' = [pc EXCEPT ![p] = s]
Slot(p,i) == row' = [row EXCEPT ![key[p]] = i]
Dead(p) == IF p=0 THEN FALSE ELSE pc[p]="dead"
Proof(p) == Dead(p) /\ Fault # "unknown"
\* case-repository.ts:66-87. Database commits before returning handle.
Acquire(p) == /\ pc[p]="new" /\ row[key[p]]=0 /\ Phase(p,"ack") /\ Slot(p,p)
              /\ UNCHANGED <<key,seen,reaped,duplicate,retry>>
\* runner/lock.ts:115-129; runner/run.ts:2651-2657. Read/probe is outside takeover txn.
Inspect(p) == /\ pc[p]="new" /\ row[key[p]]#0
              /\ Phase(p,IF Proof(row[key[p]]) THEN "cas" ELSE "poll")
              /\ seen'=[seen EXCEPT ![p]=row[key[p]]]
              /\ UNCHANGED <<key,row,reaped,duplicate,retry>>
\* runner/run.ts:2587-2598. A persistent row loops until another poll changes the outcome.
Poll(p) == /\ pc[p]="poll"
           /\ (row[key[p]]=0 \/ (Fixed /\ Proof(row[key[p]])))
           /\ Phase(p,"new") /\ UNCHANGED <<key,row,seen,reaped,duplicate,retry>>
\* Failed CAS always restarts acquisition from the database. The observation
\* may now see a free case, an active replacement, or another dead owner.
Take(p) == /\ pc[p]="cas"
           /\ IF seen[p]=row[key[p]]
              THEN /\ Phase(p,"ack") /\ Slot(p,p)
                   /\ duplicate'= (duplicate \/ seen[p] \in reaped)
                   /\ reaped'=reaped \cup {seen[p]}
              ELSE /\ Phase(p,"new") /\ UNCHANGED <<row,duplicate,reaped>>
           /\ UNCHANGED <<key,seen,retry>>
\* case-repository.ts:130-147 as part of run/storage/sqlite.ts:788-789 (baseline).
\* Optional external recover request for a Run with this planned case.
Cleanup(k) == /\ Fault="cleanup" /\ Proof(row[k]) /\ row'=[row EXCEPT ![k]=0]
              /\ duplicate'= (duplicate \/ row[k] \in reaped)
              /\ reaped'=reaped \cup {row[k]}
              /\ UNCHANGED <<key,pc,seen,retry>>
\* runner/lock.ts:212-216,232-258; the interruptible acquire can lose delivery.
Receipt(p) == /\ pc[p]="ack" /\ Phase(p,"holding")
              /\ UNCHANGED <<key,row,seen,reaped,duplicate,retry>>
Lost(p) == /\ pc[p]="ack" /\ p=1 /\ Fault="acquire-loss" /\ Phase(p,"new")
           /\ UNCHANGED <<key,row,seen,reaped,duplicate,retry>>
\* runner/lock.ts:236-254, case-repository.ts:97-103.
Release(p) == /\ pc[p] \in {"holding","retry"} /\ row[key[p]]=p
              /\ Slot(p,0) /\ Phase(p,"done") /\ UNCHANGED <<key,seen,reaped,duplicate,retry>>
\* case-repository.ts:97-103 commits, worker reply is lost (client.ts:177-187).
LostRelease(p) == /\ pc[p]="holding" /\ p=1 /\ Fault="release-reply" /\ row[key[p]]=p
                  /\ Phase(p,"lostrelease") /\ Slot(p,0) /\ retry'=retry \cup {p}
                  /\ UNCHANGED <<key,seen,reaped,duplicate>>
\* lock.ts:237-276. Retry reconciles an absent/superseded row, without releasing the successor.
ConfirmRelease(p) == /\ pc[p]="lostrelease" /\ row[key[p]]#p /\ Phase(p,"done")
                     /\ UNCHANGED <<key,row,seen,reaped,duplicate,retry>>
\* transaction.ts:10-19,24-30: deadline before commit rolls back.
\* lock.ts:238-251: before fix the next release returns success immediately.
Timeout(p) == /\ p=1 /\ Fault="release-timeout" /\ pc[p]="holding"
              /\ Phase(p,IF Fixed THEN "retry" ELSE "spent") /\ retry'=retry \cup {p}
              /\ UNCHANGED <<key,row,seen,reaped,duplicate>>
\* lock.ts:238 (old release local no-op).
RetrySpent(p) == /\ pc[p]="spent" /\ Phase(p,"done")
                 /\ UNCHANGED <<key,row,seen,reaped,duplicate,retry>>
\* External process termination between any two steps; case-repository.ts:65,130-147
\* Only original actor may crash in liveness workload; both successors survive.
Crash(p) == /\ p=1 /\ pc[p]#"dead" /\ Phase(p,"dead")
            /\ UNCHANGED <<key,row,seen,reaped,duplicate,retry>>
\* case-repository.ts:89-103 stale heartbeat/release of previously delivered tuple.
\* A fully retired owner (normal release committed) has no second authority.
Late(p) == /\ pc[p]="done" /\ row[key[p]]#p /\ UNCHANGED v
\* run.ts:2594-2598: readable, nonmissing lock gives no progress, actual poll repeats.
Idle == /\ (\A p \in P: pc[p] \in {"done","dead","poll"}) /\ UNCHANGED v
Work(p) == Acquire(p) \/ Inspect(p) \/ Poll(p) \/ Take(p) \/ Receipt(p) \/ Release(p) \/ RetrySpent(p) \/ ConfirmRelease(p)
Next == (\E p \in P: Work(p) \/ Lost(p) \/ LostRelease(p) \/ Timeout(p) \/ Crash(p) \/ Late(p)) \/ (\E k \in Keys: Cleanup(k)) \/ Idle
Spec == Init /\ [][Next]_v /\ (\A p \in P: WF_v(Work(p))) /\ (\A k \in Keys: WF_v(Cleanup(k)))
ReclaimOnRequest == \A k \in Keys: (Dead(row[k])) ~> (~Dead(row[k]))
Exclusive == \A k \in Keys: Cardinality({p \in P: key[p]=k /\ pc[p]="holding"})<=1
HandlesMatch == \A p \in P: pc[p]="holding" => row[key[p]]=p
ReapedOnce == ~duplicate
ReleasedMeansFree == \A p \in P: pc[p]="done" => row[key[p]]#p
WaiterFinishes == \A p \in P\{1}: <>(pc[p]="done")
ReleasedReplySettles == \A p \in P: (pc[p]="lostrelease") ~> (pc[p] \in {"done","dead"})
Retryable == \A p \in P: (p \in retry /\ pc[p]#"dead") ~> (row[key[p]]#p \/ pc[p]="dead")
====
