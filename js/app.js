/* Ganesh Pooja Expense Portal — Supabase-backed, role-based access
   Roles: super_admin (full access), treasurer (expenses),
   donation_collector (donations + flat owner/tenant edits), viewer (read-only). */

const SUPABASE_URL = 'https://tzcernzuwtwgrsattjaw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_qTZL-nfangfMUqdBcBvgww_q_ucMvXR';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CATEGORIES = ['Pooja Samagri','Idol & Decoration','Prasad & Food','Sound & Lighting','Flowers & Decoration','Cleaning & Sanitation','Priest / Purohit','Miscellaneous'];
const FLATS_PER_FLOOR = 18;   // units per floor
const FLOOR_COUNT = 4;        // G + 3 (Ground, 1st, 2nd, 3rd)
const DEFAULT_FLAT_COUNT = FLATS_PER_FLOOR * FLOOR_COUNT; // 72

// Index (1-based) -> flat label, "G+3" numbering pattern:
// Ground 1-18 -> A001..A018, 1st -> A101..A118, 2nd -> A201..A218, 3rd -> A301..A318.
function flatLabelForIndex(i){
  const floor = Math.floor((i-1)/FLATS_PER_FLOOR);
  const unit = ((i-1)%FLATS_PER_FLOOR)+1;
  const number = floor*100 + unit;
  return 'A' + String(number).padStart(3,'0');
}

function fmtINR(n){ return '₹' + Math.round(Number(n)||0).toLocaleString('en-IN'); }
function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso+'T00:00:00');
  if(isNaN(d)) return iso;
  return d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
