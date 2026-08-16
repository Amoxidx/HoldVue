# Contributing

Changes should remain local-first, deterministic, and narrowly scoped.

- Read `CLAUDE.md` before editing.
- Keep tests offline; inject all external adapters.
- Use synthetic fixtures only under `test/fixtures`.
- Run `npm test`, `npm run coverage`, `npm run typecheck`, and `npm run build`.
- Do not add secrets, real wallet data, NFT support, AI runtime dependencies,
  or network calls in unit tests.
