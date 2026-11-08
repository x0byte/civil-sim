import { useEffect, useRef, useState } from 'react';
import type { SimRun, Comparison } from '../sim/runSimulation.ts';
import { TAB_LABEL, type ResultsTab } from './state.ts';
export function ReportDialog({runs,comparison,available,onClose}:{runs:SimRun[];comparison?:Comparison;available:ResultsTab[];onClose:()=>void}) {
  const [selected,setSelected]=useState<ResultsTab[]>(['summary','evidence']),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('');
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;ref.current?.focus();return()=>previous?.focus();},[]);
  const download=async()=>{
    setBusy(true);setError('');setProgress('Preparing report…');
    try{await new Promise<void>(resolve=>setTimeout(resolve,0));const {createResultsPdf}=await import('./report.tsx');const bytes=await createResultsPdf(runs,selected,comparison,setProgress);
      const blob=new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`${runs[0].plan.name.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-results.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setProgress('Report downloaded.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Could not create the PDF report.');}finally{setBusy(false);}
  };
  return <div className="backdrop"><div className="dialog report-options" role="dialog" aria-modal="true" aria-label="Download results report" tabIndex={-1} ref={ref} onKeyDown={e=>{if(e.key==='Escape'&&!busy)onClose();if(e.key==='Tab'){const nodes=ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');if(!nodes?.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===ref.current)){e.preventDefault();first.focus();}}}}>
    <h2>Download report</h2><p>Summary and the Evidence appendix are always included. Choose additional sections. The report records current partial counts and censored evacuation wording.</p>
    <fieldset disabled={busy}><legend>Report sections</legend>{available.map(tab=><label key={tab}><input type="checkbox" checked={selected.includes(tab)} disabled={tab==='summary'||tab==='evidence'} onChange={e=>setSelected(s=>e.target.checked?[...s,tab]:s.filter(item=>item!==tab))}/>{TAB_LABEL[tab]}{tab==='evidence'?' · required appendix':''}</label>)}</fieldset>
    {progress&&<p role="status">{progress}</p>}{error&&<p role="alert">{error}</p>}<footer><button className="primary" disabled={busy} onClick={()=>void download()}>{busy?'Preparing PDF…':'Download PDF'}</button><button disabled={busy} onClick={onClose}>Close</button></footer>
  </div></div>;
}
