# Decision log

Newest first. One entry per decision: what, why, who decided.

## 2026-11-01: Editor (M1)
- **Stack: Vite + React + TypeScript, Three.js via react-three-fiber for 3D, zustand for state.** Common, well-documented choices so a future hire can pick it up. *(Claude)*
- **The editor derives `doorIds` and fixture `spaceId` itself** (`normalize` in `app/src/model/planOps.ts`) after every edit, using the validator's 0.15 m tolerance. Users never set them by hand, and saved plans always pass the contract checks. *(Claude)*
- **Doors on the plan's outer edge default to "entrance".** It can be switched off in the side panel. *(Claude)*
- **A desk's rotation is the direction the person faces:** desk in front, chair behind. The contract says rotation is visual only, so this doesn't affect the engine. *(Claude)*
- **The 3D view cuts walls at 1.2 m by default**, like an architect's section, so you can see into every room. "Full height" shows the real walls. *(Claude)*
- **Work is autosaved in the browser**; "Save file" / "Open file" use the contract's JSON format. *(Claude)*

## 2026-10-31: Contracts v0.1
- **Plan, scenario and results are three separate files.** The scenario (people, their day) is kept out of the floor plan so the same people can be run on two layouts and compared. That comparison is the main pitch feature. *(Claude, approved by product owner pending review)*
- **Metres, origin top-left, y downward.** Matches image pixels, which makes tracing over an uploaded plan simple. *(Claude)*
- **Walls decide walkability; space outlines are only labels.** Avoids two sources of truth for where people can go. *(Claude)*
- **Fixtures don't block movement in v0.1.** Keeps the first engine simple; desks as obstacles can come in v0.2. *(Claude)*
- **Paths are stored as keyframes, not frames.** A full day for 200 people at one frame per second would be huge; straight-line segments need only their end points. *(Claude)*
- **Results carry a plain-language `assumptions` list.** Every number we show a builder must be traceable to what produced it. *(Claude, from the "evidence grades" discussion)*

## 2026-10-31: Project setup
- **Frontend first, then algorithms.** The first audience is builders and architects, so the demo has to be easy to use. *(Product owner)*
- **Parallel build: Claude on the editor (`app/`), Codex on the simulation core (`engine/`), meeting only at `contracts/`.** *(Product owner)*
- **Floor plan input starts as upload-and-trace plus drawing.** Automatic wall detection and DXF import come later. *(Agreed)*
- **TypeScript, runs in the browser.** Pitching should be as simple as sending a link. *(Claude)*
