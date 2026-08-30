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
rem  Usage:  spaced-session.cmd 1 | 2 | 3 | report
rem    1..3    run that session into the shared checkpoint
rem    report  reconcile every session, fill any gaps, emit report.json + report.md
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

if "%~1"=="" (
  echo usage: spaced-session.cmd 1^|2^|3^|report
  exit /b 2
)

if /i "%~1"=="report" (
  echo === reconcile + report started %DATE% %TIME% >> artifacts\spaced-degraded-report.log
  node %NODE_ENV_FILE% bin\webmcp-gauge.mjs run --resume --serve fixtures/broken --url "%URL%" --sessions 3 --repeats 1 --concurrency 3 --out "%OUT%" --subject "twin (degraded metadata, 6h-spaced sessions)" >> artifacts\spaced-degraded-report.log 2>&1
  echo === reconcile + report finished %DATE% %TIME% exit=%ERRORLEVEL% >> artifacts\spaced-degraded-report.log
  exit /b %ERRORLEVEL%
)

echo === session %~1 started %DATE% %TIME% >> artifacts\spaced-degraded-s%~1.log
node %NODE_ENV_FILE% bin\webmcp-gauge.mjs session --session %~1 --serve fixtures/broken --url "%URL%" --repeats 1 --concurrency 3 --out "%OUT%" >> artifacts\spaced-degraded-s%~1.log 2>&1
echo === session %~1 finished %DATE% %TIME% exit=%ERRORLEVEL% >> artifacts\spaced-degraded-s%~1.log
exit /b %ERRORLEVEL%
