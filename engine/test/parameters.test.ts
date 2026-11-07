import { describe, expect, it } from 'vitest';
import { simulate, PARAMETERS, ParameterValues, calibrate } from '../src/index.ts';
import { parameter, withParameters } from '../src/parameters.ts';
import { densitySpeed } from '../src/modules/density.ts';
import { roomLux, Environment } from '../src/modules/environment.ts';
import { Sound } from '../src/modules/sound.ts';
import { plan, scenario } from './fixtures.ts';

function office() {
  const p = plan(), s = scenario();
  delete s.profiles; delete s.crowding; delete s.lunch;
  s.visitors = []; s.meetings = [];
  s.rates = { toiletVisitsPerDay: 0, pantryVisitsPerDay: 0 };
  return { p, s };
}
describe('parameter evidence', () => {
  it('has unique, finite, ordered definitions with honest provenance and notes', () => {
    expect(new Set(PARAMETERS.map(p => p.key)).size).toBe(PARAMETERS.length);
    for (const p of PARAMETERS) {
      expect([p.low, p.value, p.high].every(Number.isFinite)).toBe(true);
      expect(p.low).toBeLessThanOrEqual(p.value); expect(p.value).toBeLessThanOrEqual(p.high);
      expect(p.source.trim()).not.toBe(''); expect(p.note.trim()).not.toBe(''); expect(p.unit).not.toBe('');
      expect(['behaviour','setting']).toContain(p.kind);
      if (p.kind === 'setting') expect(p.low).toBe(p.high);
      else if (p.source.startsWith('Assumption:')) expect(p.source).toContain('(range assumed, not measured)');
      else expect(p.source).toMatch(/Table|Eq\.|section/);
    }
  });
  it('slower free walking increases walking time, preserves inputs and records the supplied source', () => {
    const { p, s } = office(); const before = JSON.stringify([p, s]);
    const baseline = simulate(p, s);
    const altered = simulate(p, { ...s, parameters: [{ key: 'walk.speed.adult', value: .9, source: 'Measured office cohort, 2026-11-08' }] });
    expect(altered.metrics.summary.totalWalkingTimeS).toBeGreaterThan(baseline.metrics.summary.totalWalkingTimeS);
    expect(altered.evidence!.parameters.find(p => p.key === 'walk.speed.adult')).toMatchObject({ value: .9, low: .9, high: .9, overridden: true, source: 'Measured office cohort, 2026-11-08' });
    expect(JSON.stringify([p, s])).toBe(before);
    expect(simulate(p, s)).toEqual(baseline);
    expect(altered.assumptions.some(a => a.includes('Everyone walks at 1.3'))).toBe(false);
    expect(baseline.evidence!.parameters.some(p => p.key.startsWith('comfort.light.'))).toBe(false);
  });
  it('records saved behavioural inputs with stable keys, real units and override provenance', () => {
    const { p, s } = office(); s.rates.toiletVisitsPerDay = 20;
    const r = simulate(p, { ...s, parameters: [{ key: 'scenario.rates.toiletVisitsPerDay', value: 0, source: 'Closed facilities during survey' }] });
    expect(r.events.some(e => e.type === 'toilet_visit')).toBe(false);
    expect(r.evidence!.parameters.find(p => p.key === 'scenario.rates.toiletVisitsPerDay')).toMatchObject({ value: 0, overridden: true, source: 'Closed facilities during survey' });
  });
  it('records only the room fallback actually selected', () => {
    const values = new ParameterValues();
    const room = { ...plan().spaces[0], type: 'shop' as const, lightingLux: undefined };
    withParameters(values, () => roomLux(room));
    expect(values.evidence().map(p => p.key)).toEqual(['comfort.light.room.shop']);
  });
  it('resolves road defaults during the run so overrides change sound levels', () => {
    const p = plan('office-a-site'), s = scenario('office-day-site');
    p.walls = []; p.openings = []; p.spaces = []; p.noiseSources = []; p.connectors = [];
    p.site!.roads = [{ id: 'road', kind: 'main', path: [{ x: 0, y: -50 }, { x: 0, y: 50 }] }];
    const at = (values: ParameterValues) => withParameters(values, () =>
      new Sound(new Environment(p, s), [], 60).at({ x: 4, y: 2 }, p.levels[0].id, 0));
    const baseline = at(new ParameterValues());
    const values = new ParameterValues([{ key: 'comfort.sound.road.main', value: 85, source: 'Kerb measurement' }]);
    expect(at(values)).toBeGreaterThan(baseline + 9);
    expect(values.evidence().find(p => p.key === 'comfort.sound.road.main')!.source).toBe('Kerb measurement');
  });
  it('uses density parameters in the physical speed law', () => {
    const baseline = densitySpeed(1.3, 3);
    const changed = withParameters(new ParameterValues([{ key: 'walk.density.jam', value: 4.42, source: 'Published endpoint' }]), () => densitySpeed(1.3, 3));
    expect(changed).toBeLessThan(baseline);
  });
  it.each([
    [{ key: 'missing', value: 1, source: 'test' }],
    [{ key: 'walk.speed.adult', value: 0, source: 'test' }],
    [{ key: 'walk.speed.adult', value: NaN, source: 'test' }],
    [{ key: 'walk.speed.adult', value: 1, source: ' ' }],
    [{ key: 'capacity.lift.car', value: 2.5, source: 'test' }],
    [{ key: 'comfort.taskLux.mean', value: 900, source: 'test' }],
    [{ key: 'walk.speed.adult', value: 1, source: 'test' }, { key: 'walk.speed.adult', value: 2, source: 'test' }],
  ])('rejects invalid overrides before a run', (...overrides) => {
    const { p, s } = office(); expect(() => simulate(p, { ...s, parameters: overrides })).toThrow();
  });
  it('restores parameter scope on failure and when a progress callback runs another simulation', () => {
    const { p, s } = office();
    const outer = new ParameterValues([{ key: 'walk.speed.adult', value: .8, source: 'test' }]);
    withParameters(outer, () => {
      expect(() => withParameters(new ParameterValues(), () => { throw new Error('stop'); })).toThrow('stop');
      expect(parameter('walk.speed.adult')).toBe(.8);
      simulate(p, s);
      expect(parameter('walk.speed.adult')).toBe(.8);
    });
    expect(parameter('walk.speed.adult')).toBe(1.3);
  });
  it('screens only used parameters deterministically and sends progress before completion', () => {
    const { p, s } = office(); const stages: string[] = [];
    const a = simulate(p, s, { sensitivity: true, onProgress: progress => stages.push(progress.detail ?? progress.stage) });
    const b = simulate(p, s, { sensitivity: true });
    expect(a).toEqual(b);
    expect(a.evidence!.sensitivity.find(m => m.metric === 'walking.meanSeconds')!.drivers[0].key).toBe('walk.speed.adult');
    expect(a.evidence!.sensitivity.every(m => m.drivers.length <= 5 && m.drivers.every(d => a.evidence!.parameters.some(p => p.key === d.key)))).toBe(true);
    expect(stages).toContain('sensitivity'); expect(stages.at(-1)).toBe('complete');
    expect(stages.filter(stage => stage === 'complete')).toHaveLength(1);
  });
  it('checks observed door counts and names candidates without changing the scenario', () => {
    const { p, s } = office(), before = JSON.stringify(s);
    const openingId = p.openings.find(o => o.exterior && o.kind === 'door')!.id;
    const report = calibrate(p, s, [{ kind: 'door_count', openingId, fromS: 0, toS: 1800, value: 10000 }]);
    expect(report.observations[0].inconsistent).toBe(true);
    expect(report.observations[0].predicted).toBeGreaterThan(0);
    expect(report.observations[0].parameters.some(p => p.key.startsWith('arrival.'))).toBe(true);
    expect(report.note).toContain('not identified causes'); expect(JSON.stringify(s)).toBe(before);
    expect(() => calibrate(p, s, [{ kind: 'door_count', openingId: 'missing', fromS: 0, toS: 10, value: 1 }])).toThrow();
  });
});
