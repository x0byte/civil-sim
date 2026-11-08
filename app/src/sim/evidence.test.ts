import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FloorPlan } from '../../../contracts/floorplan.ts';
import type { Scenario } from '../../../contracts/scenario.ts';
import { executeTask } from './tasks.ts';

describe('background evidence dispatch', () => {
  const plan = JSON.parse(readFileSync(new URL('../../../samples/office-a.floorplan.json', import.meta.url), 'utf8')) as FloorPlan;
  const scenario = JSON.parse(readFileSync(new URL('../../../samples/office-day.scenario.json', import.meta.url), 'utf8')) as Scenario;
  it('returns the central run first and computes evidence only in a separate task', () => {
    const messages: string[] = [];
    const result = executeTask({ kind: 'fixed', plan, scenario }, progress => messages.push(progress.message));
    expect(result.evidence!.sensitivity).toEqual([]);
    expect(messages.some(message => message.includes('sensitivity') || message.includes('depends on'))).toBe(false);
    expect(messages.at(-1)).toBe('Preparing results…');
    const progress: string[]=[];
    const sensitivity=executeTask({kind:'sensitivity',plan,scenario,evidence:result.evidence!},p=>progress.push(p.message));
    expect(sensitivity.length).toBeGreaterThan(0);
    expect(progress[0]).toMatch(/^Checking what the result depends on · 0 of /);
    expect(progress.at(-1)).toMatch(/^Checking what the result depends on · \d+ of \d+$/);
    expect(result.evidence!.sensitivity).toEqual([]);
  });
  it('never adds sensitivity to comparisons',()=>{
    const messages:string[]=[];
    const out=executeTask({kind:'compare',a:plan,b:plan,labels:['A','B']},p=>messages.push(p.message));
    if('errors' in out)throw new Error(out.errors.join());
    expect(out.comparison.a.result.evidence!.sensitivity).toEqual([]);
    expect(out.comparison.b.result.evidence!.sensitivity).toEqual([]);
    expect(messages.some(m=>m.includes('depends on')||m.includes('sensitivity'))).toBe(false);
  });
});
