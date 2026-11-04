# Contract change requests

Need something the contracts don't allow? Add an entry here instead of editing `contracts/`.
The product owner marks it approved or rejected.

## v0.7: Comfort totals for people without a profile in a profiled scenario
- Requested by: Codex, 2026-11-03
- Status: **approved — option 1, product owner, 2026-11-03**
- `contracts/scenario.ts` permits a kind with no share list to retain the average person, without `Track.profileId`, even when `profiles.list` exists. Comfort applies to everyone along their actual paths.
- `contracts/results.ts` currently specifies one `metrics.comfort.byProfile` row per listed profile, and permits a default row with `profileId: ""` only **without profiles**. The brief also requires by-profile minutes to reconcile with the tracks' discomfort stretches. People without an assigned profile have no row in that mixed case.
- Concrete example: one staff member assigned profile `worker`, and one visitor whose kind has no share list or explicit assignment. If the visitor has five dim minutes, their track must contain that stretch. A result containing only the `worker` row cannot report the visitor's minutes without mislabelling them or failing the totals check.
- **Recommended option 1:** retain every listed profile row in list order, then append one `profileId: ""` row when any tracks have no assigned profile. This row uses their default tolerances and reconciles their actual stretches. With no profiles, retain the existing single default row, including for an empty population. No new field or type is needed; clarify the row semantics.
- **Option 2:** keep the strict listed-profile rows, leave unprofiled people's discomfort on their tracks only, and explicitly limit the by-profile reconciliation requirement to people with assigned profiles. This leaves the table's total below the building total in mixed scenarios.
- Preparation completed: the six complete pre-change v0.6.1 hashes are captured from `6503fc5` in `engine/test/data/v061-full-sha256.json`; branch `engine/v0.7` starts at the approved contract branch. All eight contract sample pairs pass. Contracts, app and sample JSON remain untouched.

Template:

```
## <short title>
- Requested by: <Claude | Codex | name>, <date>
- Change: <what field/type changes>
- Why: <what it unblocks>
- Breaks: <what the other side must update>
- Status: open
```

## v0.2: Lunch breaks, visitors, and how full rooms get
- Requested by: Claude, 2026-11-01
- Status: **approved** by the product owner, 2026-11-01, including the optional validation-codes fix

**In plain words.** Offices need two more things to feel real: a **lunch break** (some people eat in the pantry, some go out, the rest eat at their desk) and **visitors** (they come in, wait at reception, go to a meeting or an office, and leave; they have no desk). To show the effect, the results also report **how full each room gets at its busiest moment**, e.g. "Pantry: 11 people at 12:40".

**Change: `scenario.ts` (version "0.1" → "0.2")**
- New optional `lunch`:
  `{ windowStart: ClockTime; windowEnd: ClockTime; durationMin: number; pantryShare: number; outShare: number }`
  Each person starts lunch at a seeded time inside the window. `pantryShare` of people eat in a pantry, `outShare` leave the building through an exterior door, and the rest eat at their desk. Shares are 0–1 and add up to at most 1.
- New optional `visitors: Visitor[]`:
  `{ id: string; arrive: ClockTime; waitMin: number; spaceId: string; durationMin: number }`
  A visitor enters by an exterior door, waits `waitMin` in a reception space (skipped if there is none), goes to `spaceId` for `durationMin`, then leaves. Visitor ids may appear in `Meeting.attendeeIds`.

**Change: `results.ts` (version "0.1" → "0.2")**
- `Activity` adds `"lunch"` (eating in a pantry) and `"waiting"` (visitor at reception). Lunch out of the building is `"absent"`; lunch at the desk is `"at_desk"`.
- `SimEventType` adds `"lunch_start"`, `"lunch_end"`, `"visitor_arrive"`, `"visitor_leave"`.
- `Track` adds `kind: "staff" | "visitor"`.
- `Metrics` adds `peakOccupancy: { spaceId: string; peak: number; t: number }[]`: for every space, the most people in it at once and when (first time, if tied).

**Change: `validate.ts`**
- Checks the new fields: lunch window inside the workday, shares in range, visitor ids unique and different from staff ids, visitor `spaceId` exists in the plan, visitor visits end within the workday, meeting attendees may be staff or visitors.

**Breaks**
- Engine (Codex): must implement lunch, visitors and `peakOccupancy`, and emit version "0.2". Brief: `docs/codex-brief-v0.2.md`.
- App (Claude): People tab gains lunch and visitor settings; playback shows the new activities; results show room peaks.
- Samples are regenerated with lunch and a few visitors.

**Optional, recommended: also fix the "no entrance" workaround.** The validators would return `{ code, message }` instead of plain text, so the engine can recognise "no exterior door" by its code instead of matching the exact wording. Small change, but it touches every place that shows validation messages.

## v0.3: Queues at toilets and pantries
- Requested by: Claude, 2026-11-01
- Status: **approved** by the product owner, 2026-11-01

**In plain words.** Today, if a toilet holds 2 people, a third walks straight in anyway. In real life they wait at the door. With queues, the simulation can answer questions clients actually ask: *"Do we have enough toilets for 40 people?"*, *"How long do people wait for the pantry at lunch?"*. People who wait too long give up and go back to their desk (and count as "gave up").