/* Simple dependency-free SVG donut chart. segments: [{value,color}] */
function buildDonutSVG(segments, size, thickness){
  size = size || 150; thickness = thickness || 20;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size/2, cy = size/2;
  const total = segments.reduce((s,x)=>s+x.value,0);
  if(!total){
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#E2E8F0" stroke-width="${thickness}"/></svg>`;
  }
  let offset = 0;
  const arcs = segments.filter(s=>s.value>0).map(s=>{
    const len = (s.value/total) * c;
    const dashoffset = -offset;
    offset += len;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness}" stroke-dasharray="${len} ${c-len}" stroke-dashoffset="${dashoffset}" stroke-linecap="butt" transform="rotate(-90 ${cx} ${cy})"/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}</svg>`;
}
function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const ROLE_LABELS = { super_admin:'Super Admin', treasurer:'Treasurer', donation_collector:'Donation Collector', viewer:'Viewer' };
function displayName(p){ return (p && (p.full_name || p.email)) || 'Unassigned'; }

/* ---------- activity log: best-effort, never blocks the action it logs ---------- */
async function logActivity(action, details){
  if(!profile) return;
  try{
    await sb.from('ganesh_activity_log').insert({ actor: profile.id, actor_name: displayName(profile), action, details: details||'' });
  }catch(e){ console.error('activity log failed', e); }
}

/* ---- session / profile / data store ---- */
let session = null;
let profile = null;         // { id, email, full_name, role }
let perms = { isAdmin:false, canDonations:false, canExpenses:false, canEditFlats:false };
const store = { flats:[], donations:[], expenses:[], settings:{committee_name:'Ganesh Pooja Committee'}, profiles:[], sevaDays:[], sevaSignups:[], fundTransfers:[], budgets:[], openingBalances:[], activityLog:[] };
const BUDGET_COLORS = ['#F97316','#2563EB','#16A34A','#DC2626','#9333EA','#0EA5E9','#CA8A04','#DB2777','#0D9488','#64748B','#EA580C','#4F46E5'];

/* ---- transient UI state (not persisted) ---- */
const ui = {
  screen:'dashboard',
  year: String(new Date().getFullYear()),
  flatsFilter:'all',
  flatsSearch:'',
  txnFilter:'all',
  editingFlatId:null,
  authMode:'signin',
};

/* ============================================================
   AUTH
   ============================================================ */
function computePerms(){
  const role = profile ? profile.role : null;
  perms.isAdmin = role === 'super_admin';
  perms.canDonations = perms.isAdmin || role === 'donation_collector';
  perms.canExpenses = perms.isAdmin || role === 'treasurer';
  perms.canEditFlats = perms.canDonations;
}

function hideLoadingOverlay(){
  document.getElementById('loadingOverlay').classList.add('hidden');
}
function showAuthScreen(msg){
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('appRoot').classList.add('hidden');
  hideLoadingOverlay();
  if(msg) setAuthError(msg);
}
function showApp(){
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appRoot').classList.remove('hidden');
  hideLoadingOverlay();
}
function setAuthError(msg){
  const el = document.getElementById('authError');
  if(!msg){ el.classList.add('hidden'); el.textContent=''; return; }
  el.textContent = msg; el.classList.remove('hidden');
}

async function fetchProfile(userId, retries){
  retries = retries === undefined ? 5 : retries;
  for(let i=0;i<retries;i++){
    const { data, error } = await sb.from('ganesh_profiles').select('*').eq('id', userId).maybeSingle();
    if(error){
      if(i === retries-1) throw error;
    } else if(data){
      return data;
    }
    await new Promise(r=>setTimeout(r, 400));
  }
  return null;
}

async function afterLogin(){
  try{
    profile = await fetchProfile(session.user.id);
    if(!profile){
      showAuthScreen('Your account was created but no profile was found. Please contact your Super Admin.');
      await sb.auth.signOut();
      return;
    }
  }catch(e){
    console.error(e);
    showAuthScreen('Could not load your account. Has the database setup (SQL script) been run in Supabase yet?');
    await sb.auth.signOut();
    return;
  }
  computePerms();
  try{
    await fetchAllData();
  }catch(e){
    console.error(e);
    showAuthScreen('Signed in, but could not load data. Has the database setup (SQL script) been run in Supabase yet?');
    await sb.auth.signOut();
    return;
  }
  showApp();
  applyRoleVisibility();
  renderAll();
  subscribeRealtime();
}

/* ---------- realtime: auto-refresh when anyone else changes data ---------- */
let realtimeChannel = null;
let realtimeRefreshTimer = null;
function scheduleRealtimeRefresh(){
  clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = setTimeout(async ()=>{
    try{
      await fetchAllData();
      renderAll();
    }catch(e){ console.error('Realtime refresh failed', e); }
  }, 700);
}
function subscribeRealtime(){
  if(realtimeChannel) return;
  const tables = ['ganesh_flats','ganesh_donations','ganesh_expenses','ganesh_settings','ganesh_profiles','ganesh_prasadam_days','ganesh_prasadam_signups','ganesh_fund_transfers'];
  realtimeChannel = sb.channel('gpep-changes');
  tables.forEach(table=>{
    realtimeChannel.on('postgres_changes', { event:'*', schema:'public', table }, scheduleRealtimeRefresh);
  });
  realtimeChannel.subscribe();
}
function unsubscribeRealtime(){
  if(realtimeChannel){ sb.removeChannel(realtimeChannel); realtimeChannel = null; }
  clearTimeout(realtimeRefreshTimer);
}

document.getElementById('authTabSignIn').addEventListener('click', ()=>setAuthMode('signin'));
document.getElementById('authTabSignUp').addEventListener('click', ()=>setAuthMode('signup'));
function setAuthMode(mode){
  ui.authMode = mode;
  document.getElementById('authTabSignIn').classList.toggle('active', mode==='signin');
  document.getElementById('authTabSignUp').classList.toggle('active', mode==='signup');
  document.getElementById('authNameField').hidden = mode!=='signup';
  document.getElementById('authSubmitBtn').textContent = mode==='signin' ? 'Sign In' : 'Sign Up';
  document.getElementById('authPassword').setAttribute('autocomplete', mode==='signin' ? 'current-password' : 'new-password');
  setAuthError(null);
}

document.getElementById('authSubmitBtn').addEventListener('click', async ()=>{
  setAuthError(null);
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const fullName = document.getElementById('authName').value.trim();
  if(!email || !password){ setAuthError('Please enter your email and password.'); return; }
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;
  try{
    if(ui.authMode === 'signin'){
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if(error){ setAuthError(error.message); }
    } else {
      const { data, error } = await sb.auth.signUp({ email, password, options:{ data:{ full_name: fullName || email, app: 'gpep' } } });
      if(error){ setAuthError(error.message); }
      else if(data && !data.session){
        setAuthError('Account created. Please check your email to confirm before signing in.');
      }
    }
  }catch(e){
    setAuthError(e.message || 'Something went wrong.');
  }finally{
    btn.disabled = false;
  }
});

async function doLogout(){
  await sb.auth.signOut();
}
document.getElementById('logoutBtn').addEventListener('click', doLogout);
document.getElementById('logoutBtnMobile').addEventListener('click', doLogout);

sb.auth.onAuthStateChange((event, s)=>{
  session = s;
  if(event === 'SIGNED_IN'){
    afterLogin();
  } else if(event === 'SIGNED_OUT'){
    profile = null;
    unsubscribeRealtime();
    showAuthScreen();
    document.getElementById('authEmail').value='';
    document.getElementById('authPassword').value='';
  }
});

(async function init(){
  const { data: { session: s } } = await sb.auth.getSession();
  session = s;
  if(session){ await afterLogin(); } else { showAuthScreen(); }
})();

/* ============================================================
   DATA FETCHING
   ============================================================ */
async function fetchAllData(){
  const [flatsRes, donationsRes, expensesRes, settingsRes, sevaDaysRes, sevaSignupsRes, transfersRes, budgetsRes, openingRes] = await Promise.all([
    sb.from('ganesh_flats').select('*').order('id'),
    sb.from('ganesh_donations').select('*').order('date',{ascending:false}),
    sb.from('ganesh_expenses').select('*').order('date',{ascending:false}),
    sb.from('ganesh_settings').select('*').eq('id',1).maybeSingle(),
    sb.from('ganesh_prasadam_days').select('*').order('seva_date'),
    sb.from('ganesh_prasadam_signups').select('*').order('created_at'),
    sb.from('ganesh_fund_transfers').select('*').order('created_at',{ascending:false}),
    sb.from('ganesh_budgets').select('*'),
    sb.from('ganesh_opening_balances').select('*'),
  ]);
  if(flatsRes.error) throw flatsRes.error;
  if(donationsRes.error) throw donationsRes.error;
  if(expensesRes.error) throw expensesRes.error;

  store.flats = flatsRes.data || [];
  store.donations = (donationsRes.data||[]).map(d=>Object.assign({}, d, { amount:Number(d.amount) }));
  store.expenses = (expensesRes.data||[]).map(e=>Object.assign({}, e, { amount:Number(e.amount) }));
  store.settings = settingsRes.data || { committee_name:'Ganesh Pooja Committee' };
  store.sevaDays = sevaDaysRes.data || [];
  store.sevaSignups = sevaSignupsRes.data || [];
  store.fundTransfers = (transfersRes.data||[]).map(t=>Object.assign({}, t, { amount:Number(t.amount) }));
  store.budgets = (budgetsRes.data||[]).map(b=>Object.assign({}, b, { amount:Number(b.amount), pct: b.pct==null?null:Number(b.pct) }));
  store.openingBalances = (openingRes.data||[]).map(o=>Object.assign({}, o, { amount:Number(o.amount) }));

  if(perms.isAdmin || perms.canExpenses){
    const { data: profs, error: profErr } = await sb.from('ganesh_profiles').select('*').order('email');
    if(!profErr) store.profiles = profs || [];
  } else {
    store.profiles = [];
  }

  if(perms.canExpenses){
    const { data: log, error: logErr } = await sb.from('ganesh_activity_log').select('*').order('created_at',{ascending:false}).limit(200);
    if(!logErr) store.activityLog = log || [];
  } else {
    store.activityLog = [];
  }
}

/* ============================================================
   DERIVED VIEW DATA
   ============================================================ */
function yearOf(iso){ return (iso||'').slice(0,4); }

function balanceOf(year, allDonations, allExpenses){
  const yDonations = allDonations.filter(d=>yearOf(d.date)===year);
  const yExpenses = allExpenses.filter(e=>yearOf(e.date)===year);
  const collected = yDonations.reduce((s,d)=>s+d.amount,0);
  const spent = yExpenses.reduce((s,e)=>s+e.amount,0);
  const openingRow = store.openingBalances.find(o=>o.year===year);
  const opening = openingRow ? Number(openingRow.amount)||0 : 0;
  return { collected, spent, opening, balance: opening + collected - spent };
}

function computeView(){
  const donations = store.donations.filter(d => yearOf(d.date)===ui.year);
  const expenses = store.expenses.filter(e => yearOf(e.date)===ui.year);
  const totalCollected = donations.reduce((s,d)=>s+d.amount,0);
  const totalExpenses = expenses.reduce((s,e)=>s+e.amount,0);
  const openingBalanceRow = store.openingBalances.find(o=>o.year===ui.year);
  const openingBalance = openingBalanceRow ? Number(openingBalanceRow.amount)||0 : 0;
  const balance = openingBalance + totalCollected - totalExpenses;

  const contributedIds = new Set(donations.map(d=>d.flat_id));
  const totalFlats = store.flats.length;
  const contributedCount = store.flats.filter(f=>contributedIds.has(f.id)).length;
  const notContributedCount = totalFlats - contributedCount;
  const contributedPct = totalFlats ? Math.round(contributedCount/totalFlats*100) : 0;
  const maxIE = Math.max(totalCollected, totalExpenses, 1);

  const donationTx = donations.map(d=>{
    const f = store.flats.find(x=>x.id===d.flat_id);
    const isInKind = d.kind === 'in_kind';
    const amountDisplay = (isInKind && !(d.amount>0)) ? '🎁 '+(d.item_description||'Item') : fmtINR(d.amount);
    const signedDisplay = (isInKind && !(d.amount>0)) ? '🎁 '+(d.item_description||'Item') : '+'+fmtINR(d.amount);
    return {
      id:d.id, type:'in', typeLabel:'Money In',
      title:(f?f.label:d.flat_id)+' • '+d.name,
      subtitle: isInKind ? 'In-Kind • '+(d.item_description||'Item') : 'Donation • '+d.mode,
      mode: isInKind ? 'In-Kind' : d.mode, kind: d.kind, itemDescription: d.item_description,
      amount:d.amount, amountFmt:amountDisplay, amountSigned:signedDisplay, color:'#16A34A',
      date:d.date, dateFmt:fmtDate(d.date), ts:d.created_at || d.date,
      flatLabel: f?f.label:d.flat_id, donorName:d.name, note:d.note||'', collectedByName:d.collected_by_name||'',
    };
  });
  const expenseTx = expenses.map(e=>({
    id:e.id, type:'out', typeLabel:'Money Out',
    title:e.category, description:e.description,
    subtitle:e.description+' • '+e.mode, mode:e.mode,
    amount:e.amount, amountFmt:fmtINR(e.amount), amountSigned:'-'+fmtINR(e.amount), color:'#DC2626',
    date:e.date, dateFmt:fmtDate(e.date), ts:e.created_at || e.date,
    billUrl: e.bill_url || null,
  }));
  const transactions = donationTx.concat(expenseTx).sort((a,b)=> (b.ts>a.ts?1:-1));
  const recentTransactions = transactions.slice(0,5);

  let filteredTransactions = transactions;
  if(ui.txnFilter==='in') filteredTransactions = transactions.filter(t=>t.type==='in');
  if(ui.txnFilter==='out') filteredTransactions = transactions.filter(t=>t.type==='out');

  const donationsSorted = [...donationTx].sort((a,b)=> (b.ts>a.ts?1:-1));
  const expensesSorted = [...expenseTx].sort((a,b)=> (b.ts>a.ts?1:-1));

  const catTotals = {};
  expenses.forEach(e=>{ catTotals[e.category] = (catTotals[e.category]||0) + e.amount; });
  const catMax = Math.max(1, ...Object.values(catTotals), 1);
  const categoryBreakdown = Object.keys(catTotals).sort((a,b)=>catTotals[b]-catTotals[a]).map(cat=>({
    category:cat, amount:catTotals[cat], amountFmt:fmtINR(catTotals[cat]), pct: Math.round(catTotals[cat]/catMax*100),
  }));

  // ---- Category budgets: planned (₹ or % of this year's collections) vs actually spent ----
  const budgetRows = store.budgets.filter(b => b.year === ui.year);
  const budgetMap = {};
  budgetRows.forEach(b=>{
    const allocated = b.mode === 'percent' ? Math.round(((Number(b.pct)||0)/100) * totalCollected) : Number(b.amount)||0;
    budgetMap[b.category] = { allocated, mode:b.mode, pct:b.pct, amount:b.amount };
  });
  const budgetCatNames = Array.from(new Set([...Object.keys(budgetMap), ...Object.keys(catTotals)]));
  let budgetColorIdx = 0;
  const budgetColorFor = {};
  budgetCatNames.forEach(cat=>{ budgetColorFor[cat] = BUDGET_COLORS[budgetColorIdx++ % BUDGET_COLORS.length]; });
  const budgetBreakdown = budgetCatNames.map(cat=>{
    const b = budgetMap[cat];
    const allocated = b ? b.allocated : 0;
    const used = catTotals[cat] || 0;
    const pctUsed = allocated>0 ? Math.round(used/allocated*100) : (used>0 ? 100 : 0);
    const remaining = allocated - used;
    let status = 'none';
    if(allocated>0) status = used>allocated ? 'over' : (pctUsed>=80 ? 'warn' : 'ok');
    else if(used>0) status = 'unbudgeted';
    return {
      category:cat, allocated, allocatedFmt:fmtINR(allocated), used, usedFmt:fmtINR(used),
      remaining, remainingFmt:fmtINR(Math.abs(remaining)), pctUsed:Math.min(pctUsed,999), status,
      mode: b?b.mode:null, pctPlanned: b?b.pct:null, color: budgetColorFor[cat],
      hasBudget: !!b,
    };
  }).sort((a,b)=> b.allocated-a.allocated || b.used-a.used);
  const totalBudgetAllocated = Object.values(budgetMap).reduce((s,x)=>s+x.allocated,0);
  const budgetDonutSegments = budgetBreakdown.filter(c=>c.allocated>0).map(c=>({ value:c.allocated, color:c.color, label:c.category }));
  const overallBudgetPctUsed = totalBudgetAllocated>0 ? Math.round(totalExpenses/totalBudgetAllocated*100) : null;

  const collectedTotals = {};
  donations.forEach(d=>{ const who = d.collected_by_name || 'Unassigned'; collectedTotals[who] = (collectedTotals[who]||0) + d.amount; });
  const collectedMax = Math.max(1, ...Object.values(collectedTotals), 1);
  const collectedByBreakdown = Object.keys(collectedTotals).sort((a,b)=>collectedTotals[b]-collectedTotals[a]).map(who=>({
    person:who, amount:collectedTotals[who], amountFmt:fmtINR(collectedTotals[who]), pct: Math.round(collectedTotals[who]/collectedMax*100),
  }));

  const recordedTotals = {};
  expenses.forEach(e=>{ const who = e.recorded_by_name || 'Unassigned'; recordedTotals[who] = (recordedTotals[who]||0) + e.amount; });
  const recordedMax = Math.max(1, ...Object.values(recordedTotals), 1);
  const recordedByBreakdown = Object.keys(recordedTotals).sort((a,b)=>recordedTotals[b]-recordedTotals[a]).map(who=>({
    person:who, amount:recordedTotals[who], amountFmt:fmtINR(recordedTotals[who]), pct: Math.round(recordedTotals[who]/recordedMax*100),
  }));

  // Fund custody: who is currently holding how much (collected − spent − handed off + received)
  const transfers = store.fundTransfers.filter(t => yearOf(t.date)===ui.year);
  const custody = {};
  donations.forEach(d=>{ const who = d.collected_by_name || 'Unassigned'; custody[who] = (custody[who]||0) + d.amount; });
  expenses.forEach(e=>{ const who = e.recorded_by_name || 'Unassigned'; custody[who] = (custody[who]||0) - e.amount; });
  transfers.forEach(t=>{
    const from = t.from_user_name || 'Unassigned', to = t.to_user_name || 'Unassigned';
    custody[from] = (custody[from]||0) - t.amount;
    custody[to] = (custody[to]||0) + t.amount;
  });
  const custodyMax = Math.max(1, ...Object.values(custody).map(Math.abs), 1);
  const custodyBreakdown = Object.keys(custody)
    .filter(who => Math.round(custody[who])!==0)
    .sort((a,b)=>custody[b]-custody[a])
    .map(who=>({
      person:who, amount:custody[who], amountFmt: (custody[who]<0?'-':'')+fmtINR(Math.abs(custody[who])),
      isNegative: custody[who]<0, pct: Math.round(Math.abs(custody[who])/custodyMax*100),
    }));

  const recentTransfers = [...transfers].sort((a,b)=> (b.created_at>a.created_at?1:-1)).slice(0,5).map(t=>({
    id:t.id, title: t.from_user_name+' → '+t.to_user_name, subtitle: 'Fund transfer'+(t.note?' • '+t.note:''),
    amountFmt: fmtINR(t.amount), dateFmt: fmtDate(t.date),
  }));

  let flatsWithData = store.flats.map(f=>{
    const fd = donations.filter(x=>x.flat_id===f.id);
    const contribution = fd.reduce((s,x)=>s+x.amount,0);
    const contributed = fd.length>0; // counts cash AND in-kind (item) contributions
    const inKindOnly = contributed && contribution===0;
    return Object.assign({}, f, {
      contribution, contributionFmt: inKindOnly ? 'In-Kind' : fmtINR(contribution), contributed,
      statusColor: contributed?'#16A34A':'#DC2626', statusText: contributed?'Contributed':'Not Contributed',
    });
  });
  let filteredFlats = flatsWithData;
  if(ui.flatsFilter==='contributed') filteredFlats = filteredFlats.filter(f=>f.contributed);
  if(ui.flatsFilter==='not') filteredFlats = filteredFlats.filter(f=>!f.contributed);
  if(ui.flatsSearch.trim()){
    const q = ui.flatsSearch.trim().toLowerCase();
    filteredFlats = filteredFlats.filter(f =>
      f.label.toLowerCase().includes(q) ||
      (f.owner||'').toLowerCase().includes(q) ||
      (f.tenant||'').toLowerCase().includes(q)
    );
  }

  // ---- This year vs last year comparison ----
  const prevYear = String(Number(ui.year)-1);
  const prevHasData = store.donations.some(d=>yearOf(d.date)===prevYear) || store.expenses.some(e=>yearOf(e.date)===prevYear);
  function pctDelta(curr, prev){
    if(!prev) return curr>0 ? null : 0;
    return Math.round(((curr-prev)/Math.abs(prev))*100);
  }
  let yearComparison = null;
  if(prevHasData){
    const prevB = balanceOf(prevYear, store.donations, store.expenses);
    const prevContributedIds = new Set(store.donations.filter(d=>yearOf(d.date)===prevYear).map(d=>d.flat_id));
    const prevContributedCount = store.flats.filter(f=>prevContributedIds.has(f.id)).length;
    const prevContributedPct = totalFlats ? Math.round(prevContributedCount/totalFlats*100) : 0;
    yearComparison = {
      prevYear,
      collected: totalCollected, prevCollected: prevB.collected,
      collectedFmt: fmtINR(totalCollected), prevCollectedFmt: fmtINR(prevB.collected),
      collectedDelta: pctDelta(totalCollected, prevB.collected),
      expenses: totalExpenses, prevExpenses: prevB.spent,
      expensesFmt: fmtINR(totalExpenses), prevExpensesFmt: fmtINR(prevB.spent),
      expensesDelta: pctDelta(totalExpenses, prevB.spent),
      balance, prevBalance: prevB.balance,
      balanceFmt: fmtINR(balance), prevBalanceFmt: fmtINR(prevB.balance),
      balanceDelta: pctDelta(balance, prevB.balance),
      contributedPct, prevContributedPct,
      contributedPctDelta: contributedPct - prevContributedPct,
    };
  }

  return {
    totalCollected, totalExpenses, balance, openingBalance,
    contributedCount, notContributedCount, totalFlats, contributedPct, maxIE,
    recentTransactions, filteredTransactions, donationsSorted, expensesSorted,
    categoryBreakdown, collectedByBreakdown, recordedByBreakdown,
    budgetBreakdown, budgetDonutSegments, totalBudgetAllocated, overallBudgetPctUsed,
    custodyBreakdown, recentTransfers, yearComparison,
    filteredFlats, hasData: donations.length>0 || expenses.length>0,
  };
}

/* ============================================================
   RENDERING
   ============================================================ */
const SCREENS = ['dashboard','flats','donations','expenses','transactions','prasadam'];
const SEVA_SESSIONS = [{ key:'morning', label:'Morning', icon:'🌅' }, { key:'evening', label:'Evening', icon:'🌇' }];

function renderNav(){
  document.querySelectorAll('.nav-btn, .bn-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.screen===ui.screen);
  });
  SCREENS.forEach(s=>{
    const el = document.getElementById('screen-'+s);
    if(el) el.hidden = (s!==ui.screen);
  });
  const titles = {dashboard:'Ganesh Pooja Portal', flats:'Flats', donations:'Donations', expenses:'Expenses', transactions:'Transactions', prasadam:'Prasadam Seva'};
  document.getElementById('topbarTitle').textContent = titles[ui.screen] || 'Ganesh Pooja Portal';
}

