import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { validateScenario } from "../../../contracts/validate.ts";
import { DEFAULT_RULES, simulate } from "../../../engine/src/index.ts";
import { runBehaviourTool } from "../assistant/behaviourTool.ts";
import { buildProject, parseProjectOrPlan } from "../model/projectFile.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { BehaviourResults } from "../results/BehaviourResults.tsx";
import type { SimRun } from "../sim/runSimulation.ts";
import { BehavioursSection } from "./BehavioursSection.tsx";
import { ruleSentence } from "./behaviourRules.ts";
import { defaultProfile, expandProfile, rulePaused } from "./officeProfile.ts";

const office = SAMPLE_PLANS[0].plan;
/** Names as they appear in rendered HTML (apostrophes are escaped). */
const html = (text: string) => text.replace(/'/g, "&#x27;");
const draft = () => ({ plan: office, profile: defaultProfile(office) });

describe("behaviour rules in the app", () => {
  it("reads every default rule as a plain sentence", () => {
    expect(ruleSentence(DEFAULT_RULES[0])).toBe(
      "People whose glare tolerance is below 0.3 on the 0–1 glare scale, where glare is above their own glare tolerance, treat routes there as 2× as long.",
    );
    expect(ruleSentence(DEFAULT_RULES.find((r) => r.id === "dim-slow")!)).toMatch(/walk at 85% of their speed\.$/);
  });

  it("starts new projects from the default rules, on and labelled as assumptions", () => {
    const profile = defaultProfile(office);
    expect(profile.behaviours).toEqual([...DEFAULT_RULES]);
    const { scenario } = expandProfile(profile, office);
    expect(scenario.behaviours!.every((r) => r.enabled)).toBe(true);
    expect(validateScenario(scenario, office)).toEqual([]);
  });

  it("pauses glare, light and noise rules while sound and light is off, so the scenario stays valid", () => {
    const profile = { ...defaultProfile(office), comfort: { ...defaultProfile(office).comfort!, enabled: false } };
    const { scenario } = expandProfile(profile, office);
    expect(scenario.behaviours!.filter((r) => r.enabled).map((r) => r.id)).toEqual(["crowd-avoid", "contrast-slow"]);
    expect(profile.behaviours!.filter((r) => rulePaused(profile, r)).map((r) => r.id)).toEqual(["glare-avoid", "noise-avoid", "dim-slow"]);
    expect(validateScenario(scenario, office)).toEqual([]);
    expect(() => simulate(office, scenario)).not.toThrow();
  });

  it("switches off a rule whose kinds of person aren't in today's mix", () => {
    const profile = defaultProfile(office);
    const rule = { ...DEFAULT_RULES[0], id: "ghost", who: { kind: "profiles" as const, profileIds: ["nobody"] } };
    const { scenario } = expandProfile({ ...profile, behaviours: [rule] }, office);
    expect(scenario.behaviours![0].enabled).toBe(false);
    expect(validateScenario(scenario, office)).toEqual([]);
  });

  it("pauses crowd rules while crowding is off, and says so in the panel", () => {
    const profile = { ...defaultProfile(office), crowding: false };
    const { scenario } = expandProfile(profile, office);
    expect(scenario.behaviours!.find((r) => r.id === "crowd-avoid")!.enabled).toBe(false);
    expect(validateScenario(scenario, office)).toEqual([]);
    expect(renderToStaticMarkup(<BehavioursSection profile={profile} setProfile={() => {}} />)).toContain("1 rule reacts to crowding, which is only worked out with crowding on");
  });

  it("keeps older profiles without rules exactly as they were", () => {
    const { behaviours: _, ...old } = defaultProfile(office);
    expect(expandProfile(old, office).scenario.behaviours).toBeUndefined();
  });

  it("saves rules in the project file", () => {
    const profile = { ...defaultProfile(office), behaviours: [{ ...DEFAULT_RULES[0], strength: { ...DEFAULT_RULES[0].strength, value: 3, basis: "user" as const, source: "Set in People" } }] };
    const read = parseProjectOrPlan(JSON.stringify(buildProject(office, [], { [office.id]: profile })));
    expect(read.kind === "project" && read.project.people[office.id].behaviours).toEqual(profile.behaviours);
  });
});

describe("Ella's set_behaviour tool", () => {
  it("changes a strength as a proposal, recording the user's words as the source", () => {
    const out = runBehaviourTool({ action: "change", rule: "Light-sensitive people avoid glare", new_rule: null, strength: { value: 4, low: 3, high: 6 }, user_words: "they really mind glare" }, draft());
    expect(out.error).toBeFalsy();
    const rule = out.draft.profile.behaviours!.find((r) => r.id === "glare-avoid")!;
    expect(rule.strength).toEqual({ value: 4, low: 3, high: 6, basis: "user", source: "Said to Ella: 'they really mind glare'" });
    expect(out.change!.text).toMatch(/4× as long/);
    expect(JSON.parse(out.result).status).toBe("proposed, not applied");
  });

  it("switches rules off and on, removes them, and adds new ones from JSON", () => {
    let d = draft();
    d = runBehaviourTool({ action: "disable", rule: "noise-avoid", new_rule: null, strength: null, user_words: "staff don't mind noise" }, d).draft;
    expect(d.profile.behaviours!.find((r) => r.id === "noise-avoid")!.enabled).toBe(false);
    const added = runBehaviourTool({
      action: "add", rule: null, strength: { value: 0.7, low: 0.5, high: 0.9 }, user_words: "older visitors slow on stairs",
      new_rule: JSON.stringify({ name: "Older visitors slow down in corridors", who: { kind: "roles", roles: ["visitor"] }, when: { kind: "place", spaceTypes: ["corridor"] }, effect: { kind: "slow" } }),
    }, d);
    expect(added.error).toBeFalsy();
    expect(added.draft.profile.behaviours!.at(-1)).toMatchObject({ id: "older-visitors-slow-down-in-corr", enabled: true, strength: { value: 0.7, basis: "user" } });
    d = runBehaviourTool({ action: "remove", rule: "dim-slow", new_rule: null, strength: null, user_words: "x" }, added.draft).draft;
    expect(d.profile.behaviours!.some((r) => r.id === "dim-slow")).toBe(false);
  });

  it("refuses unknown rules, bad strengths and broken JSON with a reason", () => {
    expect(runBehaviourTool({ action: "change", rule: "nope", new_rule: null, strength: null, user_words: "x" }, draft())).toMatchObject({ error: true, result: expect.stringMatching(/No rule "nope". Rules: glare-avoid/) });
    expect(runBehaviourTool({ action: "change", rule: "glare-avoid", new_rule: null, strength: { value: 20, low: 1, high: 30 }, user_words: "x" }, draft())).toMatchObject({ error: true, result: expect.stringMatching(/within 1–10/) });
    expect(runBehaviourTool({ action: "add", rule: null, new_rule: "{oops", strength: null, user_words: "x" }, draft())).toMatchObject({ error: true, result: expect.stringMatching(/JSON/) });
  });
});

describe("the Behaviours panel and results", () => {
  it("lists the default rules with their strengths, ranges and labels", () => {
    const out = renderToStaticMarkup(<BehavioursSection profile={defaultProfile(office)} setProfile={() => {}} />);
    for (const r of DEFAULT_RULES) expect(out).toContain(html(r.name));
    expect(out).toContain("5 of 5 rules on");
    expect(out).toContain("Strength 2 × route cost (range 1.2–4) · assumed, not measured");
  });

  it("offers the defaults to older projects, and warns about paused rules", () => {
    const { behaviours: _, ...old } = defaultProfile(office);
    expect(renderToStaticMarkup(<BehavioursSection profile={old} setProfile={() => {}} />)).toContain("Start from the default behaviours");
    const off = { ...defaultProfile(office), comfort: { ...defaultProfile(office).comfort!, enabled: false } };
    const html = renderToStaticMarkup(<BehavioursSection profile={off} setProfile={() => {}} />);
    expect(html).toContain("3 rules react to light, glare or noise");
    expect(html).toContain("2 of 5 rules on");
  });

  it("shows what each rule did, with ranges", () => {
    const profile = defaultProfile(office);
    const { scenario } = expandProfile(profile, office);
    const result = simulate(office, scenario, { decision: true });
    const run = { plan: office, profile, scenario, result } as unknown as SimRun;
    const out = renderToStaticMarkup(<BehaviourResults run={run} />);
    expect(out).toContain("Behaviour rules");
    for (const r of DEFAULT_RULES) expect(out).toContain(html(r.name));
  }, 30000);
});
