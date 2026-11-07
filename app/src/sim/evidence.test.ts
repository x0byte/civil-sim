import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FloorPlan } from '../../../contracts/floorplan.ts';
import type { Scenario } from '../../../contracts/scenario.ts';
import { executeTask } from './tasks.ts';

describe('background evidence dispatch', () => {
  it('computes sensitivity and reports it before preparing the completed result', () => {
    const plan = JSON.parse(readFileSync(new URL('../../../samples/office-a.floorplan.json', import.meta.url), 'utf8')) as FloorPlan;
    const scenario = JSON.parse(readFileSync(new URL('../../../samples/office-day.scenario.json', import.meta.url), 'utf8')) as Scenario;
    const messages: string[] = [];
    const result = executeTask({ kind: 'fixed', plan, scenario }, progress => messages.push(progress.message));
    expect(result.evidence!.sensitivity.length).toBeGreaterThan(0);
    expect(messages.some(message => message.startsWith('Checking parameter sensitivity'))).toBe(true);
    expect(messages.at(-1)).toBe('Preparing results…');
  });
});
