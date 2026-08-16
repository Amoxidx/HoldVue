# HoldVue repository rules

These rules are fail-closed. If a requested action would violate one of them,
stop and ask for direction.

- Write only inside this repository. Do not read or copy private projects,
  user-data files, build backups, downloads, keychains, environment secrets,
  wallet holdings, or credentials.
- Never add secrets, private wallet addresses, personal holdings, hostnames,
  absolute user paths, generated user data, or real provider responses.
- Never publish, upload, push, create remotes/releases, or contact external
  services as part of local development.
- Do not run destructive commands. Do not delete or overwrite unknown user
  changes. Use `apply_patch` for manual edits.
- Keep the default portfolio empty. Test fixtures must be obviously synthetic
  and live under `test/fixtures`.
- No NFTs, no AI/agent runtime dependency, and no OpenAI runtime dependency.
- Network adapters must be injected behind interfaces. The default app must not
  silently call live networks, and unit tests must remain offline.
- Preserve the 100% coverage gate for implemented product logic. Never use
  coverage ignores to hide product branches.
