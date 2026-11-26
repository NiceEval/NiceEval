---- MODULE Prefix ----
EXTENDS Naturals, FiniteSets
CONSTANT K, Corrected
VARIABLES pc, cursor, data, seed, satisfied
v == <<pc,cursor,data,seed,satisfied>>
Keys == 1..K
\* At entry the longest durable prefix may be warm to any depth. Model a single Attempt on complete private clones.
Init == /\ pc="search" /\ cursor=K /\ data={} /\ satisfied=0
        /\ \E d \in 0..K: seed=[k \in Keys |-> IF k<=d THEN 1..k ELSE {}]
\* attempt.ts:3470-3506; docker-profile/before-cache.ts:176-197 rotates, then restores or starts an empty Base.
Search == /\ pc="search"
          /\ LET hit == seed[cursor]#{} IN
             /\ data'=seed[cursor] /\ satisfied'=IF hit THEN cursor ELSE 0
             /\ cursor'=IF hit THEN cursor+1 ELSE IF cursor=1 THEN 1 ELSE cursor-1
             /\ pc'=IF hit /\ cursor=K THEN "done" ELSE IF hit \/ cursor=1 THEN "probe" ELSE "search"
          /\ UNCHANGED seed
\* attempt.ts:3519-3554; runtime.ts:324-336 replaces the reservation. Miss starts from a scrubbed slot.
Probe == /\ pc="probe" /\ data'=(IF Corrected /\ satisfied>0 /\ seed[cursor]={} THEN seed[satisfied] ELSE seed[cursor]) /\ pc'="execute" /\ UNCHANGED <<cursor,satisfied,seed>>
\* attempt.ts:3551; an independent action can succeed without consulting the parent's state.
Action == /\ pc="execute" /\ data'=data \cup {cursor} /\ pc'="capture" /\ UNCHANGED <<cursor,satisfied,seed>>
\* docker-profile/before-cache.ts:231-267; host can attest an exact copy of incomplete logical state.
Capture == /\ pc="capture" /\ seed'=[seed EXCEPT ![cursor]=data] /\ satisfied'=cursor
           /\ cursor'=cursor+1 /\ pc'=(IF cursor=K THEN "done" ELSE "probe") /\ UNCHANGED data
End == pc="done" /\ UNCHANGED v  \* attempt.ts:3640-3670; continue into normal dispatch.
Next == Search \/ Probe \/ Action \/ Capture \/ End
CorrectPrefix == \A k \in Keys: seed[k]={} \/ seed[k]=1..k
ReadyForAction == pc="execute" => data=1..(cursor-1)
====
