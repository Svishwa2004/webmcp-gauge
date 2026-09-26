# Security policy

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting** — the "Report a vulnerability" button under this repository's **Security** tab. It is enabled. Please do not open a public issue for anything exploit-shaped.

**In scope:** the CLI's own surface — the linter's parsing of untrusted manifests, CDP session and browser-launch handling, report/badge emission, the composite Action's boundary, and credentials handling.

**Out of scope, by design:** what a *measured page* can do. The harness deliberately executes tool calls on pages under test inside a real browser session; running it against a page you do not control is measurement, and no sandboxing claim is made about the measured side. What the harness does commit to is manners, not containment: one page at a time, a delay between projects, an identifying user agent, and `robots.txt` honoured.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | yes |

## Disclosure

Fixed vulnerabilities are credited in the release notes unless the reporter prefers otherwise. No fixed-vulnerability detail is edited out of the published record after the fact — corrections are added, not rewritten.
