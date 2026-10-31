# civil-sim: rules for coding agents

civil-sim lets architects, builders and clients test a building layout before it is built:
draw or trace a floor plan, fill it with simulated people, and see how they move and where
the layout causes problems. The product owner makes all scope decisions.

## Who owns what

| Folder | Owner | Notes |
|---|---|---|
| `contracts/` | Product owner | **Locked.** Read it, build against it, never edit it. See `contracts/README.md` |
| `samples/` | Shared | Edit `samples/generate.ts`, then `npm run samples`. Don't hand-edit the JSON |
| `app/` | Claude | The editor and viewer (browser UI) |
| `engine/` | Codex | The simulation core (no UI) |
| `docs/` | Shared | Decisions, roadmap, change requests |

Never edit another agent's folder. If you need something from the other side, write it in
`docs/contract-change-requests.md`.

## Working rules

- TypeScript everywhere. Code must run in a browser; Node-only APIs (`fs`, `path`) stay out of `app/src` and `engine/src`.
- Import contract types straight from `contracts/*.ts`; don't copy them.
- Work on your own branch in your own git worktree. Never commit to `master` directly.
- Before you finish: `npm run check:contracts` and your own tests must pass.
- Record any decision a future developer would need in `docs/decisions.md` (one short entry).
