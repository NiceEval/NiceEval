---- MODULE Journal ----
EXTENDS Naturals
CONSTANT P, Corrected
VARIABLES record, acknowledged, state, turn
v == <<record,acknowledged,state,turn>>
Init == /\ record="old" /\ acknowledged=FALSE /\ state="idle" /\ turn \in 1..P
\* watchdog.py:736-745; kernel may append all bytes or a positive prefix while reporting success.
Write == /\ state="idle" /\ \E written \in {"full","part"}: /\ record'=written /\ state'="append"
         /\ UNCHANGED <<acknowledged,turn>>
\* watchdog.py:744-745; corrected write loop completes before fsync. Projected on last record.
Complete == /\ state="append" /\ record="part" /\ Corrected /\ record'="full" /\ UNCHANGED <<acknowledged,turn,state>>
Sync == /\ state="append" /\ (~Corrected \/ record="full") /\ state'="ack" /\ acknowledged'=TRUE /\ UNCHANGED <<turn,record>>
\* watchdog.py:752-757; detected write error rolls back this append before returning.
Rollback == /\ state="append" /\ state'="failed" /\ record'="old" /\ UNCHANGED <<turn,acknowledged>>
\* watchdog.py:715-735; stop between syscalls can leave partial tail; recovery fails closed.
Crash == /\ state \in {"idle","append","ack","failed"} /\ state'="down" /\ UNCHANGED <<record,acknowledged,turn>>
Read == /\ state="down" /\ state'=(IF record="part" THEN "closed" ELSE "recovered") /\ UNCHANGED <<record,acknowledged,turn>>
End == state \in {"recovered","closed"} /\ UNCHANGED v  \* watchdog.py:715-735; recovered state or fail-closed startup.
Next == Write \/ Complete \/ Sync \/ Rollback \/ Crash \/ Read \/ End
AckIsRecoverable == acknowledged => record="full"
PartialNeverAdmitted == state="recovered" => record#"part"
====
