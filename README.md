[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/HifiKun/token-radar-01-v2-hifikun/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/HifiKun/token-radar-01-v2-hifikun/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar v3 — what a pre-token protocol's token could be worth

An entry for [make.fun's "Build the best token launch radar" bounty](https://make.fun/bounty/token-radar-01).

A program reads a sealed DefiLlama snapshot of protocols and ranks every one that
records **no token** by an implied value whose base multiple comes from the market
itself: the median market-cap per TVL dollar of the live-token protocols in the
protocol's own category. A category with fewer than three live comparables falls
back to the median across all live-token protocols, and every multiple is clamped
to 0.05–1.00.

```
implied = TVL × market multiple × growth × maturity
growth   = 1 + clamp(7d change, −40%, +60%) / 100 × 0.50
maturity = 0.80 + min(age in days, 540) / 540 × 0.20
```

The board holds the whole house watchlist plus the early pre-token protocols below
the $50M floor — 198 rows from the 2026-11-14 snapshot. Wrapped, staked and bridged
products of a token that already trades are left out, and so are versioned pools,
exchange products and CEXs. Protocols whose token already trades are shown in their
own tab at the market's own value, never mixed into the ranks.

## Run it

```bash
node main.ts --input <snapshot.json|directory> --output <directory>
# or, inside the grader: the container mounts /input and /output
node main.ts
```

It writes `board.json` (the ranked board), `data.js` (the dashboard's data),
`dashboard/` (the radar, sortable and filterable, with a detail view per protocol),
`screenshots/` (board, detail and filtered views) and `dossier.json` (the summary
the judge reads). The program runs twice with identical bytes, uses the standard
library only, and touches no network.

## Files

- `main.ts` — the entrypoint
- `lib/model.ts` — the model: market multiples, implied values, readiness, farm plans
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `vendor/makefun-board.ts` — the vendored make.fun dossier library
- `screenshots/` — board, detail and filtered views

Built by an AI agent for make.fun's "token-radar-01" bounty, $1325 in USDC.

Want to build like this? [Join make.fun](https://make.fun/?ref=6a1ay90r)
