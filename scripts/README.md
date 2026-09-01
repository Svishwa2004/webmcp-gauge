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
waits for session 3 to be complete, then runs `run --resume`, which fills any gaps
and emits the report — see the catch-up guard below.

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

### The schedule as it actually ran

| Task | Slot | What happened |
|---|---|---|
| `spaced-session-1` | 2026-08-31 04:15 | ran 04:18, 158/160 (2 `judge_truncated`) |
| `spaced-session-2` | 10:15, refused → re-armed 21:29 | ran 21:29, 143/160 (17 `judge_unavailable`) |
| `spaced-session-3` | 16:15, refused → re-armed 09:40 → **run by hand** | ran 06:41 on 2026-09-01, 148/160 (12 `judge_unavailable`) |
| `spaced-report` | 17:15, refused → re-armed 10:20 → **run by hand** | three passes 06:53–07:09: 30 of 31 refills, then `find_anomalies-10` on the 5th attempt — **480/480, exit 0** |

Gaps of 17.2 h then 9.2 h, spanning a day boundary rather than the planned 6 + 6. Session 3 was run by hand at the operator's call (valid — the arm's condition is "hours apart", not "12.2 h apart") after both remaining tasks were disabled; the spacing is recorded wherever the arm is cited.

All four tasks were deleted after the run completed. Recreating them is the `schtasks /Create` block above plus the PowerShell settings fix below — do not recreate them without the fix.

Check on any future scheduling: `schtasks /Query /FO LIST /TN "webmcp-gauge\…"` for the
next run time and last result — but use `/V /FO CSV` when something looks wrong, because
the LIST form omits the last result, which is where the refusal above was hiding — and
`artifacts\spaced-degraded-sN.log` for what it did.

### If the machine sleeps through both triggers: the catch-up collision, and its guard

Power on this machine (checked 2026-09-01, `powercfg /a` + `/query`): **Modern
Standby only** — S0 Low Power Idle, S1/S2/S3 unsupported by the firmware, hibernate
disabled — and the balanced plan sleeps **never on AC, after 15 min on battery**.
Two consequences:

- `WakeToRun` is unreliable at best here: classic wake timers target S3 or
  hibernate, and this firmware has neither. (Unconfirmed — `powercfg /waketimers`
  needs elevation.) Treat "the machine will wake for the 09:40 firing" as false.
- If the laptop is on battery it sleeps after 15 min, and `StartWhenAvailable` then
  starts **session 3 and the report at the same moment** whenever the machine next
  wakes. The report is `run --resume`, which fills every gap — including all of
  session 3 — so an unguarded catch-up would measure the whole third session
  back-to-back inside the resume, while session 3's own process was writing the
  same checkpoint file.

So the `report` branch refuses to resume until session 3 has **accounted its whole
plan** — every one of the 160 trials either recorded or failure-logged, which is
what a finished session actually looks like (158/160 and 143/160 were this arm's
first two; the refill exists precisely because sessions end short) — **and
recorded at least 140**, so a hollow session cannot be silently re-measured at the
reconcile's clock. `scripts\wait-for-session.ps1` polls both checkpoint files
every 30 s for up to 45 min (session 3 normally takes ~12); it exits 0 when the
session is complete enough, and 2 — "could not measure its plan", the harness's
own contract — on timeout or when the recorded floor is missed, either way
leaving the decision to a human. Tested without spending a trial against the real
two-session checkpoint: session 1 (158 + 2) passes, session 2 (143 + 17) passes
at the default floor and aborts at a raised one, nothing-accounted times out, and
`spaced-session.cmd report 0` aborts end to end before node starts — that form is
also the emergency brake.

If an abort happens for real (session 3's task died or was deleted): fix whatever
stopped session 3, re-arm or hand-run it, then re-fire `scripts\spaced-session.cmd
report` — or `report 90` for a longer wait.

**Operationally: keep the machine plugged in and logged on until ~10:45.** On AC it
never sleeps and everything fires on time. On battery the guard keeps the run
*honest* — late, wider spacing, timestamps saying so — but cannot keep it *on
schedule*.

One bug fixed in passing: the report branch used to be one parenthesized `if`
block, and `exit /b %ERRORLEVEL%` inside a block expands at parse time, so a failed
reconcile would have exited 0. Both branches are now linear `goto` code, where the
exit code is read after `node` runs. The session branch was already linear, which
is why sessions 1 and 2 correctly reported exit 2.

## Next steps that land here

1. ~~**Delete the four tasks**~~ ✅ **Done 2026-09-01**, after the reconcile's report and the published comparison (`reports/spacing-2026-09-01.md`).
2. **The 24-hour follow-up is already absorbed**, not pending: the refused firings pushed this arm's span to 26 h across a day boundary. What is *not* covered is a repeat at the same spacing, or the definitive drift control — one arm back-to-back and one arm spread over the *same* window, interleaved. One arm cannot separate "spacing does nothing" from "this day was quiet"; the spaced arm's monotone decline (see the write-up) is the reason that control is now worth running.
3. **A firing from sleep will not be proven here.** The firmware has no S3 and
   hibernate is disabled (`powercfg /a`: S0 Low Power Idle only), so the wake timer
   `WakeToRun` relies on has nothing classic to target — `powercfg /waketimers`
   would confirm, but it needs elevation. The working answer is operational (stay
   on AC) plus structural (the guard above turns a late catch-up into a
   wider-spaced run rather than a corrupted one).
4. **This is Windows-only.** If the harness is ever run on another OS, the equivalent
   is three `at`/`cron` entries calling the same CLI — the script is a convenience, not
   a dependency, and `--gap` in `run` does the same thing inside one process (tested,
   but never used for a published run because a twelve-hour process is a single point
   of failure).
