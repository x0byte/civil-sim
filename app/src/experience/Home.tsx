import { type ReactNode, useEffect, useRef, useState } from "react";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { blankPlan } from "../model/planOps.ts";
import { SAMPLE_PLANS } from "../model/samples.ts";
import { useEditor } from "../state/store.ts";
import { Logo, Mark } from "../ui/Brand.tsx";
import { hasShops } from "../population/shoppers.ts";
import { PlanModel } from "./PlanModel.tsx";
import { useExperience } from "./state.ts";

type Section = "home" | "samples" | "learn";

/** What each sample is good for, in a line. */
const SAMPLE_NOTES: Record<string, string> = {
  "office-a": "A small office with the toilet beside the manager",
  "office-b": "The same office with the toilet moved to reception",
  "sealed-room": "A plan with a room nobody can reach",
  "office-a-comfort": "West windows, a busy road and sensitive staff",
  "mall-2f-comfort": "Glass, street noise and glossy floors",
  "mall-2f": "Two floors of shops and a food court",
  "office-a-site": "On Galle Road, with a tower across the street",
  "office-a-evac": "A fire exit and an accessible toilet",
  "mall-2f-evac": "A refuge, a fire exit and a busy Saturday",
};
// In order of interest; the home row shows as many as fit on one line.
const FEATURED = ["office-a-evac", "mall-2f-evac", "office-a-site", "mall-2f-comfort", "office-a-comfort", "mall-2f"];

