
const DAYS = 731;
const ACCTS = [
  {id:'a1', name:'Wells Fargo Brokerage', short:'WF Brokerage', kind:'Taxable', hue:'oklch(0.72 0.13 250)'},
  {id:'a2', name:'Wells Fargo IRA', short:'WF IRA', kind:'Traditional IRA', hue:'oklch(0.79 0.16 152)'},
  {id:'a3', name:'Fidelity 401(k)', short:'Fidelity', kind:'Employer plan', hue:'oklch(0.78 0.14 90)'},
  {id:'a4', name:'Coinbase', short:'Coinbase', kind:'Crypto', hue:'oklch(0.74 0.14 285)'},
  {id:'a5', name:'Cash Reserve', short:'Cash Reserve', kind:'Cash only', hue:'oklch(0.70 0.05 230)'},
  {id:'a6', name:'Schwab Roth', short:'Schwab Roth', kind:'Opened 4 days ago', hue:'oklch(0.60 0.04 250)'}
];
const INSTR = [
  {sym:'GOOG', name:'Alphabet Inc', p0:130, dr:0.00059, vol:0.013},
  {sym:'AAPL', name:'Apple Inc', p0:175, dr:0.00037, vol:0.012},
  {sym:'NVDA', name:'NVIDIA Corp', p0:45, dr:0.00186, vol:0.024},
  {sym:'MSFT', name:'Microsoft Corp', p0:330, dr:0.00048, vol:0.012},
  {sym:'VOO', name:'Vanguard S&P 500 ETF', p0:400, dr:0.00046, vol:0.008},
  {sym:'VTI', name:'Vanguard Total Market ETF', p0:220, dr:0.00045, vol:0.008},
  {sym:'SCHD', name:'Schwab US Dividend ETF', p0:72, dr:0.00014, vol:0.008},
  {sym:'BTC', name:'Bitcoin', p0:29000, dr:0.00176, vol:0.030},
  {sym:'ETH', name:'Ethereum', p0:1800, dr:0.00087, vol:0.034},
  {sym:'TSLA', name:'Tesla Inc', p0:250, dr:0.00034, vol:0.026},
  {sym:'RIVN', name:'Rivian Automotive', p0:24, dr:-0.00095, vol:0.030},
  {sym:'SOFI', name:'SoFi Technologies', p0:8, dr:0.00139, vol:0.028}
];
const POS = [
  ['a1','GOOG',[[40,60],[300,25]],[]],
  ['a1','AAPL',[[20,80]],[[600,30]]],
  ['a1','NVDA',[[120,40],[420,15]],[]],
  ['a1','VOO',[[10,60]],[]],
  ['a1','MSFT',[[330,20]],[]],
  ['a1','TSLA',[[60,90]],[[520,90]]],
  ['a1','RIVN',[[150,300]],[]],
  ['a1','SOFI',[[200,400]],[[650,150]]],
  ['a2','GOOG',[[30,120]],[]],
  ['a2','VTI',[[15,90],[380,30]],[]],
  ['a2','SCHD',[[90,200]],[]],
  ['a2','MSFT',[[250,35]],[]],
  ['a2','NVDA',[[460,10]],[]],
  ['a3','VOO',[[5,140]],[]],
  ['a3','VTI',[[5,60]],[]],
  ['a3','MSFT',[[100,50]],[]],
  ['a4','BTC',[[80,0.6],[500,0.25]],[]],
  ['a4','ETH',[[110,6]],[[600,2]]]
];
const CASHTX = [['a5',12,48000],['a5',300,9000],['a5',560,-4000],['a1',2,3000],['a2',2,1500],['a3',2,800],['a4',60,1200]];
const METRICS = [
  {k:'equity', label:'Equity value', note:'Market value of holdings', al:['equity','value','eq']},
  {k:'cash_balance', label:'Cash balance', note:'Uninvested cash', al:['cash']},
  {k:'unrealized_gain', label:'Unrealized gain', note:'Market value − cost basis', al:['unrealized','unreal']},
  {k:'realized_gain', label:'Realized gain', note:'Booked on sells · shown as bars', al:['realized','real','gains','gain']},
  {k:'cost_basis', label:'Cost basis', note:'What you paid, average cost', al:['cost','basis']},
  {k:'share_count', label:'Share count', note:'One instrument only', al:['shares','share','count']},
  {k:'market_price', label:'Market price', note:'One instrument only', al:['price']}
];
const RANGES = [{k:'1W',d:7},{k:'1M',d:31},{k:'3M',d:92},{k:'6M',d:183},{k:'YTD',d:213},{k:'1Y',d:366},{k:'2Y',d:730}];
const AUTOGRAN = {'1W':'daily','1M':'daily','3M':'weekly','6M':'weekly','YTD':'monthly','1Y':'monthly','2Y':'monthly'};
const PERIOD_AL = [['YTD',['ytd','2026']],['1W',['1w','week']],['1M',['1m']],['3M',['3m']],['6M',['6m']],['1Y',['1y','year','12m']],['2Y',['2y','all','alltime','2025']]];
const GRANS = ['daily','weekly','monthly','yearly'];
const UP = 'oklch(0.79 0.16 152)', DOWN = 'oklch(0.66 0.19 25)', DIM = '#8A9099';
const CHIPSTYLE = {metric:['#1B1726','#2C2740','#DCD3F0'], sym:['#152018','#26362B','#DDF0E4'], acct:['#151A24','#232C3A','#DCE6F5'], period:['#1C1A15','#2E2A1F','#E2D6B4']};

