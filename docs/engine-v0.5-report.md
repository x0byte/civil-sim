# Engine v0.5 acceptance report

Implemented seeded shopper arrivals/types, attraction-and-distance choices, one impulse visit per planned leg, meals, shared toilet/lift use, physical exits, retail metrics and quarter-hour headcount. The approved reserved-ID contract at `8a4f9de` is the implementation base.

## Mall weekend, seed 21

Generated **839 shoppers** against an expected 850, plus 8 staff. The main entrance received 576/839 arrivals (68.7%). Everyone left through an exterior door by 21:00. Peak headcount was **120 at 19:30**. Toilet occupancy peaked at 4, within capacity 4; no warnings were emitted.

| Shop | Visits | Pass-bys | Conversion |
|---|---:|---:|---:|
| Pharmacy | 299 | 704 | 42.5% |
| Bookshop | 220 | 612 | 35.9% |
| Phone store | 330 | 899 | 36.7% |
| Clothing | 539 | 1237 | 43.6% |
| Sports | 365 | 876 | 41.7% |
| Electronics | 426 | 1101 | 38.7% |
| Shoes | 295 | 944 | 31.3% |
| Toys | 234 | 530 | 44.2% |
| Food court | 394 | 0 | 0.0% |

The sample food court has no labelled doors, so its door-based pass-bys and conversion are zero. Visits still count. Clothing, the anchor with attraction 3, received more visits than Bookshop (0.6).
Mean shopper stay: 52.64 minutes; mean shops/food stops: 3.70; mean horizontal walk: 155.58 m.

## Verification

- 161 tests passed across 13 files, including complete v0.4 regression hashes for office A/B, sealed-room and mall-day with shoppers omitted.
- Contract validation passed for all 5 sample pairs. Strict engine type checking, including unused-code checks, passed.
- Browser bundle ran without Node globals and matched native results for all 5 sample pairs and the 2,910-shopper case; static distance matrices also matched.
- All tracks in the larger case were checked for floor-specific wall clearance, ordered/bounded times and physical exits. Toilet peak remained within capacity 4.
- Tests cover arrival steps/gaps, type shares/counts, entrance shares, attraction doubling, impulse/food ordering, queue timeouts, lift-only closing, visit/dwell/frontage reconciliation, headcount, connector trip totals and repeatability.

## Timings

Median of three complete native Node simulations on the development machine (runtime only):

| Arrivals | Shoppers | Runs (s) | Median (s) | Limit (s) |
|---|---:|---|---:|---:|
| Weekend | 839 | 1.153, 1.072, 1.062 | **1.072** | 3 |
| Weekend × 3.5 | 2,910 | 1.635, 1.602, 1.593 | **1.602** | 3 |

Reproduce with `npm run benchmark:shoppers --prefix engine`. Performance tests independently use three-run medians; test files execute sequentially to avoid competing for CPU during timing checks.

## Model choices and limits

Shopper walking speed is 1.1 m/s; other people retain 1.3 m/s. Choices use exact reusable room decision points, with independent seeded spots for browsing. Standing/walking collision avoidance is not modelled for shoppers.
Appended steps preserve earlier arrivals, types, planned counts and random streams. Earlier completed tracks are unchanged; extra people can affect future shared waits for an earlier shopper after the new arrivals begin.
Closing reserves a physical stair/escalator fallback where possible. Lift-only escape uses a conservative car-clearance bound, which can shorten or prevent optional upstairs visits for a busy crowd. Entrance weights are normalised when all shares are explicit; the meal windows follow the brief (11:00–14:00 and 18:00–21:00).
All behaviour numbers remain assumptions until calibrated against real entrance and shop-door counts. Detailed rules are in `engine/README.md`. No app, contract or sample source was edited.
