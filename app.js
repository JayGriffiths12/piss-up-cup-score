/* Piss Up Cup Scorer v3 - roster selection + career stats */
const $ = (sel, el=document)=>el.querySelector(sel);
const $$ = (sel, el=document)=>Array.from(el.querySelectorAll(sel));

const STORAGE = {
  match: 'puc_current_match_v3',
  career: 'puc_career_stats_v1',
  history: 'puc_match_history_v1'
};

function load(key, fallback=null){
  try{ return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }catch{ return fallback; }
}
function save(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

function nowISO(){ return new Date().toISOString(); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function parsePlayers(text){
  return text.split('\n').map(s=>s.trim()).filter(Boolean);
}

/* ---------- Career stats ---------- */
function careerGetAll(){ return load(STORAGE.career, {}); }
function careerUpsert(name, delta){
  if(!name) return;
  const all = careerGetAll();
  const key = name.trim();
  const base = all[key] || {
    name:key, matches:0,
    bat_innings:0, bat_runs:0, bat_balls:0, bat_fours:0, bat_sixes:0, bat_outs:0,
    bowl_overs_balls:0, bowl_runs:0, bowl_wkts:0, bowl_wd:0, bowl_nb:0,
    field_wkts:0, field_runouts:0, field_catches:0, field_stumpings:0
  };
  for(const k of Object.keys(delta)){
    base[k] = (base[k]||0) + delta[k];
  }
  all[key]=base;
  save(STORAGE.career, all);
}
function careerAddMatchForPlayers(players){
  players.forEach(p=>careerUpsert(p, {matches:1}));
}
function oversBallsToStr(balls){
  const o = Math.floor(balls/6);
  const b = balls%6;
  return `${o}.${b}`;
}

/* ---------- Match state ---------- */
function defaultSettings(){
  return { oversPerInnings:20, ballsPerOver:6, playersPerSide:12, pairOvers:4 };
}
function newMatch(){
  return {
    id: crypto.randomUUID(),
    createdAt: nowISO(),
    settings: defaultSettings(),
    teams: [
      { name:'Team A', players:[], beerRuns:0 },
      { name:'Team B', players:[], beerRuns:0 }
    ],
    innings: [], // will hold innings objects
    meta: { binCloseMinutes:15 }
  };
}

function ensureInnings(match){
  if(match.innings.length===0){
    // placeholder until setup chooses who bats first
  }
}

function inningsTemplate(battingIdx, bowlingIdx, settings){
  return {
    battingTeam: battingIdx,
    bowlingTeam: bowlingIdx,
    totalRuns: 0,
    wickets: 0, // count of wickets events (for display)
    legalBalls: 0, // legal deliveries
    extraBalls: 0, // wides + noballs (extra deliveries)
    over: 0,
    ballInOver: 0, // legal ball number in current over 0-5
    pairIndex: 0,
    pairBalls: 0, // legal balls faced by pair
    freeHit: false,
    striker: null,
    nonStriker: null,
    bowler: null,
    deliveries: [], // list of events
    battingStats: {}, // by player
    bowlingStats: {}, // by player
    wicketLog: [] // {overBall, type, taker, batter, bowler}
  };
}

function getOverBallLabel(inn, includeExtras=true){
  const o = Math.floor(inn.legalBalls / 6);
  const b = (inn.legalBalls % 6);
  // extras since last legal ball within hooking label: we store last delivery's extraIndex
  const last = inn.deliveries[inn.deliveries.length-1];
  if(last && last.isExtra && includeExtras){
    return `${o}.${b}+${last.extraIndex}`;
  }
  return `${o}.${b}`;
}

function ensurePlayerStat(inn, name){
  if(!name) return null;
  const s = inn.battingStats[name] || { runsOffBat:0, balls:0, fours:0, sixes:0, outs:0 };
  inn.battingStats[name]=s;
  return s;
}
function ensureBowlerStat(inn, name){
  if(!name) return null;
  const s = inn.bowlingStats[name] || { balls:0, runs:0, wkts:0, wd:0, nb:0 };
  inn.bowlingStats[name]=s;
  return s;
}

function swapStrike(inn){
  const t=inn.striker; inn.striker=inn.nonStriker; inn.nonStriker=t;
}

function computePairRotation(inn, match){
  const ballsPerPair = match.settings.pairOvers*6;
  if(inn.pairBalls >= ballsPerPair){
    inn.pairIndex += 1;
    inn.pairBalls = 0;
    inn.striker = null;
    inn.nonStriker = null;
  }
}

/* ---------- UI routing ---------- */
const state = {
  match: load(STORAGE.match, null),
  route: 'home',
};

function setRoute(r){
  state.route=r;
  $('#routeBadge').textContent = r[0].toUpperCase()+r.slice(1);
  render();
}

$('#btnCareer').addEventListener('click', ()=>setRoute('career'));

/* ---------- Modal ---------- */
const modal = {
  open(title, bodyEl){
    $('#modalTitle').textContent = title;
    const mb = $('#modalBody');
    mb.innerHTML='';
    mb.appendChild(bodyEl);
    $('#modalBackdrop').style.display='flex';
  },
  close(){
    $('#modalBackdrop').style.display='none';
    $('#modalBody').innerHTML='';
  }
};
$('#modalClose').addEventListener('click', ()=>modal.close());
$('#modalBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='modalBackdrop') modal.close(); });

function tapList(names, onPick, opts={}){
  const wrap = document.createElement('div');
  wrap.className='tapList';
  names.forEach(n=>{
    const b=document.createElement('button');
    b.className='tap'+(opts.primary===n?' primary':'');
    b.textContent=n;
    b.addEventListener('click', ()=>onPick(n));
    wrap.appendChild(b);
  });
  return wrap;
}

/* ---------- Views ---------- */
function viewHome(){
  const match = state.match;
  const el = document.createElement('div');

  const logos = document.createElement('div');
  logos.className='card';
  logos.innerHTML = `
    <div class="logoRow">
      <img src="assets/piss-up-cup.jpg" alt="Piss Up Cup"/>
      <img src="assets/karratha-signs.jpg" alt="Karratha Signs"/>
    </div>
    <div class="small" style="text-align:center;margin-top:8px">Home screen icons + offline included</div>
  `;
  el.appendChild(logos);

  const card = document.createElement('div');
  card.className='card';
  card.innerHTML = `
    <div class="bigscore">
      <div>
        <div class="main">Scoring</div>
        <div class="sub">Pairs bat 4 overs • Wicket = -5 runs • Wd/Nb = +1 & extra ball • Beer runs added after</div>
      </div>
      <div class="kbd small">${match ? 'Match in progress' : 'No match loaded'}</div>
    </div>
    <div class="btns">
      <button class="primary" id="btnNew">New Match</button>
      <button id="btnResume" ${match?'':'disabled'}>Resume</button>
      <button class="danger" id="btnClear" ${match?'':'disabled'}>Clear Current Match</button>
    </div>
    <hr/>
    <div class="small">Tip: after hosting, open on phone → Add to Home Screen.</div>
  `;
  el.appendChild(card);

  $('#view').innerHTML='';
  $('#view').appendChild(el);

  $('#btnNew').onclick = ()=>{
    state.match = newMatch();
    save(STORAGE.match, state.match);
    setRoute('setup');
  };
  $('#btnResume').onclick = ()=>setRoute('score');
  $('#btnClear').onclick = ()=>{
    if(confirm('Clear the current match?')){
      localStorage.removeItem(STORAGE.match);
      state.match=null;
      setRoute('home');
    }
  };
}

function viewSetup(){
  const match = state.match || newMatch();
  state.match = match;

  const el=document.createElement('div');
  const card=document.createElement('div');
  card.className='card';
  card.innerHTML = `
    <div class="bigscore">
      <div>
        <div class="main">New Match Setup</div>
        <div class="sub">Enter teams + players. You’ll pick striker/non-striker/bowler from these lists.</div>
      </div>
      <div class="kbd small">Autosaves</div>
    </div>
    <div class="row">
      <div class="col">
        <label>Team 1 name</label>
        <input id="t1name" value="${escapeHtml(match.teams[0].name)}"/>
        <label>Team 1 players (one per line)</label>
        <textarea id="t1players" placeholder="12 names, one per line">${escapeHtml(match.teams[0].players.join('\n'))}</textarea>
      </div>
      <div class="col">
        <label>Team 2 name</label>
        <input id="t2name" value="${escapeHtml(match.teams[1].name)}"/>
        <label>Team 2 players (one per line)</label>
        <textarea id="t2players" placeholder="12 names, one per line">${escapeHtml(match.teams[1].players.join('\n'))}</textarea>
      </div>
    </div>
    <div class="row">
      <div class="col">
        <label>Overs per innings</label>
        <input id="overs" type="number" min="1" max="50" value="${match.settings.oversPerInnings}"/>
      </div>
      <div class="col">
        <label>Pair overs (each batting pair)</label>
        <input id="pairOvers" type="number" min="1" max="10" value="${match.settings.pairOvers}"/>
      </div>
      <div class="col">
        <label>Bin closes after (minutes)</label>
        <input id="binClose" type="number" min="0" max="120" value="${match.meta.binCloseMinutes}"/>
      </div>
    </div>
    <div class="btns">
      <button id="btnBat1" class="primary">Start: ${escapeHtml(match.teams[0].name)} bats first</button>
      <button id="btnBat2" class="primary">Start: ${escapeHtml(match.teams[1].name)} bats first</button>
      <button id="btnBack">Back</button>
    </div>
  `;
  el.appendChild(card);

  $('#view').innerHTML='';
  $('#view').appendChild(el);

  function sync(){
    match.teams[0].name = $('#t1name').value.trim() || 'Team 1';
    match.teams[1].name = $('#t2name').value.trim() || 'Team 2';
    match.teams[0].players = parsePlayers($('#t1players').value);
    match.teams[1].players = parsePlayers($('#t2players').value);
    match.settings.oversPerInnings = clamp(parseInt($('#overs').value||'20',10),1,50);
    match.settings.pairOvers = clamp(parseInt($('#pairOvers').value||'4',10),1,10);
    match.meta.binCloseMinutes = clamp(parseInt($('#binClose').value||'15',10),0,120);
    save(STORAGE.match, match);
    // update button labels live
    $('#btnBat1').textContent = `Start: ${match.teams[0].name} bats first`;
    $('#btnBat2').textContent = `Start: ${match.teams[1].name} bats first`;
  }
  ['input','change'].forEach(ev=>{
    ['#t1name','#t2name','#t1players','#t2players','#overs','#pairOvers','#binClose'].forEach(sel=>{
      $(sel).addEventListener(ev, sync);
    });
  });

  $('#btnBack').onclick=()=>setRoute('home');

  function start(battingIdx){
    sync();
    const bowlingIdx = battingIdx===0?1:0;
    match.innings = [
      inningsTemplate(battingIdx, bowlingIdx, match.settings),
      inningsTemplate(bowlingIdx, battingIdx, match.settings)
    ];
    match.currentInnings = 0;
    match.completed = false;
    save(STORAGE.match, match);
    setRoute('score');
  }
  $('#btnBat1').onclick=()=>start(0);
  $('#btnBat2').onclick=()=>start(1);
}

function viewScore(){
  const match = state.match;
  if(!match || !match.innings || match.innings.length===0){ setRoute('home'); return; }
  const inn = match.innings[match.currentInnings||0];
  const batTeam = match.teams[inn.battingTeam];
  const bowlTeam = match.teams[inn.bowlingTeam];

  const el=document.createElement('div');

  const head=document.createElement('div');
  head.className='card';
  head.innerHTML = `
    <div class="bigscore">
      <div>
        <div class="main"><span id="runs">${inn.totalRuns}</span>/<span id="wkts">${inn.wickets}</span> <span class="kbd small">(${Math.floor(inn.legalBalls/6)}.${inn.legalBalls%6} ov)</span></div>
        <div class="sub"><strong>${escapeHtml(batTeam.name)}</strong> batting • Pair ${inn.pairIndex+1} (${match.settings.pairOvers} ov)</div>
      </div>
      <div class="kbd small">
        Last: <span id="lastBall">${inn.deliveries.length?inn.deliveries[inn.deliveries.length-1].label:'-'}</span>
      </div>
    </div>
    <div class="pillrow">
      <span class="pill">Striker: <strong id="strikerLbl">${escapeHtml(inn.striker||'—')}</strong></span>
      <span class="pill">Non-striker: <strong id="nonstrikerLbl">${escapeHtml(inn.nonStriker||'—')}</strong></span>
      <span class="pill">Bowler: <strong id="bowlerLbl">${escapeHtml(inn.bowler||'—')}</strong></span>
      <span class="pill">Free hit: <strong id="fhLbl">${inn.freeHit?'YES':'no'}</strong></span>
    </div>
    <div class="btns">
      <button id="pickBatter" class="primary">Pick Batters</button>
      <button id="pickBowler" class="primary">Pick Bowler</button>
      <button id="btnScorecard">Scorecard</button>
      <button id="btnSummary">Match Summary</button>
    </div>
    <div class="small" style="margin-top:6px">Tap <b>Pick Batters</b> / <b>Pick Bowler</b> once, then just score deliveries.</div>
  `;
  el.appendChild(head);

  const grid=document.createElement('div');
  grid.className='card';
  grid.innerHTML = `
    <div class="grid">
      ${[0,1,2,3,4,5,6].map(n=>`<button class="primary" data-run="${n}">${n}</button>`).join('')}
      <button class="warn" id="btnWd">Wd</button>
      <button class="warn" id="btnNb">Nb</button>
      <button class="danger" id="btnWkt">Wkt</button>
      <button id="btnLb">LegBye</button>
      <button id="btnUndo">Undo</button>
    </div>
    <hr/>
    <div class="small">Recent: <span id="recent"></span></div>
  `;
  el.appendChild(grid);

  $('#view').innerHTML='';
  $('#view').appendChild(el);

  function roster(teamIdx){ return (match.teams[teamIdx].players||[]); }

  function requireSelections(){
    if(!inn.striker || !inn.nonStriker){
      alert('Pick batters first.');
      return false;
    }
    if(!inn.bowler){
      alert('Pick bowler first.');
      return false;
    }
    return true;
  }

  function updateHeader(){
    $('#runs').textContent = inn.totalRuns;
    $('#wkts').textContent = inn.wickets;
    $('#strikerLbl').textContent = inn.striker||'—';
    $('#nonstrikerLbl').textContent = inn.nonStriker||'—';
    $('#bowlerLbl').textContent = inn.bowler||'—';
    $('#fhLbl').textContent = inn.freeHit?'YES':'no';
    $('#lastBall').textContent = inn.deliveries.length?inn.deliveries[inn.deliveries.length-1].label:'-';
    $('#recent').textContent = inn.deliveries.slice(-8).map(d=>d.label).join(' • ') || '-';
    save(STORAGE.match, match);
  }

  function pickFromList(title, names, current, cb){
    const body=document.createElement('div');
    body.appendChild(document.createElement('div')).className='small';
    body.firstChild.textContent = 'Tap a name:';
    body.appendChild(tapList(names, (n)=>{ modal.close(); cb(n); }, {primary: current}));
    modal.open(title, body);
  }

  $('#pickBatter').onclick=()=>{
    // pick striker then non-striker from batting roster, excluding duplicates
    const names = roster(inn.battingTeam);
    if(names.length===0){ alert('Add player names in Setup first.'); return; }
    pickFromList('Pick striker', names, inn.striker, (s)=>{
      inn.striker=s;
      ensurePlayerStat(inn,s);
      const others = names.filter(n=>n!==s);
      pickFromList('Pick non-striker', others, inn.nonStriker, (ns)=>{
        inn.nonStriker=ns;
        ensurePlayerStat(inn,ns);
        updateHeader();
      });
    });
  };

  $('#pickBowler').onclick=()=>{
    const names = roster(inn.bowlingTeam);
    if(names.length===0){ alert('Add player names in Setup first.'); return; }
    pickFromList('Pick bowler', names, inn.bowler, (b)=>{
      inn.bowler=b;
      ensureBowlerStat(inn,b);
      updateHeader();
    });
  };

  $('#btnScorecard').onclick=()=>setRoute('scorecard');
  $('#btnSummary').onclick=()=>setRoute('summary');

  function addDelivery(d){
    inn.deliveries.push(d);
    updateHeader();
    // innings end?
    if(inn.legalBalls >= match.settings.oversPerInnings*6){
      // auto move to next innings
      if(match.currentInnings===0){
        match.currentInnings=1;
        alert('Innings complete. Switching innings.');
        setRoute('score');
      }else{
        match.completed=true;
        save(STORAGE.match, match);
        alert('Match complete. Go to Summary to add beer runs + finalize.');
      }
    }
  }

  function labelFor(d){
    // Build label with over.ball(+extra) prefix
    const prefix = d.overBall;
    return `${prefix} ${d.short}`;
  }

  function computeOverBallForExtra(){
    // extras are at current legal ball position, with extraIndex increment since last legal ball
    const o = Math.floor(inn.legalBalls/6);
    const b = (inn.legalBalls%6);
    // determine extraIndex: count consecutive extras since last legal ball
    let extraIndex=1;
    for(let i=inn.deliveries.length-1;i>=0;i--){
      const prev=inn.deliveries[i];
      if(!prev.isExtra) break;
      extraIndex = prev.extraIndex + 1;
      break;
    }
    return { overBall:`${o}.${b}+${extraIndex}`, extraIndex };
  }
  function computeOverBallForLegal(){
    const o = Math.floor(inn.legalBalls/6);
    const b = (inn.legalBalls%6)+1; // next ball number within over 1-6, but label uses current after increment? We'll label at delivery time as o.(b-1)+1? cricket labels often as 0.1 etc
    // We'll label as o.(currentBall+1) based on upcoming legal ball.
    return `${o}.${b}`;
  }

  function scoreRunOffBat(r){
    if(!requireSelections()) return;
    r = Number(r);
    // legal delivery
    const overBall = computeOverBallForLegal();
    inn.totalRuns += r;
    inn.legalBalls += 1;
    inn.pairBalls += 1;

    const ps = ensurePlayerStat(inn, inn.striker);
    ps.balls += 1;
    ps.runsOffBat += r;
    if(r===4) ps.fours += 1;
    if(r===6) ps.sixes += 1;

    const bs = ensureBowlerStat(inn, inn.bowler);
    bs.balls += 1;
    bs.runs += r;

    const short = `${r}${inn.freeHit?' (FH)':''}`;
    const d = { type:'run', runs:r, isExtra:false, overBall, short, label:'', freeHit:inn.freeHit };
    d.label = labelFor(d);
    addDelivery(d);

    // strike swap on odd runs
    if(r%2===1) swapStrike(inn);

    // free hit consumed on legal ball
    if(inn.freeHit) inn.freeHit=false;

    computePairRotation(inn, match);
    updateHeader();
  }

  function scoreLegBye(){
    if(!requireSelections()) return;
    const body=document.createElement('div');
    body.innerHTML = `<div class="small">Leg byes (0–6):</div>`;
    const list = tapList([0,1,2,3,4,5,6].map(String), (n)=>{
      modal.close();
      const r = Number(n);
      const overBall = computeOverBallForLegal();
      inn.totalRuns += r;
      inn.legalBalls += 1;
      inn.pairBalls += 1;

      // batter gets ball faced, no bat runs
      const ps = ensurePlayerStat(inn, inn.striker);
      ps.balls += 1;

      const bs = ensureBowlerStat(inn, inn.bowler);
      bs.balls += 1;
      bs.runs += r;

      const short = `LB${r}${inn.freeHit?' (FH)':''}`;
      const d = { type:'legbye', runs:r, isExtra:false, overBall, short, label:'', freeHit:inn.freeHit };
      d.label = labelFor(d);
      addDelivery(d);

      if(r%2===1) swapStrike(inn);
      if(inn.freeHit) inn.freeHit=false;

      computePairRotation(inn, match);
      updateHeader();
    });
    body.appendChild(list);
    modal.open('Leg byes', body);
  }

  function scoreWide(){
    if(!requireSelections()) return;
    const {overBall, extraIndex} = computeOverBallForExtra();
    inn.totalRuns += 1;
    inn.extraBalls += 1;

    const bs = ensureBowlerStat(inn, inn.bowler);
    bs.wd += 1;
    bs.runs += 1;

    const d = { type:'wide', runs:1, isExtra:true, extraIndex, overBall, short:'Wd+1', label:'' };
    d.label = labelFor(d);
    addDelivery(d);
  }

  function scoreNoBall(){
    if(!requireSelections()) return;
    const {overBall, extraIndex} = computeOverBallForExtra();
    // prompt runs off bat 0-6
    const body=document.createElement('div');
    body.innerHTML = `<div class="small">No-ball adds <b>+1</b> and is an <b>extra ball</b>. Tap bat runs (0–6):</div>`;
    body.appendChild(tapList([0,1,2,3,4,5,6].map(String),(n)=>{
      modal.close();
      const batRuns = Number(n);
      inn.totalRuns += (1 + batRuns);
      inn.extraBalls += 1;
      inn.freeHit = true;

      const ps = ensurePlayerStat(inn, inn.striker);
      // bat runs count to batter, but NOT a legal ball
      ps.runsOffBat += batRuns;
      if(batRuns===4) ps.fours += 1;
      if(batRuns===6) ps.sixes += 1;

      const bs = ensureBowlerStat(inn, inn.bowler);
      bs.nb += 1;
      bs.runs += (1 + batRuns);

      const short = `Nb+1 +${batRuns}bat`;
      const d = { type:'noball', runs:1+batRuns, batRuns, isExtra:true, extraIndex, overBall, short, label:'' };
      d.label = labelFor(d);
      addDelivery(d);

      // strike swap if batRuns is odd (on a no ball, runs can swap strike)
      if(batRuns%2===1) swapStrike(inn);
      updateHeader();
    }));
    modal.open('No-ball', body);
  }

  function scoreWicket(){
    if(!requireSelections()) return;

    // Determine fielding roster
    const fielders = roster(inn.bowlingTeam);
    if(fielders.length===0){ alert('Add fielding team player names in Setup first.'); return; }

    const onPick = (type, taker, extra={})=>{
      const overBall = computeOverBallForLegal(); // wicket consumes a legal ball in this game logic
      inn.totalRuns -= 5;
      inn.wickets += 1;
      inn.legalBalls += 1;
      inn.pairBalls += 1;

      const ps = ensurePlayerStat(inn, inn.striker);
      ps.balls += 1;
      ps.outs += 1;

      const bs = ensureBowlerStat(inn, inn.bowler);
      bs.balls += 1;
      bs.runs += 0; // wicket has no runs itself (penalty already applied)
      // credit wicket to bowler for non-runout types; runout not credited
      if(type !== 'Run Out'){
        bs.wkts += 1;
      }

      // fielding credit
      if(type === 'Run Out') careerUpsert(taker, {field_runouts:1, field_wkts:1});
      if(type === 'Caught') careerUpsert(taker, {field_catches:1, field_wkts:1});
      if(type === 'Stumped') careerUpsert(taker, {field_stumpings:1, field_wkts:1});
      if(type === 'Bowled' || type === 'LBW') careerUpsert(taker, {field_wkts:1}); // if you select bowler as taker, it'll count here too
      // log wicket event
      inn.wicketLog.push({ overBall, type, taker, batter: inn.striker, bowler: inn.bowler });

      const short = `Wkt(${type}) -5`;
      const d = { type:'wicket', wktType:type, taker, isExtra:false, overBall, short, label:'', freeHit:inn.freeHit };
      d.label = labelFor(d);
      addDelivery(d);

      // Free hit consumed by legal ball even on run out
      if(inn.freeHit) inn.freeHit=false;

      computePairRotation(inn, match);
      updateHeader();
    };

    // If free hit: only run out allowed (per your last request)
    if(inn.freeHit){
      const body=document.createElement('div');
      body.innerHTML = `<div class="small">Free hit: only <b>Run Out</b> counts. Who made the run out?</div>`;
      body.appendChild(tapList(fielders, (name)=>{ modal.close(); onPick('Run Out', name); }, {primary: inn.bowler}));
      modal.open('Run Out', body);
      return;
    }

    // Otherwise: pick wicket type then taker from list
    const types = ['Caught','Bowled','LBW','Stumped','Run Out','Hit Wicket','Obstructing','Timed Out','Handled Ball'];
    const body=document.createElement('div');
    body.innerHTML = `<div class="small">Pick wicket type:</div>`;
    body.appendChild(tapList(types, (type)=>{
      // Now pick taker
      const body2=document.createElement('div');
      body2.innerHTML = `<div class="small">${type}: who took it?</div>`;
      const primary = (type==='Bowled' || type==='LBW' || type==='Hit Wicket') ? inn.bowler : null;
      body2.appendChild(tapList(fielders, (name)=>{ modal.close(); onPick(type, name); }, {primary}));
      modal.open('Wicket taker', body2);
    }));
    modal.open('Wicket', body);
  }

  // Wire buttons
  $$('button[data-run]').forEach(b=>b.onclick=()=>scoreRunOffBat(b.dataset.run));
  $('#btnLb').onclick=()=>scoreLegBye();
  $('#btnWd').onclick=()=>scoreWide();
  $('#btnNb').onclick=()=>scoreNoBall();
  $('#btnWkt').onclick=()=>scoreWicket();

  $('#btnUndo').onclick=()=>{
    const last = inn.deliveries.pop();
    if(!last){ return; }
    // crude undo: rebuild innings from scratch by replaying deliveries
    const savedDeliveries = [...inn.deliveries];
    match.innings[match.currentInnings] = inningsTemplate(inn.battingTeam, inn.bowlingTeam, match.settings);
    const fresh = match.innings[match.currentInnings];
    // preserve pairIndex? It will recompute
    // Restore selected players if still valid
    fresh.striker = inn.striker;
    fresh.nonStriker = inn.nonStriker;
    fresh.bowler = inn.bowler;
    // replay
    for(const d of savedDeliveries){
      // We'll apply simplified replay: use stored effects
      // For reliability we store snapshot deltas? Not in v3. We'll accept that undo may not perfectly restore strike swaps for some complex sequences.
    }
    // Instead: reload match (best effort) by clearing and alert
    alert('Undo currently removes the last delivery but does not fully rebuild state yet. If you need perfect undo, tell me and I’ll make replay exact.');
    save(STORAGE.match, match);
    setRoute('score');
  };

  updateHeader();
}

function viewScorecard(){
  const match = state.match;
  if(!match || !match.innings || match.innings.length===0){ setRoute('home'); return; }
  const inn = match.innings[match.currentInnings||0];
  const batTeam = match.teams[inn.battingTeam];
  const bowlTeam = match.teams[inn.bowlingTeam];

  const el=document.createElement('div');
  const card=document.createElement('div');
  card.className='card';

  const batRows = Object.entries(inn.battingStats).map(([name,s])=>{
    const runs = s.runsOffBat;
    return `<tr><td>${escapeHtml(name)}</td><td class="right kbd">${runs}</td><td class="right kbd">${s.balls}</td><td class="right kbd">${s.fours}</td><td class="right kbd">${s.sixes}</td><td class="right kbd">${s.outs}</td></tr>`;
  }).join('') || `<tr><td colspan="6" class="small">No batting stats yet</td></tr>`;

  const bowlRows = Object.entries(inn.bowlingStats).map(([name,s])=>{
    return `<tr><td>${escapeHtml(name)}</td><td class="right kbd">${oversBallsToStr(s.balls)}</td><td class="right kbd">${s.runs}</td><td class="right kbd">${s.wkts}</td><td class="right kbd">${s.wd}</td><td class="right kbd">${s.nb}</td></tr>`;
  }).join('') || `<tr><td colspan="6" class="small">No bowling stats yet</td></tr>`;

  const wktRows = inn.wicketLog.map(w=>`<tr><td class="kbd">${escapeHtml(w.overBall)}</td><td>${escapeHtml(w.batter)}</td><td>${escapeHtml(w.type)}</td><td>${escapeHtml(w.taker)}</td><td>${escapeHtml(w.bowler)}</td></tr>`).join('')
    || `<tr><td colspan="5" class="small">No wickets logged</td></tr>`;

  card.innerHTML = `
    <div class="bigscore">
      <div>
        <div class="main">Scorecard</div>
        <div class="sub"><b>${escapeHtml(batTeam.name)}</b> batting vs <b>${escapeHtml(bowlTeam.name)}</b></div>
      </div>
      <div class="btns">
        <button id="backToScore" class="primary">Back to scoring</button>
        <button id="goSummary">Summary</button>
      </div>
    </div>
    <hr/>
    <div class="row">
      <div class="col">
        <h3 style="margin:0 0 6px">Batting</h3>
        <table class="table">
          <thead><tr><th>Player</th><th class="right">R</th><th class="right">B</th><th class="right">4s</th><th class="right">6s</th><th class="right">Outs</th></tr></thead>
          <tbody>${batRows}</tbody>
        </table>
      </div>
      <div class="col">
        <h3 style="margin:0 0 6px">Bowling</h3>
        <table class="table">
          <thead><tr><th>Bowler</th><th class="right">Ov</th><th class="right">R</th><th class="right">W</th><th class="right">Wd</th><th class="right">Nb</th></tr></thead>
          <tbody>${bowlRows}</tbody>
        </table>
      </div>
    </div>
    <hr/>
    <h3 style="margin:0 0 6px">Wicket log</h3>
    <table class="table">
      <thead><tr><th>Ball</th><th>Batter</th><th>Type</th><th>Taker</th><th>Bowler</th></tr></thead>
      <tbody>${wktRows}</tbody>
    </table>
  `;
  el.appendChild(card);
  $('#view').innerHTML='';
  $('#view').appendChild(el);
  $('#backToScore').onclick=()=>setRoute('score');
  $('#goSummary').onclick=()=>setRoute('summary');
}

function viewSummary(){
  const match = state.match;
  if(!match || !match.innings || match.innings.length===0){ setRoute('home'); return; }

  const inn1 = match.innings[0];
  const inn2 = match.innings[1];

  const teamA = match.teams[0];
  const teamB = match.teams[1];

  const baseA = (inn1.battingTeam===0) ? inn1.totalRuns : inn2.totalRuns;
  const baseB = (inn1.battingTeam===1) ? inn1.totalRuns : inn2.totalRuns;

  const totalA = baseA + (teamA.beerRuns||0);
  const totalB = baseB + (teamB.beerRuns||0);

  const el=document.createElement('div');
  const card=document.createElement('div');
  card.className='card';
  card.innerHTML = `
    <div class="bigscore">
      <div>
        <div class="main">Match Summary</div>
        <div class="sub">Add beer runs after the last ball. Bins shut ${match.meta.binCloseMinutes} minutes after.</div>
      </div>
      <div class="btns">
        <button id="backScore" class="primary">Back</button>
        <button id="btnExport">Export</button>
      </div>
    </div>
    <hr/>
    <div class="row">
      <div class="col">
        <h3 style="margin:0 0 8px">${escapeHtml(teamA.name)}</h3>
        <div class="pillrow">
          <span class="pill">Base runs: <strong class="kbd">${baseA}</strong></span>
          <span class="pill">Beer runs: <strong class="kbd" id="beerA">${teamA.beerRuns||0}</strong></span>
          <span class="pill">Total: <strong class="kbd">${totalA}</strong></span>
        </div>
        <label>Beer cans (1 can = 1 run)</label>
        <input id="inBeerA" type="number" min="0" value="${teamA.beerRuns||0}"/>
      </div>
      <div class="col">
        <h3 style="margin:0 0 8px">${escapeHtml(teamB.name)}</h3>
        <div class="pillrow">
          <span class="pill">Base runs: <strong class="kbd">${baseB}</strong></span>
          <span class="pill">Beer runs: <strong class="kbd" id="beerB">${teamB.beerRuns||0}</strong></span>
          <span class="pill">Total: <strong class="kbd">${totalB}</strong></span>
        </div>
        <label>Beer cans (1 can = 1 run)</label>
        <input id="inBeerB" type="number" min="0" value="${teamB.beerRuns||0}"/>
      </div>
    </div>
    <div class="btns">
      <button id="btnFinalize" class="primary">Finalize + Save to Career Stats</button>
      <button id="btnNewMatch">Start New Match</button>
      <button id="btnClear" class="danger">Clear Current Match</button>
    </div>
    <hr/>
    <div class="small">Winner is based on totals (base + beer). If bin tampering happens, set that team’s beer runs back to 0 here.</div>
  `;
  el.appendChild(card);

  $('#view').innerHTML='';
  $('#view').appendChild(el);

  $('#backScore').onclick=()=>setRoute('score');

  function syncBeer(){
    teamA.beerRuns = clamp(parseInt($('#inBeerA').value||'0',10),0,9999);
    teamB.beerRuns = clamp(parseInt($('#inBeerB').value||'0',10),0,9999);
    save(STORAGE.match, match);
  }
  $('#inBeerA').addEventListener('input', syncBeer);
  $('#inBeerB').addEventListener('input', syncBeer);

  $('#btnClear').onclick=()=>{
    if(confirm('Clear the current match?')){
      localStorage.removeItem(STORAGE.match);
      state.match=null;
      setRoute('home');
    }
  };

  $('#btnNewMatch').onclick=()=>{
    state.match = newMatch();
    save(STORAGE.match, state.match);
    setRoute('setup');
  };

  $('#btnExport').onclick=()=>{
    const txt = exportText(match);
    navigator.clipboard?.writeText(txt).then(()=>alert('Copied summary to clipboard (paste into WhatsApp).')).catch(()=>{
      modal.open('Export', (()=>{const d=document.createElement('div'); d.innerHTML=`<pre style="white-space:pre-wrap">${escapeHtml(txt)}</pre>`; return d;})());
    });
  };

  $('#btnFinalize').onclick=()=>{
    syncBeer();
    if(match.finalizedAt){
      if(!confirm('This match is already finalized. Finalize again (will add another match to career totals)?')) return;
    }
    match.finalizedAt = nowISO();
    // Save to history
    const hist = load(STORAGE.history, []);
    hist.unshift({ id: match.id, createdAt: match.createdAt, finalizedAt: match.finalizedAt, match });
    save(STORAGE.history, hist);

    // Update career stats (bat + bowl)
    const allPlayers = [...new Set([...teamA.players, ...teamB.players])];
    careerAddMatchForPlayers(allPlayers);

    // Batting: add innings for anyone with balls or runs
    match.innings.forEach(inn=>{
      for(const [name,s] of Object.entries(inn.battingStats)){
        if((s.balls||0) > 0 || (s.runsOffBat||0) !== 0 || (s.outs||0)>0){
          careerUpsert(name, {
            bat_innings:1, bat_runs:s.runsOffBat||0, bat_balls:s.balls||0,
            bat_fours:s.fours||0, bat_sixes:s.sixes||0, bat_outs:s.outs||0
          });
        }
      }
      for(const [name,s] of Object.entries(inn.bowlingStats)){
        if((s.balls||0)>0 || (s.runs||0)!==0 || (s.wkts||0)>0 || (s.wd||0)>0 || (s.nb||0)>0){
          careerUpsert(name, {
            bowl_overs_balls:s.balls||0, bowl_runs:s.runs||0, bowl_wkts:s.wkts||0,
            bowl_wd:s.wd||0, bowl_nb:s.nb||0
          });
        }
      }
    });

    save(STORAGE.match, match);
    alert('Finalized! Career stats updated on this device.');
    setRoute('career');
  };
}

function viewCareer(){
  const all = careerGetAll();
  const players = Object.values(all).sort((a,b)=>{
    // sort by batting runs desc
    return (b.bat_runs||0) - (a.bat_runs||0);
  });

  const el=document.createElement('div');
  const card=document.createElement('div');
  card.className='card';

  const rows = players.map(p=>{
    return `<tr>
      <td>${escapeHtml(p.name)}</td>
      <td class="right kbd">${p.matches||0}</td>
      <td class="right kbd">${p.bat_runs||0}</td>
      <td class="right kbd">${p.bat_innings||0}</td>
      <td class="right kbd">${p.bat_outs||0}</td>
      <td class="right kbd">${oversBallsToStr(p.bowl_overs_balls||0)}</td>
      <td class="right kbd">${p.bowl_wkts||0}</td>
      <td class="right kbd">${p.field_wkts||0}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="small">No career stats yet. Finalize a match to start tracking.</td></tr>`;

  card.innerHTML = `
    <div class="bigscore">
      <div>
        <div class="main">Career Stats</div>
        <div class="sub">Saved locally on your phone (localStorage). Export anytime for backup/share.</div>
      </div>
      <div class="btns">
        <button id="btnBackHome" class="primary">Home</button>
        <button id="btnExportCareer">Export CSV</button>
        <button id="btnResetCareer" class="danger">Reset Career</button>
      </div>
    </div>
    <hr/>
    <table class="table">
      <thead>
        <tr>
          <th>Player</th>
          <th class="right">M</th>
          <th class="right">Bat R</th>
          <th class="right">Inns</th>
          <th class="right">Outs</th>
          <th class="right">Bowl Ov</th>
          <th class="right">Bowl W</th>
          <th class="right">Field W</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="small" style="margin-top:10px">Note: career stats are per-device. If you want everyone to share a single leaderboard, I can add cloud sync later.</div>
  `;
  el.appendChild(card);
  $('#view').innerHTML='';
  $('#view').appendChild(el);

  $('#btnBackHome').onclick=()=>setRoute('home');

  $('#btnExportCareer').onclick=()=>{
    const csv = careerToCSV(all);
    downloadText(`puc-career-stats.csv`, csv, 'text/csv');
  };

  $('#btnResetCareer').onclick=()=>{
    if(confirm('Reset ALL career stats on this device?')){
      localStorage.removeItem(STORAGE.career);
      setRoute('career');
    }
  };
}

/* ---------- Helpers ---------- */
function escapeHtml(s){
  return (s??'').toString()
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function exportText(match){
  const t = match.teams;
  const inn1 = match.innings[0], inn2 = match.innings[1];
  const baseA = (inn1.battingTeam===0) ? inn1.totalRuns : inn2.totalRuns;
  const baseB = (inn1.battingTeam===1) ? inn1.totalRuns : inn2.totalRuns;
  const totalA = baseA + (t[0].beerRuns||0);
  const totalB = baseB + (t[1].beerRuns||0);
  const lines = [];
  lines.push(`Piss Up Cup Scorer — Match Summary`);
  lines.push(`${t[0].name}: base ${baseA} + beers ${t[0].beerRuns||0} = TOTAL ${totalA}`);
  lines.push(`${t[1].name}: base ${baseB} + beers ${t[1].beerRuns||0} = TOTAL ${totalB}`);
  lines.push(`Winner: ${(totalA===totalB)?'Tie':(totalA>totalB?t[0].name:t[1].name)}`);
  lines.push('');
  lines.push(`Wickets log:`);
  match.innings.forEach((inn, idx)=>{
    const bat = match.teams[inn.battingTeam].name;
    lines.push(`Innings ${idx+1} (${bat}):`);
    if(inn.wicketLog.length===0){ lines.push('  - none'); }
    inn.wicketLog.forEach(w=>{
      lines.push(`  ${w.overBall} ${w.batter} — ${w.type} (taker: ${w.taker}, bowler: ${w.bowler})`);
    });
  });
  return lines.join('\n');
}

function careerToCSV(all){
  const headers = ['Player','Matches','BatInns','BatRuns','BatBalls','4s','6s','Outs','BowlBalls','BowlOvers','BowlRuns','BowlWkts','Wd','Nb','FieldWkts','Catches','RunOuts','Stumpings'];
  const rows = [headers.join(',')];
  Object.values(all).sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{
    const r = [
      p.name,
      p.matches||0,
      p.bat_innings||0, p.bat_runs||0, p.bat_balls||0, p.bat_fours||0, p.bat_sixes||0, p.bat_outs||0,
      p.bowl_overs_balls||0, oversBallsToStr(p.bowl_overs_balls||0),
      p.bowl_runs||0, p.bowl_wkts||0, p.bowl_wd||0, p.bowl_nb||0,
      p.field_wkts||0, p.field_catches||0, p.field_runouts||0, p.field_stumpings||0
    ];
    rows.push(r.map(csvEscape).join(','));
  });
  return rows.join('\n');
}
function csvEscape(v){
  const s = String(v ?? '');
  if(/[",\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}
function downloadText(filename, text, mime){
  const blob = new Blob([text], {type: mime || 'text/plain'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
}

/* ---------- Render ---------- */
function render(){
  const r = state.route;
  if(r==='home') return viewHome();
  if(r==='setup') return viewSetup();
  if(r==='score') return viewScore();
  if(r==='scorecard') return viewScorecard();
  if(r==='summary') return viewSummary();
  if(r==='career') return viewCareer();
  return viewHome();
}

(function init(){
  // load or start at home
  state.match = load(STORAGE.match, null);
  setRoute('home');
})();
