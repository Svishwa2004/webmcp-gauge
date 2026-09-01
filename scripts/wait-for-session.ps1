# wait-for-session.ps1 — bounded wait until a session has accounted its whole
# plan in the time-spaced checkpoint, recording enough of it that a later
# --resume is a refill rather than a re-measurement.
#
# Used by spaced-session.cmd's report branch, against two failure modes:
#
#  1. A machine that sleeps through both trigger times: Task Scheduler's
#     StartWhenAvailable catch-up starts the session-3 task and the reconcile
#     at the same moment when it wakes. Resuming before session 3 has finished
#     would measure the whole third session back-to-back inside the resume,
#     while two node processes wrote the same checkpoint.
#  2. A hollow session: "accounted" alone would pass while "recorded" stayed
#     low, and the resume would then re-measure most of the session at the
#     reconcile's clock while the report labelled it with the session's. The
#     recorded floor exists for that case; below it the guard aborts and leaves
#     the decision to a human.
#
# "Accounted" = checkpoint records + failure-log lines for the session. A
# session's process runs each planned trial exactly once, so plan accounted is
# the signature of a finished process — a finished session is ALLOWED to end
# short of recorded-complete, because filling that is the reconcile's job.
# (The first version of this script waited for 160 *records*, which no session
# has ever achieved — 158/160 and 143/160 were this arm's first two — and would
# have aborted the reconcile in the normal case. Fixed before it fired.)
#
# exit 0  session complete and recorded well enough — the caller may resume
# exit 2  session hollow, or deadline passed — the caller must abort
#
# Counts match the literal text `"session":N,` — the exact serialization
# core/sweep.mjs writes today. Stable within a run because the same binary
# appends every record; re-check if the emitter ever changes. A concurrently
# appended partial line can miscount one poll; the 30 s cycle self-corrects.
param(
    [int]$Session = 3,
    [int]$PlanSize = 160,
    [int]$MinRecords = 140,
    [int]$Minutes = 45,
    [string]$Checkpoint = "artifacts\spaced-degraded\sweep.jsonl",
    [string]$Failures = "artifacts\spaced-degraded\harness-failures.jsonl"
)

function Count-Session([string]$Path, [int]$N) {
    if (-not (Test-Path $Path)) { return 0 }
    return (Select-String -Path $Path -SimpleMatch ('"session":' + $N + ',') | Measure-Object).Count
}

$deadline = (Get-Date).AddMinutes($Minutes)
while ($true) {
    $recorded = Count-Session $Checkpoint $Session
    $failed = Count-Session $Failures $Session
    $accounted = $recorded + $failed

    if ($accounted -ge $PlanSize) {
        if ($recorded -ge $MinRecords) {
            Write-Output ("session " + $Session + " complete: " + $recorded + " recorded + " + $failed + " failed = " + $accounted + "/" + $PlanSize + " accounted. The resume fills " + $failed + " here plus the earlier sessions' gaps.")
            exit 0
        }
        Write-Output ("session " + $Session + " accounted its plan but recorded only " + $recorded + "/" + $PlanSize + " (floor " + $MinRecords + "): a resume would re-measure most of it at the reconcile's clock. Aborting for a human decision.")
        exit 2
    }
    if ((Get-Date) -ge $deadline) {
        Write-Output ("session " + $Session + " incomplete after " + $Minutes + " min: " + $accounted + "/" + $PlanSize + " accounted (" + $recorded + " recorded).")
        exit 2
    }
    Start-Sleep -Seconds 30
}
