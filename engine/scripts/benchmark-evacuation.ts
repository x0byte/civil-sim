import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import type {FloorPlan} from "../../contracts/floorplan.ts";
import type {Scenario} from "../../contracts/scenario.ts";
import {simulate} from "../src/index.ts";
const load=<T>(name:string)=>JSON.parse(readFileSync(new URL(`../../samples/${name}`,import.meta.url),"utf8")) as T;
mkdirSync(new URL("../out/",import.meta.url),{recursive:true});
const evacuations=[];
for(const [pn,sn] of [["office-a-evac","office-day-evac"],["mall-2f-evac","mall-weekend-evac"]]){
 const p=load<FloorPlan>(`${pn}.floorplan.json`),s=load<Scenario>(`${sn}.scenario.json`);simulate(p,s);const runs=[];let result;
 for(let i=0;i<3;i++){const start=performance.now();result=simulate(p,s);runs.push(performance.now()-start);}
 const row={pair:`${pn}/${sn}`,medianMs:[...runs].sort((a,b)=>a-b)[1],runsMs:runs,evacuation:result!.metrics.evacuation,accessibility:result!.metrics.accessibility,warnings:result!.warnings.filter(w=>w.code==="evacuation")};evacuations.push(row);console.log(JSON.stringify(row));writeFileSync(new URL(`../out/${sn}.result.json`,import.meta.url),JSON.stringify(result));
}
const pairs=[["office-a","office-day"],["office-b","office-day"],["sealed-room","sealed-day"],["mall-2f","mall-day"],["mall-2f","mall-weekend"],["mall-2f","mall-weekend-people"],["office-a-comfort","office-day-comfort"],["mall-2f-comfort","mall-weekend-comfort"],["office-a-site","office-day-site"]];
const accessibility=pairs.map(([p,s])=>({pair:`${p}/${s}`,checks:simulate(load(`${p}.floorplan.json`),load(`${s}.scenario.json`)).metrics.accessibility}));
writeFileSync(new URL("../out/evacuation-benchmark.json",import.meta.url),JSON.stringify({evacuations,accessibility},null,2));
