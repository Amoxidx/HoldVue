# Security

HoldVue is local-first. An empty installation makes no provider request and
does not require a secret or API token at runtime. Keyless providers run only
for assets the user explicitly adds. Keep optional provider credentials
outside the repository and inject adapters at the application boundary.

Please do not include wallet addresses, imported portfolio exports, logs with
user data, or credentials in bug reports. Report a suspected vulnerability
privately to the project maintainers before public disclosure.

The public foundation intentionally excludes NFTs, AI/agent dependencies,
automatic uploads, and background network access.