function renderYearSelect(){
  const sel = document.getElementById('yearSelect');
  const years = new Set([String(new Date().getFullYear())]);
  store.donations.forEach(d=>years.add(yearOf(d.date)));
  store.expenses.forEach(e=>years.add(yearOf(e.date)));
  years.add(ui.year);
  const sorted = Array.from(years).filter(Boolean).sort((a,b)=>b.localeCompare(a));
  sel.innerHTML = sorted.map(y=>`<option value="${y}"${y===ui.year?' selected':''}>${y}</option>`).join('');
}

function renderDashboard(v){
  document.getElementById('dashTitle').textContent = (store.settings.committee_name || 'Ganesh Pooja') + ' ' + ui.year;
  const hasData = v.hasData;
  document.getElementById('dashHasData').classList.toggle('hidden', !hasData);
  document.getElementById('dashNoData').classList.toggle('hidden', hasData);
  document.getElementById('dashNoDataTitle').textContent = 'No data for ' + ui.year + ' yet';
  if(!hasData) return;

  document.getElementById('statCollected').textContent = fmtINR(v.totalCollected);
  document.getElementById('statExpenses').textContent = fmtINR(v.totalExpenses);
  document.getElementById('statBalance').textContent = fmtINR(v.balance);
  document.getElementById('statFlats').textContent = v.contributedCount+' / '+v.totalFlats;
  const balHint = document.getElementById('statBalanceHint');
  balHint.classList.toggle('hidden', !v.openingBalance);
  balHint.textContent = v.openingBalance ? 'Includes '+fmtINR(v.openingBalance)+' opening balance' : '';

  document.getElementById('flatsProgressTitle').textContent = v.contributedCount+' / '+v.totalFlats+' Flats Contributed';
  document.getElementById('flatsProgressBar').style.width = v.contributedPct+'%';
  document.getElementById('legendContributed').textContent = v.contributedCount+' Contributed';
  document.getElementById('legendNotContributed').textContent = v.notContributedCount+' Not Contributed';

  document.getElementById('incomeAmt').textContent = fmtINR(v.totalCollected);
  document.getElementById('expenseAmt').textContent = fmtINR(v.totalExpenses);
  document.getElementById('incomeBar').style.width = Math.round(v.totalCollected/v.maxIE*100)+'%';
  document.getElementById('expenseBar').style.width = Math.round(v.totalExpenses/v.maxIE*100)+'%';

  document.getElementById('custodyBreakdown').innerHTML = v.custodyBreakdown.map(c=>`
    <div>
      <div class="stack-row"><span>${escapeHtml(c.person)}</span><span class="${c.isNegative?'red':'green'}">${c.amountFmt}</span></div>
      <div class="bar-track"><div class="bar-fill ${c.isNegative?'red':'green'}" style="width:${c.pct}%"></div></div>
    </div>
  `).join('') || '<p class="empty-sub">Nothing collected or spent yet for '+ui.year+'.</p>';
  document.getElementById('recentTransfersList').innerHTML = v.recentTransfers.map(t=>`
    <div class="txn-row">
      <div class="txn-left">
        <span class="txn-dot" style="background:#2563EB"></span>
        <div>
          <div class="txn-title">${escapeHtml(t.title)}</div>
          <div class="txn-sub">${escapeHtml(t.subtitle)} · ${t.dateFmt}</div>
        </div>
      </div>
      <div class="txn-amt" style="color:#2563EB">${t.amountFmt}</div>
    </div>
  `).join('') || '<p class="empty-sub">No transfers recorded yet.</p>';

  document.getElementById('recentTxList').innerHTML = v.recentTransactions.map(tx=>`
    <div class="txn-row">
      <div class="txn-left">
        <span class="txn-dot" style="background:${tx.color}"></span>
        <div>
          <div class="txn-title">${escapeHtml(tx.title)}</div>
          <div class="txn-sub">${escapeHtml(tx.subtitle)}</div>
        </div>
      </div>
      <div class="txn-amt" style="color:${tx.color}">${tx.amountSigned}</div>
    </div>
  `).join('') || '<p class="empty-sub">No transactions yet.</p>';

  renderBudgetOverview(v);
  renderYearComparison(v);
}

function deltaTag(delta, goodDirection){
  // goodDirection: 'up' means higher is better (green when positive), 'down' means lower is better (green when negative)
  if(delta===null) return '<span class="compare-delta flat">NEW</span>';
  if(delta===0) return '<span class="compare-delta flat">NO CHANGE</span>';
  const isIncrease = delta>0;
  const isGood = goodDirection==='up' ? isIncrease : !isIncrease;
  const cls = isGood ? 'up' : 'down';
  const arrow = isIncrease ? '▲' : '▼';
  return `<span class="compare-delta ${cls}">${arrow} ${Math.abs(delta)}%</span>`;
}
function renderYearComparison(v){
  const panel = document.getElementById('yearComparePanel');
  const c = v.yearComparison;
  panel.classList.toggle('hidden', !c);
  if(!c) return;
  document.getElementById('yearCompareTitle').textContent = ui.year + ' vs ' + c.prevYear;
  document.getElementById('yearCompareGrid').innerHTML = `
    <div class="compare-row">
      <span class="name">Collected</span>
      <span class="figures"><span class="curr">${c.collectedFmt}</span> vs ${c.prevCollectedFmt}</span>
      ${deltaTag(c.collectedDelta,'up')}
    </div>
    <div class="compare-row">
      <span class="name">Expenses</span>
      <span class="figures"><span class="curr">${c.expensesFmt}</span> vs ${c.prevExpensesFmt}</span>
      ${deltaTag(c.expensesDelta,'down')}
    </div>
    <div class="compare-row">
      <span class="name">Balance</span>
      <span class="figures"><span class="curr">${c.balanceFmt}</span> vs ${c.prevBalanceFmt}</span>
      ${deltaTag(c.balanceDelta,'up')}
    </div>
    <div class="compare-row">
      <span class="name">Flats Contributed</span>
      <span class="figures"><span class="curr">${c.contributedPct}%</span> vs ${c.prevContributedPct}%</span>
      ${deltaTag(c.contributedPctDelta,'up')}
    </div>
  `;
}

const STATUS_LABEL = { ok:'ON TRACK', warn:'NEAR LIMIT', over:'OVER', unbudgeted:'NO BUDGET' };
function renderBudgetOverview(v){
  const hasAny = v.budgetBreakdown.some(c=>c.hasBudget);
  document.getElementById('budgetOverview').classList.toggle('hidden', !hasAny);
  document.getElementById('budgetEmpty').classList.toggle('hidden', hasAny);
  document.getElementById('budgetEmptyYear').textContent = ui.year;
  if(!hasAny) return;

  document.getElementById('budgetDonutWrap').innerHTML =
    buildDonutSVG(v.budgetDonutSegments, 150, 20) +
    `<div class="budget-donut-center">
       <div class="big">${v.overallBudgetPctUsed==null?'—':v.overallBudgetPctUsed+'%'}</div>
       <div class="small">OF BUDGET USED</div>
     </div>`;

  document.getElementById('budgetLegend').innerHTML = v.budgetBreakdown.filter(c=>c.allocated>0).map(c=>`
    <div class="budget-legend-row">
      <span class="dot" style="background:${c.color}"></span>
      <span class="name">${escapeHtml(c.category)}</span>
      <span>${c.allocatedFmt}</span>
    </div>
  `).join('') || '<p class="empty-sub">No categories budgeted yet.</p>';

  document.getElementById('budgetList').innerHTML = v.budgetBreakdown.map(c=>{
    const barColor = c.status==='over'?'red':c.status==='warn'?'amber':c.status==='ok'?'green':'slate';
    const rightText = c.hasBudget ? `${c.usedFmt} / ${c.allocatedFmt}` : `${c.usedFmt} (unbudgeted)`;
    return `
    <div class="budget-list-row">
      <div class="stack-row">
        <span>${escapeHtml(c.category)}<span class="budget-status-tag ${c.status}">${STATUS_LABEL[c.status]||''}</span></span>
        <span>${rightText}</span>
      </div>
      <div class="bar-track"><div class="bar-fill ${barColor}" style="width:${Math.min(c.pctUsed,100)}%"></div></div>
    </div>`;
  }).join('');
}

function renderFlats(v){
  document.getElementById('flatsCount').textContent = store.flats.length + ' units';
  document.querySelectorAll('#flatsFilterSeg .seg-btn').forEach(b=>b.classList.toggle('active', b.dataset.filter===ui.flatsFilter));
  document.getElementById('flatsSearch').value = ui.flatsSearch;

  const editBtn = (id) => perms.canEditFlats ? `<button class="item-card-edit" data-flat="${id}" title="Edit">✎</button>` : '';
  const editCell = (id) => perms.canEditFlats ? `<button class="row-edit-btn" data-flat="${id}" title="Edit">✎</button>` : '';

  const cardHtml = v.filteredFlats.map(f=>`
    <div class="item-card">
      <div>
        <div class="item-card-title">${escapeHtml(f.label)}</div>
        <div class="item-card-owner">Owner: ${escapeHtml(f.owner||'—')} · Tenant: ${escapeHtml(f.tenant||'—')}</div>
        <div class="item-card-title" style="margin-top:6px;font-size:13px">${f.contributionFmt}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="item-card-status" style="color:${f.statusColor}"><span class="dot" style="background:${f.statusColor}"></span>${f.statusText}</div>
        ${editBtn(f.id)}
      </div>
    </div>
  `).join('') || '<p class="empty-sub">No flats match.</p>';
  document.getElementById('flatsCards').innerHTML = cardHtml;

  const rowHtml = v.filteredFlats.map(f=>`
    <tr>
      <td class="strong">${escapeHtml(f.label)}</td>
      <td>${escapeHtml(f.owner||'—')}</td>
      <td>${escapeHtml(f.tenant||'—')}</td>
      <td class="num strong">${f.contributionFmt}</td>
      <td><span class="status-cell" style="color:${f.statusColor}"><span class="dot" style="background:${f.statusColor}"></span>${f.statusText}</span></td>
      <td>${editCell(f.id)}</td>
    </tr>
  `).join('') || '<tr class="empty-row"><td colspan="6">No flats match.</td></tr>';
  document.getElementById('flatsTableBody').innerHTML = rowHtml;
}

