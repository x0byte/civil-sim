import { renderToStaticMarkup } from "react-dom/server";
import {
  DecisionSummary,
  DecisionComparison,
} from "../playback/DecisionSummary.tsx";
import { DetailExportContext } from "../loading/DeferredDetails.tsx";
import type { SimRun, Comparison } from "../sim/runSimulation.ts";
import { topFixes } from "../experience/Story.tsx";
import { TabPanel } from "./TabPanels.tsx";
import { availableTabs, progressText } from "./model.ts";
import { TAB_LABEL, type ResultsTab } from "./state.ts";
const displayParameter = (value: number | undefined) =>
  value === undefined ? "not set" : Number(value.toPrecision(7)).toString();
export interface ReportSection {
  title: string;
  lines: string[];
}
export function plainReportText(html: string): string[] {
  return html
    .replace(/<a[^>]*>Evidence[\s\S]*?<\/a>/g, "")
    .replace(/<figure[\s\S]*?<\/figure>/g, "")
    .replace(/<\/?small[^>]*>/g, " ")
    .replace(/<\/(td|th)>/g, " | ")
    .replace(/<\/(h[1-6]|p|div|li|dt|dd|tr|section|article)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x([a-f\d]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .split("\n")
    .map((line) =>
      line
        .replace(/\s+/g, " ")
        .replace(/\s*\|\s*$/, "")
        .trim(),
    )
    .filter(Boolean);
}
export function reportSections(
  runs: SimRun[],
  selected: readonly ResultsTab[],
  comparison?: Comparison,
): ReportSection[] {
  const allowed = availableTabs(runs),
    tabs = allowed.filter(
      (tab) =>
        tab === "summary" || tab === "evidence" || selected.includes(tab),
    );
  const sections: ReportSection[] = [];
  if (comparison)
    sections.push({
      title: "Summary · comparison",
      lines: plainReportText(
        renderToStaticMarkup(<DecisionComparison comparison={comparison} />),
      ),
    });
  for (const tab of tabs)
    for (const [i, run] of runs.entries()) {
      const title = `${TAB_LABEL[tab]} · ${comparison?.labels[i] ?? run.plan.name}`;
      const status = progressText(run);
      if (tab === "summary")
        sections.push({
          title,
          lines: [
            ...plainReportText(
              renderToStaticMarkup(<DecisionSummary run={run} />).replace(
                /<details[\s\S]*?<\/details>/g,
                "",
              ),
            ),
            "Suggested fixes",
            ...topFixes(run)
              .slice(0, 3)
              .map((fix) => fix.text),
          ],
        });
      else if (tab === "evidence")
        sections.push({
          title,
          lines: [
            status,
            "Evidence appendix · always included. Low/high are parameter envelopes, not output quantiles.",
            ...(run.result.evidence?.parameters.flatMap((p) => [
              `${p.key} | value ${displayParameter(p.value)} ${p.unit} | low ${displayParameter(p.low)} | high ${displayParameter(p.high)} | ${p.overridden ? "Sourced override" : "Registry value"}`,
              p.source,
            ]) ?? ["No parameter evidence saved."]),
            "Sensitivity · " +
              (run.result.evidence?.sensitivity.length
                ? "completed"
                : "not yet computed for this result"),
            ...(run.result.evidence?.sensitivity.flatMap((row) => [
              row.metric,
              ...row.drivers.map(
                (p) => `${p.key}: ${p.swingPct.toFixed(2)}% endpoint swing`,
              ),
            ]) ?? []),
          ],
        });
      else
        sections.push({
          title,
          lines: [
            status,
            ...plainReportText(
              renderToStaticMarkup(
                <DetailExportContext.Provider value={true}>
                  <TabPanel tab={tab} run={run} />
                </DetailExportContext.Provider>,
              ),
            ),
          ],
        });
    }
  return sections;
}
/** Browser-only PDF writer. Loaded on demand by the export dialog. */
export async function createResultsPdf(
  runs: SimRun[],
  selected: readonly ResultsTab[],
  comparison?: Comparison,
  onProgress?: (message: string) => void,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  doc.setTitle(`Nine Arches · ${runs[0].plan.name} results`);
  doc.setSubject("Building simulation · decision ranges and evidence");
  const font = await doc.embedFont(StandardFonts.Helvetica),
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sections = reportSections(runs, selected, comparison),
    pages: ReturnType<typeof doc.addPage>[] = [];
  let page = doc.addPage([595.28, 841.89]),
    y = 778;
  pages.push(page);
  const clean = (text: string) =>
    [
      ...text
        .replace(/[–—−]/g, "-")
        .replace(/↔/g, " <-> ")
        .replace(/↗/g, "")
        .replace(/≤/g, "<=")
        .replace(/≥/g, ">=")
        .replace(/✓/g, "Pass")
        .replace(/✕/g, "Check"),
    ]
      .map((char) => {
        try {
          font.encodeText(char);
          return char;
        } catch {
          return "?";
        }
      })
      .join("");
  const next = () => {
    page = doc.addPage([595.28, 841.89]);
    pages.push(page);
    y = 778;
  };
  const write = (text: string, size = 9, heading = false) => {
    const words = clean(text).split(/\s+/);
    let line = "";
    const lineOut = () => {
      if (y < 58) next();
      page.drawText(line, {
        x: 42,
        y,
        size,
        font: heading ? bold : font,
        color: rgb(0.12, 0.16, 0.2),
      });
      y -= size * 1.5;
      line = "";
    };
    for (let word of words) {
      while (font.widthOfTextAtSize(word, size) > 510) {
        if (line) lineOut();
        let end = word.length;
        while (font.widthOfTextAtSize(word.slice(0, end), size) > 510) end--;
        line = word.slice(0, end);
        lineOut();
        word = word.slice(end);
      }
      const candidate = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(candidate, size) > 510) {
        lineOut();
        line = word;
      } else line = candidate;
    }
    if (line) lineOut();
  };
  write("NINE ARCHES / BUILDING RESULTS", 12, true);
  write(runs[0].plan.name, 20, true);
  write("Modelled decision ranges · supporting detail · sources");
  write(
    "Ranges are 10th-90th percentile model spread, not regulatory certification. Partial results state their completed run count. Censored evacuation is Cannot verify.",
  );
  y -= 18;
  for (const [index, section] of sections.entries()) {
    onProgress?.(
      `Preparing ${section.title} · ${index + 1} of ${sections.length}`,
    );
    if (y < 150) next();
    write(section.title, 15, true);
    y -= 5;
    for (const line of section.lines) write(line);
    y -= 20;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (selected.some((tab) => !["summary", "evidence"].includes(tab))) {
    for (const [runIndex, run] of runs.entries())
      for (const floor of run.plan.levels) {
        next();
        write(
          `Representative plan · ${comparison?.labels[runIndex] ?? run.plan.name} · ${floor.name}`,
          15,
          true,
        );
        write(progressText(run));
        write(
          "Room outlines, walls and team zones. Plan dimensions in metres; use the app for animated paths, heatmaps and interactive inspection.",
        );
        const scale = Math.min(
            510 / run.plan.bounds.width,
            580 / run.plan.bounds.height,
          ),
          left = 42,
          bottom = 85 + (580 - run.plan.bounds.height * scale) / 2;
        const point = (p: { x: number; y: number }) => ({
          x: left + p.x * scale,
          y: bottom + (run.plan.bounds.height - p.y) * scale,
        });
        for (const space of run.plan.spaces.filter(
          (s) => s.levelId === floor.id,
        ))
          for (let i = 0; i < space.polygon.length; i++)
            page.drawLine({
              start: point(space.polygon[i]),
              end: point(space.polygon[(i + 1) % space.polygon.length]),
              thickness: 0.5,
              color: rgb(0.65, 0.7, 0.74),
            });
        for (const wall of run.plan.walls.filter((w) => w.levelId === floor.id))
          page.drawLine({
            start: point(wall.a),
            end: point(wall.b),
            thickness: Math.max(0.7, wall.thickness * scale),
            color: rgb(0.18, 0.24, 0.28),
          });
        for (const opening of run.plan.openings) {
          const wall = run.plan.walls.find((w) => w.id === opening.wallId);
          if (!wall || wall.levelId !== floor.id) continue;
          const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y),
            at = (offset: number) =>
              point({
                x: wall.a.x + ((wall.b.x - wall.a.x) * offset) / length,
                y: wall.a.y + ((wall.b.y - wall.a.y) * offset) / length,
              });
          page.drawLine({
            start: at(opening.offset - opening.width / 2),
            end: at(opening.offset + opening.width / 2),
            thickness: Math.max(1, wall.thickness * scale + 1),
            color: rgb(1, 1, 1),
          });
          if (opening.kind === "window")
            page.drawLine({
              start: at(opening.offset - opening.width / 2),
              end: at(opening.offset + opening.width / 2),
              thickness: 0.8,
              color: rgb(0.25, 0.5, 0.7),
            });
        }
        for (const connector of run.plan.connectors.filter((c) =>
          c.levelIds.includes(floor.id),
        ))
          for (let i = 0; i < connector.polygon.length; i++)
            page.drawLine({
              start: point(connector.polygon[i]),
              end: point(connector.polygon[(i + 1) % connector.polygon.length]),
              thickness: 1,
              color: rgb(0.62, 0.39, 0.15),
            });
        for (const zone of run.plan.zones?.filter(
          (z) => z.levelId === floor.id,
        ) ?? [])
          for (let i = 0; i < zone.polygon.length; i++)
            page.drawLine({
              start: point(zone.polygon[i]),
              end: point(zone.polygon[(i + 1) % zone.polygon.length]),
              thickness: 1,
              color: rgb(0.23, 0.42, 0.68),
              dashArray: [4, 3],
            });
        for (const space of run.plan.spaces.filter(
          (s) => s.levelId === floor.id,
        )) {
          const x =
              space.polygon.reduce((n, p) => n + p.x, 0) / space.polygon.length,
            y0 =
              space.polygon.reduce((n, p) => n + p.y, 0) / space.polygon.length;
          const at = point({ x, y: y0 });
          const label = clean(space.name).slice(0, 32);
          page.drawText(label, {
            x: Math.max(42, Math.min(450, at.x - 20)),
            y: Math.max(110, at.y),
            size: Math.min(
              7,
              100 / Math.max(1, font.widthOfTextAtSize(label, 1)),
            ),
            font,
            color: rgb(0.12, 0.16, 0.2),
          });
        }
      }
  }
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: 42, y: 37 },
      end: { x: 553, y: 37 },
      color: rgb(0.8, 0.82, 0.85),
      thickness: 0.5,
    });
    p.drawText(`Nine Arches | Page ${i + 1} of ${pages.length}`, {
      x: 42,
      y: 23,
      size: 8,
      font,
      color: rgb(0.4, 0.44, 0.48),
    });
  });
  return doc.save();
}
