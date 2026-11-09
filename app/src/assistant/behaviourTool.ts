// Ella's behaviour-rule tool (contract v1.1). It edits the same People-profile rules as the
// Behaviours panel, and every edit is a proposal the user accepts or discards.

import type Anthropic from "@anthropic-ai/sdk";
import type { BehaviourRule } from "../../../contracts/scenario.ts";
import { validateScenario } from "../../../contracts/validate.ts";
import { DEFAULT_RULES } from "../../../engine/src/index.ts";
import { effectOf, ruleId, ruleSentence } from "../population/behaviourRules.ts";
import { expandProfile } from "../population/officeProfile.ts";
import type { Draft, ToolOutcome } from "./tools.ts";

const range = {
  type: "object",
  properties: { value: { type: "number" }, low: { type: "number" }, high: { type: "number" } },
  required: ["value", "low", "high"],
  additionalProperties: false,
};

export const BEHAVIOUR_TOOLS: Anthropic.Tool[] = [
  {
    name: "set_behaviour",
    description:
      "Add, change, switch on or off, or remove a behaviour rule: how people react to glare, light, noise, contrast, rooms or stairs/lifts/escalators. " +
      "Same rules as People → How people react; shown as a proposal, never applied automatically. Use when the user describes how people behave " +
      "(“light-sensitive people really mind glare”, “our staff don't mind noise”, “wheelchair users never use the ramp”). Strengths are what the user " +
      "said, not research: keep a range around the value. For add, `rule` follows the contract BehaviourRule shape without id or strength " +
      "(name, who, when, effect). Never claim a rule's strength is measured unless the user gave a source.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "change", "enable", "disable", "remove"] },
        rule: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "For change/enable/disable/remove: the rule's id or exact name. Null for add.",
        },
        new_rule: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description:
            "For add: JSON text of { name, who, when, effect } in the contract shape, e.g. " +
            '{"name":"Light-sensitive visitors avoid glare","who":{"kind":"trait","trait":"glareComfort","below":0.3},' +
            '"when":{"kind":"measure","measure":"glare","compare":"above","threshold":{"personal":"glareComfort"}},"effect":{"kind":"avoid"}}. Null otherwise.',
        },
        strength: { anyOf: [range, { type: "null" }], description: "For add or change: value with lowest and highest. Null to keep the current one." },
        user_words: { type: "string", description: "The user's own sentence this comes from, recorded as the source." },
      },
      required: ["action", "rule", "new_rule", "strength", "user_words"],
      additionalProperties: false,
    },
  },
];

export function runBehaviourTool(input: Record<string, unknown>, draft: Draft): ToolOutcome {
  try {
    const profile = draft.profile;
    const rules: BehaviourRule[] = structuredClone(profile.behaviours ?? [...DEFAULT_RULES]);
    const words = typeof input.user_words === "string" && input.user_words.trim() ? input.user_words.trim() : "a request to Ella";
    const source = `Said to Ella: '${words}'`;
    const find = () => {
      const key = String(input.rule ?? "").trim().toLowerCase();
      const rule = rules.find((r) => r.id.toLowerCase() === key || r.name.toLowerCase() === key);
      if (!rule) throw new Error(`No rule "${String(input.rule)}". Rules: ${rules.map((r) => `${r.id} (${r.name})`).join("; ") || "none"}.`);
      return rule;
    };
    const strength = (current: BehaviourRule["strength"], kind: BehaviourRule["effect"]["kind"]): BehaviourRule["strength"] => {
      const s = input.strength as { value: number; low: number; high: number } | null;
      if (!s) return current;
      const e = effectOf(kind);
      if (![s.value, s.low, s.high].every(Number.isFinite) || !(s.low <= s.value && s.value <= s.high) || s.low < e.min || s.high > e.max)
        throw new Error(`Strength for ${kind} needs lowest ≤ value ≤ highest, within ${e.min}–${e.max}.`);
      return { value: s.value, low: s.low, high: s.high, basis: "user", source };
    };

    let next: BehaviourRule[];
    let text: string;
    switch (input.action) {
      case "add": {
        let raw: Partial<BehaviourRule> | null = null;
        try {
          raw = typeof input.new_rule === "string" ? (JSON.parse(input.new_rule) as Partial<BehaviourRule>) : null;
        } catch {
          throw new Error("new_rule must be JSON text of { name, who, when, effect }.");
        }
        if (!raw || typeof raw !== "object" || !raw.name || !raw.who || !raw.when || !raw.effect) throw new Error("add needs new_rule with name, who, when and effect.");
        const e = effectOf(raw.effect.kind);
        if (!e) throw new Error("effect must be avoid, prefer, slow, hesitate, dwell or cannot_use.");
        const start = { value: e.start, low: Math.max(e.min, e.start * 0.75), high: Math.min(e.max, e.start * 1.5), basis: "user" as const, source };
        const rule: BehaviourRule = {
          id: ruleId(raw.name, rules), name: raw.name, enabled: true, who: raw.who, when: raw.when, effect: { kind: raw.effect.kind },
          strength: raw.effect.kind === "cannot_use" ? { value: 1, low: 1, high: 1, basis: "user", source } : strength(start, raw.effect.kind), note: source,
        };
        next = [...rules, rule];
        text = `New rule: ${rule.name}. ${ruleSentence(rule)}`;
        break;
      }
      case "change": {
        const rule = find();
        const changed = { ...rule, strength: strength(rule.strength, rule.effect.kind), note: source };
        next = rules.map((r) => (r === rule ? changed : r));
        text = `${rule.name}: ${ruleSentence(changed)} (range ${changed.strength.low}–${changed.strength.high}, your setting).`;
        break;
      }
      case "enable":
      case "disable": {
        const rule = find();
        next = rules.map((r) => (r === rule ? { ...r, enabled: input.action === "enable", note: source } : r));
        text = `${rule.name}: switched ${input.action === "enable" ? "on" : "off"}.`;
        break;
      }
      case "remove": {
        const rule = find();
        next = rules.filter((r) => r !== rule);
        text = `${rule.name}: removed.`;
        break;
      }
      default:
        throw new Error("action must be add, change, enable, disable or remove.");
    }
    const nextProfile = { ...profile, behaviours: next };
    const errors = validateScenario(expandProfile(nextProfile, draft.plan).scenario, draft.plan);
    if (errors.length) throw new Error(errors.join(" "));
    return {
      draft: { ...draft, profile: nextProfile },
      result: JSON.stringify({ status: "proposed, not applied", text, rules: next.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, strength: r.strength })) }),
      change: { text },
    };
  } catch (error) {
    return { draft, error: true, result: error instanceof Error ? error.message : String(error) };
  }
}
