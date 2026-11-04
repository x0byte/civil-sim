import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { simulate } from "../src/index.ts";
import type { FloorPlan } from "../../contracts/floorplan.ts";
import type { Scenario } from "../../contracts/scenario.ts";
mkdirSync(new URL("../out/",import.meta.url),{recursive:true});
const rows=[];
for(const [pn,sn] of [["office-a-site","office-day-site"],["office-a-comfort","office-day-comfort"],["mall-2f-comfort","mall-weekend-comfort"]]){
 const p=JSON.parse(readFileSync(new URL(`../../samples/${pn}.floorplan.json`,import.meta.url),"utf8")) as FloorPlan;
 const s=JSON.parse(readFileSync(new URL(`../../samples/${sn}.scenario.json`,import.meta.url),"utf8")) as Scenario;
 simulate(p,s);const times=[];let result;for(let i=0;i<3;i++){const start=performance.now();result=simulate(p,s);times.push(performance.now()-start);}
 const row={pair:`${pn}/${sn}`,timesMs:times,medianMs:[...times].sort((a,b)=>a-b)[1],windows:result!.metrics.comfort!.windows,desks:result!.metrics.comfort!.desks};rows.push(row);console.log(JSON.stringify(row));
}
writeFileSync(new URL("../out/site-benchmark.json",import.meta.url),JSON.stringify(rows,null,2));