function renderDonations(v){
  document.getElementById('donationsTotalLabel').textContent = fmtINR(v.totalCollected);
  document.getElementById('collectedByBreakdown').innerHTML = v.collectedByBreakdown.map(c=>`
    <div>
      <div class="stack-row"><span>${escapeHtml(c.person)}</span><span class="green">${c.amountFmt}</span></div>
      <div class="bar-track"><div class="bar-fill green" style="width:${c.pct}%"></div></div>
    </div>
  `).join('') || '<p class="empty-sub">No donations recorded for '+ui.year+'.</p>';
  document.getElementById('donationsCards').innerHTML = v.donationsSorted.map(d=>`
    <div class="item-card">
      <div>
        <div class="item-card-title">${escapeHtml(d.title)}</div>
        <div class="item-card-sub">${escapeHtml(d.mode)} · ${d.dateFmt}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="item-card-amt" style="color:#16A34A">${d.amountFmt}</div>
        <button class="item-card-edit print-receipt" data-id="${d.id}" title="Print receipt">🖨</button>
      </div>
    </div>
  `).join('') || '<p class="empty-sub">No donations recorded for '+ui.year+'.</p>';

  const delCell = (id) => perms.canDonations ? `<button class="row-edit-btn delete-donation" data-id="${id}" title="Delete">🗑</button>` : '';
  document.getElementById('donationsTableBody').innerHTML = v.donationsSorted.map(d=>`
    <tr>
      <td class="strong">${escapeHtml(d.title)}</td>
      <td>${escapeHtml(d.mode)}</td>
      <td>${d.dateFmt}</td>
      <td class="num" style="color:#16A34A">${d.amountFmt}</td>
      <td><button class="row-edit-btn print-receipt" data-id="${d.id}" title="Print receipt">🖨</button> ${delCell(d.id)}</td>
    </tr>
  `).join('') || '<tr class="empty-row"><td colspan="5">No donations recorded for '+ui.year+'.</td></tr>';
}

function renderExpenses(v){
  document.getElementById('expensesTotalLabel').textContent = fmtINR(v.totalExpenses);
  document.getElementById('categoryBreakdown').innerHTML = v.categoryBreakdown.map(c=>`
    <div>
      <div class="stack-row"><span>${escapeHtml(c.category)}</span><span class="red">${c.amountFmt}</span></div>
      <div class="bar-track"><div class="bar-fill red" style="width:${c.pct}%"></div></div>
    </div>
  `).join('') || '<p class="empty-sub">No expenses recorded for '+ui.year+'.</p>';
  document.getElementById('recordedByBreakdown').innerHTML = v.recordedByBreakdown.map(c=>`
    <div>
      <div class="stack-row"><span>${escapeHtml(c.person)}</span><span class="red">${c.amountFmt}</span></div>
      <div class="bar-track"><div class="bar-fill red" style="width:${c.pct}%"></div></div>
    </div>
  `).join('') || '<p class="empty-sub">No expenses recorded for '+ui.year+'.</p>';

  const billLink = (url) => url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" title="View bill photo" style="margin-left:8px">📎</a>` : '';
  document.getElementById('expensesCards').innerHTML = v.expensesSorted.map(e=>`
    <div class="item-card">
      <div>
        <div class="item-card-title">${escapeHtml(e.title)}${billLink(e.billUrl)}</div>
        <div class="item-card-sub">${escapeHtml(e.subtitle)} · ${e.dateFmt}</div>
      </div>
      <div class="item-card-amt" style="color:#DC2626">${e.amountFmt}</div>
    </div>
  `).join('') || '<p class="empty-sub">No expenses recorded for '+ui.year+'.</p>';

  const delCell = (id) => perms.canExpenses ? `<button class="row-edit-btn delete-expense" data-id="${id}" title="Delete">🗑</button>` : '';
  document.getElementById('expensesTableBody').innerHTML = v.expensesSorted.map(e=>`
    <tr>
      <td class="strong">${escapeHtml(e.title)}${billLink(e.billUrl)}</td>
      <td>${escapeHtml(e.description)}</td>
      <td>${escapeHtml(e.mode)}</td>
      <td>${e.dateFmt}</td>
      <td class="num" style="color:#DC2626">${e.amountFmt}</td>
      <td>${delCell(e.id)}</td>
    </tr>
  `).join('') || '<tr class="empty-row"><td colspan="6">No expenses recorded for '+ui.year+'.</td></tr>';
}

function renderTransactions(v){
  document.querySelectorAll('#txnFilterSeg .seg-btn').forEach(b=>b.classList.toggle('active', b.dataset.filter===ui.txnFilter));

  document.getElementById('txnCards').innerHTML = v.filteredTransactions.map(tx=>`
    <div class="item-card accent-left" style="border-left-color:${tx.color}">
      <div>
        <div class="item-card-title">${escapeHtml(tx.title)}</div>
        <div class="item-card-sub">${escapeHtml(tx.subtitle)} · ${tx.dateFmt}</div>
      </div>
      <div class="item-card-amt" style="color:${tx.color}">${tx.amountSigned}</div>
    </div>
  `).join('') || '<p class="empty-sub">No transactions.</p>';

  document.getElementById('txnTableBody').innerHTML = v.filteredTransactions.map(tx=>`
    <tr>
      <td><span class="status-cell" style="color:${tx.color}"><span class="dot" style="background:${tx.color}"></span>${tx.typeLabel}</span></td>
      <td><div class="item-card-title" style="font-size:14px">${escapeHtml(tx.title)}</div><div class="item-card-sub">${escapeHtml(tx.subtitle)}</div></td>
      <td>${tx.dateFmt}</td>
      <td class="num" style="color:${tx.color}">${tx.amountSigned}</td>
    </tr>
  `).join('') || '<tr class="empty-row"><td colspan="4">No transactions.</td></tr>';
}

function renderUsersList(){
  const el = document.getElementById('usersList');
  if(!perms.isAdmin){ el.innerHTML=''; return; }
  el.innerHTML = store.profiles.map(p=>`
    <div class="user-row">
      <div class="user-row-email" title="${escapeHtml(p.email)}">${escapeHtml(p.full_name || p.email)}</div>
      <select data-user="${p.id}" ${p.id===profile.id?'disabled title="You cannot change your own role"':''}>
        <option value="viewer" ${p.role==='viewer'?'selected':''}>Viewer</option>
        <option value="donation_collector" ${p.role==='donation_collector'?'selected':''}>Donation Collector</option>
        <option value="treasurer" ${p.role==='treasurer'?'selected':''}>Treasurer</option>
        <option value="super_admin" ${p.role==='super_admin'?'selected':''}>Super Admin</option>
      </select>
    </div>
  `).join('') || '<p class="empty-sub">No users yet.</p>';
}

function renderAll(){
  renderNav();
  renderYearSelect();
  const v = computeView();
  renderDashboard(v);
  renderFlats(v);
  renderDonations(v);
  renderExpenses(v);
  renderTransactions(v);
  renderUsersList();
  renderPrasadam();
}

function renderPrasadam(){
  const listEl = document.getElementById('sevaDaysList');
  const noneEl = document.getElementById('sevaNoDays');
  const days = [...store.sevaDays].sort((a,b)=>a.seva_date.localeCompare(b.seva_date));
  noneEl.classList.toggle('hidden', days.length>0);
  document.getElementById('sevaNoDaysSub').textContent = perms.isAdmin
    ? 'Click "+ Add Day" above to set up this year\'s festival days.'
    : 'Ask your Super Admin to add this year\'s festival days.';
  if(!days.length){ listEl.innerHTML=''; return; }

  listEl.innerHTML = days.map(day=>{
    const dateObj = new Date(day.seva_date+'T00:00:00');
    const dateLabel = dateObj.toLocaleDateString('en-IN',{weekday:'short', day:'numeric', month:'short', year:'numeric'});
    const deleteBtn = perms.isAdmin ? `<button class="seva-day-delete" data-day="${day.id}" title="Remove day">🗑</button>` : '';
    const sessionsHtml = SEVA_SESSIONS.map(sess=>{
      const signups = store.sevaSignups.filter(s=>s.day_id===day.id && s.session===sess.key);
      const rows = signups.map(s=>{
        const f = store.flats.find(x=>x.id===s.flat_id);
        const actions = perms.isAdmin ? `
          <span class="seva-signup-actions">
            <button class="edit-signup" data-signup="${s.id}" title="Edit">✎</button>
            <button class="delete-signup" data-signup="${s.id}" title="Delete">🗑</button>
          </span>` : '';
        return `<div class="seva-signup-row">
          <span><span class="seva-signup-flat">${escapeHtml(f?f.label:s.flat_id)}</span> — <span class="seva-signup-name">${escapeHtml(s.name)}</span></span>
          ${actions}
        </div>`;
      }).join('') || '<div class="seva-empty">No one signed up yet.</div>';
      return `
        <div class="seva-session">
          <div class="seva-session-head">
            <div class="seva-session-title">${sess.icon} ${sess.label}</div>
            <span class="subtle" style="font-size:11px">${signups.length} signed up</span>
          </div>
          <div class="seva-signup-list">${rows}</div>
          <button class="seva-add-btn" data-day="${day.id}" data-session="${sess.key}">+ Add Your Name</button>
        </div>`;
    }).join('');
    return `
      <div class="seva-day-card">
        <div class="seva-day-head">
          <div>
            <div class="seva-day-title">${escapeHtml(dateLabel)}</div>
            ${day.label ? `<div class="seva-day-sub">${escapeHtml(day.label)}</div>` : ''}
          </div>
          ${deleteBtn}
        </div>
        <div class="seva-sessions">${sessionsHtml}</div>
      </div>`;
  }).join('');
}

function applyRoleVisibility(){
  document.getElementById('userEmailLabel').textContent = profile.email;
  document.getElementById('userRoleLabel').textContent = ROLE_LABELS[profile.role] || profile.role;
  document.getElementById('userAvatar').textContent = (profile.full_name||profile.email||'?').trim().charAt(0).toUpperCase();
  document.getElementById('settingsYouEmail').textContent = profile.email;
  document.getElementById('settingsYouRole').textContent = ROLE_LABELS[profile.role] || profile.role;

  document.getElementById('addDonationBtnDash').classList.toggle('hidden', !perms.canDonations);
  document.getElementById('addDonationBtnList').classList.toggle('hidden', !perms.canDonations);
  document.getElementById('addExpenseBtnDash').classList.toggle('hidden', !perms.canExpenses);
  document.getElementById('addExpenseBtnList').classList.toggle('hidden', !perms.canExpenses);

  document.querySelectorAll('.admin-only').forEach(el=>el.classList.toggle('hidden', !perms.isAdmin));
  document.getElementById('recordTransferBtn').hidden = !perms.canExpenses;
  document.getElementById('manageBudgetBtn').hidden = !perms.canExpenses;
}

