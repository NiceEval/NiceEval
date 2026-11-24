---------------------------- MODULE LeaseCAS ----------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Atomic, Exact
Keys == 1..3
Procs == 1..3
Members(p) == {p, IF p = 3 THEN 1 ELSE p+1}
VARIABLES pc, head, owner, heldGen, heartbeat, staleMutation
vars == <<pc, head, owner, heldGen, heartbeat, staleMutation>>
Init == /\ pc = [p \in Procs |-> "waiting"]
        /\ head = [k \in Keys |-> 0] /\ owner = [k \in Keys |-> 0]
        /\ heldGen = [p \in Procs |-> head] /\ heartbeat = [k \in Keys |-> 0]
        /\ staleMutation = FALSE
Take(p, keys) ==
    /\ pc[p] = "waiting"
    /\ \A k \in keys: owner[k] = 0
    /\ head' = [k \in Keys |-> IF k \in keys THEN head[k]+1 ELSE head[k]]
    /\ owner' = [k \in Keys |-> IF k \in keys THEN p ELSE owner[k]]
    /\ heldGen' = [heldGen EXCEPT ![p] = head']
    /\ pc' = [pc EXCEPT ![p] = IF \A k \in Members(p): owner'[k] = p THEN "held" ELSE "waiting"]
    /\ UNCHANGED <<heartbeat, staleMutation>>
Acquire(p) == IF Atomic THEN Take(p, Members(p)) ELSE
    LET missing == {k \in Members(p): owner[k] # p} IN
      \E k \in missing: Take(p, {k})
Release(p) ==
    /\ pc[p] = "held"
    /\ \A k \in Members(p): owner[k] = p /\ head[k] = heldGen[p][k]
    /\ owner' = [k \in Keys |-> IF k \in Members(p) THEN 0 ELSE owner[k]]
    /\ head' = [k \in Keys |-> IF k \in Members(p) THEN head[k]+1 ELSE head[k]]
    /\ heartbeat' = [k \in Keys |-> IF k \in Members(p) THEN 0 ELSE heartbeat[k]]
    /\ pc' = [pc EXCEPT ![p] = "done"]
    /\ UNCHANGED <<heldGen, staleMutation>>
LateWrite(p) ==
    /\ pc[p] = "done"
    /\ LET accepts(k) == k \in Members(p) /\ (~Exact \/ (owner[k] = p /\ head[k] = heldGen[p][k])) IN
      /\ heartbeat' = [k \in Keys |-> IF accepts(k) THEN p ELSE heartbeat[k]]
      /\ staleMutation' = (staleMutation \/ (\E k \in Keys: accepts(k)))
    /\ UNCHANGED <<pc,head,owner,heldGen>>
Done == /\ \A p \in Procs: pc[p] = "done" /\ UNCHANGED vars
Advance == \E p \in Procs: Acquire(p) \/ Release(p)
Next == Advance \/ (\E p \in Procs: LateWrite(p)) \/ Done
Spec == Init /\ [][Next]_vars /\ WF_vars(Advance)
WholeSet == \A p \in Procs: {k \in Keys: owner[k] = p} =
    IF pc[p] = "held" THEN Members(p) ELSE {}
NoLateWrite == ~staleMutation
Settles == <>(\A p \in Procs: pc[p] = "done")
=========================================================================
