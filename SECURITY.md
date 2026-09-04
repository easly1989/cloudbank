# Security Policy

CloudBank handles personal financial data, so we take security seriously even during early development.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, report privately via one of:

- GitHub's [private vulnerability reporting](https://github.com/easly1989/cloudbank/security/advisories/new) (preferred), or
- email to the maintainer at the address on the [GitHub profile](https://github.com/easly1989).

Please include:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if possible),
- affected version / commit.

We aim to acknowledge reports within a few days and will keep you informed about the fix and disclosure timeline. Coordinated disclosure is appreciated.

## Supported versions

Security fixes target the **latest stable release** (the `:main` container tag) and the current `main` branch. Older tagged releases are not maintained — upgrade to the latest before reporting.

## Scope

In scope: authentication/session handling, wallet data isolation between users, injection, CSRF/XSS, and container hardening. Out of scope: issues requiring a pre-compromised host or physical access to the server.