/* ---------- toast ---------- */
let toastTimer;
function showToast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.add('hidden'), 2600);
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function goScreen(s){ ui.screen = s; renderAll(); window.scrollTo(0,0); }
document.querySelectorAll('.nav-btn, .bn-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> goScreen(btn.dataset.screen));
});
document.getElementById('viewFlatsBtn').addEventListener('click', ()=>{ ui.flatsFilter='all'; goScreen('flats'); });
document.getElementById('viewAllTxnBtn').addEventListener('click', ()=> goScreen('transactions'));
document.getElementById('yearSelect').addEventListener('change', (e)=>{ ui.year = e.target.value; renderAll(); });

document.querySelectorAll('#flatsFilterSeg .seg-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{ ui.flatsFilter = btn.dataset.filter; renderAll(); });
});
let flatsSearchTimer;
document.getElementById('flatsSearch').addEventListener('input', (e)=>{
  const val = e.target.value;
  clearTimeout(flatsSearchTimer);
  flatsSearchTimer = setTimeout(()=>{ ui.flatsSearch = val; renderAll(); }, 200);
});
document.querySelectorAll('#txnFilterSeg .seg-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{ ui.txnFilter = btn.dataset.filter; renderAll(); });
});

/* ============================================================
   DONATION MODAL
   ============================================================ */
const donationModal = document.getElementById('donationModal');
function setDonationKind(kind){
  document.querySelectorAll('#donKindRow .mode-btn').forEach(b=>b.classList.toggle('active', b.dataset.kind===kind));
  document.getElementById('donAmountField').hidden = kind!=='cash';
  document.getElementById('donModeField').hidden = kind!=='cash';
  document.getElementById('donItemField').hidden = kind!=='in_kind';
  document.getElementById('donItemValueField').hidden = kind!=='in_kind';
}
document.getElementById('donKindRow').addEventListener('click', (e)=>{
  const btn = e.target.closest('.mode-btn'); if(!btn) return;
  setDonationKind(btn.dataset.kind);
});
function openDonationModal(flatId){
  if(!perms.canDonations){ showToast('You do not have permission to add donations'); return; }
  const f = flatId ? store.flats.find(x=>x.id===flatId) : null;
  const sel = document.getElementById('donFlatSelect');
  sel.innerHTML = '<option value="">Select flat</option>' + store.flats.map(fl=>
    `<option value="${escapeHtml(fl.id)}">${escapeHtml(fl.label)} — ${escapeHtml(fl.owner||'Unassigned')}</option>`).join('');
  sel.value = flatId || '';
  document.getElementById('donName').value = f ? (f.owner||'') : '';
  document.getElementById('donAmount').value = '';
  document.getElementById('donItem').value = '';
  document.getElementById('donItemValue').value = '';
  document.getElementById('donDate').value = todayISO();
  document.getElementById('donNote').value = '';
  setModeButtons('donModeRow', 'UPI');
  setDonationKind('cash');
  const cbField = document.getElementById('donCollectedByField');
  cbField.hidden = !perms.isAdmin;
  if(perms.isAdmin){
    const cbSel = document.getElementById('donCollectedBy');
    cbSel.innerHTML = store.profiles.map(p=>`<option value="${p.id}">${escapeHtml(displayName(p))}</option>`).join('');
    cbSel.value = profile.id;
  }
  donationModal.classList.remove('hidden');
}
function closeDonationModal(){ donationModal.classList.add('hidden'); }
document.getElementById('addDonationBtnDash').addEventListener('click', ()=>openDonationModal(null));
document.getElementById('addDonationBtnList').addEventListener('click', ()=>openDonationModal(null));
document.getElementById('closeDonationModal').addEventListener('click', closeDonationModal);
document.getElementById('cancelDonationBtn').addEventListener('click', closeDonationModal);
document.getElementById('donFlatSelect').addEventListener('change', (e)=>{
  const f = store.flats.find(x=>x.id===e.target.value);
  if(f && !document.getElementById('donName').value){ document.getElementById('donName').value = f.owner||''; }
});
function setModeButtons(rowId, active){
  document.querySelectorAll('#'+rowId+' .mode-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.mode===active);
  });
}
document.getElementById('donModeRow').addEventListener('click', (e)=>{
  const btn = e.target.closest('.mode-btn'); if(!btn) return;
  setModeButtons('donModeRow', btn.dataset.mode);
});
document.getElementById('expModeRow').addEventListener('click', (e)=>{
  const btn = e.target.closest('.mode-btn'); if(!btn) return;
  setModeButtons('expModeRow', btn.dataset.mode);
});
document.getElementById('saveDonationBtn').addEventListener('click', async ()=>{
  if(!perms.canDonations){ showToast('You do not have permission to add donations'); return; }
  const flatId = document.getElementById('donFlatSelect').value;
  const name = document.getElementById('donName').value.trim();
  const kind = document.querySelector('#donKindRow .mode-btn.active')?.dataset.kind || 'cash';
  const date = document.getElementById('donDate').value || todayISO();
  const note = document.getElementById('donNote').value.trim();
  if(!flatId){ showToast('Please select a flat'); return; }

  let collectedBy = profile.id, collectedByName = displayName(profile);
  if(perms.isAdmin){
    const chosenId = document.getElementById('donCollectedBy').value;
    const chosen = store.profiles.find(p=>p.id===chosenId);
    if(chosen){ collectedBy = chosen.id; collectedByName = displayName(chosen); }
  }
  let payload = { flat_id: flatId, name: name||'Resident', kind, date, note, created_by: profile.id, collected_by: collectedBy, collected_by_name: collectedByName };
  if(kind==='cash'){
    const amount = Number(document.getElementById('donAmount').value);
    const mode = document.querySelector('#donModeRow .mode-btn.active')?.dataset.mode || 'Cash';
    if(!amount || amount<=0){ showToast('Please enter a valid amount'); return; }
    payload = Object.assign(payload, { amount, mode, item_description:'' });
  } else {
    const item = document.getElementById('donItem').value.trim();
    const value = Number(document.getElementById('donItemValue').value) || 0;
    if(!item){ showToast('Please enter what they are sponsoring'); return; }
    payload = Object.assign(payload, { amount: value, mode:'', item_description: item });
  }

  const btn = document.getElementById('saveDonationBtn');
  btn.disabled = true;
  const { error } = await sb.from('ganesh_donations').insert(payload);
  btn.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity('Added donation', (name||'Resident')+' ('+flatId+') — '+(kind==='cash'?fmtINR(payload.amount):payload.item_description));
  await fetchAllData();
  closeDonationModal();
  renderAll();
  showToast(kind==='cash' ? 'Donation added successfully ✓' : 'In-kind contribution recorded ✓');
});

/* ============================================================
   EXPENSE MODAL
   ============================================================ */
const expenseModal = document.getElementById('expenseModal');
function openExpenseModal(){
  if(!perms.canExpenses){ showToast('You do not have permission to add expenses'); return; }
  document.getElementById('expense-categories').innerHTML = CATEGORIES.map(c=>`<option value="${escapeHtml(c)}"></option>`).join('');
  document.getElementById('expCategory').value = CATEGORIES[0];
  document.getElementById('expDesc').value = '';
  document.getElementById('expAmount').value = '';
  document.getElementById('expDate').value = todayISO();
  document.getElementById('expNote').value = '';
  setModeButtons('expModeRow', 'Cash');
  document.getElementById('expBillFile').value = '';
  const billLabel = document.getElementById('billUploadLabel');
  billLabel.textContent = '📎 Attach bill photo (optional)';
  billLabel.classList.remove('attached');
  const rbField = document.getElementById('expRecordedByField');
  rbField.hidden = !perms.isAdmin;
  if(perms.isAdmin){
    const rbSel = document.getElementById('expRecordedBy');
    rbSel.innerHTML = store.profiles.map(p=>`<option value="${p.id}">${escapeHtml(displayName(p))}</option>`).join('');
    rbSel.value = profile.id;
  }
  expenseModal.classList.remove('hidden');
}
function closeExpenseModal(){ expenseModal.classList.add('hidden'); }
document.getElementById('addExpenseBtnDash').addEventListener('click', openExpenseModal);
document.getElementById('addExpenseBtnList').addEventListener('click', openExpenseModal);
document.getElementById('closeExpenseModal').addEventListener('click', closeExpenseModal);
document.getElementById('cancelExpenseBtn').addEventListener('click', closeExpenseModal);
document.getElementById('expBillFile').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  const label = document.getElementById('billUploadLabel');
  if(file){ label.textContent = '📎 '+file.name; label.classList.add('attached'); }
  else { label.textContent = '📎 Attach bill photo (optional)'; label.classList.remove('attached'); }
});

