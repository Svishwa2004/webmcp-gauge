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

Check on them: `schtasks /Query /FO LIST /TN "webmcp-gauge\spaced-session-2"` for the
next run time and last result, and `artifacts\spaced-degraded-s2.log` for what it did.

Remove them when the run is done — `/SC ONCE` tasks stay registered after firing:

```
schtasks /Delete /TN "webmcp-gauge\spaced-session-1" /F
schtasks /Delete /TN "webmcp-gauge\spaced-session-2" /F
schtasks /Delete /TN "webmcp-gauge\spaced-session-3" /F
schtasks /Delete /TN "webmcp-gauge\spaced-report" /F
```

## Next steps that land here

1. **Delete the four tasks** once the 17:15 reconcile has produced its report and the
   comparison is published. A stale `ONCE` task is harmless but misleading, and this
   folder is where someone will look for the cleanup command.
2. **A 24-hour spacing, if six hours shows nothing.** Same script, three `/SD` dates
   one day apart. Six hours spans provider load within a day; it does not span a
   deployment, so a null result at six hours is not evidence of stability across days.
3. **This is Windows-only.** If the harness is ever run on another OS, the equivalent
   is three `at`/`cron` entries calling the same CLI — the script is a convenience, not
   a dependency, and `--gap` in `run` does the same thing inside one process (tested,
   but never used for a published run because a twelve-hour process is a single point
   of failure).
