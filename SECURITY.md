# Security policy

This is a static documentation site with no backend, no accounts, and no user
data. The realistic surface is the build tooling, the dependency tree, and the
client-side widget code.

## Reporting a vulnerability

Please report privately. Do not open a public issue.

- Preferred: open a [private security advisory](https://github.com/danielsousaoliveira/cs-fundamentals/security/advisories/new).
- Alternative: email danielsousaoliveira77@gmail.com with "SECURITY" in the
  subject.

Include what you found, how to reproduce it, and the affected version or commit.

## What to expect

- Acknowledgement within 7 days.
- An assessment and a fix or mitigation timeline within 30 days.
- Credit in the fix notes if you want it.

## Scope

In scope: dependency vulnerabilities that affect the build or the deployed site,
XSS or injection in a widget, anything that lets a page execute unintended code
in a reader's browser.

Out of scope: findings that require a compromised maintainer machine, social
engineering, and volumetric or denial-of-service testing against GitHub Pages.
