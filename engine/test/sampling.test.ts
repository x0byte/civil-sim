import { describe, expect, it } from 'vitest';
import { sampleParameters, parameterQuantile, PARAMETERS, ParameterValues } from '../src/index.ts';
import type { Parameter } from '../src/parameters.ts';
import { checkScenario } from '../../contracts/validate.ts';
import { plan, scenario } from './fixtures.ts';
const asymmetric: Parameter = { key: 'test', kind: 'behaviour', value: 10, low: 8, high: 16, unit: 's', source: 'Assumption: test (range assumed, not measured)', note: 'test' };
describe('truncated normal Latin hypercube', () => {
  it('stays bounded, has its median/mode at the value, and concentrates near it', () => {
    expect(parameterQuantile(asymmetric,0)).toBe(8); expect(parameterQuantile(asymmetric,1)).toBe(16);
    expect(parameterQuantile(asymmetric,.5)).toBe(10);
    // Each half has greatest probability density next to the value.
    expect(parameterQuantile(asymmetric,.55)-10).toBeLessThan(parameterQuantile(asymmetric,.95)-parameterQuantile(asymmetric,.9));
    const rows=sampleParameters([asymmetric],10001,77), draws=rows.map(row=>row[0].value).sort((a,b)=>a-b);
    expect(draws[0]).toBeGreaterThanOrEqual(8);expect(draws.at(-1)!).toBeLessThanOrEqual(16);
    expect(draws[5000]).toBeCloseTo(10,2);
  });
  it('is reproducible, changes with seed, stratifies each CDF and is key/order independent', () => {
    const symmetric={ ...asymmetric,key:'symmetric',low:4,high:16 };
    const a=sampleParameters([asymmetric,symmetric],12,10);
    expect(sampleParameters([asymmetric,symmetric],12,10)).toEqual(a);
    expect(sampleParameters([symmetric,asymmetric],12,10)).toEqual(a);
    expect(sampleParameters([asymmetric,symmetric],12,11)).not.toEqual(a);
    for(const p of [asymmetric,symmetric]) {
      const values=a.map(row=>row.find(v=>v.key===p.key)!.value).sort((a,b)=>a-b);
      values.forEach((v,i)=>{expect(v).toBeGreaterThanOrEqual(parameterQuantile(p,i/12));expect(v).toBeLessThanOrEqual(parameterQuantile(p,(i+1)/12));});
    }
  });
  it('holds settings and explicit overrides fixed, including zero-width sides', () => {
    const setting={...asymmetric,key:'setting',kind:'setting' as const};
    const rows=sampleParameters([setting,asymmetric],12,1,[{key:'test',value:11,source:'Measured'}]);
    for(const row of rows){expect(row.find(p=>p.key==='setting')!.value).toBe(10);expect(row.find(p=>p.key==='test')).toEqual({key:'test',value:11,source:'Measured'});}
    expect(parameterQuantile({...asymmetric,low:10},.1)).toBe(10);
  });
  it('keeps population shares on their bounded simplex and generates valid scenarios', () => {
    const s=scenario('mall-weekend-people'),p=plan('mall-2f');
    const definitions=new ParameterValues([],s).entries();
    for(const row of sampleParameters(definitions,12,42)) {
      const values=new Map(row.map(p=>[p.key,p.value]));
      for(const definition of definitions) {expect(values.get(definition.key)!).toBeGreaterThanOrEqual(definition.low-1e-10);expect(values.get(definition.key)!).toBeLessThanOrEqual(definition.high+1e-10);}
      const sampled=new ParameterValues(row,s).scenario!;
      expect(checkScenario(sampled,p)).toEqual([]);
    }
  });
  it('samples integer capacity and keeps all profile min/mean/max relationships valid', () => {
    const definitions=new ParameterValues([],scenario('office-day-comfort')).entries();
    for(const row of sampleParameters(definitions,100,99)) {
      const values=new Map(row.map(p=>[p.key,p.value]));
      expect(Number.isInteger(values.get('capacity.lift.car'))).toBe(true);
      for(const p of definitions) if(p.key.endsWith('.mean')) {
        const prefix=p.key.slice(0,-4),mean=values.get(p.key)!;
        if(values.has(prefix+'min'))expect(values.get(prefix+'min')!).toBeLessThanOrEqual(mean);
        if(values.has(prefix+'max'))expect(values.get(prefix+'max')!).toBeGreaterThanOrEqual(mean);
      }
    }
    for(const p of PARAMETERS.filter(p=>p.kind==='setting'))expect(p.low).toBe(p.high);
  });
});
