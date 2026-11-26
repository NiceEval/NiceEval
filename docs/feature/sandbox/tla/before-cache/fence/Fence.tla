---- MODULE Fence ----
EXTENDS Naturals
CONSTANT N, Corrected
R == 1..N
VARIABLES state, released
v == <<state,released>>
Init == /\ state=[r \in R |-> "fresh"] /\ released={}
\* watchdog.py:1546-1649. Distinct reservations of one Invocation can concurrently have prepared intent.
Prepare(r) == /\ state[r]="fresh" /\ state'=[state EXCEPT ![r]="prepared"] /\ UNCHANGED released
\* watchdog.py:2826-2832,1511-1544. Durably fence and scrub prepared copies, then client may retry release.
Release(r) == /\ state[r]="prepared" /\ released'=released \cup {r}
              /\ state'=[i \in R |-> IF state[i]="prepared" /\ (~Corrected \/ r=i) THEN "scrubbed" ELSE state[i]]
\* watchdog.py:1681-1739. A late publish from a scrubbed operation is rejected; another active owner can publish.
Publish(r) == /\ state[r]="prepared" /\ state'=[state EXCEPT ![r]="published"] /\ UNCHANGED released
End == UNCHANGED v  \* watchdog.py:2613-2620; no subsequent control request is required.
Next == End \/ \E r \in R: Prepare(r) \/ Release(r) \/ Publish(r)
OnlyReleasedScrubbed == \A r \in R: state[r]="scrubbed" => r \in released
====
