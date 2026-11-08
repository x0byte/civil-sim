import { useEffect, useState } from 'react';
import type { SimRun } from '../sim/runSimulation.ts';
import { ParameterValues } from '../../../engine/src/index.ts';
import { validateScenario } from '../../../contracts/validate.ts';
import { defaultProfile, expandProfile } from '../population/officeProfile.ts';
import { useEditor } from '../state/store.ts';
import { useEvidenceJob } from '../sim/evidenceJob.tsx';
import { useRangeJob } from '../sim/rangeJob.tsx';
import { useResults } from './state.ts';
import { formatNumber, RangeProgress } from './values.tsx';
export function applyEvidenceOverride(run:SimRun,key:string,value:number,source:string):void {
  if(!source.trim()||!Number.isFinite(value))throw new Error('Enter a finite value and its source.');
  const state=useEditor.getState();
  if(state.plan!==run.plan)throw new Error('The building changed. Run the day again before changing its evidence.');
  const profile=state.profiles[run.plan.id]??run.profile??defaultProfile(run.plan);
  const parameters=[...(profile.parameters??run.scenario.parameters??[]).filter(p=>p.key!==key),{key,value,source:source.trim()}];
  const expanded=expandProfile({...profile,parameters},run.plan).scenario;
  const effective=new ParameterValues(parameters,expanded).scenario!;
  const errors=validateScenario(effective,run.plan);if(errors.length)throw new Error(errors.join(' '));
  state.setProfile(run.plan.id,{...profile,parameters},true);
}
export function EvidenceTab({run,label,comparison=false}:{run:SimRun;label?:string;comparison?:boolean}) {
  const target=useResults(s=>s.parameter),sensitivity=useEvidenceJob(),ranges=useRangeJob();
  const rowId=(key:string)=>'evidence-'+(label?encodeURIComponent(label)+'-':'')+encodeURIComponent(key);
  const [query,setQuery]=useState(''),[edit,setEdit]=useState<string>(),[value,setValue]=useState(''),[source,setSource]=useState(''),[error,setError]=useState('');
  useEffect(()=>{setQuery(target??'');if(target){document.getElementById(rowId(target))?.scrollIntoView?.({block:'center'});}},[target,label]);
  const rows=run.result.evidence?.parameters.filter(p=>!query||`${p.key} ${p.source}`.toLowerCase().includes(query.toLowerCase()))??[];
  const status=ranges.status==='working'?'Waiting for ranges':comparison?'Sensitivity is not run for comparisons. Per-option parameters and ranges are shown.':sensitivity.status==='working'?sensitivity.message:
    run.result.evidence?.sensitivity.length?'Sensitivity ready':ranges.status==='error'||sensitivity.status==='error'?'Checking stopped · retry from the progress message':ranges.status==='cancelled'||sensitivity.status==='cancelled'?'Checking stopped · rerun to finish':'Sensitivity not computed for this result';
  return <section aria-label={label?`${label} Evidence`:'Evidence'}><h2>{label?label+' · ':''}Parameters and sources</h2><RangeProgress run={run}/>
    <p role="status">{status}</p><p>Behaviour bounds describe measured envelopes or labelled assumptions. Settings stay fixed. Changing a value records its source and marks results as old; rerun to calculate its effect.</p>
    <label className="field">Find a parameter<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="results-table-wrap"><table className="table"><thead><tr><th>Parameter</th><th>Value</th><th>Low–high</th><th>Source</th><th>Override</th></tr></thead><tbody>{rows.map(p=><tr key={p.key} id={rowId(p.key)} tabIndex={-1} className={target===p.key?'evidence-target':''}>
      <th scope="row">{p.key}</th><td title={`${p.low}–${p.high} ${p.unit}`}>{formatNumber(p.value)} {p.unit}</td><td>{formatNumber(p.low)}–{formatNumber(p.high)}</td><td>{p.source.split(/(https?:\/\/[^\s]+)/g).map((text,i)=>/^https?:\/\//.test(text)?<a key={i} href={text} target="_blank" rel="noreferrer">Source</a>:text)}</td><td>{p.overridden?'Yes · ':''}<button onClick={()=>{setEdit(p.key);setValue(String(p.value));setSource('');setError('');}}>Change this value</button></td>
    </tr>)}</tbody></table></div>
    {edit&&<form className="evidence-edit" onSubmit={e=>{e.preventDefault();try{applyEvidenceOverride(run,edit,Number(value),source);setEdit(undefined);useEditor.getState().notify('Source recorded. Run the day again to update results.');}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}}>
      <h3>Change {edit}</h3><label className="field">Value<input required type="number" step="any" value={value} onChange={e=>setValue(e.target.value)}/></label><label className="field">Source or measurement<input required value={source} onChange={e=>setSource(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<button type="submit">Save sourced override</button><button type="button" onClick={()=>setEdit(undefined)}>Cancel</button>
    </form>}
    <h3>What the result depends on</h3><p>One-at-a-time screening on a reduced population; an empty driver list is not proof that a censored or incomplete result is safe.</p>
    {run.result.evidence?.sensitivity.map(row=><article key={row.metric}><h4>{row.metric}</h4>{row.drivers.length?<ol>{row.drivers.map(driver=><li key={driver.key}><button onClick={()=>useResults.getState().choose('evidence',driver.key)}>{driver.key}</button> · <span title="Endpoint swing relative to the reduced-sample baseline, not an uncertainty percentile.">{formatNumber(driver.swingPct)}% swing</span></li>)}</ol>:<p>No positive driver found in this screening sample.</p>}</article>)}
  </section>;
}
