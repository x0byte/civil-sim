import { describe, expect, it } from 'vitest';
import { simulate, streamUncertainty, percentile, ParameterValues } from '../src/index.ts';
import type { RangeMeasurement, UncertaintySnapshot } from '../src/index.ts';
import type { Scenario } from '../../contracts/scenario.ts';
import type { SimulationResult } from '../../contracts/results.ts';
import { createNavigationCache, memoGeometry } from '../src/modules/navigation.ts';
import { plan, scenario } from './fixtures.ts';

const measure = (r: SimulationResult): RangeMeasurement => ({
  'walking.meanSeconds': { value: r.metrics.summary.meanWalkingTimeS, unit: 's' },
  'queue.seconds': { value: r.metrics.queues.reduce((sum, q) => sum + q.totalWaitS, 0), unit: 's' },
});
const options = { measure, representativeMetric: 'walking.meanSeconds' };
const deterministic = ({ timings: _, ...snapshot }: UncertaintySnapshot) => snapshot;

describe('streamed uncertainty foundation (Part B1)', () => {
  it('yields the central result before any sampled simulation and defaults to twelve', () => {
    const p = plan(), s = scenario(), before = JSON.stringify([p, s]);
    let calls = 0;
    const stream = streamUncertainty(p, s, { ...options, measure: r => { calls++; return measure(r); } });
    expect(calls).toBe(0);
    const central = stream.next().value!;
    expect(central.stage).toBe('central'); expect(central.completed).toBe(0); expect(central.total).toBe(12);
    expect(central.ranges).toEqual({}); expect(central.timings.rangeMs).toEqual([]);
    expect(central.result).toEqual(simulate(p, s)); expect(calls).toBe(1);
    expect(JSON.stringify([p, s])).toBe(before); stream.return(undefined);
  });
  it('streams reproducible ranges/counts and chooses full playback nearest the median', () => {
    const p = plan(), s = { ...scenario(), uncertainty: { runs: 4 } }, before = JSON.stringify([p, s]);
    const scores: number[] = [], seeds: number[] = [];
    const a = [...streamUncertainty(p, s, { ...options, measure: r => {
      scores.push(r.metrics.summary.meanWalkingTimeS); seeds.push(r.seed); return measure(r);
    } })], b = [...streamUncertainty(p, s, options)];
    expect(a.map(deterministic)).toEqual(b.map(deterministic));
    expect(a.map(row => row.completed)).toEqual([0, 1, 2, 3, 4, 4]); expect(a[2].message).toBe('Ranges from 2 of 4 runs');
    expect(a[1].timings.rangeMs).toHaveLength(1); expect(a[4].timings.rangeMs).toHaveLength(4);
    expect(new Set(seeds).size).toBe(5);
    const final = a.at(-1)!, selected = final.representative!;
    for (const metric of Object.values(final.ranges)) {
      expect(metric.low).toBeLessThanOrEqual(metric.value); expect(metric.value).toBeLessThanOrEqual(metric.high);
    }
    const sampled = scores.slice(1), median = percentile(sampled, .5);
    expect(Math.abs(sampled[selected.index] - median)).toBe(Math.min(...sampled.map(v => Math.abs(v - median))));
    const replay = simulate(p, { ...s, seed: selected.seed, parameters: selected.parameters });
    expect(final.result.tracks).toEqual(replay.tracks); expect(final.result.events).toEqual(replay.events);
    expect(final.result.metrics).toEqual(replay.metrics); expect(final.result.heatmaps).toEqual(replay.heatmaps);
    expect(final.result.heatmaps.footfall.length).toBeGreaterThan(0); expect(JSON.stringify([p, s])).toBe(before);
  });
  it('pins measured parameters without pretending population randomness has disappeared', () => {
    const p = plan(), s = { ...scenario(), uncertainty: { runs: 4 } };
    const fixed = { ...s, parameters: new ParameterValues([], s).entries().filter(p => p.kind === 'behaviour').map(p => ({ key: p.key, value: p.value, source: 'Measured for test' })) };
    const reader = (_: SimulationResult, effective: Scenario): RangeMeasurement => ({ rate: { value: effective.rates.toiletVisitsPerDay, unit: 'count' } });
    const varying = [...streamUncertainty(p, s, { measure: reader, representativeMetric: 'rate' })].at(-1)!;
    const pinned = [...streamUncertainty(p, fixed, { measure: reader, representativeMetric: 'rate' })].at(-1)!;
    expect(varying.ranges.rate.high).toBeGreaterThan(varying.ranges.rate.low);
    expect(pinned.ranges.rate).toMatchObject({ value: s.rates.toiletVisitsPerDay, low: s.rates.toiletVisitsPerDay, high: s.rates.toiletVisitsPerDay });
    expect(pinned.representative!.parameters.find(p => p.key === 'scenario.rates.toiletVisitsPerDay')!.source).toBe('Measured for test');
  });
  it('cancels between pulls, reuses an existing central result, and isolates subsequent input edits', () => {
    const p = plan(), s = { ...scenario(), uncertainty: { runs: 2 } }, central = simulate(p, s), controller = new AbortController();
    const stream = streamUncertainty(p, s, { ...options, central, signal: controller.signal });
    expect(stream.next().value!.result).toBe(central); s.rates.toiletVisitsPerDay = 999;
    expect(stream.next().value!.completed).toBe(1);
    controller.abort(); expect(() => stream.next()).toThrow(); expect(central.evidence!.sensitivity).toEqual([]);
    expect(() => streamUncertainty(p, { ...s, seed: s.seed + 1 }, { ...options, central }).next()).toThrow(/does not match/);
  });
  it('retains occupancy and movement but skips supporting comfort grids in range measurements', () => {
    const p = plan('office-a-comfort'), s = scenario('office-day-comfort');
    const central = simulate(p, s), fast = simulate(p, s, { measurement: 'headlines' });
    expect(fast.tracks).toEqual(central.tracks.map(({ discomfort: _, ...track }) => track)); expect(fast.events).toEqual(central.events);
    expect(fast.metrics.peakOccupancy).toEqual(central.metrics.peakOccupancy); expect(fast.metrics.summary).toEqual(central.metrics.summary);
    expect(fast.metrics.queues).toEqual(central.metrics.queues); expect(fast.metrics.comfort).toBeNull(); expect(fast.heatmaps.footfall).toEqual([]);
    const seen: boolean[] = [];
    const result = [...streamUncertainty(p, { ...s, uncertainty: { runs: 1 } }, {
      ...options, comfortHeadline: true, measure: r => { seen.push(r.metrics.comfort !== null); return measure(r); },
    })].at(-1)!;
    expect(seen).toEqual([true, true]); expect(result.result.metrics.comfort).not.toBeNull();
  });
  it('retains cache contents across pulls without leaving the global cache active', () => {
    const cache = createNavigationCache(); let created = 0;
    const get = () => memoGeometry('test', () => 'same', () => ++created);
    expect(cache.run(get)).toBe(1); expect(cache.run(get)).toBe(1); expect(get()).toBe(2);
    const other = createNavigationCache(); expect(other.run(get)).toBe(3);
    cache.run(() => { expect(get()).toBe(1); other.run(() => expect(get()).toBe(3)); expect(get()).toBe(1); });
    expect(() => cache.run(() => { throw new Error('failure'); })).toThrow('failure'); expect(get()).toBe(4);
  });
  it('interpolates percentiles and rejects invalid counts, values and changing keys', () => {
    expect(percentile([0, 10, 20, 30], .1)).toBeCloseTo(3); expect(percentile([0, 10, 20, 30], .5)).toBe(15);
    expect(percentile([0, 10, 20, 30], .9)).toBe(27); expect(() => percentile([], .5)).toThrow(); expect(() => percentile([NaN], .5)).toThrow();
    const p = plan(), s = scenario();
    expect(() => streamUncertainty(p, { ...s, uncertainty: { runs: 0 } }, options).next()).toThrow(/positive integer/);
    expect(() => streamUncertainty(p, s, { ...options, measure: () => ({ invalid: { value: NaN, unit: 's' } }) }).next()).toThrow();
    let count = 0;
    const stream = streamUncertainty(p, s, { ...options, measure: r => ++count === 1 ? measure(r) : { 'walking.meanSeconds': { value: 1, unit: 'people' } } });
    stream.next(); expect(() => stream.next()).toThrow(/same keys/);
  });
});
