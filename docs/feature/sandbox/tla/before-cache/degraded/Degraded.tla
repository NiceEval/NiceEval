---- MODULE Degraded ----
EXTENDS Naturals
CONSTANT K
VARIABLES phase, i, count, recovered
v == <<phase,i,count,recovered>>
Init == /\ phase="search" /\ i=K /\ count=[k \in 1..K |-> 0] /\ recovered=FALSE
\* attempt.ts:3470-3508; deepest-to-shallowest lookup; a miss on the first candidate permits probing key 1 again.
Search == /\ phase="search"
          /\ \E r \in {"hit","miss","error","degraded"}:
              /\ phase'=CASE r="miss" -> IF i=1 THEN "probe" ELSE "search"
                          [] r="hit" -> IF i=K THEN "done" ELSE "probe"
                          [] r="error" -> "recover" [] OTHER -> "replay"
              /\ i'=CASE r="miss" -> IF i=1 THEN 1 ELSE i-1 [] r="hit" -> i+1 [] OTHER -> 1
          /\ UNCHANGED <<count,recovered>>
\* attempt.ts:3512-3554; a failed re-probe after an author action cannot go back to clean Base.
Probe == /\ phase="probe"
         /\ \E r \in {"hit","miss","error","degraded"}:
             /\ phase'=CASE r="miss" -> "action" [] r="hit" -> IF i=K THEN "done" ELSE "probe"
                     [] r="degraded" -> "replay" [] OTHER -> IF \E j \in 1..K: count[j]>0 THEN "failed" ELSE "recover"
             /\ i'=(IF r="hit" THEN i+1 ELSE i) /\ UNCHANGED <<count,recovered>>
\* attempt.ts:3551-3557,3640-3664. Unsupported/contended/continued uncached executes only the suffix.
Action == /\ phase \in {"action","replay"} /\ count'=[count EXCEPT ![i]=@+1]
          /\ phase'=IF phase="action" THEN "capture" ELSE IF i=K THEN "done" ELSE "replay"
          /\ i'=(IF phase="replay" THEN i+1 ELSE i) /\ UNCHANGED recovered
Capture == /\ phase="capture"  \* attempt.ts:3553-3649; capture outcome controls suffix replay.
           /\ \E r \in {"published","continued","error"}:
               /\ phase'=IF r="error" THEN "failed" ELSE IF i=K THEN "done" ELSE IF r="continued" THEN "replay" ELSE "probe"
               /\ i'=i+1 /\ UNCHANGED <<count,recovered>>
\* attempt.ts:3424-3468. A clean-base recovery either fails or replays once.
Recover == /\ phase="recover" /\ phase' \in {"replay","failed"} /\ i'=1 /\ recovered'=TRUE /\ UNCHANGED count
End == phase \in {"failed","done"} /\ UNCHANGED v  \* attempt.ts:3465-3470,3640-3670; return or propagate failure.
Move == Search \/ Probe \/ Action \/ Capture \/ Recover
Spec == Init /\ [][Move \/ End]_v /\ WF_v(Move)
NoReplay == \A j \in 1..K: count[j]<=1
OneRecovery == ~(recovered /\ phase="recover")
Terminates == <>(phase \in {"failed","done"})
====
