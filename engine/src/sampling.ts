import type { ParameterOverride } from '../../contracts/scenario.ts';
import { balanceShares } from './parameters.ts';
import type { Parameter } from './parameters.ts';
import { personSeed, seededRandom } from './modules/random.ts';

// Abramowitz & Stegun 7.1.26: bounded-error erf approximation, used only to
// invert a distribution CDF, never as a behavioural model coefficient.
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1, a = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + .3275911 * a);
  const erf = 1 - (((((1.061405429*t - 1.453152027)*t) + 1.421413741)*t - .284496736)*t + .254829592)*t*Math.exp(-a*a);
  return (1 + sign * erf) / 2;
}
function positiveNormalQuantile(q: number): number {
  let low = 0, high = 2;
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2;
    if (normalCdf(mid) < q) low = mid; else high = mid;
  }
  return (low + high) / 2;
}
/** Median-anchored split normal: each half has half the mass and peaks at
 * value; sigma on that side is distance-to-bound / 2. Normalise each half
 * over [0,2 sigma]. This is the inverse-CDF equivalent of rejecting draws
 * outside the bounds. Unequal widths give unequal one-sided density heights
 * at the join: unlike a continuous two-piece normal, its median stays at value.
 * A bound equal to value gives a half-mass atom there. Settings are constant.
 */
export function parameterQuantile(parameter: Parameter, q: number): number {
  const { value, low, high } = parameter;
  if (!Number.isFinite(q) || q < 0 || q > 1 || ![low,value,high].every(Number.isFinite) || low > value || value > high) throw new Error('Invalid parameter quantile or bounds');
  if (parameter.kind === 'setting' || low === high || q === .5) return value;
  if (q === 0) return low; if (q === 1) return high;
  const z = positiveNormalQuantile(.5 + Math.abs(2*q-1) * (normalCdf(2)-.5));
  const draw = q < .5 ? value - (value-low)/2*z : value + (high-value)/2*z;
  return Math.max(low, Math.min(high, parameter.integer ? Math.round(draw) : draw));
}

/** Seeded Latin hypercube on truncated-normal quantiles, independently shuffled
 * by key. Adding/reordering definitions never reshuffles existing parameters.
 * Consumers pass the registry definitions for the scenario; explicit scalar
 * overrides stay fixed, with their original source. Does not run simulations.
 */
export function sampleParameters(parameters: readonly Parameter[], runs: number, seed: number,
  overrides: readonly ParameterOverride[] = []): ParameterOverride[][] {
  if (!Number.isInteger(runs) || runs < 1 || !Number.isFinite(seed)) throw new Error('Sampling needs positive integer runs and a finite seed');
  if (new Set(parameters.map(p=>p.key)).size !== parameters.length) throw new Error('Duplicate sampling parameter');
  const pinned = new Map(overrides.map(p=>[p.key,p]));
  if (pinned.size !== overrides.length || overrides.some(p => !parameters.some(d => d.key === p.key) || !Number.isFinite(p.value) || !p.source.trim())) throw new Error('Invalid sampling overrides');
  const rows: ParameterOverride[][] = Array.from({ length: runs }, () => []);
  for (const parameter of [...parameters].sort((a,b)=>a.key.localeCompare(b.key))) {
    const random = seededRandom(personSeed(seed, `parameter-lhs:${parameter.key}`));
    const quantiles = Array.from({ length: runs }, (_,i)=>(i+random())/runs);
    for (let i = runs-1; i > 0; i--) {
      const j = Math.floor(random()*(i+1)); [quantiles[i],quantiles[j]]=[quantiles[j],quantiles[i]];
    }
    rows.forEach((row,i)=>row.push(pinned.has(parameter.key) ? { ...pinned.get(parameter.key)! } : {
      key: parameter.key, value: parameterQuantile(parameter,quantiles[i]), source: parameter.source,
    }));
  }
  return rows.map(row=>balanceShares(parameters,row,new Set(overrides.map(p=>p.key))));
}
