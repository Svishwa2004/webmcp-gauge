@echo off
rem ---------------------------------------------------------------------------
rem  One session of the time-spaced run (project log item 6).
rem
rem  Back-to-back sessions measure process independence: separate processes,
rem  separate browsers, cold profiles, minutes apart. They cannot see drift in
rem  the provider, the machine or the day, because there is no time between them.
rem  This script exists so each session can be fired hours apart by the Windows
rem  Task Scheduler, which survives a reboot and needs no editor session open.
rem
rem  Usage:  spaced-session.cmd 1 | 2 | 3 | report [wait-minutes]
rem    1..3    run that session into the shared checkpoint
rem    report  reconcile every session, fill any gaps, emit report.json + report.md
rem            Before resuming it waits up to wait-minutes (default 45) for
rem            session 3's trials to be recorded - see the note at :report.
rem
rem  Same shape as the published back-to-back arm it is compared against
rem  (reports\twin-degraded-1.3.0-glm-5.3-s3r1.*): degraded twin, 3 sessions x
rem  1 repeat over all 160 utterances, concurrency 3, judge glm-5.3.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0.."

rem The judge key is NOT in a scheduled task's environment - it lives only inside
rem the interactive session that normally launches the harness. Verified the hard
rem way: the first scheduled firing exited 1 with "No judge API key found". So the
rem credentials come from .env (git-ignored, documented by .env.example) and node
rem loads them itself; a missing .env fails loudly rather than measuring nothing.
set "NODE_ENV_FILE=--env-file=.env"
set "WEBMCP_GAUGE_JUDGE_MODEL=glm-5.3"
set "WEBMCP_GAUGE_JUDGE_BASE_URL=https://agentrouter.org/v1"
set "OUT=artifacts/spaced-degraded"
set "URL=twin.html?variant=degraded"
set "WAIT_MINUTES=45"
if not "%~2"=="" set "WAIT_MINUTES=%~2"

if "%~1"=="" (
  echo usage: spaced-session.cmd 1^|2^|3^|report [wait-minutes]
  exit /b 2
)

if /i not "%~1"=="report" goto :session

rem  The subject records the spacing that actually happened, not the one that was
rem  planned: the 10:15 and 16:15 firings were refused by the scheduler (battery
rem  defaults, see scripts\README.md), so the sessions landed 17.2 h and 12.2 h
rem  apart across a day boundary instead of 6 h and 6 h.
rem
rem  A machine that sleeps through both trigger times gets session 3 and this
rem  reconcile started at the same moment when it wakes, because
rem  StartWhenAvailable is retroactive. Resuming before session 3 has finished
rem  would measure the whole third session back-to-back inside the resume, while
rem  session 3's own process was writing the same checkpoint. So the reconcile
rem  waits until session 3 has accounted its whole plan - recorded or
rem  failure-logged - and recorded at least 140 of 160, and aborts with exit 2
rem  ("could not measure its plan") on timeout or when the session ends too
rem  hollow for a resume to be a refill rather than a re-measurement.
:report
echo === reconcile + report started %DATE% %TIME% >> artifacts\spaced-degraded-report.log
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\wait-for-session.ps1 -Minutes %WAIT_MINUTES% >> artifacts\spaced-degraded-report.log 2>&1
if errorlevel 1 goto :abort

node %NODE_ENV_FILE% bin\webmcp-gauge.mjs run --resume --serve fixtures/broken --url "%URL%" --sessions 3 --repeats 1 --concurrency 3 --out "%OUT%" --subject "twin (degraded metadata, sessions 17h and 12h apart)" >> artifacts\spaced-degraded-report.log 2>&1
echo === reconcile + report finished %DATE% %TIME% exit=%ERRORLEVEL% >> artifacts\spaced-degraded-report.log
exit /b %ERRORLEVEL%

:abort
echo === reconcile aborted, session 3 not complete after %WAIT_MINUTES% min %DATE% %TIME% >> artifacts\spaced-degraded-report.log
exit /b 2

:session
echo === session %~1 started %DATE% %TIME% >> artifacts\spaced-degraded-s%~1.log
node %NODE_ENV_FILE% bin\webmcp-gauge.mjs session --session %~1 --serve fixtures/broken --url "%URL%" --repeats 1 --concurrency 3 --out "%OUT%" >> artifacts\spaced-degraded-s%~1.log 2>&1
echo === session %~1 finished %DATE% %TIME% exit=%ERRORLEVEL% >> artifacts\spaced-degraded-s%~1.log
exit /b %ERRORLEVEL%
