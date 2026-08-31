# Scripts

Glue for runs that outlive an editor session. Nothing here is part of the harness —
each file is a thin wrapper around the same CLI you would type by hand, so the
measurement stays reproducible without the wrapper.

## `spaced-session.cmd 1|2|3|report`

One session of the time-spaced run (PROJECT-LOG item 6). Back-to-back sessions
measure process independence — separate processes, separate browsers, cold profiles,
minutes apart — and say nothing about drift across hours or days. This script exists
so each session can be fired by the Windows Task Scheduler, which survives a reboot
and needs no editor session open.

Shape: the degraded twin, 3 sessions × 1 repeat over all 160 utterances, concurrency
3, judge `glm-5.3` — deliberately the same shape as
`reports/twin-degraded-1.3.0-glm-5.3-s3r1.*`, whose between-session σ was measured
back-to-back at **0.041** on `sum_by_category` and **0.062** on `top_expenses`. All
three sessions append to one checkpoint in `artifacts/spaced-degraded/`; `report`
runs `run --resume`, which fills any gaps and emits the report.

**Credentials come from `.env`**, loaded with `node --env-file=.env`. This is not a
style choice: a scheduled task cannot see a key that exists only inside an
interactive session, and the first firing proved it by exiting 1 in under a second
with `No judge API key found`. Copy `.env.example` to `.env` before scheduling
anything.

### The schedule as created on 2026-08-31

```
schtasks /Create /F /TN "webmcp-gauge\spaced-session-1" /SC ONCE /SD 08/31/2026 /ST 04:15 ^
  /TR "D:\Projects\Hackthon-projects\webmcp-gauge\scripts\spaced-session.cmd 1"
… -2 at 10:15, -3 at 16:15, spaced-report at 17:15
```

### `schtasks /Create` writes a task that refuses to run on battery

Only sessions 1 and 2 of that schedule ever ran. Sessions 2, 3 and the reconcile
first came back with last result `2147946720` = `0x800710E0`, *"the operator or
administrator has refused the request"* — the scheduler declining to start the task,
with no `spaced-degraded-s2.log` to show for it. `schtasks /Query /V` explains it:
Power Management reads **"Stop On Battery Mode, No Start On Batteries"**, and
`StartWhenAvailable` is off, so a laptop on battery gets a refusal and a slot missed
while asleep is never retried. `/Create` has no flag for any of that; PowerShell does:

```
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
       -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 72)
Set-ScheduledTask -TaskPath '\webmcp-gauge\' -TaskName 'spaced-session-3' -Settings $s
```

⚠️ **`StartWhenAvailable` is retroactive.** Turning it on for a `ONCE` task whose start
time has already passed arms it to fire within minutes — for `spaced-report` that means
`run --resume` measuring every remaining session back-to-back and calling the result
time-spaced. Move the trigger in the same command that changes the settings:

```
Set-ScheduledTask -TaskPath '\webmcp-gauge\' -TaskName 'spaced-session-3' `
  -Trigger (New-ScheduledTaskTrigger -Once -At '2026-09-01T09:40:00')
```

### The schedule as it now stands

| Task | Fires | State |
|---|---|---|
| `spaced-session-1` | 2026-08-31 04:18 | ran, 158/160 (2 `judge_truncated`) |
| `spaced-session-2` | 2026-08-31 21:29 | ran, 143/160 (17 `judge_unavailable`) |
| `spaced-session-3` | 2026-09-01 09:40 | armed |
| `spaced-report` | 2026-09-01 10:20 | armed |

Gaps of 17.2 h then 12.2 h, spanning a day boundary rather than the planned 6 + 6.

Check on them: `schtasks /Query /FO LIST /TN "webmcp-gauge\spaced-session-2"` for the
next run time and last result — but use `/V /FO CSV` when something looks wrong, because
the LIST form omits the last result, which is where the refusal above was hiding — and
`artifacts\spaced-degraded-s2.log` for what it did.

Remove them when the run is done — `/SC ONCE` tasks stay registered after firing:

```
schtasks /Delete /TN "webmcp-gauge\spaced-session-1" /F
schtasks /Delete /TN "webmcp-gauge\spaced-session-2" /F
schtasks /Delete /TN "webmcp-gauge\spaced-session-3" /F
schtasks /Delete /TN "webmcp-gauge\spaced-report" /F
```

## Next steps that land here

1. **Delete the four tasks** once the 10:20 reconcile on 2026-09-01 has produced its
   report and the comparison is published. A stale `ONCE` task is harmless but
   misleading, and this folder is where someone will look for the cleanup command.
2. **The 24-hour follow-up is already absorbed**, not pending: the refused firings
   pushed this arm's span to 29.4 h across a day boundary, which is what a separate
   day-apart run was going to buy. What is *not* covered is a repeat at the same
   spacing — one arm cannot separate "spacing does nothing" from "this day was quiet".
3. **A firing from sleep is still unproven.** `WakeToRun` is set on all four tasks and
   has never been observed to wake anything; if the machine is shut down rather than
   asleep, `StartWhenAvailable` runs the task late and the gap becomes whatever the
   timestamps say it was.
4. **This is Windows-only.** If the harness is ever run on another OS, the equivalent
   is three `at`/`cron` entries calling the same CLI — the script is a convenience, not
   a dependency, and `--gap` in `run` does the same thing inside one process (tested,
   but never used for a published run because a twelve-hour process is a single point
   of failure).
