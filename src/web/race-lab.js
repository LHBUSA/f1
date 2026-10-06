// F1 Race Lab client. Premium values arrive only after server verification.
(() => {
  const API='/pbe/f1/race-lab';
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=(v,d=1)=>v==null?'—':Number(v).toFixed(d);
  const signed=(v,d=1)=>v==null?'—':`${Number(v)>0?'+':''}${Number(v).toFixed(d)}`;
  const driver=(d)=>d?`<a href="/drivers/${esc(d.id)}">${esc(d.name)}</a>`:'—';
  const team=(t)=>t?`<a href="/teams/${esc(t.id)}">${esc(t.name)}</a>`:'—';
  function locked(host,b){host.innerHTML=`<div class="premium-gate"><span class="eyebrow">◆ All Access · Race Lab</span><h2>${b?.signed_in?'Race Lab is not included on this account.':'Unlock the F1 intelligence layer.'}</h2><p>Full Circuit Fit, Driver DNA, form deltas, teammate qualifying gaps and championship movement live here.</p><div class="rl-actions"><a class="pc-cta" href="/all-access">View All Access</a><a class="more" href="/intelligence">Free Intelligence preview</a></div></div>`;}
  function render(host,d){
    const next=d.next_event,fit=d.circuit_fit||{},c=d.circuit_dna||{};
    const fitRows=(fit.drivers||[]).slice(0,10).map(x=>`<li><span>${x.rank}</span>${driver(x.driver)}<b>${esc(x.fit_score)}</b><small>${esc(x.strongest||'')}</small></li>`).join('');
    const dna=(d.dna_leaders||[]).map(g=>`<div><span class="kicker">${esc(g.label)}</span><ol class="rl-rank">${(g.rows||[]).slice(0,5).map(x=>`<li>${driver(x.driver)}<b>${esc(x.percentile)}</b><small>n=${esc(x.sample_size??'—')}</small></li>`).join('')}</ol></div>`).join('');
    const form=(d.form?.improvers||[]).map(x=>`<li>${driver(x.driver)}<b>${signed(x.delta_ppr)}</b><small>pts/race</small></li>`).join('');
    const mates=(d.teammates||[]).map(x=>`<tr><td>${team(x.team)}</td><td>${driver(x.a)} vs ${driver(x.b)}</td><td>${esc(x.quali?.join('–')||'—')}</td><td>${x.median_gap_pct==null?'—':n(Math.abs(x.median_gap_pct),3)+'%'}</td><td>${esc(x.race?.join('–')||'—')}</td></tr>`).join('');
    const champ=(d.championship||[]).map(x=>`<tr><td>${driver(x.driver)}</td><td>P${esc(x.position)}</td><td>${esc(x.points)}</td><td>${x.movement==null?'—':signed(x.movement,0)}</td></tr>`).join('');
    host.innerHTML=`<div class="rl-command"><div><span class="eyebrow">◆ PLATINUM RACE LAB · ${esc(d.season)}</span><h2>${esc(next?.name||'Season intelligence')}</h2><p>${next?`Round ${next.round} · ${esc(next.circuit?.name||'')}`:'No future race published.'}</p></div><div class="rl-state"><b>ALL ACCESS ACTIVE</b><span>Private · no-store</span></div></div>
<div class="rl-grid">
<section class="rl-card rl-wide"><span class="eyebrow">Next-race Circuit Fit</span><h2>${esc(next?.name||'Next race')}</h2><ol class="rl-rank">${fitRows}</ol><p class="fine">Descriptive profile match, not a prediction.</p></section>
<section class="rl-card rl-wide"><span class="eyebrow">${esc(d.dna_window||'Current window')}</span><h2>Driver DNA leaders</h2><div class="rl-dna">${dna}</div></section>
<section class="rl-card"><span class="eyebrow">Last five vs prior five</span><h2>Form Lab</h2><ol class="rl-rank">${form}</ol></section>
<section class="rl-card"><span class="eyebrow">Next circuit</span><h2>Circuit DNA</h2><dl class="rl-metrics"><div><dt>Pole → win</dt><dd>${c.pole_win_rate==null?'—':Math.round(c.pole_win_rate*100)+'%'}</dd></div><div><dt>Grid↔finish ρ</dt><dd>${n(c.grid_finish_rho,2)}</dd></div><div><dt>Attrition</dt><dd>${c.attrition_rate==null?'—':Math.round(c.attrition_rate*100)+'%'}</dd></div></dl></section>
<section class="rl-card rl-wide"><span class="eyebrow">Same car</span><h2>Teammate battle board</h2><div class="table-wrap"><table class="itable"><thead><tr><th>Team</th><th>Pair</th><th>Qualifying</th><th>Median gap</th><th>Race</th></tr></thead><tbody>${mates}</tbody></table></div></section>
<section class="rl-card rl-wide"><span class="eyebrow">Five-round movement</span><h2>Championship movement</h2><div class="table-wrap"><table class="itable"><thead><tr><th>Driver</th><th>Pos</th><th>Pts</th><th>Move</th></tr></thead><tbody>${champ}</tbody></table></div></section></div>`;
  }
  async function mount(){const host=document.querySelector('[data-race-lab]'); if(!host)return; try{const r=await fetch(API,{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});const b=await r.json().catch(()=>null);if(r.status===200&&b?.tier==='all_access')render(host,b);else if(r.status===403)locked(host,b);else host.innerHTML='<div class="premium-gate"><h2>Race Lab temporarily unavailable.</h2><p>Public F1 pages remain available.</p></div>';}catch{host.innerHTML='<div class="premium-gate"><h2>Race Lab temporarily unavailable.</h2></div>';}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();