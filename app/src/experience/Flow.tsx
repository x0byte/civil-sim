import { ImprovementsButton } from "../improvements/Improvements.tsx";
import { CubeIcon, PlanIcon } from "../ui/icons.tsx";
import { useState } from "react";
import { useExperience } from "./state.ts";
import { Estimate } from "./Story.tsx";
import { useEditor } from "../state/store.ts";
import { getItem } from "../model/planOps.ts";
import { DEFAULT_COMFORT } from "../model/comfortDefaults.ts";
import { defaultProfile } from "../population/officeProfile.ts";
import { DEFAULT_SHOPPERS, MALL_HOURS, hasShops, SHOPPER_DAYS, type ShopperDay } from "../population/shoppers.ts";
import { kindsFromPreset, type KindsPreset } from "../population/kinds.ts";
import { TextField } from "../ui/fields.tsx";
import { runDay } from "../sim/runDay.ts";
import { EvacuationDialog } from "../sim/EvacuationDialog.tsx";
import { runSimulationJob, SimulationStatus, useSimulationJob } from "../sim/jobs.tsx";

export function SimpleBuilding() {
  const state = useEditor(),
    ux = useExperience();
  const item = state.selection ? getItem(state.plan, state.selection.kind, state.selection.id) : undefined;
  return (
    <section className="panel simple-building">
      <header>
        <h2>{item && "name" in item ? item.name : "Your building"}</h2>
      </header>
      <div className="panel-body">
        {!item && <TextField label="Building name" value={state.plan.name} onCommit={(name) => state.commit((p) => ({ ...p, name }))} />}
        <p>
          {state.plan.spaces.length} rooms · {state.plan.levels.length} {state.plan.levels.length === 1 ? "floor" : "floors"} · dimensions in metres
        </p>
        <p>Select something on the plan, or tell Ella what to change.</p>
        <button
          className="primary"
          onClick={() =>
            ux.ask(item ? "Help me improve what I selected. Explain any numbers you assume." : "Help me describe or improve this building.")
          }
        >
          Describe a change
        </button>
        <button onClick={() => ux.go(2)}>Next: Who uses it →</button>
      </div>
    </section>
  );
}
export function SimplePeople() {
  const state = useEditor(),
    ux = useExperience(),
    profile = state.profiles[state.plan.id] ?? defaultProfile(state.plan),
    mall = hasShops(state.plan);
  const save = (p: typeof profile) => state.setProfile(state.plan.id, p, true);
  return (
    <section className="panel simple-people">
      <header>
        <h1>Who uses your building?</h1>
      </header>
      <div className="panel-body">
        <p>
          A sensible starting day is ready. <Estimate />
        </p>
        <label className="field">
          <span>Building type</span>
          <select
            value={profile.shoppers?.enabled && mall ? "mall" : "office"}
            onChange={(e) => {
              if (e.target.value === "mall" && !mall) {
                ux.ask("Help me add shops and a food court so I can try a shopping mall crowd.");
                return;
              }
              save({
                ...profile,
                shoppers: { ...(profile.shoppers ?? DEFAULT_SHOPPERS), enabled: e.target.value === "mall" },
                ...(e.target.value === "mall" && profile.workday.start === "08:30" ? { workday: MALL_HOURS } : {}),
              });
            }}
          >
            <option value="office">Office</option>
            <option value="mall">Shopping mall</option>
          </select>
        </label>
        {mall && profile.shoppers?.enabled ? (
          <>
            <label className="field">
              <span>Kind of day</span>
              <select
                value={profile.shoppers.day}
                onChange={(e) => save({ ...profile, shoppers: { ...profile.shoppers!, day: e.target.value as ShopperDay } })}
              >
                {Object.entries(SHOPPER_DAYS).map(([id, p]) => (
                  <option key={id} value={id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                Crowd size <Estimate reason="A multiplier on the sample arrival pattern. Check it against entrance counts." />
              </span>
              <select
                value={profile.shoppers.crowd}
                onChange={(e) => save({ ...profile, shoppers: { ...profile.shoppers!, crowd: Number(e.target.value) } })}
              >
                <option value={0.5}>Quieter · half as many</option>
                <option value={1}>Typical</option>
                <option value={1.5}>Busier · half as many again</option>
                <option value={2}>Very busy · twice as many</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>Kind of day</span>
              <select value={profile.attendance} onChange={(e) => save({ ...profile, attendance: Number(e.target.value) })}>
                <option value={1}>Everyone comes in</option>
                <option value={0.8}>A typical workday · most come in</option>
                <option value={0.5}>A quieter day · half come in</option>
                {![1, 0.8, 0.5].includes(profile.attendance) && (
                  <option value={profile.attendance}>Your day · {Math.round(profile.attendance * 100)}% come in</option>
                )}
              </select>
            </label>
            <label className="field">
              <span>Crowd size</span>
              <select value={profile.attendance} onChange={(e) => save({ ...profile, attendance: Number(e.target.value) })}>
                <option value={1}>Full team</option>
                <option value={0.8}>Most of the team</option>
                <option value={0.5}>Half the team</option>
                {![1, 0.8, 0.5].includes(profile.attendance) && (
                  <option value={profile.attendance}>Your setting · {Math.round(profile.attendance * 100)}%</option>
                )}
              </select>
            </label>
            <p>{profile.departments.reduce((n, d) => n + d.headcount, 0)} staff on the team. Ask Ella to change teams or add visitors.</p>
          </>
        )}
        <label className="field">
          <span>
            Kinds of people{" "}
            <Estimate reason="A starting mix for Sri Lanka, including people who need step-free routes. It is not a measured count." />
          </span>
          <select
            value={profile.kinds?.preset === "custom" ? "custom" : (profile.kinds?.preset ?? "typical")}
            onChange={(e) => save({ ...profile, kinds: kindsFromPreset(e.target.value as KindsPreset) })}
          >
            <option value="typical">A typical mix</option>
            <option value="access">More people who need easier access</option>
            <option value="opening">Opening week · more first-time visitors</option>
            {profile.kinds?.preset === "custom" && <option value="custom">Your own mix</option>}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={profile.comfort?.enabled ?? false}
            onChange={(e) => save({ ...profile, comfort: { ...(profile.comfort ?? DEFAULT_COMFORT), enabled: e.target.checked } })}
          />
          Check comfort · sound and light
        </label>
        <button onClick={() => ux.ask("Help me choose who uses this building. Explain the assumptions first.")}>Help me choose</button>
        <button className="primary" onClick={() => ux.go(3)}>
          Use these people →
        </button>
      </div>
    </section>
  );
}
export function RunControls() {
  const state = useEditor(),
    ux = useExperience();
  const [evac, setEvac] = useState(false);
  const job = useSimulationJob();
  const busy = job.status === "working";
  const last = state.past.at(-1);
  const compare = () => {
    if (!last) return;
    void runSimulationJob(
      { kind: "compare", a: last.plan, b: state.plan, labels: ["Before", "Your change"], profile: last.profiles[last.plan.id] },
      (out) => {
        if ("errors" in out) return;
        state.setComparison(out.comparison);
        state.setView("compare");
      },
    );
  };
  return (
    <div className="run-controls">
      <h2>See what happens</h2>
      <p>Try the day, then look for one thing to improve.</p>
      <button className="primary big-run" disabled={busy} onClick={() => void runDay()}>
        {busy ? "Working in the background…" : "▶ Run the day"}
      </button>
      <button disabled={busy} onClick={() => setEvac(true)}>
        Run an evacuation…
      </button>
      {last && last.plan !== state.plan && (
        <button disabled={busy} onClick={compare}>
          Compare with before
        </button>
      )}
      <SimulationStatus />
      {state.run && <ImprovementsButton />}
      {state.run && (
        <div className="presentation-switch view-tabs wide" role="group" aria-label="View results">
          <button
            aria-pressed={ux.presentation === "2d"}
            aria-label="2D analysis"
            data-tip="Heatmaps on the plan"
            onClick={() => {
              ux.setPresentation("2d");
              state.setView("sim");
            }}
          >
            <PlanIcon />
            <span>2D</span>
          </button>
          <button
            aria-pressed={ux.presentation === "3d"}
            aria-label="3D walk-through"
            data-tip="Walk through in 3D"
            onClick={() => {
              ux.setPresentation("3d");
              state.setView("sim");
            }}
          >
            <CubeIcon />
            <span>3D</span>
          </button>
        </div>
      )}
      {evac && <EvacuationDialog onClose={() => setEvac(false)} />}
    </div>
  );
}
