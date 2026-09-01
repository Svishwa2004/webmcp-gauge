# wait-for-session.ps1 — bounded wait until a session's trials are all in the
# time-spaced checkpoint.
#
# Used by spaced-session.cmd's report branch. If the machine sleeps through both
# trigger times, Task Scheduler's StartWhenAvailable catch-up can start the
# session-3 task and the reconcile at the same moment when it wakes. Resuming
# before session 3 lands would measure the whole third session back-to-back
# inside the resume and still call the run time-spaced, while two node processes
# wrote the same checkpoint. This script blocks until the checkpoint holds
# MinRecords lines for Session, or Minutes elapse, whichever comes first.
#
# exit 0  session complete — the caller may resume
# exit 2  deadline passed with the session incomplete — the caller must abort
#
# The count matches the literal text `"session":N,` — the exact serialization
# core/sweep.mjs writes today. Stable within a run because the same binary
# appends every record; re-check if the emitter ever changes.
param(
    [int]$Session = 3,
    [int]$MinRecords = 160,
    [int]$Minutes = 45,
    [string]$Checkpoint = "artifacts\spaced-degraded\sweep.jsonl"
)

$deadline = (Get-Date).AddMinutes($Minutes)
while ($true) {
    if (Test-Path $Checkpoint) {
        $count = (Select-String -Path $Checkpoint -SimpleMatch ('"session":' + $Session + ',') | Measure-Object).Count
    } else {
        $count = 0
    }
    if ($count -ge $MinRecords) {
        Write-Output ("session " + $Session + " complete: " + $count + "/" + $MinRecords)
        exit 0
    }
    if ((Get-Date) -ge $deadline) {
        Write-Output ("session " + $Session + " incomplete after " + $Minutes + " min: " + $count + "/" + $MinRecords)
        exit 2
    }
    Start-Sleep -Seconds 30
}