**Change: `floorplan.ts` (no version change, meaning only)**
- `Space.capacity` already exists. It now also means: for **toilets and pantries**, at most this many people can be inside at once, and anyone else queues at the door. A missing capacity means no limit, exactly as today. Meeting rooms keep capacity as a warning only (meetings aren't queued).

**Change: `scenario.ts` (version "0.2" → "0.3")**
- New optional `queueing: { maxWaitMin: number }`. How long someone waits at a full toilet or pantry before giving up. Default when omitted: 10 minutes.

**Change: `results.ts` (version "0.2" → "0.3")**
- `Activity` adds `"queuing"`: standing at the door of a full room.
- `SimEventType` adds `"queue_start"`, `"queue_end"` and `"gave_up"` (each with `spaceId`).
- `Metrics` adds `queues: { spaceId; peopleWhoWaited; totalWaitS; longestWaitS; gaveUp }[]`, one entry per toilet or pantry that has a capacity, in plan order.

**Not a contract change (engine only):** people heading to the same room spread out across it instead of all standing on its centre point.

**Breaks**
- Engine (Codex): queues, waiting positions outside the door, giving up, the new metrics, spreading people in rooms. Brief: `docs/codex-brief-v0.3.md`.
- App (Claude): capacity for pantries in the side panel, a "Queuing" colour, a "Queues" table in results, queue rows in the comparison scorecard, and a max-wait setting in the People tab.
- Samples: the pantry gets a capacity; the toilet keeps capacity 2.

## v0.4: Buildings with several floors
- Requested by: Claude, 2026-11-01
- Status: **approved** by the product owner, 2026-11-01

**In plain words.** Shopping malls (and most offices bigger than a single floor) have several levels joined by stairs, escalators and lifts. This change lets one plan hold several floors stacked on top of each other, plus the things that connect them. The simulation can then show, for example, crowding at the bottom of an escalator, or how long people wait for a lift. It's the first step of the mall phase; shops, visitor profiles and calibration come after.

**Key choice: floors share one set of coordinates.** Floors sit directly above each other, so a point (x, y) is the same spot on every floor, as in a real building and in architects' drawings. A stair is drawn once and serves every floor it reaches.

**Change: `floorplan.ts` (version "0.1" → "0.2")**
- New `levels: { id; name; elevation }[]` (elevation in metres above the ground floor), at least one. A plan with one level behaves exactly as today.
- Walls, openings (through their wall), spaces and fixtures gain `levelId`. A v0.1 plan opens as a single "Ground floor".
- New `connectors: Connector[]`:
  `{ id; name; kind: "stairs" | "escalator" | "lift"; polygon: Vec2[]; levelIds: string[]; direction?: "up" | "down"; capacity?: number }`
  - `polygon` is the footprint, the same on every level it serves; people step on and off anywhere inside it.
  - `levelIds`: the floors it stops at (two or more; stairs and escalators connect consecutive floors).
  - `direction`: escalators only; a single escalator runs one way. Missing means both ways (stairs, lifts).
  - `capacity`: lifts only, people per trip (default 8).
- New space types for malls: `"shop"`, `"food_court"`, `"atrium"` (open void or concourse), `"service"` (back-of-house). Shops and food courts don't do anything special yet; attractors come in the next step.

**Change: `scenario.ts` (version "0.3" → "0.4")**
- No new fields. Desks and spaces may be on any level; people take stairs, escalators or lifts as needed.

**Change: `results.ts` (version "0.3" → "0.4")**
- `TrackPoint` gains `levelId`. A person moving between floors appears at the connector on one level, then on the other.
- `Activity` adds `"climbing"` (on stairs or an escalator) and `"in_lift"` (waiting for or riding a lift).
- `Heatmaps` gains `levels: { levelId; footfall; dwellS }[]`, one grid per floor. The existing `footfall` and `dwellS` stay, as the first floor's grid.
- `Metrics` adds `connectors: { connectorId; trips; peakWaiting; longestWaitS }[]`: how many people used each connector, the most waiting at once, and the longest wait (mainly lifts).

**Change: `validate.ts`**
- Levels: unique ids, at least one, every item's `levelId` exists. Connectors: polygon inside bounds, at least two known levels, `direction` only on escalators, `capacity` only on lifts.

**Breaks**
- Engine (Codex): one walkable grid per level joined through connectors; routes across floors; climbing and lift waiting; per-level heatmaps; connector metrics. Brief: `docs/codex-brief-v0.4.md`.
- App (Claude): a floor switcher in the editor and playback; drawing stairs, escalators and lifts; 3D view stacks the floors; project files carry all floors; v0.1 plans open as one floor.
- Samples: a two-floor sample (small mall: shops on both floors, an escalator pair, stairs and a lift).


## v0.5: Shoppers, shop pull and shop-front footfall
- Requested by: Claude, 2026-11-01
- Status: **approved** by the product owner, 2026-11-01

**In plain words.** Today the mall is filled with office-style people who sit at desks. This change adds **shoppers**: hundreds or thousands of people who arrive through the day, wander from shop to shop, maybe eat at the food court, and leave. Where they go depends on how strongly each shop pulls people in and how far away it is. The result tells a mall designer, for every shop, **how many people walk past its front, how many go in, and how long they stay**, which is what decides rents and whether a unit at the end of a corridor will survive.

**How a shopper behaves (the engine's model, explained in the results' assumptions).**
1. Arrives at a time drawn from the day's **arrival curve**, through an entrance picked by its **share** (e.g. the car-park door takes 60%).
2. Plans to visit a number of shops (set by their **shopper type**, e.g. "quick trip" 1–2, "browsing" 4–8).
3. Picks each next shop by **pull ÷ walking effort**: a big, attractive shop far away can beat a small one next door (the standard "gravity" model of retail).
4. While walking, may **pop into a shop it passes** (impulse visit, a small chance per shop front).
5. May go to the **food court** (more likely around meal times) and the **toilets** (by time spent in the mall).
6. Leaves through an entrance when done or out of time.

**Key choice: shop pull belongs to the floor plan; the crowd belongs to the scenario.** Where the anchor store goes is a design decision being tested, so it lives with the layout. Who comes and when (a weekday vs a Poya-day weekend) is the scenario, so the same crowd can run on two layouts and be compared.

**Change: `floorplan.ts` (version "0.2" → "0.3")**
- `Space.attraction?: number`: how strongly a shop or food court pulls shoppers, relative to a typical shop = 1 (a supermarket or anchor store might be 5, a kiosk 0.3). Only for shops and food courts. Missing means 1.
- `Opening.arrivalShare?: number`: for exterior doors, the share of shoppers who come in (and mostly leave) this way. Missing shares are split equally among the remaining entrances.

**Change: `scenario.ts` (version "0.4" → "0.5")**
- New optional `shoppers`:
  ```ts
  shoppers?: {
    /** Shoppers arriving per hour, as a step curve over the day. */
    arrivals: { from: ClockTime; to: ClockTime; perHour: number }[];
    types: ShopperType[];          // shares add up to 1
    impulse: number;               // chance of popping into a shop just passed, 0–1 (e.g. 0.03)
    toiletVisitsPerHour: number;   // per shopper, e.g. 0.3
  }
  ShopperType {
    id; name;
    share: number;                 // of all shoppers, 0–1
    shops: { min: number; max: number };   // shops planned
    minutesPerShop: number;        // average time inside a shop
    foodCourtChance: number;       // 0–1, higher around 12:00–14:00 and 19:00–21:00
    maxStayMin: number;            // leaves by then whatever is left
  }
  ```
- Office fields (`people`, `meetings`, `visitors`) stay; shop staff are still people at counters.

**Change: `results.ts` (version "0.4" → "0.5")**
- `Track.kind` adds `"shopper"`. `Activity` adds `"shopping"` (inside a shop) and `"eating"` (food court).
- Events add `"shop_visit"` (with `spaceId`) for shoppers; `arrive`/`leave` also cover shoppers.
- `Metrics` adds:
  - `shops: { spaceId; passBys; visits; conversion; meanDwellS; peak }[]` for every shop and food court: people walking within 2 m of its doors, visits, visits ÷ pass-bys, average stay, most inside at once.
  - `headcount: { t; count }[]`: people in the building every 15 minutes, so the busiest hour is visible.
  - `shoppers: { count; meanStayMin; meanShopsVisited; meanWalkM }`.
- Shoppers count in heatmaps, room peaks, queues and connector use, but not in the staff `perPerson` list or the staff `summary`.

**Change: `validate.ts`**
- `attraction` positive, only on shops and food courts; `arrivalShare` 0–1, only on exterior doors, shares sum ≤ 1.
- Shoppers: arrival steps in order inside the day, rates ≥ 0, type shares sum to 1, `shops.min ≤ max`, chances 0–1.

**Breaks**
- Engine (Codex): shopper generation from the arrival curve, the gravity choice of shops, impulse visits, food court and toilets, shop metrics, headcount. Must stay deterministic and fast (target: 3,000 shoppers on a 2-floor mall in under 3 s).
- App (Claude): a "Shoppers" tab in People (day type presets: weekday, weekend, Poya/holiday, festive season; types and their shares), shop pull and entrance share in the inspector, shop-front results (best and worst shops, pass-bys vs visits), a headcount-through-the-day chart, shoppers drawn as small triangles.
- Samples: `mall-2f` gains shop pulls (one anchor) and entrance shares; new `mall-weekend` scenario.

**Left for later (not in v0.5).** Families and friends walking together, children, weather, shop opening hours per unit, promotions, and calibration against real door counts (phase 2 step 4). All numbers in the presets are assumptions until calibrated, and the results will say so.

## v0.5: Reserve generated shopper IDs
- Requested by: Codex, 2026-11-01
- Status: **approved** by the product owner, 2026-11-01 (recommended option)
- Problem: generated shoppers are named `shopper-1`, `shopper-2`, … in arrival order, and `Track.personId` must be unique, but the contract allowed staff or visitor ids of that form, so a generated shopper could share an id with someone else.
- Change: when `scenario.shoppers` is present, ids matching `^shopper-[1-9][0-9]*$` are reserved for generated shoppers. `checkScenario` rejects staff and visitor ids of that form with the new issue code `"reserved_id"`; documented on `Shoppers` in `scenario.ts`. Scenarios without shoppers are unchanged (e.g. `mall-day`'s visitors `shopper-1`…`shopper-6` stay valid).
- Rejected alternative: the engine skipping taken ids, which would leave gaps in the numbering.
- Breaks: nothing existing; no sample combines shoppers with such ids.

## v0.6: People who differ, and crowding
- Requested by: Claude, 2026-11-02
- Status: **approved** by the product owner, 2026-11-02, with the three recommended decisions (evacuation in v0.7; crowding on by default in the app; presets and the assistant propose numbers, marked as assumptions)
- Implemented as proposed, with these details settled while writing the types: profile metrics are empty and crowding metrics and the density grid are still filled in when profiles are omitted; crowd density is people per m² within 1.0 m of a point, sampled every 5 s; `mall-weekend` stays unchanged as the v0.5 baseline and the new `mall-weekend-people` sample carries profiles and crowding; the narrow-door case is tested on a copy of the plan in the engine's tests rather than changing `mall-2f`.

**In plain words.** Today everyone of a kind is the same person: same speed, same route, happy to take any stairs, never bothered by a crowd. Real buildings are used by children and grandparents, wheelchair users, parents with pushchairs, people on crutches, first-time visitors who don't know the way, and people who will queue for a lift rather than step on an escalator. This change gives every simulated person their own traits, drawn from bell curves, so the results can answer **"who struggled, where, and why?"**:
- "The 9 wheelchair users waited a total of 41 minutes for the lift; at 18:30 one waited 6 minutes."
- "Nobody in a wheelchair can reach the Toys shop: its door is 0.75 m wide."
- "First-time visitors took 35% longer than regulars to find the toilets."
- "The bottom of the up escalator was packed (over 2 people per m²) for 25 minutes after 18:00, and 140 people felt uncomfortable there."

It also adds **crowding**: people slow down when it's packed, and only so many can get through a door or onto an escalator per second. That is what turns a pleasant-looking concourse into a bottleneck at peak hour, and it is the ground work for evacuation (next version).

**Key choice 1: kinds of person are separate from what they came to do.** A "family outing" shopper can be a grandmother with a walking stick or a parent with a pushchair. So a scenario lists **kinds of person** (profiles) with shares, separately from shopper types and staff teams, and the engine draws one for every person.

**Key choice 2: traits are bell curves, not single numbers.** Each numeric trait is a spread (average, how much it varies, lowest, highest). The engine draws each person's own value, seeded, so runs are still repeatable. Ten wheelchair users won't all move at exactly 0.9 m/s.

**Key choice 3: "smart / not so smart" becomes how well someone knows the building.** What changes behaviour is wayfinding: a regular takes the shortest way; a first-time visitor takes longer routes, hesitates at junctions and sometimes turns back. It's measurable (route length against the shortest route) and respectful.

**Key choice 4: without these new fields, results are exactly as v0.5.** Profiles and crowding are both optional, so every existing scenario and its results stay the same. The app will turn them on by default for new projects.

**Change: `scenario.ts` (version "0.5" → "0.6")**
```ts
/** A spread of values, drawn per person from a bell curve and clipped to [min, max]. sd 0 = everyone the same. */
interface Spread { mean: number; sd: number; min: number; max: number }

/** A kind of person. Drawn for each person by share. */
interface PersonProfile {
  id: string;
  name: string;                       // "Wheelchair user", "Older adult", "Child (with adult)", "Regular"
  /** Walking speed on the flat, m/s. Average adult ≈ 1.3; with a walking aid ≈ 0.8. */
  speed: Spread;
  /**
   * What they can use. "step_free": no stairs or escalators (wheelchairs, pushchairs, some
   * walking aids); lifts and level routes only, and doors at least 0.8 m wide.
   * "no_escalator": stairs and lifts but not escalators. "any": everything.
   */
  access: "any" | "no_escalator" | "step_free";
  /** Space taken in a crowd, as a multiple of an average adult (wheelchair ≈ 2.5, pushchair ≈ 2, child ≈ 0.7). */
  size: number;
  /** When there's a choice between ways up, relative liking for each (e.g. lift 3, escalator 1, stairs 0.3). */
  prefers: { stairs: number; escalator: number; lift: number };
  /** How well they know the building, 0–1: 1 always takes the shortest way; lower takes detours and hesitates. */
  familiarity: Spread;
  /** People per m² at which they start to feel uncomfortable (a typical adult ≈ 1.5; anxious in crowds ≈ 0.8). */
  crowdComfort: Spread;
}

interface Scenario {
  // … everything in v0.5, plus:
  /** Kinds of person and their shares, for each kind of track. Omitted means everyone is the v0.5 average person. */
  profiles?: {
    list: PersonProfile[];
    /** Shares of each profile id for staff, visitors and shoppers; each list adds up to 1. */
    staff?: { profileId: string; share: number }[];
    visitors?: { profileId: string; share: number }[];
    shoppers?: { profileId: string; share: number }[];
  };
  /** People slow down in crowds and doors/escalators have a flow limit. Omitted means off (v0.5 behaviour). */
  crowding?: { enabled: true };
}

interface Person {     // and Visitor
  // … plus: a known person's own profile (e.g. a staff member who uses a wheelchair), instead of a drawn one.
  profileId?: string;
}
```

**How crowding works (engine, explained in the assumptions).** Walking speed falls as the people per m² around someone rises, using the standard pedestrian speed–density curve: free walking below about 0.5 people/m², roughly half speed at 2, nearly stopped at 5. A person's `size` counts towards density. Doors pass at most about 1.3 people per metre of width per second; escalators about 1 person per second each; people wait their turn. Numbers are published defaults, assumptions until calibrated.

**Change: `results.ts` (version "0.5" → "0.6")**
- `Track` adds `profileId?: string` (present when profiles are used), so the app can colour and filter by kind of person.
- `SimEventType` adds `"blocked"` (with `spaceId`): someone couldn't reach where they wanted to go by a route they can use, and went elsewhere or gave up.
- `Metrics` adds:
  - `profiles: ProfileMetrics[]`, one per profile:
    `{ profileId; count; meanWalkM; meanWalkS; meanDetourPct; liftWaitS; longestLiftWaitS; blocked; uncomfortableS; uncomfortablePeople }`
    - `meanDetourPct`: how much longer their routes were than the shortest route they could use;
    - `blocked`: trips that couldn't be made;
    - `uncomfortableS` / `uncomfortablePeople`: total time spent above their own `crowdComfort`, and how many people that happened to.
  - `crowding: CrowdingMetrics[]`, one per space with anyone in it:
    `{ spaceId; peakDensity; peakT; minutesOver2 }`: most people per m² at once (by `size`), when, and minutes above 2 people/m².
- `Heatmaps.levels[]` adds `peakDensity: number[]`: the most people per m² ever seen in each cell, so crowd hot spots show on the plan.
- `WarningCode` adds `"not_step_free"`: a room or floor that people with `access: "step_free"` can't reach (e.g. "Nobody using a wheelchair can reach First floor: there's no lift"), naming the room or floor.
- Staff `perPerson` and `summary` keep their v0.5 meaning.

**Change: `validate.ts`**
- Profile ids unique; every `profileId` used exists; each share list adds up to 1; spreads have `min ≤ mean ≤ max`, `sd ≥ 0`, speeds positive; `size > 0`; preferences ≥ 0 and not all zero; familiarity within 0–1.

**Breaks**
- Engine (Codex): per-person traits drawn from spreads (seeded, on their own random stream so turning profiles on doesn't reshuffle anything else); route choice that respects access and preferences; familiarity detours and hesitation; door width checks for step-free people; crowding (speed–density, door and escalator flow limits); the new metrics, heatmap and warning. Must stay exactly v0.5 when the new fields are omitted, deterministic, and fast with crowding on (target: the 3,000-shopper mall in under 6 s).
- App (Claude):
  - **Kinds of people** in the People tab with presets the assistant can fill: "Sri Lankan mall weekend", "Sri Lankan school day", "Office". Each lists who is included and why, marked as assumptions to check.
  - Playback can colour people by kind and filter to one kind ("show only wheelchair users").
  - A **"Who struggled"** results section (per kind: detours, lift waits, blocked trips, discomfort); crowd hot spots on the plan; step-free warnings.
  - The assistant gets a tool to set kinds of people.
- Samples: a new `mall-weekend-people` (the Saturday crowd with profiles and crowding); a door too narrow for wheelchairs is tested on a copy of `mall-2f`.

**Left for v0.7 (evacuation).** An alarm at a set time; everyone heads for the nearest usable exit; lifts out of use; step-free people go to a refuge point and wait for help; time for the building to empty, per floor and per kind of person; where queues form at stairs and exits. It builds directly on this version's traits and crowding.

**Left for later.** Light, noise and heat comfort (needs a daylight and noise model: the "comfort" version); families and groups walking together; signage; children's routines in schools (timetables and bells come with the school phase). Profiles already leave room for light and noise sensitivity when comfort arrives.

**Decisions for the product owner**
1. **Split evacuation into v0.7** (recommended), rather than one large v0.6. Evacuation needs its own alarm, exit and refuge rules, and is easier to check once crowding is proven.
2. **Crowding on by default in the app** (recommended), while the contract keeps it optional so older results stay comparable.
3. **Who sets the numbers.** The presets and the assistant will propose shares and spreads with a one-line reason each (e.g. a census figure for disability prevalence), always marked as assumptions until checked. Recommended: yes, and the results show "assumptions" next to every number that came from a preset.

## v0.6: What counts as a detour
- Requested by: Codex, 2026-11-02
- Status: **approved** by the product owner, 2026-11-02 (option 1, recommended by Codex and Claude)
- Problem: connector preferences may send someone to a farther lift, while familiarity 1 must mean no detour. Against the globally shortest usable route, a perfectly familiar lift-lover would show a detour without ever going wrong.
- Decision: route choice happens first (access, then `prefers`); `meanDetourPct` and familiarity are measured against the shortest path through the connectors chosen. Familiarity 1 is always 0% detour. Preference-driven extra distance still shows in walking distance, walking time and lift waits. Wording updated on `ProfileMetrics.meanDetourPct` and `PersonProfile.familiarity`; no new fields.
- Rejected: counting preference-driven distance as detour, which would mix choices with getting lost.
- Breaks: nothing; clarifies meaning before the engine implements it.

## v0.7: Comfort — sound, light and contrast
- Requested by: Claude, 2026-11-03
- Status: **approved** by the product owner, 2026-11-03, with the four recommended decisions (scope: sound, light and contrast; defaults by room type but no default shades; desk rotation is the way the sitter faces; on by default in the app)
- Implemented as proposed, with these details settled while writing the types: validation codes `site`, `noise_source`, `window`, `space_comfort` and `comfort`; window glass settings are refused on doors; heatmap glare is from direct sun reaching a spot, while glare from facing a sunlit window is reported per desk; the existing samples move to floor plan v0.4 and scenario v0.7 with no other change, and two new pairs carry comfort (`office-a-comfort` + `office-day-comfort`, `mall-2f-comfort` + `mall-weekend-comfort`).

**In plain words.** We already know where every person is, second by second. This change describes what each spot in the building *sounds* and *looks* like, gives each kind of person their own sensitivities, and adds up what each person experienced along the path they actually walked. That answers **"how did it feel to be here, and for whom?"**:
- "Desks 4–7 get direct sun through the west windows from 15:30; the people sitting there have glare for about 70 minutes a day."
- "The open office next to the pantry averages 58 dB(A) at lunch, too loud to concentrate for 9 of the 13 staff."
- "The food court reaches 74 dB(A) at 19:00; 60% of older adults and everyone sensitive to noise found it uncomfortable."
- "The corridor to the toilets is dim (80 lux) and its floor and walls are the same shade: people with low vision struggle there."
- "Twelve people had two or more discomforts at once (loud, crowded and glare) for over 10 minutes: likely sensory overload."

"Feelings" are worked out as the gap between what a place is like and what that person tolerates, the same way "felt crowded" already works. Nobody's psychology is simulated. These are simplified comfort scores for **comparing layouts**, not lighting or acoustic engineering; results will say so, and the numbers are assumptions until checked against measurements.

**Key choice 1: the building describes its environment; the people describe their tolerances.** The plan gains which way is north, window heights, glass and shading, room lighting levels, how echoey each room is, floor and wall shades, and noise sources such as a busy road. Profiles gain how much noise, dimness and glare each kind of person tolerates, and whether they have low vision.

**Key choice 2: sensible defaults by room type, so nobody has to type it all in.** Missing lighting levels and acoustics take typical values for the room type (an office about 500 lux, a corridor about 150; a food court with hard surfaces, an office mixed). The assistant can fill in the rest from a sentence like "glass shopfronts, tiled floors, a main road on the west side". Floor and wall shades have **no default**: without them contrast is reported as "not checked", never guessed.

**Key choice 3: colour means contrast, for now.** Light-to-dark contrast between floors, walls and doors is well established for people with low vision (a difference of about 30 points of light reflectance). Claims like "blue feels calm" have weak evidence and stay out until there's a reason to add them.

**Key choice 4: activity matters.** The same 60 dB(A) is fine while eating in a food court and too loud at a desk. Noise and light tolerances have a general value and a stricter value for focused work (at a desk, in a meeting).

**Key choice 5: without the new fields, results are exactly v0.6.** Comfort is optional in the scenario, so older scenarios and their results stay the same.

**Change: `floorplan.ts` (version "0.3" → "0.4"; all new fields optional)**
```ts
interface FloorPlan {
  // … plus:
  /** Where the building is and which way it faces. Missing: north is up the page, latitude 6.9° (Colombo). */
  site?: {
    /** Direction of north, degrees clockwise from "up the page" (−y). */
    northDeg: number;
    /** Degrees, positive north. */
    latitude?: number;
  };
  /** Things that make noise: a road outside, plant, music, a generator. People, escalators and lifts are counted by the engine. */
  noiseSources?: NoiseSource[];
}

interface NoiseSource {
  id: string;
  levelId: string;
  name: string;            // "Galle Road", "Generator", "Background music"
  position: Vec2;          // may be outside the walls, e.g. on the road
  /** Loudness in dB(A) measured 1 m away (a busy road at the kerb ≈ 75, quiet plant ≈ 55, background music ≈ 65). */
  dbA: number;
  /** When it's on ("HH:MM"). Missing: all day. */
  hours?: { from: string; to: string };
}

interface Opening {
  // … plus, windows only:
  /** Height of the bottom and top of the glass above the floor, m. Missing: 0.9 and 2.1. */
  sillM?: number;
  headM?: number;
  /** Share of daylight the glass lets through, 0–1: clear ≈ 0.7, tinted ≈ 0.4, frosted ≈ 0.5 (frosted also stops glare). Missing: 0.7. */
  transmittance?: number;
  frosted?: boolean;
  /** Blinds, louvres or a deep overhang that stop direct sun. Missing: false. */
  shaded?: boolean;
}

interface Space {
  // … plus:
  /** Electric lighting on a table-height surface during opening hours, lux. Missing: typical for the room type. */
  lightingLux?: number;
  /** How much sound bounces around: "hard" (tile, glass, concrete), "mixed", "soft" (carpet, acoustic ceiling). Missing: typical for the room type. */
  acoustics?: "hard" | "mixed" | "soft";
  /** Light reflectance of the floor and walls, 0 (black) to 100 (white). Missing: contrast isn't checked. */
  floorLRV?: number;
  wallLRV?: number;
}

interface Fixture {
  /** Degrees, clockwise from +x. For desks, the way the person sitting there faces (used for glare). */
  rotation: number;        // meaning extended: was "visual only"
}
```

**Change: `scenario.ts` (version "0.6" → "0.7")**
```ts
interface Scenario {
  // … plus:
  /** Work out sound, light and contrast comfort. Missing: off (v0.6 behaviour). */
  comfort?: {
    enabled: true;
    /** The day simulated, for the sun's path. Missing: 2026-03-21 (in Colombo the sun passes straight overhead in early April and early September). */
    date?: string;         // "YYYY-MM-DD"
    /** "clear": direct sun and glare; "overcast": soft daylight, no glare. Missing: "clear". */
    sky?: "clear" | "overcast";
  };
}

interface PersonProfile {
  // … plus, all optional (missing: typical adult values, stated in the assumptions):
  /** Loudest dB(A) they're comfortable with while walking, shopping or eating (typical ≈ 70; noise-sensitive ≈ 60). */
  noiseComfort?: Spread;
  /** Loudest dB(A) for focused work at a desk or in a meeting (typical ≈ 50). */
  focusNoiseComfort?: Spread;
  /** Least light they need to see comfortably for tasks, lux (typical ≈ 300; older or low vision ≈ 500). */
  taskLux?: Spread;
  /** How much glare they put up with, 0–1 on the engine's glare scale (typical ≈ 0.4; light-sensitive ≈ 0.25). */
  glareComfort?: Spread;
  /** Needs strong contrast between floor and walls to find their way. */
  lowVision?: boolean;
}
```

**How the engine works it out (explained in the assumptions, no algorithm names).**
- *Light:* each room's electric lighting while open, plus daylight from its windows that fades with distance from the glass and stops at walls; outdoor light from the sun's height for the date, time and sky. Sampled every 15 minutes on the existing grid.
- *Glare:* direct sun through an unshaded, unfrosted window reaching where someone is; or someone seated at a desk facing a sunlit window. Scored 0 (none) to 1 (unbearable).
- *Sound:* each source fades with distance (about 6 dB quieter for every doubling) and loses more through walls, glass and doors; echoey rooms are louder. People add sound by how many are talking where (a busy food court louder than a quiet office); escalators and lifts add their own. Averaged every minute.
- *Contrast:* low where a room's floor and walls are within 30 points of each other.
- *Discomfort:* any minute where a person's spot is louder, dimmer or glarier than their own drawn tolerance (the stricter value while working), in low contrast with low vision, or crowded (as in v0.6). Two or more at once counts as **overload**.

**Change: `results.ts` (version "0.6" → "0.7")**
- `Heatmaps.levels[]` adds, when comfort is on: `noiseDbA` (loudest 15-minute average in each cell), `lightLux` (dimmest while open), `glare` (worst glare seen). Empty arrays when comfort is off.
- `Track` adds `discomfort?: { from: number; to: number; cause: DiscomfortCause }[]`, the stretches when this person was uncomfortable, so the app can show "one person's day".
- `type DiscomfortCause = "loud" | "dim" | "glare" | "low_contrast" | "crowded"`.
- `Metrics` adds `comfort: ComfortMetrics | null` (null when comfort is off):
  - `byProfile`: one per profile (one row with `profileId: ""` without profiles): `{ profileId; people; minutes: Record<DiscomfortCause, number>; peopleAffected: Record<DiscomfortCause, number>; overloadMinutes; overloadPeople }`.
  - `bySpace`: one per space anyone entered: `{ spaceId; loudestDbA; loudestT; dimmestLux; worstGlare; worstGlareT; contrast: "ok" | "low" | "not_checked"; discomfortMinutes }`.
  - `desks`: one per desk with glare or noise above focus comfort: `{ deskId; glareMinutes; loudMinutes }`.
- `WarningCode` adds `"comfort"`, in plain words naming rooms or desks: "Desk 6 gets direct sun from 15:30 to 16:40", "The corridor to the toilets is dim (80 lux) for its use".

**Change: `validate.ts`**
- `northDeg` 0–360; latitude −90–90; noise `dbA` 0–140 with valid hours; window heights `0 ≤ sillM < headM`, only on windows; `transmittance` 0–1; `lightingLux ≥ 0`; LRVs 0–100; `comfort.date` a real date; new spreads valid as before; `glareComfort` within 0–1.

**Breaks**
- Engine (Codex): sun position, daylight, electric light and glare; sound from sources, people, escalators and lifts through walls and doors; contrast; per-person discomfort against drawn tolerances; the new heatmaps, metrics, track stretches and warnings. Exactly v0.6 when comfort is off; deterministic; tolerances on the profile random stream so turning comfort on changes no movement. Target: the people mall with comfort on in under 8 s.
- App (Claude):
  - Inputs: a north arrow on the plan; window glass and shading in the inspector; room lighting, acoustics and shades; a noise-source tool; comfort settings (date, sky) in People. Defaults shown as assumptions.
  - Kinds of people gain sensitivities (noise-sensitive, light-sensitive, low vision, sensory overload as a preset kind).
  - Results: **"How it felt"** per kind by cause, comfort by room, desks with glare or noise; noise, light and glare heatmaps; "one person's day" in playback.
  - The assistant fills environment and sensitivities from a description.
- Samples: plans move to v0.4 with no new fields (results unchanged). New `office-a-comfort` plan (west windows, a pantry beside desks, a road outside) with an `office-day-comfort` scenario, and a `mall-weekend-comfort` scenario on a mall plan with finishes, glass shopfronts and road noise.

**Left for later.** Heat and airflow (needs a cooling and ventilation model; matters in Sri Lanka, so it's the natural next comfort step); smell; colour moods; signage and wayfinding by sight; evacuation (now v0.8).

**Decisions for the product owner**
1. **Scope:** sound, light (daylight, electric lighting, glare) and contrast; no colour moods; heat later. Recommended.
2. **Defaults:** lighting and acoustics default by room type, marked as assumptions; floor and wall shades have no default, so contrast says "not checked" until someone enters them. Recommended.
3. **Desk direction:** desk rotation starts to mean which way the person faces, so glare can be judged; the editor already lets you rotate desks. Recommended.
4. **On by default in the app**, like crowding, while staying optional in the contract. Recommended.

## v0.8: Site and weather — neighbours, shadows, roads and real skies
- Requested by: Claude, 2026-11-04
- Status: **approved** by the product owner, 2026-11-04, with the four recommended decisions (OpenStreetMap and Open-Meteo, no Google map data; fetch once and save in the project; typical day by default; unknown heights from floors or assumed 2 floors, highlighted)
- Implemented as proposed, with these details settled while writing the types: validation codes `neighbour`, `road` and `weather`; neighbours and roads share the plan's id space; one new sample pair, `office-a-site` + `office-day-site`, with made-up fixed data.

**In plain words.** Comfort (v0.7) knows the sun's path but treats the building as standing alone under a sky that's either clear or overcast all day. Real Sri Lankan sites have a tall block next door, a main road along one side and afternoon cloud. This change lets you drop a pin on the site and fetch, once, what surrounds it and what the weather is like, so results can say:
- "From 15:10 the apartment block to the west shades the office windows: desks 8–12 have no afternoon glare."
- "The first-floor food court still gets low sun over the neighbouring shops (they're 6 m tall; its windows start at 4.8 m)."
- "Galle Road (a main road) along the west side makes the bottom desks 6 dB louder than the top ones."
- "On a typical 15 November, cloud builds from 14:00, so afternoon glare is about half what a clear day gives."

**Key choice 1: open data, fetched once, saved in the project.** Neighbouring buildings and roads come from **OpenStreetMap** (free to use for this, with credit), weather from **Open-Meteo** (free, no key). The app fetches them when you place the pin or press Refresh, and saves them into the plan and scenario. The engine never goes online, so the same project always gives the same result and works offline.

**Key choice 2: not Google's map data.** Google's terms don't allow extracting buildings or tracing from Google Maps or Earth imagery for our own analysis. Google can come later only as a picture behind the map, inside Google's own viewer, once there's a small server to hold the key. Google's Open Buildings heights are open, but come as very large files that need a server to cut down: later.

**Key choice 3: heights you can trust or correct.** OpenStreetMap often lacks heights. Each neighbour records where its height came from: measured in the data, estimated from its number of floors (3 m each), or assumed (2 floors) when nothing is known. The app highlights estimated and assumed heights for you to check.

**Key choice 4: weather as a typical day by default.** For the simulated date the app saves 24 hourly values: cloud, temperature, humidity and rain. Default: **typical for that date** (the average of the past 10 years around it). Option: **a specific past day**, to check against something you remember. In v0.8 the engine uses cloud for sun and daylight; temperature, humidity and rain are stored and shown, ready for heat comfort and rain-day behaviour later.

**Key choice 5: without the new fields, results are exactly v0.7.**

**Change: `floorplan.ts` (version "0.4" → "0.5"; all new fields optional)**
```ts
interface Site {
  northDeg: number;
  latitude?: number;
  /** Where the plan's origin (its top-left corner, x 0 y 0) is on the earth. Replaces latitude when given. */
  location?: { lat: number; lon: number };
  /** Hours ahead of UTC for clock times. Missing: 5.5 (Sri Lanka). */
  utcOffsetHours?: number;
  /** Buildings around this one that can shade it. In plan metres; may lie outside `bounds`. */
  neighbours?: Neighbour[];
  /** Roads around the building, as noise sources along their length. In plan metres; may lie outside `bounds`. */
  roads?: Road[];
  /** Where fetched data came from, shown with the results, e.g. "© OpenStreetMap contributors, fetched 2026-11-04". */
  credits?: string[];
}

interface Neighbour {
  id: string;
  name?: string;               // "Apartment block", from the data when it has one
  polygon: Vec2[];             // footprint, at least 3 points
  heightM: number;             // above this building's ground floor
  /** "data": a height in the source; "floors": from its number of floors; "assumed": nothing known (2 floors); "user": entered or corrected. */
  heightFrom: "data" | "floors" | "assumed" | "user";
}

interface Road {
  id: string;
  name?: string;               // "Galle Road"
  path: Vec2[];                // centre line, at least 2 points
  kind: "main" | "secondary" | "local" | "service";
  /** Loudness 1 m from the kerb, dB(A). Missing: main 75, secondary 70, local 62, service 55. */
  dbA?: number;
  /** When traffic runs, "HH:MM". Missing: 06:00–22:00. */
  hours?: { from: string; to: string };
}
```

**Change: `scenario.ts` (version "0.7" → "0.8")**
```ts
interface Comfort {
  // … everything in v0.7, plus:
  /** Hourly weather for the simulated date. When given, its cloud replaces `sky`. */
  weather?: Weather;
}

interface Weather {
  /** "typical": averaged over past years for this date; "day": one real past day (`comfort.date`). */
  kind: "typical" | "day";
  /** e.g. "Open-Meteo, 2016–2025, fetched 2026-11-04". */
  source: string;
  /** 24 entries, one per clock hour from 00:00. */
  hourly: { hour: string; cloudPct: number; tempC: number; humidityPct: number; rainMm: number }[];
}
```

**How the engine uses them (explained in the assumptions).**
- *Neighbour shadows:* direct sun reaches a window or a spot only if the line towards the sun clears every neighbour, counting their height and the floor's elevation. Neighbours also block part of the sky, reducing daylight from windows facing them.
- *Roads:* each road is a noise source along its whole length (fading about 3 dB per doubling of distance, slower than a single point), through walls and windows as for v0.7 sources.
- *Cloud:* each hour's cloud cuts direct sun and glare in proportion (100% cloud: none) and changes daylight between clear-sky and overcast levels.
- Without neighbours, roads or weather, exactly v0.7.

**Change: `results.ts` (version "0.7" → "0.8")**
- `ComfortMetrics` adds `windows`: one per window that gets direct sun at some point, in plan order: `{ openingId; sunMinutes; shadedByNeighboursMinutes; cloudedMinutes }`. That explains why a window is or isn't glary.
- `ComfortMetrics` adds `weatherUsed: "sky" | "typical" | "day"`, so the screens say which sky was used.
- Assumptions name the data sources from `site.credits` and `weather.source`.

**Change: `validate.ts`**
- `location` within lat −90–90, lon −180–180; `utcOffsetHours` −12–14; neighbours: unique ids, polygon ≥ 3 points, `heightM` above 0 and at most 500; roads: unique ids, path ≥ 2 points, `dbA` 0–140, valid hours. Neighbours and roads are exempt from the plan-bounds check.
- Weather: exactly 24 entries for hours 00:00…23:00 in order, cloud and humidity 0–100, rain ≥ 0, temperature −50–60.

**Breaks**
- Engine (Codex): neighbour shadows for direct sun and glare, sky blocked by neighbours, road line sources, hourly cloud, the window metrics. Exactly v0.7 without the new fields; deterministic; within v0.7 speed limits plus a little for neighbours.
- App (Codex this time, Claude reviews):
  - **Site panel:** place the pin by typing coordinates or pasting a Google Maps link (the app reads the coordinates from the link; no Google key needed); line the plan up with the street using the north angle. A small map view of the surroundings with © OpenStreetMap credit.
  - **Fetch surroundings:** buildings and roads within about 200 m, from OpenStreetMap; heights marked data / floors / assumed, assumed ones highlighted; edit heights, delete or draw neighbours by hand; Refresh to fetch again.
  - **Weather:** "Typical for this date" or "A specific past day", fetched from Open-Meteo, shown as a small hourly strip (cloud, temperature, rain); Refresh.
  - **Results:** windows shaded by neighbours and by cloud; neighbours and roads drawn faintly around the plan in 2D and as plain blocks in 3D.
  - **Assistant:** can set the location from a link or place name the user gives, and correct neighbour heights ("the block to the west is 12 floors").
- Samples: `office-a-comfort` gains a location in Colombo, a 10-storey neighbour to the west, Galle Road as a road (replacing its point source in a new copy of the plan, `office-a-site`), and a typical 15 November weather day in a new `office-day-site` scenario. Fixed data in the sample, nothing fetched.

**Left for later.** Terrain and hills; trees; heights from Google Open Buildings (needs a server); Google map or satellite imagery behind the plan (needs a key on a server); heat comfort from the stored temperature and humidity; rain changing who comes and where they go; evacuation (v0.9).

**Decisions for the product owner**
1. **Sources:** OpenStreetMap for neighbours and roads, Open-Meteo for weather; no Google map data, Google imagery later with a server. Recommended.
2. **Fetch once, save in the project; the engine stays offline.** Recommended.
3. **Weather default:** typical for the date (10-year average), with a specific past day as an option. Recommended.
4. **Unknown heights:** from floors when known, otherwise assumed 2 floors, highlighted for the user to check. Recommended.

## v0.9: Evacuation and accessibility
- Requested by: Claude, 2026-11-04
- Status: **open**: needs the product owner's approval.

**In plain words.** Two questions every client and approving authority asks: **can everyone get out, and how fast?** and **can everyone use the building in the first place?** This change adds both.

*Evacuation:* at an alarm time you choose, everyone stops, takes a moment to react, and heads for an exit with the crowding rules from v0.6. Lifts stop unless they're marked as evacuation lifts. People who can't use stairs go to a refuge (a protected waiting spot by a stair) and wait for help. Results say:
- "The building was empty of everyone who could leave in 4 min 50 s; First floor cleared in 3 min 40 s."
- "62% of people used the main entrance; the side exit by the toilets was used by 9 people, because first-time visitors head back the way they came in."
- "The stair down from First floor had a queue of up to 40 people for 2 minutes."
- "11 people waited at the First floor refuge, the first from 1 min 10 s; with no refuge on Second floor, 3 wheelchair users had nowhere safe to wait."

*Accessibility:* the building gains ramps, accessible toilets, evacuation lifts and refuges, and a plain-language check of common accessibility guidance, so results also say:
- "There's no accessible toilet on First floor: wheelchair users walked 85 m on average to the one downstairs, and 2 couldn't get there in time."
- "The ramp to the mezzanine is 1 in 8, steeper than the usual 1 in 12: wheelchair users can't use it."

**Key choice 1: an evacuation is its own run.** The scenario sets an alarm time; the day runs normally until then, then everyone evacuates and the run ends when the last person is out or at a refuge. The app offers "Run an evacuation at…" next to the normal run, using the same people, so you see who was where when the alarm went off.

**Key choice 2: people go to the exits they know.** A well-documented finding from real fires: people head for the way they came in rather than the nearest exit, especially in unfamiliar buildings. Here, people who know the building well (familiarity 0.7 and above) take the nearest usable exit; others mostly return to the entrance they used, and change their mind only if it's badly blocked. Staff know every exit.

**Key choice 3: reaction time is drawn per person.** Nobody moves the instant an alarm sounds: people finish a sentence, gather things, look around. Each kind of person gets a spread (typical 30–120 s; staff trained to respond faster; shoppers in a shop, or people in a toilet, slower). These are assumptions, as before.

**Key choice 4: assisted evacuation is counted, not simulated.** Step-free people without an evacuation lift go to the nearest refuge on their floor and wait. Results count who is waiting, where and from when. How staff or firefighters bring them down is left out; it depends on procedures we don't model.

**Key choice 5: guidance, not compliance.** Accessibility checks follow common guidance (doors at least 0.8 m, ramps no steeper than 1 in 12, an accessible toilet on every floor people use, a refuge on every floor without an evacuation lift) and say so. They don't claim to certify against Sri Lanka's accessibility regulations or fire code; the results say to check those with the approving authority.

**Change: `floorplan.ts` (version "0.5" → "0.6")**
```ts
type ConnectorKind = "stairs" | "escalator" | "lift" | "ramp";   // "ramp" is new

interface Connector {
  // … plus:
  /** Lifts only: kept running during an alarm for people who can't use stairs. Missing: false. */
  evacuationLift?: boolean;
}
// A ramp joins two floors next to each other, like stairs; step-free people can use it when it's
// no steeper than 1 in 12 (rise between the floors over its footprint's longer side). Escalators stop
// during an alarm and are used as stairs.

interface Opening {
  // … plus, exterior doors only:
  /** Used only in an alarm, never to arrive or leave normally. Missing: false. */
  fireExit?: boolean;
}

interface Space {
  // … plus:
  /** Toilets only: usable by wheelchair users (wide door, room to turn, grab rails). Missing: false. */
  accessible?: boolean;
  /** A protected spot to wait for help in an alarm, usually beside a stair. Missing: false. */
  refuge?: boolean;
}
```

**Change: `scenario.ts` (version "0.8" → "0.9")**
```ts
interface Scenario {
  // … plus:
  /** Sound an alarm and evacuate. Missing: an ordinary day (v0.8 behaviour). */
  evacuation?: {
    /** When the alarm sounds, "HH:MM", within the day. */
    alarmAt: string;
    /** Exits out of use for this run (a blocked door, a fire near it), opening ids. Missing: none. */
    blockedExitIds?: string[];
  };
}

interface PersonProfile {
  // … plus:
  /** Seconds from the alarm until they start moving. Missing: typical 30–120 s (stated in the assumptions). */
  reactionS?: Spread;
}
```
Toilet trips by `step_free` people go only to `accessible` toilets (or are `blocked`). A plan with no `accessible` toilets behaves as v0.8 (every toilet is usable) and warns.

**Change: `results.ts` (version "0.8" → "0.9")**
- `Activity` adds `"evacuating"` (moving to an exit or refuge after the alarm) and `"at_refuge"`.
- `SimEventType` adds `"alarm"`, `"evacuated"` (with the exit's opening id) and `"reached_refuge"` (with the space id).
- `Metrics` adds `evacuation: EvacuationMetrics | null` (null without an alarm):
  - `outS`: seconds from the alarm until everyone who could leave was out; `refugeS`: until everyone else was at a refuge; `stranded`: people with neither (no usable exit or refuge).
  - `byFloor`: `{ levelId; people; clearS }` (when the last person left that floor).
  - `byProfile`: `{ profileId; people; meanOutS; slowestOutS; atRefuge; stranded }` (row `""` for people without a profile).
  - `exits`: `{ openingId; people; firstS; lastS; peakQueue }`, one per exterior door, in plan order.
  - `connectors`: `{ connectorId; people; peakQueue; queueS }`, stairs, escalators, ramps and lifts used.
  - `refuges`: `{ spaceId; people; firstS; lastS }`.
- `Metrics` adds `accessibility: AccessibilityCheck[]`, always filled: `{ code; ok; message; refIds }` for each guidance check (`door_width`, `ramp_gradient`, `accessible_toilet_per_floor`, `step_free_route_per_floor`, `refuge_or_evacuation_lift_per_floor`), in plain words.
- `WarningCode` adds `"evacuation"` (e.g. "3 people on Second floor had no exit or refuge they could use") and `"accessibility"` (failed checks).

**Change: `validate.ts`**
- Ramps join exactly two adjacent floors; `evacuationLift` only on lifts; `fireExit` only on exterior doors and never with `arrivalShare`; `accessible` only on toilets; `alarmAt` a time within the workday; `blockedExitIds` are exterior doors; `reactionS` a valid spread with min ≥ 0.

**Breaks**
- Engine (Codex): ramps (gradient rule for step-free people), accessible-toilet routing, alarm handling (everyone switches at once), reaction time on its own random stream, exit choice by familiarity, lifts stopping except evacuation lifts, escalators as stairs, refuges, the new metrics, checks and warnings. Exactly v0.8 without an alarm, ramps or the new space flags. Deterministic; the people mall's evacuation in under 3 s.
- App (Codex, Claude reviews): ramp tool; evacuation-lift, fire-exit, accessible-toilet and refuge settings in the inspector; "Run an evacuation at…" with alarm time and blocked exits; evacuation results (time to empty, by floor, by kind of person, exits, queues, refuges, stranded), playback from the alarm with an "everyone out at…" marker; an **Accessibility** results section with each check passed or failed; assistant tools for all of these.
- Samples: `mall-2f` gains an accessible toilet, a refuge by the stairs on First floor and a side fire exit in a new copy `mall-2f-evac`; `mall-weekend-evac` sounds the alarm at 18:30 with the people mall's kinds; `office-a-evac` + `office-day-evac` for a single-floor office at 10:20 (during the morning meeting).

**Left for later.** Fire and smoke spread; staff guiding people; assisted evacuation of refuges; phased evacuation by floor; voice alarms and wayfinding signs; heat comfort; school drills.

**Decisions for the product owner**
1. **An evacuation is a separate run** from a chosen alarm time, with the same people. Recommended.
2. **Exit choice:** familiar people take the nearest exit; others mostly return the way they came in. Recommended.
3. **Lifts stop in an alarm** unless marked as evacuation lifts; escalators are used as stairs. Recommended.
4. **Refuges are counted, not emptied:** we report who waits where and from when, without simulating rescue. Recommended.
5. **Accessibility checks are common guidance, not certification**, and say so. Recommended.
