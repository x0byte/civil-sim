import { create } from "zustand";
export const RESULT_TABS = [
  "summary",
  "movement",
  "capacity",
  "evacuation",
  "access",
  "teams",
  "retail",
  "comfort",
  "evidence",
] as const;
export type ResultsTab = (typeof RESULT_TABS)[number];
export const TAB_LABEL: Record<ResultsTab, string> = {
  summary: "Summary",
  movement: "Movement",
  capacity: "Capacity",
  evacuation: "Evacuation",
  access: "Access",
  teams: "Teams",
  retail: "Retail",
  comfort: "Comfort",
  evidence: "Evidence",
};
export function readResultsHash(hash: string): {
  tab: ResultsTab;
  parameter?: string;
} {
  const match = /^#results\/([^?]+)(?:\?(.*))?$/.exec(hash);
  const tab =
    match && RESULT_TABS.includes(match[1] as ResultsTab)
      ? (match[1] as ResultsTab)
      : "summary";
  return {
    tab,
    parameter: match
      ? (new URLSearchParams(match[2] ?? "").get("parameter") ?? undefined)
      : undefined,
  };
}
interface ResultsState {
  tab: ResultsTab;
  parameter?: string;
  focus?: { id: string; t?: number; sequence: number };
  choose: (tab: ResultsTab, parameter?: string) => void;
  locate: (id: string, t?: number) => void;
  syncHash: () => void;
}
export const useResults = create<ResultsState>((set) => ({
  ...readResultsHash(typeof window === "undefined" ? "" : window.location.hash),
  choose: (tab, parameter) => {
    set({ tab, parameter });
    if (typeof window !== "undefined")
      window.history.replaceState(
        null,
        "",
        `#results/${tab}${parameter ? "?parameter=" + encodeURIComponent(parameter) : ""}`,
      );
  },
  locate: (id, t) =>
    set((state) => ({
      focus: { id, t, sequence: (state.focus?.sequence ?? 0) + 1 },
    })),
  syncHash: () => set(readResultsHash(window.location.hash)),
}));