/** The start page: new building, continue, samples and a short guide. */
export function Home() {
  const ux = useExperience();
  const plan = useEditor((s) => s.plan);
  const [section, setSection] = useState<Section>("home");
  const [tour, setTour] = useState(0);

  const open = (id: string) => {
    useEditor.getState().load(SAMPLE_PLANS.find((s) => s.id === id)!.plan);
    ux.newBuilding();
    ux.setHome(false);
  };
  const bring = (action: "image" | "dxf" | "draw" | "describe") => {
    if (action !== "draw") useEditor.getState().load(blankPlan("My building", 24, 18));
    ux.newBuilding();
    ux.setHome(false);
    if (action === "describe") ux.ask("Help me turn my building description into a plan. Ask me about the rooms, floors and sizes first.");
    else window.dispatchEvent(new CustomEvent("volt:bring", { detail: action }));
  };

  return (
    <div className="home">
      <nav className="home-nav" aria-label="Home">
        <button className="primary home-new" onClick={() => bring("draw")}>
          <PlusIcon /> New building
        </button>
        {(
          [
            ["home", "Home", <HomeIcon key="i" />],
            ["samples", "Samples", <GridIcon key="i" />],
            ["learn", "Learn", <BookIcon key="i" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} className="home-nav-item" aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}>
            {icon}
            {label}
          </button>
        ))}
        <div className="home-nav-foot">
          <Logo height={18} />
          <p>
            <a href="https://ninearches.ai">ninearches.ai</a>
          </p>
          <p>People's behaviour, sound and light are estimates until checked against a real building.</p>
        </div>
      </nav>

      <main className="home-main">
        {section === "home" && (
          <>
            <header className="home-header">
              <h1>Welcome to Nine Arches</h1>
              <p>Test a layout with the people who will use it, before it's built.</p>
              <button onClick={() => setTour(1)}>Take the quick tour</button>
            </header>

            <h2>Start something new</h2>
            <div className="home-tiles">
              <Tile icon={<ImageIcon />} title="Trace a plan image" note="A photo, scan or PDF export" onClick={() => bring("image")} />
              <Tile icon={<FileIcon />} title="Import a drawing" note="AutoCAD DXF" onClick={() => bring("dxf")} />
              <Tile icon={<PenIcon />} title="Draw from scratch" note="Walls, doors and rooms" onClick={() => bring("draw")} />
              <Tile
                icon={<Mark size={22} />}
                title="Describe it to the assistant"
                note="The assistant sets it up"
                onClick={() => bring("describe")}
                accent
              />
            </div>

            <h2>Continue</h2>
            <div className="home-cards">
              <PlanCard plan={plan} title={plan.name} note="Open in the editor" onClick={() => ux.setHome(false)} />
            </div>

            <div className="home-row-heading">
              <h2>Samples</h2>
              <button className="link" onClick={() => setSection("samples")}>
                See all {SAMPLE_PLANS.length}
              </button>
            </div>
            <FeaturedRow>
              {FEATURED.map((id) => {
                const s = SAMPLE_PLANS.find((x) => x.id === id)!;
                return <PlanCard key={id} plan={s.plan} title={s.label} note={SAMPLE_NOTES[id]} onClick={() => open(id)} />;
              })}
            </FeaturedRow>
          </>
        )}

        {section === "samples" && (
          <>
            <header className="home-header">
              <h1>Samples</h1>
              <p>Ready-made buildings to try things on. Open one, change it, and run the day.</p>
            </header>
            <div className="home-cards">
              {SAMPLE_PLANS.map((s) => (
                <PlanCard key={s.id} plan={s.plan} title={s.label} note={SAMPLE_NOTES[s.id] ?? ""} onClick={() => open(s.id)} />
              ))}
            </div>
          </>
        )}

        {section === "learn" && (
          <>
            <header className="home-header">
              <h1>How Nine Arches works</h1>
              <p>Three steps, in any order you like. Nothing has to be perfect to try it.</p>
            </header>
            <ol className="home-steps">
              <li>
                <strong>Building</strong>
                <span>
                  Trace a plan image, import a drawing, draw one, or describe it to the assistant. Rooms, doors, stairs and lifts are all it needs.
                </span>
              </li>
              <li>
                <strong>People</strong>
                <span>
                  Pick an office or a mall and a kind of day. The assistant fills in who comes, including people who need step-free routes or find
                  crowds hard.
                </span>
              </li>
              <li>
                <strong>Simulate</strong>
                <span>Run the day, or an evacuation. See what to fix first, then walk through the building beside the people.</span>
              </li>
            </ol>
            <section className="home-name">
              <h2>Why Nine Arches</h2>
              <p>
                The Nine Arches Bridge near Ella carries the hill-country railway in a tight curve high above a tea-covered valley. Completed in 1919,
                it was built by local workers under British engineers from concrete, stone and brick: about 91 metres long and 24 metres high, and
                still carrying trains more than a century later. Local legend says it was built without steel, and credits a village builder, P. K.
                Appuhami. Whatever the full story, the bridge shows what careful design and skilled hands can do together: a structure that works
                beautifully for the people who use it. That's what Nine Arches is for: testing a building with the people who will use it, before it's
                built.
              </p>
            </section>
            <h2>Handy keys</h2>
            <dl className="home-keys">
              <dt>⌘Z / ⇧⌘Z</dt>
              <dd>Undo and redo</dd>
              <dt>V · W · D · N · R · F · T</dt>
              <dd>Select, wall, door, window, room, furniture and stairs tools</dd>
              <dt>Delete</dt>
              <dd>Remove what's selected</dd>
              <dt>Space</dt>
              <dd>Play or pause a simulation</dd>
            </dl>
          </>
        )}
      </main>
      {tour > 0 && (
        <div className="backdrop">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Quick tour"
            onKeyDown={(e) => {
              if (e.key === "Escape") setTour(0);
            }}
          >
            <p>Step {tour} of 3</p>
            <h2>{["", "Your building", "Who uses it", "See what happens"][tour]}</h2>
            <p>
              {
                [
                  "",
                  "Start from a sample, trace a plan, draw one, or describe your building to the assistant.",
                  "A typical day is already filled in. Choose the crowd and kinds of people; Fine-tune holds the details.",
                  "Run the day, see what to fix first, and walk beside the people. Try a fix prepares a proposal for you to review.",
                ][tour]
              }
            </p>
            <div className="dialog-actions">
              <button onClick={() => setTour(0)}>Skip tour</button>
              <button autoFocus className="primary" onClick={() => setTour(tour === 3 ? 0 : tour + 1)}>
                {tour === 3 ? "Let’s start" : "Next"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/** Shows only the cards that fit on one line, so nothing hidden can take keyboard focus. */
function FeaturedRow({ children }: { children: ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setFit(Math.max(1, Math.floor((el.clientWidth + 14) / (220 + 14))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="home-cards" ref={ref}>
      {children.slice(0, fit)}
    </div>
  );
}

function Tile({ icon, title, note, onClick, accent }: { icon: ReactNode; title: string; note: string; onClick: () => void; accent?: boolean }) {
  return (
    <button className={`home-tile ${accent ? "accent" : ""}`} onClick={onClick}>
      <span className="home-tile-icon">{icon}</span>
      <strong>{title}</strong>
      <span>{note}</span>
    </button>
  );
}

function PlanCard({ plan, title, note, onClick }: { plan: FloorPlan; title: string; note: string; onClick: () => void }) {
  const floors = plan.levels.length;
  const kind = hasShops(plan) ? "Mall" : "Office";
  return (
    <button className="plan-card" onClick={onClick}>
      <span className="plan-card-art">
        <PlanModel plan={plan} />
        <span className={`plan-card-kind ${kind.toLowerCase()}`}>{kind}</span>
      </span>
      <span className="plan-card-text">
        <strong>{title}</strong>
        <span>{note}</span>
        <small>
          {floors} floor{floors === 1 ? "" : "s"} · {plan.spaces.length} rooms
          {plan.site?.location ? " · on a real site" : ""}
        </small>
      </span>
    </button>
  );
}

const svg = {
  width: 18,
  height: 18,
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
const PlusIcon = () => (
  <svg {...svg} width={14} height={14}>
    <path d="M9 3.5v11M3.5 9h11" />
  </svg>
);
const HomeIcon = () => (
  <svg {...svg}>
    <path d="M3 8.5L9 3.5l6 5V15H3z" />
    <path d="M7.5 15v-4h3v4" />
  </svg>
);
const GridIcon = () => (
  <svg {...svg}>
    <rect x="3" y="3" width="5" height="5" rx="1" />
    <rect x="10" y="3" width="5" height="5" rx="1" />
    <rect x="3" y="10" width="5" height="5" rx="1" />
    <rect x="10" y="10" width="5" height="5" rx="1" />
  </svg>
);
const BookIcon = () => (
  <svg {...svg}>
    <path d="M3 4.5c2-1 4-1 6 .5 2-1.5 4-1.5 6-.5V14c-2-1-4-1-6 .5-2-1.5-4-1.5-6-.5z" />
    <path d="M9 5v9.5" />
  </svg>
);
const ImageIcon = () => (
  <svg {...svg} width={22} height={22}>
    <rect x="2.5" y="3.5" width="13" height="11" rx="1.5" />
    <circle cx="6.5" cy="7" r="1.2" />
    <path d="M2.5 12.5l4-3.5 3 2.5 2.5-2 3.5 3" />
  </svg>
);
const FileIcon = () => (
  <svg {...svg} width={22} height={22}>
    <path d="M10.5 2.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 15.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5z" />
    <path d="M10.5 2.5v4h4M9 9v4.5M7 11.5l2 2 2-2" />
  </svg>
);
const PenIcon = () => (
  <svg {...svg} width={22} height={22}>
    <path d="M3 15l1-3.5L12 3.5l2.5 2.5-8 8z" />
    <path d="M10.5 5l2.5 2.5" />
  </svg>
);
