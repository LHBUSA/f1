// F1 Race Lab client. Premium metrics arrive only after server verification.
// Identity media is public and rights-cleared; premium analytical values are never embedded in static HTML.
(() => {
  const API='/pbe/f1/race-lab';
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=(v,d=1)=>v==null?'—':Number(v).toFixed(d);
  const signed=(v,d=1)=>v==null?'—':`${Number(v)>0?'+':''}${Number(v).toFixed(d)}`;
  const host=()=>document.querySelector('[data-race-lab]');
  const media=()=>{try{return JSON.parse(host()?.dataset.media||'{}')}catch{return {teams:{}}}};
  const teamMedia=(id)=>media().teams?.[id]||null;
  const initials=(name)=>String(name||'?').split(/\s+/).filter(Boolean).map(x=>x[0]).slice(0,2).join('').toUpperCase();

  const mark=(id,size='sm')=>{
    const t=teamMedia(id);
    if(!t) return '';
    if(t.logo) return `<span class="rl-mark rl-mark-${size}${t.logoBg==='light'?' is-light':''}"><img src="${esc(t.logo)}" alt="" loading="lazy" decoding="async"></span>`;
    return `<span class="rl-mark rl-mark-${size} rl-code">${esc(t.fallback||id.slice(0,3).toUpperCase())}</span>`;
  };
  const avatar=(d,size='sm')=>{
    if(!d) return '';
    const px=size==='lg'?96:size==='md'?64:42;
    return `<span class="rl-avatar rl-avatar-${size}"><img src="/pbe/f1/media/headshot/${esc(d.id)}" alt="${esc(d.name)}" width="${px}" height="${px}" loading="lazy" decoding="async" onerror="this.parentElement.textContent='${esc(initials(d.name))}'"></span>`;
  };
  const driver=(d,{image=true,team=true}={})=>d?`<a class="rl-driver" href="/drivers/${esc(d.id)}">${image?avatar(d):''}<span class="rl-driver-copy"><b>${esc(d.name)}</b>${team&&d.team_id?`<small>${mark(d.team_id,'xs')}${esc(teamMedia(d.team_id)?.name||'')}</small>`:''}</span></a>`:'—';
  const team=(t,{car=false}={})=>t?`<a class="rl-team" href="/teams/${esc(t.id)}">${mark(t.id,'sm')}<span><b>${esc(t.name)}</b>${car&&teamMedia(t.id)?.car?.model?`<small>${esc(teamMedia(t.id).car.model)}</small>`:''}</span></a>`:'—';

  const carPicture=(id,cls='')=>{
    const c=teamMedia(id)?.car;
    if(!c?.webp640) return '';
    const avif=[c.avif640&&`${c.avif640} 640w`,c.avif960&&`${c.avif960} 960w`,c.avif1280&&`${c.avif1280} 1280w`].filter(Boolean).join(',');
    const webp=[c.webp640&&`${c.webp640} 640w`,c.webp960&&`${c.webp960} 960w`,c.webp1280&&`${c.webp1280} 1280w`].filter(Boolean).join(',');
    return `<picture class="rl-car ${cls}">${avif?`<source type="image/avif" srcset="${avif}" sizes="(max-width:700px) 90vw, 620px">`:''}<img src="${esc(c.webp960||c.webp640)}" ${webp?`srcset="${webp}"`:''} sizes="(max-width:700px) 90vw, 620px" alt="" loading="lazy" decoding="async"></picture>`;
  };

  function locked(root,b){
    root.innerHTML=`<div class="premium-gate rl-locked"><div class="rl-lock-art">${Object.keys(media().teams||{}).slice(0,3).map((id)=>carPicture(id,'rl-lock-car')).join('')}</div><span class="eyebrow">◆ All Access · Race Lab</span><h2>${b?.signed_in?'Race Lab is not included on this account.':'Unlock the F1 intelligence layer.'}</h2><p>Full Circuit Fit, Driver DNA, form deltas, teammate qualifying gaps and championship movement live here — with the full 2026 field visually mapped.</p><div class="rl-actions"><a class="pc-cta" href="/all-access">View All Access</a><a class="more" href="/intelligence">Free Intelligence preview</a></div></div>`;
  }

  function render(root,d){
    const next=d.next_event,fit=d.circuit_fit||{},c=d.circuit_dna||{};
    const leadTeams=[...new Set((fit.drivers||[]).slice(0,3).map(x=>x.driver?.team_id).filter(Boolean))];
    const heroCars=leadTeams.length?leadTeams:Object.keys(media().teams||{}).slice(0,3);

    const fitRows=(fit.drivers||[]).slice(0,10).map(x=>`
      <li class="rl-fit-row">
        <span class="rl-rank-no">${x.rank}</span>
        ${driver(x.driver)}
        <div class="rl-score"><b>${esc(x.fit_score)}</b><small>FIT</small></div>
        <small class="rl-why">${esc(x.strongest||'Profile match')}</small>
      </li>`).join('');

    const constructors=(fit.constructors||[]).slice(0,6).map(x=>`
      <article class="rl-team-card">
        <div class="rl-team-head">${team(x.constructor,{car:true})}<b class="rl-team-score">${esc(x.fit_score)}</b></div>
        ${carPicture(x.constructor.id)}
        <span class="fine">Circuit Fit · rank ${x.rank}</span>
      </article>`).join('');

    const dna=(d.dna_leaders||[]).map(g=>`<article class="rl-dna-card"><span class="kicker">${esc(g.label)}</span><ol class="rl-dna-list">${(g.rows||[]).slice(0,5).map((x,i)=>`<li><span class="rl-mini-rank">${i+1}</span>${driver(x.driver)}<div class="rl-percentile"><b>${esc(x.percentile)}</b><small>pct</small></div><span class="rl-meter"><i class="w-${Math.max(0,Math.min(100,Math.round(Number(x.percentile)||0)))}"></i></span><small class="rl-sample">n=${esc(x.sample_size??'—')} · ${esc(x.confidence||'')}</small></li>`).join('')}</ol></article>`).join('');

    const form=(d.form?.improvers||[]).map((x,i)=>`<li><span class="rl-mini-rank">${i+1}</span>${driver(x.driver)}<div class="rl-form-delta"><b>${signed(x.delta_ppr)}</b><small>pts/race</small></div></li>`).join('');

    const mates=(d.teammates||[]).map(x=>`<article class="rl-battle">
      <div class="rl-battle-team">${team(x.team,{car:true})}${carPicture(x.team.id,'rl-battle-car')}</div>
      <div class="rl-versus">${driver(x.a)}<span>VS</span>${driver(x.b)}</div>
      <div class="rl-battle-stats"><div><span>Qualifying</span><b>${esc(x.quali?.join('–')||'—')}</b></div><div><span>Median gap</span><b>${x.median_gap_pct==null?'—':n(Math.abs(x.median_gap_pct),3)+'%'}</b></div><div><span>Race</span><b>${esc(x.race?.join('–')||'—')}</b></div></div>
    </article>`).join('');

    const champ=(d.championship||[]).map((x,i)=>`<li><span class="rl-mini-rank">${i+1}</span>${driver(x.driver)}<div class="rl-champ-stats"><b>P${esc(x.position)}</b><span>${esc(x.points)} pts</span><em class="${Number(x.movement)>0?'gain':Number(x.movement)<0?'loss':''}">${x.movement==null?'—':signed(x.movement,0)}</em></div></li>`).join('');

    root.innerHTML=`
      <section class="rl-command rl-command-premium">
        <div class="rl-command-copy"><span class="eyebrow">◆ PLATINUM RACE LAB · ${esc(d.season)}</span><h2>${esc(next?.name||'Season intelligence')}</h2><p>${next?`Round ${esc(next.round)} · ${esc(next.circuit?.name||'')}`:'No future race published.'}</p><div class="rl-state-inline"><span>ALL ACCESS ACTIVE</span><small>Private · no-store · server verified</small></div></div>
        <div class="rl-hero-cars">${heroCars.map((id)=>carPicture(id)).join('')}</div>
      </section>

      <div class="rl-grid rl-grid-premium">
        <section class="rl-card rl-wide rl-fit-panel"><div class="rl-card-head"><div><span class="eyebrow">Next-race intelligence</span><h2>Circuit Fit</h2><p class="muted">${esc(next?.name||'Next race')} · full field</p></div><span class="rl-chip">PROPRIETARY</span></div><div class="rl-fit-layout"><ol class="rl-fit-list">${fitRows}</ol><div class="rl-constructor-stack">${constructors}</div></div><p class="fine">Descriptive profile match, not a prediction or betting signal.</p></section>

        <section class="rl-card rl-wide"><div class="rl-card-head"><div><span class="eyebrow">${esc(d.dna_window||'Current window')}</span><h2>Driver DNA leaders</h2></div><span class="rl-chip">FULL POPULATION</span></div><div class="rl-dna">${dna}</div></section>

        <section class="rl-card"><div class="rl-card-head"><div><span class="eyebrow">Last five vs prior five</span><h2>Form Lab</h2></div></div><ol class="rl-form-list">${form}</ol></section>

        <section class="rl-card rl-circuit-card"><div class="rl-card-head"><div><span class="eyebrow">Next circuit</span><h2>Circuit DNA</h2></div></div><dl class="rl-metrics"><div><dt>Pole → win</dt><dd>${c.pole_win_rate==null?'—':Math.round(c.pole_win_rate*100)+'%'}</dd></div><div><dt>Grid↔finish ρ</dt><dd>${n(c.grid_finish_rho,2)}</dd></div><div><dt>Avg places moved</dt><dd>${n(c.mean_abs_position_change,1)}</dd></div><div><dt>Attrition</dt><dd>${c.attrition_rate==null?'—':Math.round(c.attrition_rate*100)+'%'}</dd></div><div><dt>Stops / car</dt><dd>${n(c.stops_per_car,2)}</dd></div><div><dt>Recent races</dt><dd>${esc(c.recent_races??'—')}</dd></div></dl></section>

        <section class="rl-card rl-wide"><div class="rl-card-head"><div><span class="eyebrow">Same car · same machinery</span><h2>Teammate battle board</h2></div><span class="rl-chip">CONTROLLED COMPARISON</span></div><div class="rl-battles">${mates}</div></section>

        <section class="rl-card rl-wide"><div class="rl-card-head"><div><span class="eyebrow">Five-round movement</span><h2>Championship movement</h2></div><span class="rl-chip">TRAJECTORY</span></div><ol class="rl-champ-list">${champ}</ol></section>
      </div>
      <p class="fine rl-method">PropBetEdge-derived intelligence is descriptive unless explicitly labelled otherwise. Prediction-market prices never enter these calculations. Car photography and team marks use the site's approved media registry.</p>`;
  }

  async function mount(){
    const root=host(); if(!root)return;
    try{
      const r=await fetch(API,{credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
      const b=await r.json().catch(()=>null);
      if(r.status===200&&b?.tier==='all_access') render(root,b);
      else if(r.status===403) locked(root,b);
      else root.innerHTML='<div class="premium-gate"><h2>Race Lab temporarily unavailable.</h2><p>Public F1 pages remain available.</p></div>';
    }catch{root.innerHTML='<div class="premium-gate"><h2>Race Lab temporarily unavailable.</h2></div>';}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();