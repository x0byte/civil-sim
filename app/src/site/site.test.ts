import { afterEach, describe, expect, it, vi } from "vitest";
import type { FloorPlan } from "../../../contracts/floorplan.ts";
import { validateFloorPlan, validateScenario } from "../../../contracts/validate.ts";
import sample from "../../../samples/office-a-site.floorplan.json";
import archive from "./fixtures/archive-colombo.json";
import { archiveDay, averageWeather, convertOverpass, fetchWeather, fetchSurroundings, overpassQuery, type OverpassResponse } from "./data.ts";
import { mapsLocation, toEarth, toPlan } from "./coordinates.ts";
import { addNeighbour, addRoad, updateNeighbour, setSite, removeItem, setSurroundings } from "../model/planOps.ts";
import { buildProject, parseProjectOrPlan } from "../model/projectFile.ts";
import { useEditor } from "../state/store.ts";
import { defaultProfile, expandProfile } from "../population/officeProfile.ts";
import { runTool, describe as describeDraft } from "../assistant/tools.ts";
const plan=()=>structuredClone(sample) as FloorPlan;
afterEach(()=>vi.unstubAllGlobals());
describe("site inputs and geographic conversion",()=>{
 it.each(["https://www.google.com/maps/@6.9,79.853,17z","https://www.google.com/maps/place/Office/data=!3d6.9!4d79.853","https://maps.google.com/?q=6.9%2C79.853"])("reads supplied coordinates: %s",link=>expect(mapsLocation(link)).toEqual({lat:6.9,lon:79.853}));
 it.each(["Colombo","https://maps.app.goo.gl/short","https://maps.google.com/?q=91,79"])("refuses unavailable/invalid coordinates: %s",link=>expect(()=>mapsLocation(link)).toThrow());
 it("converts metres, rotates north and reprojects without moving the earth position",()=>{
  const origin={lat:6.9,lon:79.853},p={lat:6.901,lon:79.854},a=toPlan(p,origin,0),b=toPlan(p,origin,90);
  expect(a.x).toBeCloseTo(110.39,1);expect(a.y).toBeCloseTo(-111.195,2);expect(b.x).toBeCloseTo(-a.y);expect(b.y).toBeCloseTo(a.x);expect(toEarth(b,origin,90)).toEqual(p);
  const old=plan(),next=setSite(old,{northDeg:90});const point=old.site!.neighbours![0].polygon[0];expect(toEarth(next.site!.neighbours![0].polygon[0],next.site!.location!,90)).toEqual(toEarth(point,old.site!.location!,old.site!.northDeg));
 });
 it("converts height tags and roads, skipping walks, and clips long ways",()=>{
  const p=plan(),o=p.site!.location!;const points=[{x:-20,y:0},{x:-15,y:0},{x:-15,y:4},{x:-20,y:4},{x:-20,y:0}].map(q=>toEarth(q,o,p.site!.northDeg));
  const raw:OverpassResponse={elements:[{type:"way",id:1,tags:{building:"yes",height:"12 m"},geometry:points},{type:"way",id:2,tags:{building:"yes","building:levels":"3"},geometry:points},{type:"way",id:3,tags:{building:"yes"},geometry:points},...(["primary","tertiary","residential","service","footway"] as const).map((highway,i)=>({type:"way",id:i+4,tags:{highway},geometry:[{x:-1000,y:-10},{x:1000,y:-10}].map(q=>toEarth(q,o,p.site!.northDeg))}))]};
  const out=convertOverpass(raw,p);expect(out.neighbours.map(n=>[n.heightM,n.heightFrom])).toEqual([[12,"data"],[9,"floors"],[6,"assumed"]]);expect(out.roads.map(r=>r.kind)).toEqual(["main","secondary","local","service"]);expect(out.roads.every(r=>r.path.every(q=>Math.abs(q.x)<=250.000001))).toBe(true);expect(validateFloorPlan({...p,site:{...p.site!,...out}})).toEqual([]);expect(overpassQuery(o)).toContain("around:200");
 });
});
describe("recorded archive weather, never live network",()=>{
 it("makes 24 valid local hours including half-hour interpolation and ten-day average",()=>{
  const hours=archiveDay(archive,"2025-11-15",5.5);expect(hours).toHaveLength(24);expect(hours[0].hour).toBe("00:00");expect(hours[23].hour).toBe("23:00");
  const i=archive.hourly.time.indexOf("2025-11-14T18:00");expect(hours[0].cloudPct).toBe((archive.hourly.cloud_cover[i]+archive.hourly.cloud_cover[i+1])/2);
  const weather=averageWeather(Array.from({length:10},()=>hours),"typical","Recorded archive");const p=plan(),profile=defaultProfile(p);profile.comfort={enabled:true,date:"2025-11-15",sky:"clear",weather};
  expect(validateScenario(expandProfile(profile,p).scenario)).toEqual([]);
 });
 it("uses app fetch and handles failures without replacing saved data",async()=>{
  const mock=vi.fn().mockResolvedValue(new Response(JSON.stringify(archive),{status:200}));vi.stubGlobal("fetch",mock);
  const out=await fetchWeather(plan().site!,"2025-11-15","day",undefined,new Date("2026-11-04"));expect(out.weather.hourly).toHaveLength(24);expect(mock).toHaveBeenCalledTimes(1);
  mock.mockResolvedValue(new Response("busy",{status:429}));await expect(fetchSurroundings(plan())).rejects.toThrow(/rate limit.*Retry/);
 });
 it("rejects incomplete hourly responses",()=>expect(()=>archiveDay({...archive,hourly:{...archive.hourly,cloud_cover:[]}},"2025-11-15",5.5)).toThrow(/missing/));
});
describe("undo and assistant site edits",()=>{
 it("undoes/redoes location, drawing, height, road, fetch and removal independently",()=>{
  const p=plan();useEditor.getState().load(p);
  const edits=[(p:FloorPlan)=>setSite(p,{location:{lat:6.91,lon:79.85}}),(p:FloorPlan)=>addNeighbour(p,[{x:-10,y:0},{x:-5,y:0},{x:-5,y:4}],12).plan,(p:FloorPlan)=>updateNeighbour(p,p.site!.neighbours![0].id,{heightM:20}),(p:FloorPlan)=>addRoad(p,[{x:-10,y:0},{x:-10,y:10}],"local").plan,(p:FloorPlan)=>setSurroundings(p,[],[],["© OpenStreetMap contributors, recorded"]),(p:FloorPlan)=>removeItem(p,{kind:"neighbour",id:p.site!.neighbours![0].id})];
  for(const edit of edits){const before=useEditor.getState().plan;useEditor.getState().commit(edit);const after=useEditor.getState().plan;expect(after).not.toEqual(before);useEditor.getState().undo();expect(useEditor.getState().plan).toEqual(before);useEditor.getState().redo();expect(useEditor.getState().plan).toEqual(after);expect(validateFloorPlan(after)).toEqual([]);}
 });
 it("accepts each tool, refuses bad input and describes saved context",()=>{
  const p=plan();let draft={plan:p,profile:defaultProfile(p)};
  const calls:[string,Record<string,unknown>,Record<string,unknown>][]=[
   ["set_location",{lat:null,lon:null,maps_link:"https://maps.google.com/?q=6.9,79.853",utc_offset:5.5},{lat:91,lon:10,maps_link:null,utc_offset:null}],
   ["add_neighbour",{name:"New block",polygon:[{x:-10,y:0},{x:-5,y:0},{x:-5,y:4}],height:12},{polygon:[],height:12}],
   ["update_neighbour",{neighbour_id:p.site!.neighbours![0].id,height:25,name:null},{neighbour_id:"missing",height:25,name:null}],
   ["add_road",{name:"Lane",path:[{x:-10,y:0},{x:-10,y:10}],kind:"local",dbA:null,hours:null},{path:[],kind:"main"}],
   ["set_weather",{kind:"day",date:"2025-11-15"},{kind:"invented",date:null}],
  ];
  for(const [name,good,bad] of calls){expect(runTool(name,bad,draft).error).toBe(true);const out=runTool(name,good,draft);expect(out.error,out.result).toBeFalsy();draft=out.draft;expect(validateFloorPlan(draft.plan)).toEqual([]);}
  expect(describeDraft(draft)).toContain("79.853");expect(runTool("remove",{kind:"neighbour",id:draft.plan.site!.neighbours![0].id},draft).error).toBeFalsy();
 });
});

