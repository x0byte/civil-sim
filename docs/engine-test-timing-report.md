# Engine test timing

Branch: `engine/test-timing`, based on `integrate/nine-arches` at `08bde54`. No merge or push.

## Changes

- `test/v09.test.ts` — “ends safely and deterministically”: the mall speed guard now takes the median of three runs after one untimed warm-up. Timers surround only `simulate()`. The target remains **strictly below 3,000 ms**. Existing determinism, input immutability, safety, wall-crossing, access, flow and pre-alarm-path assertions are unchanged. The whole-test timeout is explicitly **30 s**, allowing its six full simulations plus assertions; the office row shares this timeout.
- `test/v09.test.ts` — “sends upper-floor step-free people to a refuge, or out by an evacuation lift”: an explicit **20 s** timeout replaces Vitest’s 5 s default for its two full simulations. Behaviour assertions are unchanged.
- `test/v06.test.ts` — both “keeps arrivals × … safe and deterministic, median of three under six seconds” cases: added one untimed warm-up before the existing three simulation-only samples. The **6,000 ms** target, explicit 60 s whole-test timeout and all behaviour assertions remain unchanged.
- These speed checks log their three samples and median, so reports can quote full-suite measurements directly.

No simulation implementation, contracts, app files, sample JSON or golden hashes changed.

## Two consecutive engine runs

Both project Vite servers (ports 5173 and 5174) were stopped. No app tests, builds or benchmark jobs ran concurrently with either engine suite. Same code and targets for both commands: `npm test --prefix engine`.

| Scenario | Run 1 median | Run 2 median | Unchanged target |
| --- | ---: | ---: | ---: |
| mall-weekend-evac | 3.162 s | 3.075 s | 3 s |
| People mall · normal arrivals | 1.963 s | 1.936 s | 6 s |
| People mall · 3.5× arrivals | 4.720 s | 4.644 s | 6 s |

- Run 1: **284/285**, 135.30 s.
- Run 2: **284/285**, 133.34 s.
- The only failure in each run is the mall evacuation’s **3 s speed guard**. The requested 285/285 condition is **not met**; the measured warmed median still exceeds the target. The limit was not raised, bypassed or softened.
- The refuge/lift test passes in both runs: **6.482 s** and **6.282 s**, within its new whole-test timeout.

Raw samples and runtime metadata: [engine-test-timing-results.json](engine-test-timing-results.json). These are full-suite Vitest measurements; they should not be confused with the approximately 2.1 s standalone measurements reported in review. The doorway/sample changes remain present throughout.

## Other checks

- App: **166/166 tests**, 22 files, 19.84 s (`npm test --prefix app`).
- Engine, app and contract type checks: **pass** (`npm run typecheck --prefix engine`, `npm run typecheck --prefix app`, `npm run typecheck:contracts`).
- `npm run check:contracts`: **all 11 sample pairs pass**.
- `git diff --check`: **pass**.

Dev servers remain stopped. Only test measurement/timeout code and these documentation artifacts changed. Achieving 285/285 with this unchanged 3 s guard still requires a speed improvement; the timing-only fix does not claim to provide one.
