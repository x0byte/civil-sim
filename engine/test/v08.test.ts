import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { simulate } from "../src/index.ts";
import { Environment, sunPosition } from "../src/modules/environment.ts";
import { neighbourBlocks, cloudFraction, skyVisibility } from "../src/modules/site.ts";
import { Sound } from "../src/modules/sound.ts";
import { plan, scenario } from "./fixtures.ts";

describe("v0.8 site and weather", () => {
  const captures = JSON.parse(readFileSync(new URL("data/v072-full-sha256.json", import.meta.url), "utf8")).sha256;
  it.each(Object.keys(captures))("preserves the entire v0.7.2 result: %s", (key) => {
    const [p, s] = key.split("/"); const result = JSON.parse(JSON.stringify(simulate(plan(p), scenario(s))));
    expect(result.version).toBe("0.8"); result.version = "0.7";
    if (result.metrics.comfort) { delete result.metrics.comfort.windows; delete result.metrics.comfort.weatherUsed; }
    expect(createHash("sha256").update(JSON.stringify(result)).digest("hex")).toBe(captures[key]);
  });
  it("uses footprint intersections, observer elevation and blocked sky", () => {
    const p = plan("office-a-site"); p.site!.neighbours = [{ id: "block", polygon: [{x:-10,y:-10},{x:-5,y:-10},{x:-5,y:30},{x:-10,y:30}], heightM:6, heightFrom:"user" }];
    const sun = {x:-1,y:0,up:.1};
    expect(neighbourBlocks(p,{x:0,y:5},1,sun)).toBe(true);
    expect(neighbourBlocks(p,{x:0,y:5},7,sun)).toBe(false);
    expect(neighbourBlocks(p,{x:0,y:40},1,sun)).toBe(false);
    expect(skyVisibility(p,{x:0,y:5},1,1,0)).toBeLessThan(1);
    expect(skyVisibility(p,{x:0,y:5},7,1,0)).toBe(1);
  });
  it("shades west windows in the afternoon and restores sun when neighbours are removed", () => {
    const p=plan("office-a-site"), s=scenario("office-day-site"); delete s.comfort!.weather;
    const env=new Environment(p,s),sun=sunPosition(p,s,16*3600);
    const shaded=env.windows.filter(w=>env.windowSun(w,sun).eligible && env.windowSun(w,sun).clear===0);
    expect(shaded.length).toBeGreaterThan(0);
    const q=structuredClone(p);q.site!.neighbours=[];const clear=new Environment(q,s);
    for(const w of shaded) expect(clear.windowSun(clear.windows.find(v=>v.opening.id===w.opening.id)!,sun).clear).toBe(1);
    expect(p.fixtures.filter(f=>f.type==="desk").some(f=>clear.light(f.position,f.levelId,sun,f.rotation).facing>env.light(f.position,f.levelId,sun,f.rotation).facing)).toBe(true);
  });
  it("hourly weather overrides sky and full cloud removes direct glare", () => {
    const p=plan("office-a-site"),s=scenario("office-day-site");p.site!.neighbours=[];s.comfort!.sky="clear";s.comfort!.weather!.hourly.forEach(h=>h.cloudPct=100);
    const env=new Environment(p,s),sun=sunPosition(p,s,16*3600);expect(cloudFraction(s,16*3600)).toBe(1);
    for(const f of p.fixtures.filter(f=>f.type==="desk")) expect(env.light(f.position,f.levelId,sun,f.rotation)).toMatchObject({glare:0,facing:0});
    expect(simulate(p,s).metrics.comfort!.windows.every(w=>w.sunMinutes===0)).toBe(true);
    s.comfort!.sky="overcast";s.comfort!.weather!.hourly.forEach(h=>h.cloudPct=0);expect(cloudFraction(s,0)).toBe(0);
  });
  it("makes the road-facing side of the sample office louder",()=>{
    const p=plan("office-a-site"),s=scenario("office-day-site"),sound=new Sound(new Environment(p,s),[],60);
    expect(sound.at({x:12,y:13},"ground",0)).toBeGreaterThan(sound.at({x:12,y:5},"ground",0)+1);
  });
  it("uses longitude and timezone together",()=>{
    const p=plan("office-a-site"),s=scenario("office-day-site"),sun=sunPosition(p,s,43200);p.site!.location!.lon+=15;p.site!.utcOffsetHours!+=1;expect(sunPosition(p,s,43200)).toEqual(sun);
  });
  it("roads lose about 3 dB per doubling while points lose 6 dB; road hours apply",()=>{
    const p=plan("office-a-site"),s=scenario("office-day-site");p.walls=[];p.openings=[];p.spaces=[];p.noiseSources=[];
    p.site!.roads=[{id:"road",kind:"main",path:[{x:0,y:-500},{x:0,y:500}]}];const sound=new Sound(new Environment(p,s),[],60);
    const drop=sound.at({x:4,y:0},"ground",0)-sound.at({x:8,y:0},"ground",0);expect(drop).toBeGreaterThan(2.7);expect(drop).toBeLessThan(3.3);
    p.site!.roads=[];p.noiseSources=[{id:"point",name:"Point",levelId:"ground",position:{x:0,y:0},dbA:75}];const point=new Sound(new Environment(p,s),[],60);
    expect(point.at({x:4,y:0},"ground",0)-point.at({x:8,y:0},"ground",0)).toBeGreaterThan(5.4);
    p.noiseSources=[];p.site!.roads=[{id:"road",kind:"main",path:[{x:0,y:-500},{x:0,y:500}],hours:{from:"10:00",to:"11:00"}}];expect(new Sound(new Environment(p,s),[],60).at({x:4,y:0},"ground",0)).toBeLessThan(40);
  });
  it("is deterministic, immutable and leaves movement unchanged",()=>{
    const p=plan("office-a-site"),s=scenario("office-day-site"),before=JSON.stringify([p,s]);const a=simulate(p,s);expect(simulate(p,s)).toEqual(a);expect(JSON.stringify([p,s])).toBe(before);
    delete s.comfort;const off=simulate(p,s);const movement=(r:typeof a)=>r.tracks.map(({discomfort,...t})=>t);expect(movement(a)).toEqual(movement(off));expect(a.metrics.comfort!.weatherUsed).toBe("typical");
  });
});
