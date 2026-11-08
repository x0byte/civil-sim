import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { simulate, PARAMETERS, ParameterValues, analyseSensitivity, evidenceMetrics, sensitivitySample } from '../src/index.ts';
import { withNavigationCache } from '../src/modules/navigation.ts';
import { plan, scenario } from './fixtures.ts';

describe('Part A review regressions', () => {
  it('documents every static registry key', () => {
    const documentation=readFileSync(new URL('../../docs/parameters.md',import.meta.url),'utf8');
    for(const p of PARAMETERS) expect(documentation, p.key).toContain('`'+p.key+'`');
  });
  it('clips probabilities, keeps settings fixed and exposes assumed-rate drivers', () => {
    for(const p of new ParameterValues([],scenario()).entries()) {
      if(p.kind==='setting')expect(p.low).toBe(p.high);
      if(/Share$|\.share$|familiarity|glareComfort/.test(p.key)) {expect(p.low).toBeGreaterThanOrEqual(0);expect(p.high).toBeLessThanOrEqual(1);}
    }
    const r=simulate(plan(),scenario(),{sensitivity:true});
    expect(r.evidence!.sensitivity.some(row=>row.drivers.some(d=>d.key==='scenario.rates.toiletVisitsPerDay'))).toBe(true);
    const settings=new Set(PARAMETERS.filter(p=>p.kind==='setting').map(p=>p.key));
    expect(r.evidence!.sensitivity.every(row=>row.drivers.every(d=>!settings.has(d.key)))).toBe(true);
  });
  it('movement-only post-processing leaves tracks and the headline inputs identical', () => {
    const p=plan('office-a-comfort'),s=scenario('office-day-comfort');
    const full=simulate(p,s),screen=simulate(p,s,{measurement:'movement'});
    expect(screen.tracks).toEqual(full.tracks.map(({discomfort: _,...track})=>track));expect(screen.events).toEqual(full.events);
    expect(evidenceMetrics(screen)).toEqual(evidenceMetrics(full));
    expect(screen.metrics.comfort).toBeNull();expect(full.metrics.comfort).not.toBeNull();
  });
  it('scoped geometry caching preserves routes and resets per-run lift metrics when overrides change', () => {
    const p=plan('mall-2f'),s=scenario('mall-day');
    const slow={...s,parameters:[{key:'capacity.lift.stop',value:12,source:'Measured stop'}]};
    const baseline=simulate(p,s,{measurement:'movement'}),changed=simulate(p,slow,{measurement:'movement'});
    withNavigationCache(()=>{
      for(const [scenario,expected] of [[s,baseline],[slow,changed],[s,baseline]] as const) {
        const actual=simulate(p,scenario,{measurement:'movement'});
        expect(actual.tracks).toEqual(expected.tracks);expect(actual.metrics.connectors).toEqual(expected.metrics.connectors);
        expect(evidenceMetrics(actual)).toEqual(evidenceMetrics(expected));
      }
    });
  },15000);
  it('keeps arrival endpoint rates and existing overrides scaled to the same sample', () => {
    const p=plan('mall-2f'),s=scenario('mall-weekend');
    const key='scenario.shoppers.arrivals.0.perHour',original=s.shoppers!.arrivals[0].perHour;
    s.parameters=[{key,value:original*2,source:'Observed entry counts'}];
    const sample=sensitivitySample(s,8);
    expect(sample.parameters![0].value).toBe(sample.shoppers!.arrivals[0].perHour);
    delete s.parameters;
    const baseline=simulate(p,s,{measurement:'movement'}),captured: number[]=[];
    const one=baseline.evidence!.parameters.find(p=>p.key===key)!;
    analyseSensitivity(p,s,{parameters:[one],sensitivity:[]},(_p,reduced)=>{
      const rate=reduced.parameters?.find(p=>p.key===key)?.value ?? reduced.shoppers!.arrivals[0].perHour;
      captured.push(rate);return baseline;
    },{sampleSize:8});
    const factor=sensitivitySample(s,8).shoppers!.arrivals[0].perHour/original;
    expect(captured[1]).toBeCloseTo(one.low*factor);expect(captured[2]).toBeCloseTo(one.high*factor);
  });
});
