# Contract change requests

Need something the contracts don't allow? Add an entry here instead of editing `contracts/`.
The product owner marks it approved or rejected.

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