function uuidv4(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r = Math.random()*16|0, v = c==='x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}
async function uploadBillPhoto(expenseId, file){
  const ext = (file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'') || 'jpg';
  const path = `${expenseId}.${ext}`;
  const { error } = await sb.storage.from('receipts').upload(path, file, { upsert:true, contentType: file.type || 'image/jpeg' });
  if(error) throw error;
  const { data } = sb.storage.from('receipts').getPublicUrl(path);
  return data.publicUrl;
}

document.getElementById('saveExpenseBtn').addEventListener('click', async ()=>{
  if(!perms.canExpenses){ showToast('You do not have permission to add expenses'); return; }
  const category = document.getElementById('expCategory').value.trim() || 'Miscellaneous';
  const description = document.getElementById('expDesc').value.trim();
  const amount = Number(document.getElementById('expAmount').value);
  const mode = document.querySelector('#expModeRow .mode-btn.active')?.dataset.mode || 'Cash';
  const date = document.getElementById('expDate').value || todayISO();
  const note = document.getElementById('expNote').value.trim();
  const billFile = document.getElementById('expBillFile').files[0] || null;
  if(!description){ showToast('Please enter a description'); return; }
  if(!amount || amount<=0){ showToast('Please enter a valid amount'); return; }
  let recordedBy = profile.id, recordedByName = displayName(profile);
  if(perms.isAdmin){
    const chosenId = document.getElementById('expRecordedBy').value;
    const chosen = store.profiles.find(p=>p.id===chosenId);
    if(chosen){ recordedBy = chosen.id; recordedByName = displayName(chosen); }
  }
  const btn = document.getElementById('saveExpenseBtn');
  btn.disabled = true;

  const expenseId = uuidv4();
  let billUrl = null;
  if(billFile){
    try{ billUrl = await uploadBillPhoto(expenseId, billFile); }
    catch(e){ btn.disabled = false; showToast('Bill upload failed: '+e.message); return; }
  }

  const { error } = await sb.from('ganesh_expenses').insert({
    id: expenseId, category, description, amount, mode, date, note,
    bill_attached: !!billUrl, bill_url: billUrl, created_by: profile.id,
    recorded_by: recordedBy, recorded_by_name: recordedByName,
  });
  btn.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity('Added expense', category+' — '+fmtINR(amount));
  await fetchAllData();
  closeExpenseModal();
  renderAll();
  showToast('Expense added successfully ✓');
});

/* ---------- delete donation/expense ---------- */
document.getElementById('donationsTableBody').addEventListener('click', async (e)=>{
  const receiptBtn = e.target.closest('.print-receipt');
  if(receiptBtn){ printDonationReceipt(receiptBtn.dataset.id); return; }
  const btn = e.target.closest('.delete-donation'); if(!btn) return;
  if(!perms.canDonations) return;
  if(!confirm('Delete this donation?')) return;
  const d = store.donations.find(x=>x.id===btn.dataset.id);
  const { error } = await sb.from('ganesh_donations').delete().eq('id', btn.dataset.id);
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity('Deleted donation', d ? (d.name+' — '+fmtINR(d.amount)) : btn.dataset.id);
  await fetchAllData(); renderAll(); showToast('Donation deleted');
});
document.getElementById('donationsCards').addEventListener('click', (e)=>{
  const receiptBtn = e.target.closest('.print-receipt');
  if(receiptBtn) printDonationReceipt(receiptBtn.dataset.id);
});
document.getElementById('expensesTableBody').addEventListener('click', async (e)=>{
  const btn = e.target.closest('.delete-expense'); if(!btn) return;
  if(!perms.canExpenses) return;
  if(!confirm('Delete this expense?')) return;
  const ex = store.expenses.find(x=>x.id===btn.dataset.id);
  const { error } = await sb.from('ganesh_expenses').delete().eq('id', btn.dataset.id);
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity('Deleted expense', ex ? (ex.category+' — '+fmtINR(ex.amount)) : btn.dataset.id);
  await fetchAllData(); renderAll(); showToast('Expense deleted');
});

/* ============================================================
   EDIT FLAT MODAL
   ============================================================ */
const flatModal = document.getElementById('flatModal');
function openFlatModal(flatId){
  if(!perms.canEditFlats){ showToast('You do not have permission to edit flats'); return; }
  const f = store.flats.find(x=>x.id===flatId);
  if(!f) return;
  ui.editingFlatId = flatId;
  document.getElementById('flatModalTitle').textContent = 'Edit ' + f.label;
  document.getElementById('flatOwner').value = f.owner||'';
  document.getElementById('flatTenant').value = f.tenant||'';
  flatModal.classList.remove('hidden');
}
function closeFlatModal(){ flatModal.classList.add('hidden'); ui.editingFlatId=null; }
document.getElementById('closeFlatModal').addEventListener('click', closeFlatModal);
document.getElementById('cancelFlatBtn').addEventListener('click', closeFlatModal);
document.getElementById('saveFlatBtn').addEventListener('click', async ()=>{
  if(!perms.canEditFlats || !ui.editingFlatId) return;
  const owner = document.getElementById('flatOwner').value.trim();
  const tenant = document.getElementById('flatTenant').value.trim();
  const { error } = await sb.from('ganesh_flats').update({ owner, tenant }).eq('id', ui.editingFlatId);
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity('Edited flat', ui.editingFlatId+' — owner: '+(owner||'—')+', tenant: '+(tenant||'—'));
  await fetchAllData();
  closeFlatModal();
  renderAll();
  showToast('Flat updated');
});
document.getElementById('flatsCards').addEventListener('click', (e)=>{
  const btn = e.target.closest('.item-card-edit'); if(!btn) return;
  openFlatModal(btn.dataset.flat);
});
document.getElementById('flatsTableBody').addEventListener('click', (e)=>{
  const btn = e.target.closest('.row-edit-btn'); if(!btn) return;
  openFlatModal(btn.dataset.flat);
});

/* ============================================================
   FUND TRANSFERS ("who has how much")
   ============================================================ */
const transferModal = document.getElementById('transferModal');
function openTransferModal(){
  if(!perms.canExpenses){ showToast('Only Super Admin or Treasurer can record transfers'); return; }
  const options = store.profiles.map(p=>`<option value="${p.id}" data-name="${escapeHtml(displayName(p))}">${escapeHtml(displayName(p))}</option>`).join('');
  document.getElementById('transferFrom').innerHTML = options;
  document.getElementById('transferTo').innerHTML = options;
  document.getElementById('transferFrom').value = profile.id;
  const otherProfile = store.profiles.find(p=>p.id!==profile.id);
  document.getElementById('transferTo').value = otherProfile ? otherProfile.id : profile.id;
  document.getElementById('transferAmount').value = '';
  document.getElementById('transferDate').value = todayISO();
  document.getElementById('transferNote').value = '';
  transferModal.classList.remove('hidden');
}
function closeTransferModal(){ transferModal.classList.add('hidden'); }
document.getElementById('recordTransferBtn').addEventListener('click', openTransferModal);
document.getElementById('closeTransferModal').addEventListener('click', closeTransferModal);
document.getElementById('cancelTransferBtn').addEventListener('click', closeTransferModal);
document.getElementById('saveTransferBtn').addEventListener('click', async ()=>{
  if(!perms.canExpenses) return;
  const fromId = document.getElementById('transferFrom').value;
  const toId = document.getElementById('transferTo').value;
  const amount = Number(document.getElementById('transferAmount').value);
  const date = document.getElementById('transferDate').value || todayISO();
  const note = document.getElementById('transferNote').value.trim();
  if(!fromId || !toId){ showToast('Please select both people'); return; }
  if(fromId===toId){ showToast('From and To must be different people'); return; }
  if(!amount || amount<=0){ showToast('Please enter a valid amount'); return; }
  const fromP = store.profiles.find(p=>p.id===fromId);
  const toP = store.profiles.find(p=>p.id===toId);
  const btn = document.getElementById('saveTransferBtn');
  btn.disabled = true;
  const { error } = await sb.from('ganesh_fund_transfers').insert({
    from_user: fromId, from_user_name: displayName(fromP),
    to_user: toId, to_user_name: displayName(toP),
    amount, date, note, created_by: profile.id,
  });
  btn.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity('Recorded transfer', displayName(fromP)+' → '+displayName(toP)+' — '+fmtINR(amount));
  await fetchAllData();
  closeTransferModal();
  renderAll();
  showToast('Transfer recorded ✓');
});

/* ============================================================
   CATEGORY BUDGETS
   ============================================================ */
const budgetModal = document.getElementById('budgetModal');
let budgetEditRows = [];

function buildBudgetEditRows(){
  const existing = store.budgets.filter(b=>b.year===ui.year);
  const existingMap = {};
  existing.forEach(b=>{ existingMap[b.category] = { category:b.category, mode:b.mode, amount:b.amount, pct:b.pct }; });
  const usedThisYear = store.expenses.filter(e=>yearOf(e.date)===ui.year).map(e=>e.category);
  const catNames = Array.from(new Set([...CATEGORIES, ...usedThisYear, ...Object.keys(existingMap)]));
  return catNames.map(cat => existingMap[cat] || { category:cat, mode:'amount', amount:'', pct:'' });
}

function renderBudgetRows(){
  document.getElementById('budgetRows').innerHTML = budgetEditRows.map((r,i)=>`
    <div class="budget-row" data-idx="${i}">
      <div class="budget-row-name" title="${escapeHtml(r.category)}">${escapeHtml(r.category)}</div>
      <div class="mode-row">
        <button type="button" class="mode-btn small ${r.mode==='amount'?'active':''}" data-mode="amount">₹</button>
        <button type="button" class="mode-btn small ${r.mode==='percent'?'active':''}" data-mode="percent">%</button>
      </div>
      <div class="amount-input">
        <span>${r.mode==='percent'?'%':'₹'}</span>
        <input type="number" min="0" class="budget-value-input" value="${escapeHtml(r.mode==='percent' ? (r.pct??'') : (r.amount??''))}">
      </div>
    </div>
  `).join('') || '<p class="empty-sub">No categories yet — add one below.</p>';
}

function openBudgetModal(){
  if(!perms.canExpenses){ showToast('Only Super Admin or Treasurer can manage budgets'); return; }
  document.getElementById('budgetModalYear').textContent = ui.year;
  budgetEditRows = buildBudgetEditRows();
  document.getElementById('newBudgetCategory').value = '';
  renderBudgetRows();
  budgetModal.classList.remove('hidden');
}
function closeBudgetModal(){ budgetModal.classList.add('hidden'); }
document.getElementById('manageBudgetBtn').addEventListener('click', openBudgetModal);
document.getElementById('closeBudgetModal').addEventListener('click', closeBudgetModal);
document.getElementById('cancelBudgetBtn').addEventListener('click', closeBudgetModal);

document.getElementById('budgetRows').addEventListener('click', (e)=>{
  const btn = e.target.closest('.mode-btn'); if(!btn) return;
  const row = btn.closest('.budget-row');
  const idx = Number(row.dataset.idx);
  budgetEditRows[idx].mode = btn.dataset.mode;
  renderBudgetRows();
});
document.getElementById('budgetRows').addEventListener('input', (e)=>{
  const input = e.target.closest('.budget-value-input'); if(!input) return;
  const row = input.closest('.budget-row');
  const idx = Number(row.dataset.idx);
  if(budgetEditRows[idx].mode==='percent') budgetEditRows[idx].pct = input.value;
  else budgetEditRows[idx].amount = input.value;
});
document.getElementById('addBudgetCategoryBtn').addEventListener('click', ()=>{
  const input = document.getElementById('newBudgetCategory');
  const name = input.value.trim();
  if(!name) return;
  if(budgetEditRows.some(r=>r.category.toLowerCase()===name.toLowerCase())){ showToast('That category is already in the list'); return; }
  budgetEditRows.push({ category:name, mode:'amount', amount:'', pct:'' });
  input.value = '';
  renderBudgetRows();
});

document.getElementById('saveBudgetBtn').addEventListener('click', async ()=>{
  if(!perms.canExpenses) return;
  const btn = document.getElementById('saveBudgetBtn');
  btn.disabled = true;
  const toUpsert = [];
  const toDeleteCategories = [];
  budgetEditRows.forEach(r=>{
    const val = r.mode==='percent' ? Number(r.pct) : Number(r.amount);
    if(val > 0){
      toUpsert.push({
        year: ui.year, category: r.category, mode: r.mode,
        amount: r.mode==='amount' ? val : 0,
        pct: r.mode==='percent' ? val : null,
        created_by: profile.id,
      });
    } else {
      toDeleteCategories.push(r.category);
    }
  });
  let err = null;
  if(toUpsert.length){
    const { error } = await sb.from('ganesh_budgets').upsert(toUpsert, { onConflict: 'year,category' });
    if(error) err = error;
  }
  if(!err && toDeleteCategories.length){
    const { error } = await sb.from('ganesh_budgets').delete().eq('year', ui.year).in('category', toDeleteCategories);
    if(error) err = error;
  }
  btn.disabled = false;
  if(err){ showToast('Error: '+err.message); return; }
  await logActivity('Updated budgets', ui.year+' — '+toUpsert.length+' categor'+(toUpsert.length===1?'y':'ies'));
  await fetchAllData();
  closeBudgetModal();
  renderAll();
  showToast('Budgets saved ✓');
});

/* ============================================================
   PRASADAM SEVA
   ============================================================ */
const sevaDayModal = document.getElementById('sevaDayModal');
function openSevaDayModal(){
  if(!perms.isAdmin){ showToast('Only a Super Admin can add seva days'); return; }
  document.getElementById('sevaDayDate').value = '';
  document.getElementById('sevaDayDateTo').value = '';
  document.getElementById('sevaDayLabel').value = '';
  sevaDayModal.classList.remove('hidden');
}
function closeSevaDayModal(){ sevaDayModal.classList.add('hidden'); }
document.getElementById('addSevaDayBtn').addEventListener('click', openSevaDayModal);
document.getElementById('closeSevaDayModal').addEventListener('click', closeSevaDayModal);
document.getElementById('cancelSevaDayBtn').addEventListener('click', closeSevaDayModal);
const MAX_SEVA_DAY_RANGE = 45; // sane cap so a typo in "to date" can't try to insert years of rows
document.getElementById('saveSevaDayBtn').addEventListener('click', async ()=>{
  if(!perms.isAdmin) return;
  const fromDate = document.getElementById('sevaDayDate').value;
  const toDateRaw = document.getElementById('sevaDayDateTo').value;
  const label = document.getElementById('sevaDayLabel').value.trim();
  if(!fromDate){ showToast('Please pick a from date'); return; }
  const toDate = toDateRaw && toDateRaw > fromDate ? toDateRaw : fromDate;

  // Build one row per date in [fromDate, toDate]. For a single day, label is
  // used as-is; for a range, each day gets "<label> — Day N" so they're
  // distinguishable (or just "Day N" if no label was given).
  const rows = [];
  let cur = new Date(fromDate+'T00:00:00');
  const end = new Date(toDate+'T00:00:00');
  let dayNum = 1;
  const isRange = toDate !== fromDate;
  while(cur <= end){
    if(dayNum > MAX_SEVA_DAY_RANGE){ break; }
    const iso = cur.toISOString().slice(0,10);
    const rowLabel = isRange ? (label ? `${label} — Day ${dayNum}` : `Day ${dayNum}`) : label;
    rows.push({ seva_date: iso, label: rowLabel });
    cur.setDate(cur.getDate()+1);
    dayNum++;
  }
  if(!rows.length){ showToast('Nothing to add'); return; }

  const btn = document.getElementById('saveSevaDayBtn');
  btn.disabled = true;
  const { data: inserted, error } = await sb.from('ganesh_prasadam_days')
    .upsert(rows, { onConflict: 'seva_date', ignoreDuplicates: true })
    .select();
  btn.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  const addedCount = inserted ? inserted.length : rows.length;
  const skipped = rows.length - addedCount;
  if(rows.length === 1){
    await logActivity('Added seva day', fromDate+(label?' — '+label:''));
  } else {
    await logActivity('Added seva days', `${fromDate} to ${toDate} (${addedCount} day${addedCount===1?'':'s'} added${skipped?', '+skipped+' already existed':''})`);
  }
  await fetchAllData();
  closeSevaDayModal();
  renderAll();
  showToast(rows.length===1 ? 'Seva day added' : `${addedCount} seva day${addedCount===1?'':'s'} added${skipped?' ('+skipped+' already existed)':''}`);
});
document.getElementById('sevaDaysList').addEventListener('click', async (e)=>{
  const delDayBtn = e.target.closest('.seva-day-delete');
  if(delDayBtn){
    if(!perms.isAdmin) return;
    if(!confirm('Remove this seva day? This also removes any sign-ups for it.')) return;
    const dayId = delDayBtn.dataset.day;
    const inUse = store.sevaSignups.some(s=>s.day_id===dayId);
    if(inUse){ showToast('Remove the sign-ups for this day first, or delete them individually.'); return; }
    const dayInfo = store.sevaDays.find(d=>d.id===dayId);
    const { error } = await sb.from('ganesh_prasadam_days').delete().eq('id', dayId);
    if(error){ showToast('Error: '+error.message); return; }
    await logActivity('Deleted seva day', dayInfo ? (dayInfo.seva_date+(dayInfo.label?' — '+dayInfo.label:'')) : dayId);
    await fetchAllData(); renderAll(); showToast('Seva day removed');
    return;
  }
  const addBtn = e.target.closest('.seva-add-btn');
  if(addBtn){ openSevaSignupModal(addBtn.dataset.day, addBtn.dataset.session, null); return; }
  const editBtn = e.target.closest('.edit-signup');
  if(editBtn){
    if(!perms.isAdmin) return;
    const s = store.sevaSignups.find(x=>x.id===editBtn.dataset.signup);
    if(s) openSevaSignupModal(s.day_id, s.session, s);
    return;
  }
  const delBtn = e.target.closest('.delete-signup');
  if(delBtn){
    if(!perms.isAdmin) return;
    if(!confirm('Delete this sign-up?')) return;
    const signupInfo = store.sevaSignups.find(s=>s.id===delBtn.dataset.signup);
    const { error } = await sb.from('ganesh_prasadam_signups').delete().eq('id', delBtn.dataset.signup);
    if(error){ showToast('Error: '+error.message); return; }
    await logActivity('Deleted seva sign-up', signupInfo ? signupInfo.name : '');
    await fetchAllData(); renderAll(); showToast('Sign-up deleted');
  }
});

const sevaSignupModal = document.getElementById('sevaSignupModal');
let sevaEditingId = null;
function openSevaSignupModal(dayId, session, existing){
  const day = store.sevaDays.find(d=>d.id===dayId);
  if(!day) return;
  sevaEditingId = existing ? existing.id : null;
  const dateLabel = new Date(day.seva_date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
  const sess = SEVA_SESSIONS.find(s=>s.key===session);
  document.getElementById('sevaSignupTitle').textContent = existing ? 'Edit Sign-up' : 'Add Your Name';
  document.getElementById('sevaSignupContext').textContent = `${dateLabel} — ${sess?sess.icon+' '+sess.label:session}`;
  document.getElementById('sevaSignupModal').dataset.day = dayId;
  document.getElementById('sevaSignupModal').dataset.session = session;
  const sel = document.getElementById('sevaFlatSelect');
  sel.innerHTML = '<option value="">Select flat</option>' + store.flats.map(fl=>
    `<option value="${escapeHtml(fl.id)}">${escapeHtml(fl.label)} — ${escapeHtml(fl.owner||'Unassigned')}</option>`).join('');
  sel.value = existing ? existing.flat_id : '';
  document.getElementById('sevaName').value = existing ? existing.name : (profile.full_name || '');
  document.getElementById('sevaNote').value = existing ? (existing.note||'') : '';
  sevaSignupModal.classList.remove('hidden');
}
function closeSevaSignupModal(){ sevaSignupModal.classList.add('hidden'); sevaEditingId=null; }
document.getElementById('closeSevaSignupModal').addEventListener('click', closeSevaSignupModal);
document.getElementById('cancelSevaSignupBtn').addEventListener('click', closeSevaSignupModal);
document.getElementById('sevaFlatSelect').addEventListener('change', (e)=>{
  const f = store.flats.find(x=>x.id===e.target.value);
  if(f && !document.getElementById('sevaName').value){ document.getElementById('sevaName').value = f.owner||''; }
});
document.getElementById('saveSevaSignupBtn').addEventListener('click', async ()=>{
  const flatId = document.getElementById('sevaFlatSelect').value;
  const name = document.getElementById('sevaName').value.trim();
  const note = document.getElementById('sevaNote').value.trim();
  if(!flatId){ showToast('Please select a flat'); return; }
  if(!name){ showToast('Please enter a name'); return; }
  const btn = document.getElementById('saveSevaSignupBtn');
  btn.disabled = true;
  let error;
  if(sevaEditingId){
    ({ error } = await sb.from('ganesh_prasadam_signups').update({ flat_id: flatId, name, note }).eq('id', sevaEditingId));
  } else {
    const dayId = sevaSignupModal.dataset.day;
    const session = sevaSignupModal.dataset.session;
    ({ error } = await sb.from('ganesh_prasadam_signups').insert({ day_id: dayId, session, flat_id: flatId, name, note, created_by: profile.id }));
  }
  btn.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity(sevaEditingId ? 'Edited seva sign-up' : 'Added seva sign-up', name);
  await fetchAllData();
  closeSevaSignupModal();
  renderAll();
  showToast(sevaEditingId ? 'Sign-up updated' : 'Thank you — sign-up added ✓');
});

/* ============================================================
   SETTINGS MODAL
   ============================================================ */
const settingsModal = document.getElementById('settingsModal');
function renderActivityLog(){
  const field = document.getElementById('settingsActivityField');
  field.classList.toggle('hidden', !perms.canExpenses);
  if(!perms.canExpenses) return;
  document.getElementById('activityLogList').innerHTML = store.activityLog.map(a=>{
    const when = new Date(a.created_at);
    const whenFmt = isNaN(when) ? '' : when.toLocaleDateString('en-IN',{day:'numeric',month:'short'}) + ' · ' + when.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    return `
    <div class="activity-log-row">
      <div>
        <div class="activity-log-main">${escapeHtml(a.action)}</div>
        <div class="activity-log-sub">${escapeHtml(a.actor_name||'System')}${a.details?' — '+escapeHtml(a.details):''}</div>
      </div>
      <div class="activity-log-time">${whenFmt}</div>
    </div>`;
  }).join('') || '<p class="empty-sub" style="padding:8px">No activity recorded yet.</p>';
}

function openSettingsModal(){
  document.getElementById('settingsName').value = store.settings.committee_name || '';
  document.getElementById('settingsFlatCount').value = store.flats.length;
  document.getElementById('obYearLabel').textContent = ui.year;
  const obRow = store.openingBalances.find(o=>o.year===ui.year);
  document.getElementById('settingsOpeningBalance').value = obRow ? obRow.amount : '';
  document.getElementById('settingsOpeningBalanceNote').value = obRow ? (obRow.note||'') : '';
  renderUsersList();
  renderActivityLog();
  settingsModal.classList.remove('hidden');
}
function closeSettingsModal(){ settingsModal.classList.add('hidden'); }
document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
document.getElementById('settingsBtnMobile').addEventListener('click', openSettingsModal);
document.getElementById('closeSettingsModal').addEventListener('click', closeSettingsModal);
document.getElementById('cancelSettingsBtn').addEventListener('click', closeSettingsModal);

document.getElementById('usersList').addEventListener('change', async (e)=>{
  const sel = e.target.closest('select[data-user]'); if(!sel) return;
  if(!perms.isAdmin) return;
  const userId = sel.dataset.user;
  const newRole = sel.value;
  const targetProfile = store.profiles.find(p=>p.id===userId);
  sel.disabled = true;
  const { error } = await sb.from('ganesh_profiles').update({ role: newRole }).eq('id', userId);
  sel.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity('Changed role', (targetProfile?displayName(targetProfile):'A user') + ' → ' + (ROLE_LABELS[newRole]||newRole));
  await fetchAllData();
  renderUsersList();
  showToast('Role updated');
});

document.getElementById('saveSettingsBtn').addEventListener('click', async ()=>{
  if(!perms.isAdmin) return;
  const btn = document.getElementById('saveSettingsBtn');
  btn.disabled = true;
  const committeeName = document.getElementById('settingsName').value.trim() || 'Ganesh Pooja Committee';
  const desiredCount = Math.max(1, Math.min(999, Number(document.getElementById('settingsFlatCount').value) || store.flats.length));
  const nameChanged = committeeName !== (store.settings.committee_name||'');

  const { error: settingsErr } = await sb.from('ganesh_settings').update({ committee_name: committeeName, updated_at: new Date().toISOString() }).eq('id', 1);
  if(settingsErr){ showToast('Error: '+settingsErr.message); btn.disabled=false; return; }
  if(nameChanged) await logActivity('Updated committee name', committeeName);

  if(desiredCount > store.flats.length){
    const rows = [];
    for(let i=store.flats.length+1;i<=desiredCount;i++){
      const label = flatLabelForIndex(i);
      rows.push({ id: label, label, owner:'', tenant:'' });
    }
    const { error } = await sb.from('ganesh_flats').insert(rows);
    if(error){ showToast('Error adding flats: '+error.message); btn.disabled=false; return; }
    await logActivity('Added flats', (desiredCount-store.flats.length)+' flat(s), now '+desiredCount+' total');
  } else if(desiredCount < store.flats.length){
    const sorted = [...store.flats].sort((a,b)=>a.id.localeCompare(b.id));
    const removeIds = sorted.slice(desiredCount).map(f=>f.id);
    const inUse = store.donations.some(d=>removeIds.includes(d.flat_id));
    if(inUse){
      showToast('Cannot remove flats that have donations recorded');
    } else if(removeIds.length){
      const { error } = await sb.from('ganesh_flats').delete().in('id', removeIds);
      if(error){ showToast('Error removing flats: '+error.message); btn.disabled=false; return; }
      await logActivity('Removed flats', removeIds.join(', '));
    }
  }

  const obAmount = Number(document.getElementById('settingsOpeningBalance').value) || 0;
  const obNote = document.getElementById('settingsOpeningBalanceNote').value.trim();
  const obRow = store.openingBalances.find(o=>o.year===ui.year);
  if(obAmount>0 || obRow){
    const { error: obErr } = await sb.from('ganesh_opening_balances').upsert(
      { year: ui.year, amount: obAmount, note: obNote, updated_by: profile.id, updated_at: new Date().toISOString() },
      { onConflict: 'year' }
    );
    if(obErr){ showToast('Error saving opening balance: '+obErr.message); btn.disabled=false; return; }
    if(!obRow || Number(obRow.amount)!==obAmount) await logActivity('Set opening balance', ui.year+' → '+fmtINR(obAmount));
  }

  btn.disabled = false;
  await fetchAllData();
  closeSettingsModal();
  renderAll();
  showToast('Settings saved');
});

/* ============================================================
   PRINTABLE / PDF REPORTS
   (uses the browser's Print → Save as PDF — no extra libraries)
   ============================================================ */
function reportHeader(title){
  const now = new Date();
  return `
    <div class="report-head">
      <div>
        <h1>${escapeHtml(store.settings.committee_name || 'Ganesh Pooja Committee')}</h1>
        <div class="rsub">${escapeHtml(title)} — ${ui.year}</div>
      </div>
      <div class="report-meta">Generated ${now.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}<br>${now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</div>
    </div>`;
}
function donationsTableHtml(v){
  return `
    <div class="report-section-title">Donations (${v.donationsSorted.length})</div>
    <table>
      <thead><tr><th>Flat / Donor</th><th>Type</th><th>Mode</th><th>Date</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${v.donationsSorted.map(d=>`
          <tr>
            <td>${escapeHtml(d.title)}</td>
            <td>${d.kind==='in_kind' ? 'In-Kind'+(d.itemDescription?' — '+escapeHtml(d.itemDescription):'') : 'Cash'}</td>
            <td>${escapeHtml(d.mode||'—')}</td>
            <td>${d.dateFmt}</td>
            <td class="num">${d.amount>0 ? fmtINR(d.amount) : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="5">No donations recorded.</td></tr>'}
      </tbody>
    </table>`;
}
function expensesTableHtml(v){
  return `
    <div class="report-section-title">Expenses (${v.expensesSorted.length})</div>
    <table>
      <thead><tr><th>Category</th><th>Description</th><th>Mode</th><th>Date</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${v.expensesSorted.map(e=>`
          <tr>
            <td>${escapeHtml(e.title)}</td>
            <td>${escapeHtml(e.description)}</td>
            <td>${escapeHtml(e.mode)}</td>
            <td>${e.dateFmt}</td>
            <td class="num">${fmtINR(e.amount)}</td>
          </tr>`).join('') || '<tr><td colspan="5">No expenses recorded.</td></tr>'}
      </tbody>
    </table>
    <div class="report-section-title">Expenses by Category</div>
    <table>
      <thead><tr><th>Category</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${v.categoryBreakdown.map(c=>`<tr><td>${escapeHtml(c.category)}</td><td class="num">${c.amountFmt}</td></tr>`).join('') || '<tr><td colspan="2">No expenses recorded.</td></tr>'}
      </tbody>
    </table>`;
}
function buildReportHTML(kind){
  const v = computeView();
  let stats = '';
  let body = '';
  if(kind==='donations'){
    stats = `
      <div class="report-stats">
        <div class="report-stat"><div class="rlabel">TOTAL COLLECTED</div><div class="rval">${fmtINR(v.totalCollected)}</div></div>
        <div class="report-stat"><div class="rlabel">FLATS CONTRIBUTED</div><div class="rval">${v.contributedCount} / ${v.totalFlats}</div></div>
      </div>`;
    body = donationsTableHtml(v);
  } else if(kind==='expenses'){
    stats = `
      <div class="report-stats">
        <div class="report-stat"><div class="rlabel">TOTAL EXPENSES</div><div class="rval">${fmtINR(v.totalExpenses)}</div></div>
      </div>`;
    body = expensesTableHtml(v);
  } else {
    stats = `
      <div class="report-stats">
        <div class="report-stat"><div class="rlabel">TOTAL COLLECTED</div><div class="rval">${fmtINR(v.totalCollected)}</div></div>
        <div class="report-stat"><div class="rlabel">TOTAL EXPENSES</div><div class="rval">${fmtINR(v.totalExpenses)}</div></div>
        <div class="report-stat"><div class="rlabel">BALANCE</div><div class="rval">${fmtINR(v.balance)}</div></div>
        <div class="report-stat"><div class="rlabel">FLATS CONTRIBUTED</div><div class="rval">${v.contributedCount} / ${v.totalFlats}</div></div>
      </div>`;
    body = donationsTableHtml(v) + expensesTableHtml(v);
  }
  const titles = { donations:'Donations Report', expenses:'Expenses Report', both:'Financial Report' };
  return `<div class="report-doc">
    ${reportHeader(titles[kind])}
    ${stats}
    ${body}
    <div class="report-footer">Generated by the Ganesh Pooja Expense Portal · ${escapeHtml(store.settings.committee_name||'')}</div>
  </div>`;
}
function printReport(kind){
  document.getElementById('printReportArea').innerHTML = buildReportHTML(kind);
  window.print();
}
document.getElementById('exportDonationsBtn').addEventListener('click', ()=>printReport('donations'));
document.getElementById('exportExpensesBtn').addEventListener('click', ()=>printReport('expenses'));
document.getElementById('exportBothBtn').addEventListener('click', ()=>printReport('both'));

/* ---------- single-donation printable receipt ---------- */
function buildDonationReceiptHTML(id){
  const d = store.donations.find(x=>x.id===id);
  if(!d) return '<div class="report-doc">Donation not found.</div>';
  const f = store.flats.find(x=>x.id===d.flat_id);
  const isInKind = d.kind==='in_kind';
  const amountLine = isInKind
    ? escapeHtml(d.item_description||'In-kind contribution') + (d.amount>0 ? ' (est. '+fmtINR(d.amount)+')' : '')
    : fmtINR(d.amount);
  const rows = [
    ['Receipt No.', d.id.slice(0,8).toUpperCase()],
    ['Flat', f?f.label:d.flat_id],
    ['Received From', d.name],
    ['Date', fmtDate(d.date)],
    ['Mode', isInKind ? 'In-Kind' : d.mode],
    ['Collected By', d.collected_by_name || '—'],
  ];
  if(d.note) rows.push(['Note', d.note]);
  return `<div class="report-doc">
    ${reportHeader('Donation Receipt')}
    <div class="receipt-amount">${amountLine}</div>
    <table class="receipt-table">
      ${rows.map(r=>`<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td></tr>`).join('')}
    </table>
    <div class="report-footer">Thank you for your contribution to ${escapeHtml(store.settings.committee_name||'')} — ${ui.year}.</div>
  </div>`;
}
function printDonationReceipt(id){
  document.getElementById('printReportArea').innerHTML = buildDonationReceiptHTML(id);
  window.print();
}

/* ---------- backup export ---------- */
function downloadFile(filename, content, mime){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
document.getElementById('exportBackupBtn').addEventListener('click', ()=>{
  downloadFile(`ganesh-pooja-backup-${todayISO()}.json`, JSON.stringify(store, null, 2), 'application/json');
});

/* ---------- CSV export (opens straight in Excel/Sheets) ---------- */
function toCSV(headers, rows){
  const esc = (v)=>{ const s = String(v??''); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const lines = [headers.map(esc).join(','), ...rows.map(r=>r.map(esc).join(','))];
  return '﻿' + lines.join('\r\n'); // BOM so Excel reads ₹/UTF-8 correctly
}
function downloadCSV(filename, headers, rows){
  downloadFile(filename, toCSV(headers, rows), 'text/csv;charset=utf-8;');
}
function exportDonationsCSV(){
  const v = computeView();
  const rows = v.donationsSorted.map(d=>[d.date, d.title, d.kind==='in_kind'?'In-Kind':'Cash', d.mode||'', d.amount, d.itemDescription||'', d.collectedByName||'', d.note||'']);
  downloadCSV(`donations-${ui.year}-${todayISO()}.csv`, ['Date','Flat / Donor','Type','Mode','Amount','Item (if in-kind)','Collected By','Note'], rows);
}
function exportExpensesCSV(){
  const v = computeView();
  const rows = v.expensesSorted.map(e=>[e.date, e.title, e.description, e.mode, e.amount, e.billUrl?'Yes':'No']);
  downloadCSV(`expenses-${ui.year}-${todayISO()}.csv`, ['Date','Category','Description','Mode','Amount','Bill Attached'], rows);
}
function exportTransactionsCSV(){
  const v = computeView();
  const rows = v.filteredTransactions.map(t=>[t.date, t.typeLabel, t.title, t.mode||'', t.amount]);
  downloadCSV(`transactions-${ui.year}-${todayISO()}.csv`, ['Date','Type','Details','Mode','Amount'], rows);
}
document.getElementById('exportDonationsCsvBtn').addEventListener('click', exportDonationsCSV);
document.getElementById('exportExpensesCsvBtn').addEventListener('click', exportExpensesCSV);
document.getElementById('exportDonationsCsvBtnList').addEventListener('click', exportDonationsCSV);
document.getElementById('exportExpensesCsvBtnList').addEventListener('click', exportExpensesCSV);
document.getElementById('exportTxnCsvBtn').addEventListener('click', exportTransactionsCSV);

document.getElementById('clearAllBtn').addEventListener('click', async ()=>{
  if(!perms.isAdmin) return;
  if(!confirm('This will permanently delete ALL donations and expenses (flats are kept). Continue?')) return;
  if(!confirm('Really sure? This cannot be undone.')) return;
  const NIL = '00000000-0000-0000-0000-000000000000';
  const [r1, r2] = await Promise.all([
    sb.from('ganesh_donations').delete().neq('id', NIL),
    sb.from('ganesh_expenses').delete().neq('id', NIL),
  ]);
  if(r1.error || r2.error){ showToast('Error clearing data'); return; }
  await logActivity('Cleared all data', 'All donations & expenses deleted');
  await fetchAllData();
  closeSettingsModal();
  renderAll();
  showToast('All transaction data cleared');
});

/* ---------- close modals on overlay click ---------- */
const ALL_MODALS = [donationModal, expenseModal, flatModal, settingsModal, sevaDayModal, sevaSignupModal, transferModal, budgetModal];
ALL_MODALS.forEach(modal=>{
  modal.addEventListener('click', (e)=>{ if(e.target===modal) modal.classList.add('hidden'); });
});

/* ---------- Escape key closes whichever modal is open ---------- */
document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Escape') return;
  const open = ALL_MODALS.find(m => !m.classList.contains('hidden'));
  if(open) open.classList.add('hidden');
});

/* ---------- offline / online awareness ---------- */
function updateOnlineStatus(){
  const offline = !navigator.onLine;
  document.getElementById('offlineBanner').classList.toggle('hidden', !offline);
  document.body.classList.toggle('is-offline', offline);
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

/* ============================================================
   PWA: service worker + "Install App" prompt
   ============================================================ */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('./sw.js').catch(err=>console.error('SW registration failed', err));
  });
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('installAppField').classList.remove('hidden');
});
document.getElementById('installAppBtn').addEventListener('click', async ()=>{
  if(!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('installAppField').classList.add('hidden');
});
window.addEventListener('appinstalled', ()=>{
  document.getElementById('installAppField').classList.add('hidden');
  showToast('App installed ✓');
});

// iOS Safari has no beforeinstallprompt — show manual "Add to Home Screen" instructions instead.
(function showIosInstallHintIfNeeded(){
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if(isIos && !isStandalone){
    document.getElementById('installIosField').classList.remove('hidden');
  }
})();

/* ---------- auth screen default mode ---------- */
setAuthMode('signin');
