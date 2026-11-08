import { compareResults, PARAMETERS } from '../../../engine/src/index.ts';
import type { Ranged } from '../../../contracts/results.ts';
import type { Comparison, SimRun } from '../sim/runSimulation.ts';

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
function Range({ value, pending, boundsLabel = '10th–90th percentile' }: { value: Ranged; pending?: boolean; boundsLabel?: string }) {
  return <span title={pending ? 'Central estimate; uncertainty runs pending' : `${boundsLabel}: ${number(value.low)}–${number(value.high)} ${value.unit}`}>
    {number(value.value)}{!pending && <small> ({number(value.low)}–{number(value.high)})</small>}
  </span>;
}
export function DecisionSummary({ run }: { run: SimRun; 'data-title'?: string }) {
  const d = run.result.decision;
  if (!d) return null;
  const total = run.scenario.uncertainty?.runs ?? PARAMETERS.find(p => p.key === 'setting.uncertainty.runs')!.value;
  const name = (id: string) => run.plan.spaces.find(s => s.id === id)?.name ?? run.plan.connectors.find(c => c.id === id)?.name ?? `Door ${run.plan.openings.filter(o => o.kind === 'door').findIndex(o => o.id === id) + 1}`;
  const worst = [...d.capacity].sort((a, b) => b.utilisation.value - a.utilisation.value)[0];
  return <section className="panel" aria-label="Decision metrics">
    <header><h2>Decision metrics</h2></header>
    <div className="panel-body">
      <p role="status">{d.runs === 0 ? 'Central estimate · ranges pending' : `From ${d.runs} of ${total} runs${d.runs < total ? ' · partial ranges' : ''}`}</p>
      <dl>
        <dt>Staff time lost · hours per day</dt><dd><Range value={d.timeLost.hoursPerDay} pending={!d.runs} /></dd>
        {d.timeLost.costPerYear && <><dt>Staff time cost · {run.scenario.costs?.currency} per year</dt><dd><Range value={d.timeLost.costPerYear} pending={!d.runs} /></dd></>}
        {worst && <><dt>Highest capacity utilisation · {name(worst.refId)}</dt><dd><Range value={worst.utilisation} pending={!d.runs} /> (ratio)</dd></>}
        {d.evacuation && <><dt>Evacuation · seconds</dt><dd><Range value={d.evacuation.totalS} pending={!d.runs} /> · {d.evacuation.limitS === undefined ? 'No limit set' : `${d.evacuation.pass ? 'Within' : 'Exceeds or cannot verify'} your ${d.evacuation.limitS} s limit`}</dd></>}
        {d.teamDistance && <><dt>Team travel · seconds per person per day{d.teamDistance.pairs.some(p => p.from === 'meetings') && <small> · derived from scheduled meetings</small>}</dt><dd><Range value={d.teamDistance.secondsPerPersonPerDay} pending={!d.runs} /></dd></>}
      </dl>
      <details><summary>Delay causes and rules</summary>
        <ul>{d.timeLost.byCause.map(row => <li key={row.cause}>{{queue:'Queuing',lift_wait:'Lift waiting',detour:'Extra route distance',walk:'Slowing and hesitation'}[row.cause]}: <Range value={row.hoursPerDay} pending={!d.runs} /> hours/day</li>)}</ul>
        <ul>{d.checks.map(check => <li key={check.code} title={check.rule}>{check.ok ? '✓' : 'Check'} {check.message}<small> {check.rule}</small></li>)}</ul>
      </details>
    </div>
  </section>;
}
export function DecisionComparison({ comparison }: { comparison: Comparison }) {
  const { a, b, labels } = comparison;
  if (!a.result.decision || !b.result.decision) return null;
  const labelsByMetric: Record<string,string> = { 'timeLost.hoursPerDay':'Staff time lost', 'timeLost.costPerYear':'Staff time cost', 'evacuation.totalS':'Evacuation time', 'teamDistance.secondsPerPersonPerDay':'Team travel per person' };
  const units: Record<string,string> = { s:'seconds', hours_per_day:'hours/day', currency_per_year:`${b.scenario.costs?.currency ?? ''}/year` };
  const rows = compareResults(a.result, b.result).filter(row => ['timeLost.hoursPerDay', 'timeLost.costPerYear', 'evacuation.totalS', 'teamDistance.secondsPerPersonPerDay'].includes(row.metric));
  const totalA = a.scenario.uncertainty?.runs ?? PARAMETERS.find(p => p.key === 'setting.uncertainty.runs')!.value;
  const totalB = b.scenario.uncertainty?.runs ?? totalA;
  const complete = a.result.decision.runs >= totalA && b.result.decision.runs >= totalB;
  return <section className="panel" aria-label="Decision comparison"><header><h2>Decision comparison</h2></header><div className="panel-body">
    <p>{labels[1]} minus {labels[0]}. {complete ? 'Difference bounds come from each option’s 10th–90th percentile interval.' : `Provisional · from ${a.result.decision.runs} of ${totalA} and ${b.result.decision.runs} of ${totalB} runs.`}</p>
    <table className="table"><thead><tr><th>Measure</th><th>Difference (B − A)</th><th>Assessment</th></tr></thead><tbody>{rows.map(row => <tr key={row.metric}>
      <td>{labelsByMetric[row.metric] ?? row.metric}</td><td><Range value={row.difference} boundsLabel="Bounds from subtracting the two option intervals" pending={!a.result.decision!.runs || !b.result.decision!.runs} /> {units[row.difference.unit] ?? row.difference.unit}</td><td>{complete ? row.verdict : 'Incomplete ranges'}</td>
    </tr>)}</tbody></table>
  </div></section>;
}