describe("saved weather history",()=>{
 it("undoes and redoes weather choices and saved hourly data",()=>{
  const p=plan(),profile=defaultProfile(p);useEditor.getState().load(p);useEditor.getState().setProfile(p.id,profile);
  const weather=averageWeather([archiveDay(archive,"2025-11-15",5.5)],"day","Recorded archive");
  const next={...profile,comfort:{enabled:true,date:"2025-11-15",sky:"clear" as const,weatherKind:"day" as const,weather}};
  const saved=parseProjectOrPlan(JSON.stringify(buildProject(p,[],{[p.id]:next})));expect(saved.kind === "project" && saved.project.people[p.id].comfort!.weather).toEqual(weather);
  useEditor.getState().setProfile(p.id,next,true);useEditor.getState().undo();expect(useEditor.getState().profiles[p.id]).toEqual(profile);useEditor.getState().redo();expect(useEditor.getState().profiles[p.id]).toEqual(next);
 });
 it("averages ten archive dates using recorded hourly values and never uses a live request",async()=>{
  const mock=vi.fn(async(url:string)=>{const q=new URL(url);const day=q.searchParams.get("start_date")!;const first=Date.parse(`${day}T00:00Z`);const data={...archive,hourly:{...archive.hourly,time:archive.hourly.time.map((_,i)=>new Date(first+i*3600000).toISOString().slice(0,16))}};return new Response(JSON.stringify(data),{status:200});});vi.stubGlobal("fetch",mock);
  const result=await fetchWeather(plan().site!,"2026-11-15","typical",undefined,new Date("2026-11-04"));expect(mock).toHaveBeenCalledTimes(10);expect(result.weather.source).toContain("2016–2025");expect(result.weather.hourly).toHaveLength(24);
 });
});

// A timeout from either Overpass endpoint must not leak the browser's raw abort error.
it("explains surroundings service failures in plain words", async () => {
  const { surroundingsError } = await import("./data.ts");
  expect(surroundingsError(new DOMException("signal is aborted without reason", "AbortError"))).toBe("The surroundings service took too long. Retry later.");
  expect(surroundingsError(new TypeError("Failed to fetch"))).toContain("Check the connection");
});