function rng(seed){let a=seed>>>0;return function(){a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
function seedOf(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}

class Component extends DCLogic {
  state = {
    nav:'portfolio', level:'portfolio', acct:null, sym:null,
    metric:'equity', rangeKey:(this.props.defaultRange||'1Y'), gran:null,
    tab:'holdings', scrubbing:false, scrubIdx:null, pinA:null, pinB:null,
    sheet:null, cum:false, showClosed:false, txnType:'buy',
    sOpen:false, sText:'', sChips:[], sArmed:false, sBrowse:null, recents:[], toast:null
  };

  componentDidMount(){
    try{ const r=JSON.parse(localStorage.getItem('pt-v2-recents')||'[]'); if(Array.isArray(r)) this.setState({recents:r.slice(0,3)}); }catch(e){}
  }

  build(){
    if(this._d) return this._d;
    const today = new Date(2026,7,1);
    const dates=[]; for(let i=0;i<DAYS;i++){const dt=new Date(today); dt.setDate(dt.getDate()-(DAYS-1-i)); dates.push(dt);}
    const px={};
    INSTR.forEach(ins=>{ const r=rng(seedOf(ins.sym)); let p=ins.p0; const arr=[];
      for(let i=0;i<DAYS;i++){ const z=(r()+r()+r()-1.5)*1.5; p=Math.max(p*Math.exp(ins.dr+ins.vol*z), ins.p0*0.08); arr.push(p); }
      px[ins.sym]=arr; });
    const keys=[], cash={}, flows={}, txns=[];
    ACCTS.forEach(a=>{ cash[a.id]=new Array(DAYS).fill(0); flows[a.id]=new Array(DAYS).fill(0); });
    CASHTX.forEach(([acct,day,amt])=>{ flows[acct][day]+=amt; txns.push({day, acct, sym:null, type: amt>0?'deposit':'withdraw', qty:null, price:null, amount:Math.abs(amt), realized:null}); });
    POS.forEach(([acct,sym,lots,sells])=>{
      const shares=new Array(DAYS).fill(0), cost=new Array(DAYS).fill(0), real=new Array(DAYS).fill(0);
      const ev=[]; lots.forEach(([d,q])=>ev.push({d,q,sell:false})); sells.forEach(([d,q])=>ev.push({d,q,sell:true}));
      ev.sort((a,b)=>a.d-b.d);
      let sh=0, cb=0, rl=0, ei=0;
      for(let i=0;i<DAYS;i++){
        while(ei<ev.length && ev[ei].d===i){
          const e=ev[ei], p=px[sym][i];
          if(!e.sell){ sh+=e.q; cb+=e.q*p; flows[acct][Math.max(0,i-1)]+=e.q*p*1.06; flows[acct][i]-=e.q*p;
            txns.push({day:i, acct, sym, type:'buy', qty:e.q, price:p, amount:e.q*p, realized:null}); }
          else { const avg=sh>0?cb/sh:0, q=Math.min(e.q,sh); const r=q*(p-avg); rl+=r; cb-=q*avg; sh-=q; flows[acct][i]+=q*p;
            txns.push({day:i, acct, sym, type:'sell', qty:q, price:p, amount:q*p, realized:r}); }
          ei++;
        }
        shares[i]=sh; cost[i]=cb; real[i]=rl;
      }
      keys.push({acct,sym,shares,cost,real});
    });
    ACCTS.forEach(a=>{ let c=0; for(let i=0;i<DAYS;i++){ c+=flows[a.id][i]; cash[a.id][i]=Math.max(c,0);} });
    txns.sort((a,b)=>b.day-a.day);
    this._d={dates,px,keys,cash,txns};
    return this._d;
  }

  filt(){ const s=this.state; return {syms:s.sym?[s.sym]:null, accts:s.acct?[s.acct]:null}; }
  matches(k,f){ return (!f.syms||f.syms.indexOf(k.sym)>=0) && (!f.accts||f.accts.indexOf(k.acct)>=0); }

  daily(metric,f){
    const key=metric+'|'+(f.syms||['*']).join(',')+'|'+(f.accts||['*']).join(',');
    this._memo=this._memo||{}; if(this._memo[key]) return this._memo[key];
    const d=this.build(); const out=new Array(DAYS).fill(0);
    if(metric==='cash_balance'){ ACCTS.forEach(a=>{ if(f.accts&&f.accts.indexOf(a.id)<0) return; for(let i=0;i<DAYS;i++) out[i]+=d.cash[a.id][i]; }); }
    else if(metric==='market_price'){ const sym=(f.syms&&f.syms[0])||'GOOG'; for(let i=0;i<DAYS;i++) out[i]=d.px[sym][i]; }
    else { d.keys.forEach(k=>{ if(!this.matches(k,f)) return; const p=d.px[k.sym];
      for(let i=0;i<DAYS;i++){
        if(metric==='equity') out[i]+=k.shares[i]*p[i];
        else if(metric==='cost_basis') out[i]+=k.cost[i];
        else if(metric==='share_count') out[i]+=k.shares[i];
        else if(metric==='unrealized_gain') out[i]+=k.shares[i]*p[i]-k.cost[i];
        else if(metric==='realized_gain') out[i]+=k.real[i];
      }}); }
    this._memo[key]=out; return out;
  }

  series(){
    const s=this.state, f=this.filt(), d=this.build();
    const days=(RANGES.find(r=>r.k===s.rangeKey)||RANGES[5]).d;
    const start=Math.max(0, DAYS-1-days);
    const raw=this.daily(s.metric,f);
    const gran=s.gran||AUTOGRAN[s.rangeKey];
    const flow = s.metric==='realized_gain' && !s.cum;
    const buckets=[];
    const kf=(dt)=> gran==='daily'?dt.toISOString().slice(0,10)
      : gran==='weekly'?(()=>{const t=new Date(dt);t.setDate(t.getDate()-((t.getDay()+6)%7));return t.toISOString().slice(0,10);})()
      : gran==='monthly'?dt.getFullYear()+'-'+dt.getMonth() : ''+dt.getFullYear();
    let cur=null;
    for(let i=start;i<DAYS;i++){ const k=kf(d.dates[i]);
      if(!cur||cur.k!==k){ cur={k,i0:i,i:i}; buckets.push(cur);} cur.i=i; cur.end=d.dates[i]; }
    const pts=buckets.map((b,j)=>{ let v;
      if(flow){ const prev = j===0? raw[Math.max(start-1,0)] : raw[buckets[j-1].i]; v=raw[b.i]-prev; }
      else v=raw[b.i];
      return {v, date:b.end}; });
    return {pts, gran, flow};
  }

  usd(v,dp){ const n=Math.abs(v); return (v<0?'−':'')+'$'+n.toLocaleString('en-US',{minimumFractionDigits:dp===undefined?2:dp,maximumFractionDigits:dp===undefined?2:dp}); }
  money(v){ return this.usd(v, Math.abs(v)>=10000?0:2); }
  signed(v){ return (v>=0?'+':'−')+this.usd(Math.abs(v), Math.abs(v)>=10000?0:2); }
  pct(v){ return (v>=0?'+':'−')+Math.abs(v).toFixed(2)+'%'; }
  qty(v){ return v.toLocaleString('en-US',{maximumFractionDigits:v<10?4:2}); }
  shq(v){ return this.qty(v)+'×'; }
  dlabel(d,g){ if(g==='yearly') return ''+d.getFullYear();
    if(g==='monthly') return d.toLocaleDateString('en-US',{month:'short',year:'numeric'});
    if(g==='weekly') return 'Week of '+d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
  metricVal(v){ const m=this.state.metric; if(m==='share_count') return this.shq(v); if(m==='market_price') return this.usd(v); return this.money(v); }

  idxFrom(e){ const el=this._chart; if(!el) return 0;
    const r=el.getBoundingClientRect(), n=this._n||1;
    const f=Math.min(1,Math.max(0,(e.clientX-r.left)/Math.max(r.width,1)));
    return Math.round(f*(n-1)); }
  onDown=(e)=>{ try{e.currentTarget.setPointerCapture(e.pointerId);}catch(err){} this._x0=e.clientX; this._moved=false; this.setState({scrubbing:true, scrubIdx:this.idxFrom(e)}); };
  onMove=(e)=>{ if(!this.state.scrubbing) return; if(Math.abs(e.clientX-this._x0)>6) this._moved=true; this.setState({scrubIdx:this.idxFrom(e)}); };
  onUp=(e)=>{ const i=this.idxFrom(e);
    if(this._moved){ this.setState({scrubbing:false, scrubIdx:null}); return; }
    const compare=this.props.compareTaps!==false, s=this.state;
    if(compare && s.pinA!==null && s.pinB===null && i!==s.pinA) this.setState({scrubbing:false, scrubIdx:null, pinB:i});
    else if(s.pinA===i && s.pinB===null) this.setState({scrubbing:false, scrubIdx:null, pinA:null, pinB:null});
    else this.setState({scrubbing:false, scrubIdx:null, pinA:i, pinB:null}); };
  onLeave=()=>{ if(this.state.scrubbing) this.setState({scrubbing:false, scrubIdx:null}); };

  go(patch){ this.setState(Object.assign({scrubIdx:null, scrubbing:false, pinA:null, pinB:null, sheet:null, showClosed:false}, patch)); }
  clearFilter(kind, patch){
    const s=this.state;
    const snap={sym:s.sym, acct:s.acct, level:s.level, metric:s.metric, rangeKey:s.rangeKey, gran:s.gran, tab:s.tab, nav:s.nav, cum:s.cum};
    if(this._toastTimer) clearTimeout(this._toastTimer);
    this.go(Object.assign({toast:{msg:kind+' filter removed', snap}}, patch));
    this._toastTimer=setTimeout(()=>this.setState({toast:null}), 5000);
  }
  toastUndo=()=>{ const t=this.state.toast; if(!t) return; if(this._toastTimer) clearTimeout(this._toastTimer); this.go(Object.assign({toast:null}, t.snap)); };
  toastDismiss=()=>{ if(this._toastTimer) clearTimeout(this._toastTimer); this.setState({toast:null}); };
  hasInstr(id){ const d=this.build(); return d.keys.some(k=>k.acct===id && k.shares[DAYS-1]>0); }
  gotoAcct(id, nav){ const p={level:'account', acct:id, tab:'holdings'};
    if(nav) p.nav=nav;
    if(!this.hasInstr(id) && ['equity','cost_basis','unrealized_gain'].indexOf(this.state.metric)>=0) p.metric='cash_balance';
    else if(this.state.metric==='cash_balance' && this.hasInstr(id)) p.metric='equity';
    this.go(p); }
  slice(sym,acct){ const p={nav:'portfolio', sym, acct, level: acct?'slice':'instrument', tab:'holdings'};
    if(this.state.metric==='cash_balance') p.metric='equity';
    this.go(p); }

  // ---------- search ----------
  sReset(extra){ return Object.assign({sOpen:false, sText:'', sChips:[], sArmed:false, sBrowse:null}, extra||{}); }
  openSearch=()=>{ if(this._sInput) this._sInput.value=''; this.setState({sOpen:true, sText:'', sChips:[], sArmed:false, sBrowse:null}); };
  closeSearch=()=>{ this.setState(this.sReset()); };
  focusSearch=()=>{ if(this._sInput) this._sInput.focus(); };
  addChip(kind,label,val){
    const chips=this.state.sChips.filter(c=>c.kind!==kind).concat([{kind,label,val}]);
    if(this._sInput) this._sInput.value='';
    this.setState({sChips:chips, sText:'', sArmed:false, sBrowse:null});
    setTimeout(()=>this.focusSearch(),0);
  }
  removeChipAt(i){ const chips=this.state.sChips.slice(); chips.splice(i,1); this.setState({sChips:chips, sArmed:false}); setTimeout(()=>this.focusSearch(),0); }
  heldSyms(){
    if(this._held) return this._held;
    const d=this.build(), last=DAYS-1, m={};
    d.keys.forEach(k=>{ const o=m[k.sym]||(m[k.sym]={sym:k.sym, sh:0, mv:0, cb:0, rl:0, accts:[]});
      o.sh+=k.shares[last]; o.mv+=k.shares[last]*d.px[k.sym][last]; o.cb+=k.cost[last]; o.rl+=k.real[last];
      o.accts.push(k); });
    this._held = Object.values(m).sort((a,b)=>b.mv-a.mv);
    return this._held;
  }
  sMatch(text){
    const t=text.trim().toLowerCase();
    const chips=this.state.sChips;
    const has=k=>chips.some(c=>c.kind===k);
    const out={metrics:[], instrs:[], accts:[], periods:[]};
    if(!t) return out;
    if(!has('metric')) out.metrics = METRICS.filter(m=> m.al.some(a=>a.startsWith(t)) || m.label.toLowerCase().startsWith(t));
    if(!has('sym')){
      const info={}; INSTR.forEach(i=>info[i.sym]=i);
      out.instrs = this.heldSyms().filter(o=>{ const ins=info[o.sym];
        return o.sym.toLowerCase().startsWith(t) || ins.name.toLowerCase().includes(t); });
    }
    if(!has('acct')) out.accts = ACCTS.filter(a=> a.name.toLowerCase().split(/[\s()]+/).some(w=>w.startsWith(t)) || a.short.toLowerCase().startsWith(t) || (a.kind.toLowerCase().includes(t)&&t.length>2));
    if(!has('period')) out.periods = PERIOD_AL.filter(([k,al])=> al.some(a=>a.startsWith(t)) || k.toLowerCase()===t).map(([k])=>k);
    return out;
  }
  tryCommit(text){
    const m=this.sMatch(text);
    const total = m.metrics.length + m.instrs.length + m.accts.length + m.periods.length;
    const t=text.trim().toLowerCase();
    if(m.instrs.length && m.instrs.some(o=>o.sym.toLowerCase()===t)){ const o=m.instrs.find(o=>o.sym.toLowerCase()===t); this.addChip('sym',o.sym,o.sym); return true; }
    if(total===1){
      if(m.metrics.length){ const mm=m.metrics[0]; this.addChip('metric',mm.label,mm.k); return true; }
      if(m.instrs.length){ this.addChip('sym',m.instrs[0].sym,m.instrs[0].sym); return true; }
      if(m.accts.length){ this.addChip('acct',m.accts[0].short,m.accts[0].id); return true; }
      if(m.periods.length){ this.addChip('period',m.periods[0],m.periods[0]); return true; }
    }
    return false;
  }
  onSInput=(e)=>{ this.setState({sText:e.target.value, sArmed:false}); };
  onSKey=(e)=>{
    const s=this.state;
    if(e.key==='Backspace' && s.sText==='' && s.sChips.length){
      if(!s.sArmed) this.setState({sArmed:true});
      else this.removeChipAt(s.sChips.length-1);
      e.preventDefault(); return;
    }
    if(e.key===' ' && s.sText.trim()){ if(this.tryCommit(s.sText)) e.preventDefault(); return; }
    if(e.key==='Enter'){ const g=this.goInfo(); if(g && g.ok) this.applyGo(); }
  };
  goInfo(){
    const chips=this.state.sChips;
    if(!chips.length) return null;
    const get=k=>{ const c=chips.find(x=>x.kind===k); return c?c.val:null; };
    const sym=get('sym'), acct=get('acct');
    let metric=get('metric');
    const needSym = metric==='share_count'||metric==='market_price';
    if(needSym && !sym) return {ok:false, title:METRICS.find(m=>m.k===metric).label+' needs an instrument', sub:'Add a symbol chip first', value:'—'};
    if(!metric) metric = (sym||acct)? (this.state.metric==='cash_balance'&&sym?'equity':this.state.metric) : this.state.metric;
    let range=get('period') || (metric==='realized_gain'?'YTD':this.state.rangeKey);
    const f={syms:sym?[sym]:null, accts:acct?[acct]:null};
    const raw=this.daily(metric,f);
    const days=(RANGES.find(r=>r.k===range)||RANGES[5]).d, start=Math.max(0,DAYS-1-days), last=DAYS-1;
    const v = metric==='realized_gain'? raw[last]-raw[start] : raw[last];
    const fmt = metric==='share_count'? this.shq(v) : metric==='market_price'? this.usd(v) : (metric==='realized_gain'||metric==='unrealized_gain')? this.signed(v) : this.money(v);
    const mLabel=METRICS.find(m=>m.k===metric).label;
    const acctName = acct? ACCTS.find(a=>a.id===acct).short : null;
    const d=this.build();
    const nAcct = sym? d.keys.filter(k=>k.sym===sym && k.shares[last]>0).length : ACCTS.length;
    return {ok:true, metric, sym, acct, range,
      title: mLabel + (sym?' · '+sym:'') + (acctName?' · '+acctName:''),
      sub: (acctName? acctName : sym? ('All '+nAcct+' accounts') : 'Whole portfolio') + ' · ' + range + ' · ' + AUTOGRAN[range] + (metric==='realized_gain'?' bars':''),
      value: fmt};
  }
  applyGo=()=>{
    const g=this.goInfo(); if(!g||!g.ok) return;
    const level = g.sym&&g.acct?'slice' : g.sym?'instrument' : g.acct?'account' : 'portfolio';
    const rec={title:g.title, value:g.value, metric:g.metric, sym:g.sym, acct:g.acct, range:g.range};
    const recents=[rec].concat(this.state.recents.filter(r=>r.title!==rec.title)).slice(0,3);
    try{ localStorage.setItem('pt-v2-recents', JSON.stringify(recents)); }catch(e){}
    this.setState(this.sReset({nav:'portfolio', level, sym:g.sym, acct:g.acct, metric:g.metric, rangeKey:g.range, gran:null, tab:'holdings', pinA:null, pinB:null, cum:false, recents}));
  };
  applyRecent(rec){
    const level = rec.sym&&rec.acct?'slice' : rec.sym?'instrument' : rec.acct?'account' : 'portfolio';
    this.setState(this.sReset({nav:'portfolio', level, sym:rec.sym||null, acct:rec.acct||null, metric:rec.metric||'equity', rangeKey:rec.range||'1Y', gran:null, tab:'holdings', pinA:null, pinB:null, cum:false}));
  }

  statics(){
    if(this._st) return this._st;
    const d=this.build(), last=DAYS-1;
    const merged=this.heldSyms().filter(o=>o.sh>0);
    const mk=(vals,w,h)=>{ const mn=Math.min.apply(null,vals), mx=Math.max.apply(null,vals), r=(mx-mn)||1;
      return vals.map((v,i)=>(i?'L':'M')+(i/(vals.length-1)*w).toFixed(1)+' '+(h-2-((v-mn)/r)*(h-4)).toFixed(1)).join(' '); };
    const eq=this.daily('equity',{syms:null,accts:null}), cashAll=this.daily('cash_balance',{syms:null,accts:null});
    const tot=[]; for(let i=0;i<DAYS;i++) tot.push(eq[i]+cashAll[i]);
    const yrAgo=tot[DAYS-366];
    const acctRows=ACCTS.map(a=>{
      const mvS=this.daily('equity',{syms:null,accts:[a.id]}), cbS=this.daily('cost_basis',{syms:null,accts:[a.id]});
      const mv=mvS[last]+d.cash[a.id][last], cb=cbS[last], gl=cb>0?((mvS[last]-cb)/cb*100):0;
      const v=[]; for(let i=DAYS-260;i<DAYS;i+=13) v.push(mvS[i]+d.cash[a.id][i]);
      const flat=Math.max.apply(null,v)-Math.min.apply(null,v)<1;
      return {id:a.id, name:a.name, hue:a.hue, sub:a.kind, raw:mv, mv:this.money(mv), gl: cb>0?this.pct(gl):'—',
        sc: cb>0?(gl>=0?UP:DOWN):DIM, spark: flat?'M0 9 L46 9':mk(v,46,18)}; });
    const segsRaw=acctRows.filter(r=>r.raw>1).sort((a,b)=>b.raw-a.raw);
    const segTot=segsRaw.reduce((a,s)=>a+s.raw,0);
    const allocSegs=segsRaw.map(s=>({id:s.id, name:ACCTS.find(a=>a.id===s.id).short, hue:s.hue,
      w:(s.raw/segTot*100).toFixed(1)+'%', pct:Math.round(s.raw/segTot*100)+'%'}));
    this._st={merged, acctRows, allocSegs, total:tot[last], totalDelta:this.pct((tot[last]-yrAgo)/yrAgo*100)+'  '+this.signed(tot[last]-yrAgo)};
    return this._st;
  }

  searchVals(accent){
    const s=this.state, d=this.build(), last=DAYS-1, px=d.px;
    const armedIdx = s.sArmed? s.sChips.length-1 : -1;
    const sChips = s.sChips.map((c,i)=>{ const st=CHIPSTYLE[c.kind];
      const armed = i===armedIdx;
      return {label:c.label,
        bg: armed?'oklch(0.32 0.09 25)':st[0], bd: armed?'oklch(0.55 0.16 25)':st[1], fg: armed?'#FFD9DC':st[2],
        glow: armed?'0 0 0 3px oklch(0.66 0.19 25 / .18)':'none',
        onRemove:()=>this.removeChipAt(i)}; });
    const t=s.sText.trim();
    const sections=[];
    const row=(o)=>Object.assign({barW:'0', hue:'transparent', t1:'', t2:'', v1:'', v2:'', v2c:'#6C737D', onTap:null}, o);
    const sec=(title,rows,chipsList,note)=>({title, rows:rows||[], chipsList:chipsList||[], note:note||false});
    const info={}; INSTR.forEach(i=>info[i.sym]=i);
    if(s.sBrowse==='syms'){
      const rows=this.heldSyms().slice().sort((a,b)=>a.sym.localeCompare(b.sym)).map(o=>row({
        t1:o.sym, t2:info[o.sym].name + (o.sh>0?' · '+this.shq(o.sh):' · closed'),
        v1:o.sh>0?this.money(o.mv):'—', v2:o.sh>0?'':'realized '+this.signed(o.rl), v2c:o.rl>=0?accent:DOWN,
        onTap:()=>this.addChip('sym',o.sym,o.sym)}));
      sections.push(sec('All '+rows.length+' instruments · tap to add a chip', rows, [ {label:'‹ Back', bg:'#0F1216', bd:'#232830', fg:'#7E858F', onTap:()=>this.setState({sBrowse:null})} ]));
    } else if(!t && s.sChips.length===0){
      const recRows = s.recents.map(r=>row({t1:r.title, t2:(r.range||'1Y'), v1:r.value, onTap:()=>this.applyRecent(r)}));
      if(recRows.length) sections.push(sec('Recent slices', recRows));
      const symChips = this.statics().merged.slice(0,7).map(o=>({label:o.sym, bg:CHIPSTYLE.sym[0], bd:CHIPSTYLE.sym[1], fg:CHIPSTYLE.sym[2], onTap:()=>this.addChip('sym',o.sym,o.sym)}))
        .concat([{label:'See all '+this.heldSyms().length+' →', bg:'#0F1216', bd:'#232830', fg:'#7E858F', onTap:()=>this.setState({sBrowse:'syms'})}]);
      sections.push(sec('Jump to a symbol', null, symChips));
      const acctChips = ACCTS.map(a=>({label:a.name, bg:CHIPSTYLE.acct[0], bd:CHIPSTYLE.acct[1], fg:CHIPSTYLE.acct[2], onTap:()=>this.addChip('acct',a.short,a.id)}));
      sections.push(sec('Jump to an account', null, acctChips, recRows.length?false:'Slices you apply from search will show up here as recents.'));
    } else {
      const m=this.sMatch(t);
      const has=k=>s.sChips.some(c=>c.kind===k);
      const chipSym = (s.sChips.find(c=>c.kind==='sym')||{}).val || null;
      if(m.metrics.length) sections.push(sec('Metric', m.metrics.map(mm=>row({t1:mm.label, t2:mm.note, onTap:()=>this.addChip('metric',mm.label,mm.k)}))));
      if(m.instrs.length){
        sections.push(sec('Instrument', m.instrs.slice(0,4).map(o=>row({
          t1:o.sym, t2:info[o.sym].name+' · '+(o.sh>0?this.shq(o.sh)+' · '+o.accts.filter(k=>k.shares[last]>0).length+' accounts':'closed · realized '+this.signed(o.rl)),
          v1:o.sh>0?this.money(o.mv):'—', onTap:()=>this.addChip('sym',o.sym,o.sym)}))));
        if(!has('acct')){
          const pairs=[];
          m.instrs.slice(0,2).forEach(o=>{ o.accts.forEach(k=>{ if(k.shares[last]<=0) return; const a=ACCTS.find(x=>x.id===k.acct);
            pairs.push(row({barW:'3px', hue:a.hue, t1:o.sym+' in '+a.short, t2:this.shq(k.shares[last])+' · avg '+this.usd(k.cost[last]/k.shares[last]),
              v1:this.money(k.shares[last]*px[o.sym][last]),
              onTap:()=>{ this.addChip('sym',o.sym,o.sym); setTimeout(()=>this.addChip('acct',a.short,a.id),0); }})); }); });
          if(pairs.length) sections.push(sec('In one account · adds both chips', pairs));
        }
      }
      if(m.accts.length) sections.push(sec('Account', m.accts.map(a=>{
        const mvS=this.daily('equity',{syms:null,accts:[a.id]});
        return row({barW:'3px', hue:a.hue, t1:a.name, t2:a.kind, v1:this.money(mvS[last]+d.cash[a.id][last]), onTap:()=>this.addChip('acct',a.short,a.id)}); })));
      if(m.periods.length) sections.push(sec('Period', null, m.periods.map(k=>({label:k, bg:CHIPSTYLE.period[0], bd:CHIPSTYLE.period[1], fg:CHIPSTYLE.period[2], onTap:()=>this.addChip('period',k,k)}))));
      if(!t && s.sChips.length){
        if(chipSym && !has('acct')){
          const held=this.heldSyms().find(o=>o.sym===chipSym);
          const rows=(held?held.accts:[]).filter(k=>k.shares[last]>0).map(k=>{ const a=ACCTS.find(x=>x.id===k.acct);
            return row({barW:'3px', hue:a.hue, t1:a.name, t2:this.shq(k.shares[last])+' '+chipSym+' · '+this.money(k.shares[last]*px[chipSym][last]), v1:'+',
              onTap:()=>this.addChip('acct',a.short,a.id)}); });
          if(rows.length) sections.push(sec('Or add another chip', rows));
        } else if(!chipSym && !has('acct')){
          sections.push(sec('Or add another chip', ACCTS.filter(a=>this.hasInstr(a.id)||a.id==='a5').map(a=>row({barW:'3px', hue:a.hue, t1:a.name, t2:a.kind, v1:'+', onTap:()=>this.addChip('acct',a.short,a.id)}))));
        }
        if(!has('period')) sections.push(sec('Period', null, PERIOD_AL.map(([k])=>k).map(k=>({label:k, bg:CHIPSTYLE.period[0], bd:CHIPSTYLE.period[1], fg:CHIPSTYLE.period[2], onTap:()=>this.addChip('period',k,k)}))));
      }
      if(t && chipSym===null && m.instrs.length===0 && m.metrics.length===0 && m.accts.length===0 && m.periods.length===0){
        sections.push(sec('No matches', [row({t1:'Nothing matches "'+t+'"', t2:'Search covers your instruments, accounts, metrics and periods — not the whole market.'})]));
      }
      // activity matches
      if(t && m.instrs.length===1){
        const sym=m.instrs[0].sym;
        const acts=d.txns.filter(x=>x.sym===sym).slice(0,2);
        if(acts.length){
          sections.push(sec('Activity · '+d.txns.filter(x=>x.sym===sym).length, acts.map(x=>{ const a=ACCTS.find(z=>z.id===x.acct);
            return row({t1:x.type.toUpperCase()+' · '+sym+' · '+this.shq(x.qty)+' @ '+this.usd(x.price), t2:a.short+' · '+d.dates[x.day].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),
              v1:(x.type==='buy'?'−':'+')+this.usd(x.amount,0),
              onTap:()=>{ this.setState(this.sReset({nav:'activity', sym, acct:null, level:'instrument'})); }}); })));
        }
      }
    }
    const g=this.goInfo();
    return { searchOpen:s.sOpen, sChips, sText:s.sText,
      toast:s.toast||false, toastUndo:this.toastUndo, toastDismiss:this.toastDismiss,
      sPlaceholder: s.sChips.length? '' : 'Search holdings, accounts, activity',
      sInputRef:(el)=>{ this._sInput=el; if(el && el.value!==this.state.sText) el.value=this.state.sText; }, onSInput:this.onSInput, onSKey:this.onSKey,
      focusSearch:this.focusSearch, closeSearch:this.closeSearch, applyGo:this.applyGo,
      sGo: g||false, sSections:sections };
  }

  renderVals(){
    const s=this.state, d=this.build(), st=this.statics(), last=DAYS-1, px=d.px;
    const accent=this.props.accent||UP;
    const {pts, gran, flow}=this.series();
    this._n=pts.length;
    const vals=pts.map(p=>p.v);
    const isBars = s.metric==='realized_gain' && !s.cum;
    const W=358, H=168, PAD=10;
    let mn=Math.min.apply(null,vals), mx=Math.max.apply(null,vals);
    if(s.metric==='realized_gain'||s.metric==='unrealized_gain'){ mn=Math.min(mn,0); mx=Math.max(mx,0); }
    if(mx-mn<1e-6) mx=mn+1;
    const rr=mx-mn;
    const X=i=> pts.length<2?W/2:(i/(pts.length-1))*W;
    const Y=v=> H-PAD-((v-mn)/rr)*(H-PAD*2);
    const pathD=pts.map((p,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(p.v).toFixed(1)).join(' ');
    const areaD=pathD+' L'+W+' '+H+' L0 '+H+' Z';
    const bw=Math.max(2, W/Math.max(pts.length,1)*0.62);
    const zeroY=Y(0);
    const barX=i=> pts.length<2?(W-bw)/2 : (i/(pts.length-1))*(W-bw);
    const bars=pts.map((p,i)=>{ const y=Y(p.v); return {x:barX(i).toFixed(1), y:Math.min(y,zeroY).toFixed(1), w:bw.toFixed(1), h:Math.max(1.5,Math.abs(zeroY-y)).toFixed(1), fill:p.v>=0?accent:DOWN}; });

    const li=pts.length-1;
    let vi=li, mode='latest';
    if(s.scrubbing && s.scrubIdx!==null){ vi=Math.min(s.scrubIdx,li); mode='scrub'; }
    else if(s.pinA!==null && s.pinB!==null){ vi=Math.min(s.pinB,li); mode='ab'; }
    else if(s.pinA!==null){ vi=Math.min(s.pinA,li); mode='pin'; }
    const v0=vals[0], dv=(a,b)=> b===0?null:(a-b)/Math.abs(b)*100;
    const flowTotal=vals.reduce((a,b)=>a+b,0);
    let deltaMain, deltaSub, deltaColor;
    if(mode==='scrub'){
      const prev= vi>0?vals[vi-1]:vals[0], dPrev=vals[vi]-prev, dStart=vals[vi]-v0;
      deltaMain=this.signed(dPrev)+' vs prev';
      deltaSub=this.dlabel(pts[vi].date,gran)+'  ·  '+this.signed(dStart)+' from start';
      deltaColor=dPrev>=0?accent:DOWN;
    } else if(mode==='ab'){
      const a=Math.min(s.pinA,s.pinB), b=Math.max(s.pinA,s.pinB), diff=vals[b]-vals[a], p=dv(vals[b],vals[a]);
      deltaMain=this.signed(diff);
      deltaSub=this.dlabel(pts[a].date,gran)+' → '+this.dlabel(pts[b].date,gran)+(p===null?'':'  ·  '+this.pct(p));
      deltaColor=diff>=0?accent:DOWN;
    } else if(mode==='pin'){
      const dStart=vals[vi]-v0;
      deltaMain=this.signed(dStart);
      deltaSub=this.dlabel(pts[vi].date,gran)+'  ·  pinned · tap again to compare';
      deltaColor=dStart>=0?accent:DOWN;
    } else if(flow){
      deltaMain=this.dlabel(pts[0].date,gran)+' → '+this.dlabel(pts[li].date,gran);
      deltaSub=pts.length+' '+gran.replace('ly','')+' buckets';
      deltaColor=flowTotal>=0?accent:DOWN;
    } else {
      const dStart=vals[li]-v0, p=dv(vals[li],v0);
      deltaMain=this.signed(dStart)+(p===null?'':'  '+this.pct(p));
      deltaSub= s.rangeKey==='YTD'?'year to date': s.rangeKey==='2Y'?'past 2 years':'past '+s.rangeKey.replace('W',' week').replace('M',' months').replace('Y',' year');
      deltaColor=dStart>=0?accent:DOWN;
    }
    const cross=(s.scrubbing && s.scrubIdx!==null)?{x:X(Math.min(s.scrubIdx,li)).toFixed(1), y:Y(vals[Math.min(s.scrubIdx,li)]).toFixed(1)}:false;
    const pins=[s.pinA,s.pinB].filter(i=>i!==null&&i<=li).map(i=>({x:X(i).toFixed(1), y:Y(vals[i]).toFixed(1)}));
    const pinBand=(s.pinA!==null&&s.pinB!==null)?{x:Math.min(X(s.pinA),X(s.pinB)).toFixed(1), w:Math.abs(X(s.pinB)-X(s.pinA)).toFixed(1)}:false;

    const rows=[], closedRows=[]; let emptyMsg=false, emptySub='', sectionTitle='', statCard=false, stats=[];
    const STRIPE='repeating-linear-gradient(135deg,#191D23 0 3px,#12151A 3px 6px)';
    const initials=(n)=>n.split(' ').map(w=>w[0]).join('').slice(0,3);
    if(s.level==='portfolio' && s.tab==='accounts' && !s.sym){
      sectionTitle='Accounts';
      st.acctRows.forEach(a=>rows.push({av:initials(a.name), avBg:'#15181D', avFg:'#9AA2AC', t1:a.name, t2:a.sub, v1:a.mv, v2:a.gl, v2c:a.sc, onTap:()=>this.gotoAcct(a.id)}));
    } else if(s.sym && !s.acct){
      const held=d.keys.filter(k=>k.sym===s.sym);
      const sh=held.reduce((a,k)=>a+k.shares[last],0), cb=held.reduce((a,k)=>a+k.cost[last],0);
      const mv=sh*px[s.sym][last], rl=held.reduce((a,k)=>a+k.real[last],0);
      statCard=true;
      stats=[{k:'Shares', v:this.qty(sh), c:'#EAEEF3'},{k:'Market price', v:this.usd(px[s.sym][last]), c:'#EAEEF3'},
        {k:'Avg cost', v: sh>0?this.usd(cb/sh):'—', c:'#EAEEF3'},{k:'Unrealized', v: sh>0?this.signed(mv-cb):'—', c: mv-cb>=0?accent:DOWN},
        {k:'Realized (all time)', v:this.signed(rl), c: rl>=0?accent:DOWN},{k:'Cost basis', v:this.money(cb), c:'#EAEEF3'}];
      sectionTitle='Across your accounts';
      held.forEach(k=>{ const a=ACCTS.find(x=>x.id===k.acct), kmv=k.shares[last]*px[s.sym][last], kcb=k.cost[last];
        const gl=kcb>0?(kmv-kcb)/kcb*100:0;
        const row={av:initials(a.name), avBg:'#15181D', avFg:'#9AA2AC', t1:a.name,
          t2: k.shares[last]>0? this.shq(k.shares[last])+' · avg '+this.usd(kcb/k.shares[last]) : 'closed · realized '+this.signed(k.real[last]),
          v1: k.shares[last]>0?this.money(kmv):'—', v2: k.shares[last]>0?this.pct(gl):this.signed(k.real[last]),
          v2c:(k.shares[last]>0?gl:k.real[last])>=0?accent:DOWN, onTap:()=>this.slice(s.sym,k.acct)};
        if(k.shares[last]>0) rows.push(row); else closedRows.push(row); });
    } else {
      const f=this.filt(), bySym={};
      d.keys.forEach(k=>{ if(f.accts&&f.accts.indexOf(k.acct)<0) return; if(f.syms&&f.syms.indexOf(k.sym)<0) return;
        const o=bySym[k.sym]||(bySym[k.sym]={sym:k.sym, sh:0, cb:0, rl:0}); o.sh+=k.shares[last]; o.cb+=k.cost[last]; o.rl+=k.real[last]; });
      const list=Object.values(bySym).map(o=>({o, mv:o.sh*px[o.sym][last], gl: o.cb>0?(o.sh*px[o.sym][last]-o.cb)/o.cb*100:0, ins:INSTR.find(i=>i.sym===o.sym)})).sort((a,b)=>b.mv-a.mv);
      sectionTitle = s.level==='portfolio'? '' : 'Holdings';
      list.forEach(({o,mv,gl,ins})=>{
        const row={av:'', avBg:STRIPE, avFg:'#9AA2AC', t1:o.sym,
          t2: o.sh>0? ins.name+' · '+this.shq(o.sh) : ins.name+' · closed · realized '+this.signed(o.rl),
          v1: o.sh>0?this.money(mv):'—', v2: o.sh>0?this.pct(gl):this.signed(o.rl), v2c:(o.sh>0?gl:o.rl)>=0?accent:DOWN,
          onTap:()=>this.slice(o.sym, s.acct)};
        if(o.sh>0) rows.push(row); else closedRows.push(row); });
      if(s.acct){
        const a=ACCTS.find(x=>x.id===s.acct), c=d.cash[s.acct][last];
        if(rows.length===0 && closedRows.length===0 && c<1){ emptyMsg='Nothing here yet'; emptySub='Add your first buy or deposit and this account starts charting from that date.'; }
        if(c>1 && !s.sym) rows.unshift({av:'', avBg:'#12151A', avFg:'#6C737D', t1:'Cash', t2: rows.length?'Uninvested · '+a.short:'No instruments in this account', v1:this.money(c), v2:'—', v2c:DIM, onTap:()=>this.setState({metric:'cash_balance', pinA:null, pinB:null})});
      }
    }

    const chips=[];
    if(s.sym) chips.push({kind:'Instrument', label:s.sym, bg:'#152018', bd:'#26362B', fg:'#DDF0E4', onClear:()=>this.clearFilter(s.sym, {sym:null, level: s.acct?'account':'portfolio'})});
    if(s.acct){ const a=ACCTS.find(x=>x.id===s.acct);
      chips.push({kind:'Account', label:a.short, bg:'#151A24', bd:'#232C3A', fg:'#DCE6F5', onClear:()=>this.clearFilter(a.short, {acct:null, level: s.sym?'instrument':'portfolio'})}); }

    const mDef=METRICS.find(m=>m.k===s.metric)||METRICS[0];
    const singleSym=!!s.sym;
    const sheetRows=[];
    if(s.sheet==='metric'){
      METRICS.forEach(m=>{ const ok=(m.k!=='share_count'&&m.k!=='market_price')||singleSym;
        sheetRows.push({label:m.label, note: ok?m.note:m.note+' — pick an instrument first', op: ok?1:0.38,
          dotBd: s.metric===m.k?accent:'#333A42', dotBg: s.metric===m.k?accent:'transparent',
          onTap:()=> ok? this.setState({metric:m.k, sheet:null, pinA:null, pinB:null}) : null}); });
    } else if(s.sheet==='gran'){
      const auto=AUTOGRAN[s.rangeKey], days=(RANGES.find(r=>r.k===s.rangeKey)||RANGES[5]).d;
      GRANS.forEach(g=>{ const ok=!(g==='yearly'&&days<366)&&!(g==='monthly'&&days<62)&&!(g==='weekly'&&days<21);
        const cur=(s.gran||auto)===g;
        sheetRows.push({label:g.charAt(0).toUpperCase()+g.slice(1), note: g===auto?'Default for '+s.rangeKey:(ok?'':'Too coarse for '+s.rangeKey),
          op: ok?1:0.38, dotBd: cur?accent:'#333A42', dotBg: cur?accent:'transparent',
          onTap:()=> ok? this.setState({gran:g, sheet:null, pinA:null, pinB:null}) : null}); });
    } else if(s.sheet==='accts'){
      sheetRows.push({label:'Whole portfolio', note:'All 6 accounts combined', op:1, dotBd: s.acct?'#333A42':accent, dotBg: s.acct?'transparent':accent, onTap:()=>this.go({acct:null, level: s.sym?'instrument':'portfolio'})});
      ACCTS.forEach(a=>sheetRows.push({label:a.name, note:a.kind, op:1, dotBd: s.acct===a.id?accent:'#333A42', dotBg: s.acct===a.id?accent:'transparent', onTap:()=>this.gotoAcct(a.id)}));
    }

    const txnTypes=['buy','sell','deposit','withdraw'].map(t=>({label:t.charAt(0).toUpperCase()+t.slice(1),
      bg: s.txnType===t?'#20252C':'transparent', fg: s.txnType===t?'#F2F4F7':'#6C737D', onTap:()=>this.setState({txnType:t})}));
    const isCash = s.txnType==='deposit'||s.txnType==='withdraw';
    const acctObj = s.acct? ACCTS.find(x=>x.id===s.acct):null;
    const acctShort = acctObj? acctObj.short : null;
    const FROM='from view';
    const txnFields = isCash
      ? [{k:'Account', v:acctShort||'Choose…', c: acctShort?'#EAEEF3':'#5A616B', tag: acctShort?FROM:''},
         {k:'Amount', v:'$0.00', c:'#5A616B', tag:''},{k:'Date', v:'Aug 1, 2026', c:'#EAEEF3', tag:''}]
      : [{k:'Account', v:acctShort||'Choose…', c: acctShort?'#EAEEF3':'#5A616B', tag: acctShort?FROM:''},
         {k:'Instrument', v:s.sym||'Choose…', c: s.sym?'#EAEEF3':'#5A616B', tag: s.sym?FROM:''},
         {k:'Shares', v:'0', c:'#5A616B', tag:''},
         {k:'Price / share', v: s.sym?this.usd(px[s.sym][last]):'$0.00', c: s.sym?'#EAEEF3':'#5A616B', tag: s.sym?'live':''},
         {k:'Date', v:'Aug 1, 2026', c:'#EAEEF3', tag:''}];
    if(s.txnType==='sell' && s.sym){
      const held=d.keys.filter(k=>k.sym===s.sym&&(!s.acct||k.acct===s.acct)).reduce((a,k)=>a+k.shares[last],0);
      txnFields[2]={k:'Shares', v:'0 of '+this.shq(held)+' held', c:'#5A616B', tag: s.acct?'in this account':'all accounts'};
    }
    txnFields.forEach(f=>{ const on=!!f.tag; f.tagPad= on?'3px 7px':'0'; f.tagBg= on?'#18211B':'transparent'; f.tagFg= on?'#8FBFA1':'transparent'; });
    const txnCta='Record '+s.txnType+(!isCash&&s.sym?' · '+s.sym:'')+(acctShort?' → '+acctShort:'');

    const af=this.filt();
    const acts=d.txns.filter(t=>{
      if(af.accts && af.accts.indexOf(t.acct)<0) return false;
      if(af.syms && t.sym!==af.syms[0]) return false;
      return true; });
    const groups=[]; let gcur=null;
    acts.forEach(t=>{
      const dt=d.dates[t.day], key=dt.getFullYear()+'-'+dt.getMonth();
      if(!gcur||gcur.key!==key){ gcur={key, label:dt.toLocaleDateString('en-US',{month:'long',year:'numeric'}), rows:[], netv:0}; groups.push(gcur); }
      const a=ACCTS.find(x=>x.id===t.acct);
      const badge = t.type==='buy'?'BUY': t.type==='sell'?'SELL': t.type==='deposit'?'DEP':'WDL';
      const bg = t.type==='buy'?'#152018': t.type==='sell'?'#231519': t.type==='deposit'?'#151A24':'#1C1A15';
      const fg = t.type==='buy'?'#8FBFA1': t.type==='sell'?'#D99AA2': t.type==='deposit'?'#9DB4D9':'#C7B48A';
      gcur.netv += (t.type==='buy'||t.type==='withdraw')? -t.amount : t.amount;
      gcur.rows.push({badge, badgeBg:bg, badgeFg:fg,
        t1: t.sym? t.sym+' · '+this.shq(t.qty)+' @ '+this.usd(t.price) : (t.type==='deposit'?'Cash deposit':'Cash withdrawal'),
        t2: a.short+' · '+dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),
        v1: (t.type==='buy'||t.type==='withdraw'?'−':'+')+this.usd(t.amount,0),
        v2: t.realized!==null? this.signed(t.realized)+' realized' : '',
        v2c: t.realized!==null? (t.realized>=0?accent:DOWN) : '#6C737D'});
    });
    const actGroups=groups.map(g=>({label:g.label, rows:g.rows, net:this.signed(g.netv)+' net', netc: g.netv>=0?accent:DOWN}));

    const matAccts=['a1','a2','a3','a4'];
    const matCols=matAccts.map(id=>({label:ACCTS.find(a=>a.id===id).short, onTap:()=>this.gotoAcct(id,'portfolio')}));
    const matRows=st.merged.slice(0,7).map(m=>({ sym:m.sym, onTap:()=>this.slice(m.sym,null),
      cells: matAccts.map(aid=>{ const k=d.keys.find(x=>x.acct===aid&&x.sym===m.sym);
        const v=k?k.shares[last]*px[m.sym][last]:0;
        return v>0? {v:'$'+Math.round(v/1000)+'k', bg:'#0E1115', fg:'#DDE3EA', cur:'pointer', onTap:()=>this.slice(m.sym,aid)}
                  : {v:'·', bg:'#0B0E11', fg:'#3A4048', cur:'default', onTap:null}; })}));
    const allocSegs=st.allocSegs.map(sg=>Object.assign({}, sg, {onTap:()=>this.gotoAcct(sg.id,'portfolio')}));
    const acctRowsG=st.acctRows.map(a=>Object.assign({}, a, {onTap:()=>this.gotoAcct(a.id,'portfolio')}));

    const navTabs=[['portfolio','Portfolio'],['grid','Grid'],['activity','Activity']].map(([k,label])=>({
      label, dot: s.nav===k?accent:'transparent', fg: s.nav===k?'#F2F4F7':'#5F666F',
      onTap:()=>this.setState({nav:k, sheet:null, scrubbing:false, scrubIdx:null})}));

    return Object.assign({
      accent,
      pfDisp: s.nav==='portfolio'?'flex':'none', gridDisp: s.nav==='grid'?'flex':'none', actDisp: s.nav==='activity'?'flex':'none',
      fabDisp: (s.nav==='grid'||s.sOpen)?'none':'flex', navTabs,
      chips, allChipDisp: chips.length?'none':'flex',
      openAccts:()=>this.setState({sheet:'accts'}), openMetric:()=>this.setState({sheet:'metric'}),
      openGran:()=>this.setState({sheet:'gran'}),
      openTxn:()=>this.setState({sheet:'txn', txnType:(s.acct && !s.sym && !this.hasInstr(s.acct))?'deposit':'buy'}),
      closeSheet:()=>this.setState({sheet:null}),
      openSearch:this.openSearch,
      metricLabel: mDef.label + (flow?' · booked in range':(s.sym||s.acct?'':' · whole portfolio')),
      bigValue: (flow && mode==='latest')? this.signed(flowTotal) : this.metricVal(vals[Math.min(vi,li)]),
      deltaMain, deltaSub, deltaColor,
      pathD, areaD, bars, isBars, isLine:!isBars,
      baseY: (s.metric==='realized_gain'||s.metric==='unrealized_gain')? zeroY.toFixed(1) : Y(v0).toFixed(1),
      cross, pins, pinBand,
      ranges: RANGES.map(r=>({k:r.k, fg: s.rangeKey===r.k?'#0A0B0D':'#8A9099', bg: s.rangeKey===r.k?accent:'transparent',
        onTap:()=>this.setState({rangeKey:r.k, gran:null, pinA:null, pinB:null, scrubIdx:null})})),
      granLabel:(s.gran||AUTOGRAN[s.rangeKey]).replace(/^./,c=>c.toUpperCase()),
      cumDisp: s.metric==='realized_gain'?'block':'none',
      setPer:()=>this.setState({cum:false, pinA:null, pinB:null}), setCum:()=>this.setState({cum:true, pinA:null, pinB:null}),
      perBg: s.cum?'transparent':'#20252C', perFg: s.cum?'#6C737D':'#F2F4F7',
      cumBg: s.cum?'#20252C':'transparent', cumFg: s.cum?'#F2F4F7':'#6C737D',
      hint: s.pinA!==null? (s.pinB!==null?'A → B compare · tap to reset':'Pinned · tap another point to compare') : 'Drag the chart to scrub · tap to pin',
      tabsDisp: (s.level==='portfolio' && !s.sym)?'flex':'none',
      tabHold:()=>this.setState({tab:'holdings'}), tabAcct:()=>this.setState({tab:'accounts'}),
      tabHoldBg: s.tab==='holdings'?'#20252C':'transparent', tabHoldFg: s.tab==='holdings'?'#F2F4F7':'#6C737D',
      tabAcctBg: s.tab==='accounts'?'#20252C':'transparent', tabAcctFg: s.tab==='accounts'?'#F2F4F7':'#6C737D',
      nHold: st.merged.length, nAcct: ACCTS.length,
      rows, sectionTitle, secDisp: sectionTitle?'block':'none', statCard, stats, emptyMsg, emptySub,
      hasClosed: this.props.showClosed!==false && closedRows.length>0, nClosed: closedRows.length,
      closedRows: s.showClosed?closedRows:[], closedCaret: s.showClosed?'Hide':'Show',
      toggleClosed:()=>this.setState({showClosed:!s.showClosed}),
      chartRef:(el)=>{this._chart=el;}, onDown:this.onDown, onMove:this.onMove, onUp:this.onUp, onLeave:this.onLeave,
      listSheet: !!s.sheet && s.sheet!=='txn', isTxn: s.sheet==='txn', sheetRows, txnTypes, txnFields, txnCta,
      ctxChips: chips.map(c=>({label:c.label, bg:c.bg, bd:c.bd, fg:c.fg})),
      ctxLabel: chips.length?'In context':'', ctxPad: chips.length?'11px 12px':'0', ctxMb: chips.length?'14px':'0',
      ctxBg: chips.length?'#0E1319':'transparent', ctxBd: chips.length?'#1C2530':'transparent',
      txnNote: chips.length? 'Prefilled from the view you opened this from — tap either row to change it. The cash side posts to the same account automatically.'
        : 'Nothing prefilled: you opened this from the whole-portfolio view. Drill into an account or instrument first and it comes in filled.',
      sheetTitle: s.sheet==='metric'?'Metric' : s.sheet==='gran'?'Granularity' : s.sheet==='accts'?'Accounts'
        : (s.sym&&acctShort)?'Add '+s.sym+' in '+acctShort : acctShort?'Add to '+acctShort : s.sym?'Add '+s.sym+' transaction':'Add transaction',
      sheetSub: s.sheet==='metric'?'Applies to the current slice and chart.' : s.sheet==='gran'?'Range stays '+s.rangeKey+'. Only valid buckets are selectable.'
        : s.sheet==='accts'?'Pick one, or stay on the whole portfolio.' : 'Manual entry — the only way data gets in.',
      actGroups, actEmpty: actGroups.length===0,
      actScope: chips.length? acts.length+' matching' : acts.length+' transactions',
      totalStr:this.money(st.total), totalDelta:st.totalDelta, allocSegs, matCols, matRows, acctRows:acctRowsG
    }, this.searchVals(accent));
  }
}

