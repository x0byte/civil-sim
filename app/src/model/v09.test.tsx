import {describe,expect,it,vi,afterEach} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import type {FloorPlan} from "../../../contracts/floorplan.ts";
import type {Scenario} from "../../../contracts/scenario.ts";
import {validateFloorPlan,validateScenario} from "../../../contracts/validate.ts";
import office from "../../../samples/office-a-evac.floorplan.json";
import mall from "../../../samples/mall-2f-evac.floorplan.json";
import officeDay from "../../../samples/office-day-evac.scenario.json";
import mallDay from "../../../samples/mall-weekend-evac.scenario.json";
import osm from "../site/fixtures/overpass-colombo.json";
import site from "../../../samples/office-a-site.floorplan.json";
import {simulate} from "../../../engine/src/index.ts";
import {defaultProfile,expandProfile} from "../population/officeProfile.ts";
import {useEditor} from "../state/store.ts";
import {addConnector,setSafetyFlag} from "./planOps.ts";
import {rampText} from "../ui/Inspector.tsx";
import {runTool,describe as describeDraft} from "../assistant/tools.ts";
import {convertOverpass,fetchSurroundings, type OverpassResponse} from "../site/data.ts";
import {AccessibilityResults,EvacuationResults} from "../playback/EvacuationResults.tsx";
import {defaultAlarm} from "../sim/EvacuationDialog.tsx";
import {runSimulation,runComparison} from "../sim/runSimulation.ts";
const p=()=>structuredClone(mall) as FloorPlan;
afterEach(()=>vi.unstubAllGlobals());
describe("v0.9 app edits and tools",()=>{
 it("validates and undoes each safety edit and ramp; gives the actual gradient",()=>{
  useEditor.getState().load(p());const edits=[(p:FloorPlan)=>setSafetyFlag(p,"opening","g-d-main","fireExit",true),(p:FloorPlan)=>setSafetyFlag(p,"space",p.spaces.find(s=>s.type==="toilet")!.id,"accessible",true),(p:FloorPlan)=>setSafetyFlag(p,"space","f-food-court","refuge",true),(p:FloorPlan)=>setSafetyFlag(p,"connector",p.connectors.find(c=>c.kind==="lift")!.id,"evacuationLift",true),(p:FloorPlan)=>addConnector(p,[{x:14,y:0},{x:23,y:0},{x:23,y:6},{x:14,y:6}],"ramp","ground").plan];
  for(const edit of edits){const before=useEditor.getState().plan;useEditor.getState().commit(edit);const after=useEditor.getState().plan;expect(validateFloorPlan(after)).toEqual([]);useEditor.getState().undo();expect(useEditor.getState().plan).toEqual(before);useEditor.getState().redo();expect(useEditor.getState().plan).toEqual(after);}
  const plan=useEditor.getState().plan,c=plan.connectors.at(-1)!;expect(rampText(plan,c)).toContain("too steep");plan.levels[1].elevation=.5;expect(rampText(plan,c)).toContain("fine for wheelchairs");
 });
 it("accepts each safety flag, a ramp and alarm setup; refuses mismatched flags and bad inputs",()=>{
  let draft={plan:p(),profile:defaultProfile(p())};const flags=[{flag:"fireExit",id:"g-d-main"},{flag:"accessible",id:draft.plan.spaces.find(s=>s.type==="toilet")!.id},{flag:"refuge",id:"f-food-court"},{flag:"evacuationLift",id:draft.plan.connectors.find(c=>c.kind==="lift")!.id}];
  for(const input of flags){expect(runTool("set_safety_flag",{...input,id:"missing",value:true},draft).error).toBe(true);const r=runTool("set_safety_flag",{...input,value:true},draft);expect(r.error,r.result).toBeFalsy();draft=r.draft;}
  const ramp=runTool("add_connector",{floor_id:"ground",kind:"ramp",polygon:[{x:14,y:0},{x:23,y:0},{x:23,y:6}],name:"Ramp",escalator_direction:null},draft);expect(ramp.error,ramp.result).toBeFalsy();expect(runTool("add_connector",{floor_id:"ground",kind:"ramp",polygon:[]},draft).error).toBe(true);
  expect(runTool("set_evacuation",{enabled:true,alarm_at:"25:00",blocked_exit_ids:[]},draft).error).toBe(true);const alarm=runTool("set_evacuation",{enabled:true,alarm_at:"18:30",blocked_exit_ids:["g-d-main"]},draft);expect(alarm.error,alarm.result).toBeFalsy();expect(validateScenario(expandProfile(alarm.draft.profile,alarm.draft.plan).scenario,alarm.draft.plan)).toEqual([]);expect(describeDraft(alarm.draft)).toContain("alarm 18:30");
 });
 it("uses exactly the day people for an evacuation and compares evacuation results",()=>{
  const plan=office as FloorPlan,profile=defaultProfile(plan);profile.comfort=undefined;const day=runSimulation(plan,profile),evac=runSimulation(plan,profile,{alarmAt:"10:20"});expect("errors"in day).toBe(false);expect("errors"in evac).toBe(false);if("run"in day&&"run"in evac){expect(evac.run.scenario.people).toEqual(day.run.scenario.people);expect(evac.run.scenario.seed).toBe(day.run.scenario.seed);expect(defaultAlarm(day.run,profile.workday.start,profile.workday.end)).toMatch(/^\d\d:\d\d$/);}
  const compare=runComparison(plan,plan,["A","B"],profile,{alarmAt:"10:20"});expect("comparison"in compare&&compare.comparison.a.result.metrics.evacuation).toBeTruthy();
 });
 it.each([[office,officeDay],[mall,mallDay]])("renders plain evacuation and guidance results",(plan,scenario)=>{
  const result=simulate(plan as FloorPlan,scenario as Scenario);const run={plan:plan as FloorPlan,scenario:scenario as Scenario,result,runMs:0,notes:[],collaborations:[]};const html=renderToStaticMarkup(<><EvacuationResults run={run}/><AccessibilityResults run={run}/></>);expect(html).toContain("Exits and queues");expect(html).toContain("guidance, not certification");expect(html).not.toContain("connectorId");
 });
});
describe("real recorded Overpass response © OpenStreetMap contributors (ODbL)",()=>{
 it("converts Colombo buildings, height provenance and Galle Road / Marine Drive",()=>{const out=convertOverpass(osm as unknown as OverpassResponse,site as FloorPlan);expect(out.neighbours.length).toBeGreaterThan(100);expect(out.neighbours.some(n=>n.heightFrom==="data")).toBe(true);expect(out.neighbours.some(n=>n.heightFrom==="floors")).toBe(true);expect(out.roads.some(r=>r.name?.includes("Galle"))).toBe(true);expect(out.roads.some(r=>r.name?.includes("Marine"))).toBe(true);expect(validateFloorPlan({...site,site:{...site.site,...out}} as FloorPlan)).toEqual([]);});
 it("POSTs the main service first and uses the mirror only after failure",async()=>{const mock=vi.fn().mockResolvedValueOnce(new Response("busy",{status:503})).mockResolvedValueOnce(new Response(JSON.stringify(osm),{status:200}));vi.stubGlobal("fetch",mock);const out=await fetchSurroundings(site as FloorPlan);expect(mock.mock.calls[0][0]).toBe("https://overpass-api.de/api/interpreter");expect(mock.mock.calls[0][1].method).toBe("POST");expect(mock.mock.calls[0][1].body.get("data")).toContain("around:200");expect(mock.mock.calls[1][0]).toContain("private.coffee");expect(out.credits[0]).toContain("ODbL");});
});
