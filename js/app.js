/* Ganesh Pooja Expense Portal — Supabase-backed, role-based access
   Roles: super_admin (full access), treasurer (expenses),
   donation_collector (donations + flat owner/tenant edits), viewer (read-only). */

const SUPABASE_URL = 'https://tzcernzuwtwgrsattjaw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_qTZL-nfangfMUqdBcBvgww_q_ucMvXR';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CATEGORIES = ['Pooja Samagri','Idol & Decoration','Prasad & Food','Sound & Lighting','Flowers & Decoration','Priest / Purohit','Miscellaneous'];
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
// NOTE: deliberately NOT using toISOString() here -- it converts to UTC,
// which rolls the calendar date back a day for any timezone ahead of UTC
// (e.g. IST, UTC+5:30) during the first few hours of the local day.
function todayISO(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
/* Native <input type="date"> pickers render in whatever format the user's
   browser/OS locale is set to (often US MM/DD/YYYY) -- there is no way to
   force that from the page itself. To avoid any ambiguity, every date field
   pairs with a small hint element that spells the picked date out in full,
   Indian style ("14 September 2026"), updated live as the user picks. */
function wireDateConfirm(inputId, hintId){
  const input = document.getElementById(inputId);
  const hint = document.getElementById(hintId);
  if(!input || !hint) return;
  const update = () => {
    if(!input.value){ hint.textContent = ''; hint.classList.remove('warn'); return; }
    const d = new Date(input.value+'T00:00:00');
    if(isNaN(d)){ hint.textContent = ''; hint.classList.remove('warn'); return; }
    const nowYear = new Date().getFullYear();
    // Sane-range check: catches typo'd years (e.g. 2205 for 2025, or a
    // stray old year) without blocking anything -- it's a warning, not a
    // validation error, since a genuinely old/future record is still valid.
    const outOfRange = d.getFullYear() < (nowYear-1) || d.getFullYear() > (nowYear+1);
    hint.textContent = (outOfRange ? '⚠ ' : '= ') + d.toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}) + (outOfRange ? ' — check the year' : '');
    hint.classList.toggle('warn', outOfRange);
  };
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  update();
}
[['donDate','donDateHint'],['expDate','expDateHint'],['transferDate','transferDateHint'],
 ['sevaDayDate','sevaDayDateHint'],['sevaDayDateTo','sevaDayDateToHint'],['pledgeDate','pledgeDateHint'],
 ['bulkImportDate','bulkImportDateHint']]
  .forEach(([inputId,hintId]) => wireDateConfirm(inputId,hintId));

/* Same idea as wireDateConfirm, but for amount fields -- echoes the typed
   number back as a fully-formatted Indian-style rupee amount ("= ₹1,25,000")
   so a fat-fingered extra zero (₹1,25,000 vs ₹12,50,000) is obvious before
   saving, since the raw <input type="number"> gives no grouping at all. */
function wireAmountConfirm(inputId, hintId){
  const input = document.getElementById(inputId);
  const hint = document.getElementById(hintId);
  if(!input || !hint) return;
  const update = () => {
    const n = Number(input.value);
    if(!input.value || isNaN(n) || n<=0){ hint.textContent = ''; return; }
    hint.textContent = '= ' + fmtINR(n);
  };
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  update();
}
[['donAmount','donAmountHint'],['donItemValue','donItemValueHint'],['pledgeAmount','pledgeAmountHint'],
 ['expAmount','expAmountHint'],['transferAmount','transferAmountHint'],['expTotalExpected','expTotalExpectedHint']]
  .forEach(([inputId,hintId]) => wireAmountConfirm(inputId,hintId));

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

// Everyone selectable as Collected By / Recorded By / a fund transfer party:
// real signed-up accounts (store.profiles) plus reference-only people Super
// Admin added with just a name + mobile number for someone who hasn't
// signed up yet (store.people). Options carry the display name in
// data-name, so save handlers never need to re-look-up the name by id --
// that lookup would fail for a placeholder person id, which isn't in
// store.profiles.
function assignablePeopleOptionsHtml(){
  const profs = store.profiles.map(p=>({ id:p.id, name:displayName(p) }));
  const ppl = store.people.map(p=>({ id:p.id, name:p.full_name+(p.profile_id?'':' (not signed up)') }));
  return profs.concat(ppl).map(p=>
    `<option value="${p.id}" data-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`
  ).join('');
}

// Resolve a recorded_by/collected_by id to its CURRENT display name, rather
// than the name text snapshotted on the transaction when it was saved --
// otherwise a "not signed up" placeholder name never updates (and splits
// into a second bucket in per-person breakdowns) once that person links to
// a real account and starts recording under their profile name instead.
function currentPersonName(id, fallbackName){
  if(!id) return fallbackName || 'Unassigned';
  const prof = store.profiles.find(p=>p.id===id);
  if(prof) return displayName(prof);
  const person = store.people.find(p=>p.id===id);
  if(person){
    const linked = person.profile_id ? store.profiles.find(p=>p.id===person.profile_id) : null;
    return linked ? displayName(linked) : person.full_name+' (not signed up)';
  }
  return fallbackName || 'Unassigned';
}

/* ---------- sortable table headers ---------- */
// Applies a {key, dir} sort state to a list using a per-key value-extractor
// map. Used by every data table (Flats, Donations, Expenses, Transactions)
// so clicking a column header re-orders that table without touching the
// underlying totals/breakdowns computed elsewhere from the unsorted data.
function applySort(list, sortState, valueFns){
  const fn = sortState && valueFns[sortState.key];
  if(!fn) return list;
  const sorted = [...list].sort((a,b)=>{
    const va = fn(a), vb = fn(b);
    if(va<vb) return -1;
    if(va>vb) return 1;
    return 0;
  });
  if(sortState.dir==='desc') sorted.reverse();
  return sorted;
}
// Wires click-to-sort on a table's <th data-sort-key> cells once at startup
// (the headers are static markup -- only <tbody> gets re-rendered).
function wireSortableHeaders(theadSelector, sortState){
  document.querySelectorAll(theadSelector+' th[data-sort-key]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.dataset.sortKey;
      if(sortState.key===key){ sortState.dir = sortState.dir==='asc' ? 'desc' : 'asc'; }
      else { sortState.key = key; sortState.dir = 'asc'; }
      renderAll();
    });
  });
}
// Updates the ▲/▼ indicator + highlight on whichever header is active.
function updateSortHeaderUI(theadSelector, sortState){
  document.querySelectorAll(theadSelector+' th[data-sort-key]').forEach(th=>{
    const isActive = th.dataset.sortKey===sortState.key;
    th.classList.toggle('sorted', isActive);
    const existingArrow = th.querySelector('.sort-arrow');
    if(existingArrow) existingArrow.remove();
    if(isActive){
      th.insertAdjacentHTML('beforeend', ` <span class="sort-arrow">${sortState.dir==='asc'?'▲':'▼'}</span>`);
    }
  });
}

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
const store = { flats:[], donations:[], pledges:[], expenses:[], settings:{committee_name:'Ganesh Pooja Committee', upi_number_1:'', upi_number_2:'', seva_signup_url:''}, profiles:[], people:[], sevaDays:[], sevaSignups:[], fundTransfers:[], budgets:[], openingBalances:[], activityLog:[] };
const BUDGET_COLORS = ['#F97316','#2563EB','#16A34A','#DC2626','#9333EA','#0EA5E9','#CA8A04','#DB2777','#0D9488','#64748B','#EA580C','#4F46E5'];

/* ---- transient UI state (not persisted) ---- */
const ui = {
  screen:'dashboard',
  year: String(new Date().getFullYear()),
  flatsFilter:'all',
  flatsSearch:'',
  txnFilter:'all',
  editingFlatId:null,
  editingExpenseId:null,
  editingDonationId:null,
  editingTransferId:null,
  editingSevaDayId:null,
  authMode:'signin',
  pledgeBeingFulfilled:null,
  // Set by clicking a name in the Expenses "Recorded By" breakdown --
  // {key, name} of the person to narrow the expense list/cards down to.
  expensesPersonFilter:null,
  // Sortable table headers -- default order matches each table's previous
  // fixed behavior (flats by flat number, everything else by newest first),
  // so nothing changes until a resident clicks a column header.
  flatsSort:{key:'flat', dir:'asc'},
  donationsSort:{key:'date', dir:'desc'},
  expensesSort:{key:'date', dir:'desc'},
  txnSort:{key:'date', dir:'desc'},
};

wireSortableHeaders('#screen-flats .data-table thead', ui.flatsSort);
wireSortableHeaders('#screen-donations .data-table thead', ui.donationsSort);
wireSortableHeaders('#screen-expenses .data-table thead', ui.expensesSort);
wireSortableHeaders('#screen-transactions .data-table thead', ui.txnSort);

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
  const [flatsRes, donationsRes, pledgesRes, expensesRes, settingsRes, sevaDaysRes, sevaSignupsRes, transfersRes, budgetsRes, openingRes] = await Promise.all([
    sb.from('ganesh_flats').select('*').order('id'),
    sb.from('ganesh_donations').select('*').order('date',{ascending:false}),
    sb.from('ganesh_pledges').select('*').order('pledged_date',{ascending:false}),
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
  store.pledges = (pledgesRes.data||[]).map(p=>Object.assign({}, p, { amount:Number(p.amount) }));
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
    // Reference-only people (name + mobile) Super Admin added before they
    // have a real account -- selectable for Collected By / Recorded By /
    // fund transfers the same as a signed-up profile.
    const { data: ppl, error: pplErr } = await sb.from('ganesh_people').select('*').order('full_name');
    if(!pplErr) store.people = ppl || [];
  } else {
    store.profiles = [];
    store.people = [];
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
  // "collected" is total contribution value (cash + estimated in-kind value)
  // for display purposes; "cashCollected" is cash-only and is what the
  // Balance formula must use — an idol or laddu sponsorship's estimated
  // value was never actual cash in hand, so it can't offset real expenses.
  const cashCollected = yDonations.filter(d=>d.kind==='cash').reduce((s,d)=>s+d.amount,0);
  const inKindValue = yDonations.filter(d=>d.kind==='in_kind').reduce((s,d)=>s+d.amount,0);
  const collected = cashCollected + inKindValue;
  const spent = yExpenses.reduce((s,e)=>s+e.amount,0);
  const openingRow = store.openingBalances.find(o=>o.year===year);
  const opening = openingRow ? Number(openingRow.amount)||0 : 0;
  return { collected, cashCollected, inKindValue, spent, opening, balance: opening + cashCollected - spent };
}

function computeView(){
  const donations = store.donations.filter(d => yearOf(d.date)===ui.year);
  const expenses = store.expenses.filter(e => yearOf(e.date)===ui.year);
  // "collected" = total contribution value (cash + estimated in-kind value),
  // shown as the headline "Total Collected" stat. "cashCollected" is the
  // cash-only figure the Balance formula must use — an in-kind item's
  // estimated value was never actual cash in hand, so it can't be netted
  // against real cash expenses without overstating how much money there is.
  const cashCollected = donations.filter(d=>d.kind==='cash').reduce((s,d)=>s+d.amount,0);
  const inKindValue = donations.filter(d=>d.kind==='in_kind').reduce((s,d)=>s+d.amount,0);
  const totalCollected = cashCollected + inKindValue;
  const totalExpenses = expenses.reduce((s,e)=>s+e.amount,0);
  const openingBalanceRow = store.openingBalances.find(o=>o.year===ui.year);
  const openingBalance = openingBalanceRow ? Number(openingBalanceRow.amount)||0 : 0;
  const balance = openingBalance + cashCollected - totalExpenses;

  // ---- Committed but not yet paid: advances already given (e.g. priest's
  // day-1 advance) that still owe a balance later. This money is already
  // "spoken for" even though it hasn't left the account yet, so treating
  // the full Current Balance as free-to-spend would overstate what's
  // actually safe to commit to new expenses.
  const pendingRows = expenses.filter(e=>{
    const pt = e.payment_type || 'full';
    if(pt==='full' || e.total_expected==null) return false;
    return (Number(e.total_expected) - e.amount) > 0;
  }).map(e=>({
    id: e.id, category: e.category, description: e.description,
    due: Number(e.total_expected) - e.amount,
  }));
  const pendingBalanceDue = pendingRows.reduce((s,r)=>s+r.due, 0);
  const availableToSpend = balance - pendingBalanceDue;

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
    const flatLabel = f ? f.label : (d.flat_id || 'Unknown / Vacated Tenant');
    return {
      id:d.id, type:'in', typeLabel:'Money In',
      title:flatLabel+' • '+d.name,
      subtitle: isInKind ? 'In-Kind • '+(d.item_description||'Item') : 'Donation • '+d.mode,
      mode: isInKind ? 'In-Kind' : d.mode, kind: d.kind, itemDescription: d.item_description,
      amount:d.amount, amountFmt:amountDisplay, amountSigned:signedDisplay, color:'#16A34A',
      date:d.date, dateFmt:fmtDate(d.date), ts:d.created_at || d.date,
      flatLabel, donorName:d.name, note:d.note||'', collectedByName:d.collected_by_name||'',
    };
  });
  const expenseTx = expenses.map(e=>{
    const paymentType = e.payment_type || 'full';
    const totalExpected = e.total_expected!=null ? Number(e.total_expected) : null;
    const balanceDue = (paymentType!=='full' && totalExpected!=null) ? (totalExpected - e.amount) : null;
    return {
      id:e.id, type:'out', typeLabel:'Money Out',
      title:e.category, description:e.description,
      subtitle:e.description+' • '+e.mode, mode:e.mode,
      amount:e.amount, amountFmt:fmtINR(e.amount), amountSigned:'-'+fmtINR(e.amount), color:'#DC2626',
      date:e.date, dateFmt:fmtDate(e.date), ts:e.created_at || e.date,
      billUrl: e.bill_url || null,
      paymentType, totalExpected, balanceDue,
      recordedByKey: e.recorded_by || 'unassigned',
      recordedByName: currentPersonName(e.recorded_by, e.recorded_by_name),
    };
  });
  const transactions = donationTx.concat(expenseTx).sort((a,b)=> (b.ts>a.ts?1:-1));
  const recentTransactions = transactions.slice(0,5);

  let filteredTransactions = transactions;
  if(ui.txnFilter==='in') filteredTransactions = transactions.filter(t=>t.type==='in');
  if(ui.txnFilter==='out') filteredTransactions = transactions.filter(t=>t.type==='out');

  const donationsSorted = [...donationTx].sort((a,b)=> (b.ts>a.ts?1:-1));
  const expensesSorted = [...expenseTx].sort((a,b)=> (b.ts>a.ts?1:-1));
  const filteredExpensesSorted = ui.expensesPersonFilter
    ? expensesSorted.filter(e => e.recordedByKey === ui.expensesPersonFilter.key)
    : expensesSorted;

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

  // Keyed by id (not the name text) so a person's expenses stay in one
  // bucket even if their recorded_by_name snapshot changes over time --
  // e.g. after a "not signed up" placeholder gets linked to a real account.
  const recordedTotals = {};
  expenses.forEach(e=>{
    const key = e.recorded_by || 'unassigned';
    if(!recordedTotals[key]) recordedTotals[key] = { name: currentPersonName(e.recorded_by, e.recorded_by_name), amount:0 };
    recordedTotals[key].amount += e.amount;
  });
  const recordedMax = Math.max(1, ...Object.values(recordedTotals).map(x=>x.amount), 1);
  const recordedByBreakdown = Object.keys(recordedTotals).sort((a,b)=>recordedTotals[b].amount-recordedTotals[a].amount).map(key=>({
    key, person:recordedTotals[key].name, amount:recordedTotals[key].amount,
    amountFmt:fmtINR(recordedTotals[key].amount), pct: Math.round(recordedTotals[key].amount/recordedMax*100),
  }));

  // Fund custody: who is currently holding how much (collected − spent − handed off + received)
  // Keyed by the person's id, not their display name -- a name-keyed bucket
  // silently splits into two whenever the same person's name is rendered
  // differently between entries (renamed profile, or picked as a "team
  // member" reference before vs. after being linked to a real account), so
  // a transfer and the expense it funded stop netting against each other
  // even though they're the same person. The id (collected_by / recorded_by
  // / from_user / to_user) stays stable regardless of name changes; the
  // *_name text is only used to label the bucket for display.
  const transfers = store.fundTransfers.filter(t => yearOf(t.date)===ui.year);
  const custody = {};
  const custodyNames = {};
  // Itemized in/out entries per person, so a click on their custody bar can
  // show exactly what made up that balance (which donations, expenses and
  // transfers), not just the net total.
  const custodyItems = {};
  const addCustody = (id, name, delta) => {
    const key = id || 'unassigned';
    custody[key] = (custody[key]||0) + delta;
    if(name) custodyNames[key] = name;
  };
  const addCustodyItem = (id, dir, item) => {
    const key = id || 'unassigned';
    if(!custodyItems[key]) custodyItems[key] = { in:[], out:[] };
    custodyItems[key][dir].push(item);
  };
  // Cash-only — an in-kind item's estimated value was never physically
  // handed to the collector, so it shouldn't inflate their custody balance.
  donations.filter(d=>d.kind==='cash').forEach(d=>{
    addCustody(d.collected_by, d.collected_by_name, d.amount);
    addCustodyItem(d.collected_by, 'in', { label:'Donation • '+d.name, amount:d.amount, date:d.date, dateFmt:fmtDate(d.date) });
  });
  expenses.forEach(e=>{
    addCustody(e.recorded_by, e.recorded_by_name, -e.amount);
    addCustodyItem(e.recorded_by, 'out', { label:'Expense • '+e.category+(e.description?' — '+e.description:''), amount:e.amount, date:e.date, dateFmt:fmtDate(e.date) });
  });
  transfers.forEach(t=>{
    addCustody(t.from_user, t.from_user_name, -t.amount);
    addCustody(t.to_user, t.to_user_name, t.amount);
    addCustodyItem(t.from_user, 'out', { label:'Transfer to '+(t.to_user_name||'Unassigned')+(t.note?' • '+t.note:''), amount:t.amount, date:t.date, dateFmt:fmtDate(t.date) });
    addCustodyItem(t.to_user, 'in', { label:'Transfer from '+(t.from_user_name||'Unassigned')+(t.note?' • '+t.note:''), amount:t.amount, date:t.date, dateFmt:fmtDate(t.date) });
  });
  const custodyMax = Math.max(1, ...Object.values(custody).map(Math.abs), 1);
  const custodyBreakdown = Object.keys(custody)
    .filter(key => Math.round(custody[key])!==0)
    .sort((a,b)=>custody[b]-custody[a])
    .map(key=>{
      const items = custodyItems[key] || { in:[], out:[] };
      const itemsIn = [...items.in].sort((a,b)=> (b.date>a.date?1:-1)).map(x=>Object.assign({}, x, { amountFmt:fmtINR(x.amount) }));
      const itemsOut = [...items.out].sort((a,b)=> (b.date>a.date?1:-1)).map(x=>Object.assign({}, x, { amountFmt:fmtINR(x.amount) }));
      const totalIn = items.in.reduce((s,x)=>s+x.amount,0);
      const totalOut = items.out.reduce((s,x)=>s+x.amount,0);
      return {
        key, person: custodyNames[key] || 'Unassigned', amount:custody[key], amountFmt: (custody[key]<0?'-':'')+fmtINR(Math.abs(custody[key])),
        isNegative: custody[key]<0, pct: Math.round(Math.abs(custody[key])/custodyMax*100),
        totalIn, totalInFmt: fmtINR(totalIn), totalOut, totalOutFmt: fmtINR(totalOut), itemsIn, itemsOut,
      };
    });

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

  // ---- Pledges: promised but not yet received (for this year, still pending) ----
  const pledgeRows = store.pledges.filter(p => p.status==='pending' && yearOf(p.pledged_date)===ui.year)
    .sort((a,b)=> (a.pledged_date<b.pledged_date?1:-1))
    .map(p=>{
      const f = store.flats.find(x=>x.id===p.flat_id);
      return Object.assign({}, p, { flatLabel: f?f.label:p.flat_id, amountFmt: fmtINR(p.amount), pledgedDateFmt: fmtDate(p.pledged_date) });
    });
  const totalPledged = pledgeRows.reduce((s,p)=>s+p.amount,0);

  // ---- Prasadam seva: how many Pooja / Pooja & Prasadam slots still need a volunteer ----
  const sevaTotalSlots = store.sevaDays.length * SEVA_SESSIONS.length;
  let sevaOpenSlots = 0;
  store.sevaDays.forEach(day=>{
    SEVA_SESSIONS.forEach(sess=>{
      const has = store.sevaSignups.some(s=>s.day_id===day.id && s.session===sess.key);
      if(!has) sevaOpenSlots++;
    });
  });
  const sevaFilledSlots = sevaTotalSlots - sevaOpenSlots;
  const sevaFilledPct = sevaTotalSlots ? Math.round(sevaFilledSlots/sevaTotalSlots*100) : 0;

  return {
    totalCollected, cashCollected, inKindValue, totalExpenses, balance, openingBalance,
    pendingRows, pendingBalanceDue, availableToSpend,
    contributedCount, notContributedCount, totalFlats, contributedPct, maxIE,
    recentTransactions, filteredTransactions, donationsSorted, expensesSorted, filteredExpensesSorted,
    categoryBreakdown, collectedByBreakdown, recordedByBreakdown,
    budgetBreakdown, budgetDonutSegments, totalBudgetAllocated, overallBudgetPctUsed,
    custodyBreakdown, recentTransfers, yearComparison,
    sevaTotalSlots, sevaOpenSlots, sevaFilledSlots, sevaFilledPct,
    pledgeRows, totalPledged, totalPledgedFmt: fmtINR(totalPledged),
    filteredFlats, hasData: donations.length>0 || expenses.length>0,
  };
}

/* ============================================================
   RENDERING
   ============================================================ */
const SCREENS = ['dashboard','flats','donations','expenses','transactions','prasadam'];
// Four seva slots per day: Morning/Evening crossed with Pooja / Pooja &
// Prasadam (Both), so residents pick a time AND a type.
const SEVA_SESSIONS = [
  { key:'morning_pooja', label:'Morning — Pooja', icon:'🌅' },
  { key:'morning_pooja_prasadam', label:'Morning — Pooja & Prasadam (Both)', icon:'🌅' },
  { key:'evening_pooja', label:'Evening — Pooja', icon:'🌇' },
  { key:'evening_pooja_prasadam', label:'Evening — Pooja & Prasadam (Both)', icon:'🌇' },
];
// Two cards per day (Morning / Evening); the Pooja vs Pooja & Prasadam
// (Both) choice is made inside the Add-Your-Name form via SEVA_TYPES.
const SEVA_TIMES = [
  { key:'morning', label:'Morning', icon:'🌅' },
  { key:'evening', label:'Evening', icon:'🌇' },
];
// "Both" listed first (default), "Only Pooja" second, per committee request.
const SEVA_TYPES = [
  { key:'pooja_prasadam', label:'Pooja & Prasadam (Both)', tag:'Pooja & Prasadam' },
  { key:'pooja', label:'Only Pooja', tag:'Pooja only' },
];
function sevaTimeOf(sessionKey){ return String(sessionKey||'').startsWith('evening') ? 'evening' : 'morning'; }
function sevaTypeOf(sessionKey){ return String(sessionKey||'').endsWith('pooja_prasadam') ? 'pooja_prasadam' : 'pooja'; }
function sevaComposeSession(time, type){ return `${time}_${type}`; }

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
  // Pull years from every table that carries a year, not just donations/
  // expenses -- a year with (say) only an opening balance set, or only
  // pledges/seva days recorded, still needs to be selectable, otherwise
  // it silently disappears from the dropdown even though its data exists.
  const years = new Set([String(new Date().getFullYear())]);
  store.donations.forEach(d=>years.add(yearOf(d.date)));
  store.expenses.forEach(e=>years.add(yearOf(e.date)));
  store.pledges.forEach(p=>years.add(yearOf(p.pledged_date)));
  store.openingBalances.forEach(o=>years.add(String(o.year)));
  store.fundTransfers.forEach(t=>years.add(yearOf(t.created_at)));
  store.sevaDays.forEach(d=>years.add(yearOf(d.seva_date)));
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

  const obRow = store.openingBalances.find(o=>o.year===ui.year);
  const obBanner = document.getElementById('noOpeningBalanceBanner');
  obBanner.classList.toggle('hidden', !!obRow);
  document.getElementById('noOpeningBalanceYear').textContent = ui.year;

  if(!hasData) return;

  document.getElementById('statCollected').textContent = fmtINR(v.totalCollected);
  const inKindHint = document.getElementById('statInKindHint');
  inKindHint.classList.toggle('hidden', !v.inKindValue);
  inKindHint.textContent = v.inKindValue ? 'Includes '+fmtINR(v.inKindValue)+' in-kind (est. value, not cash)' : '';
  document.getElementById('statExpenses').textContent = fmtINR(v.totalExpenses);
  document.getElementById('statBalance').textContent = fmtINR(v.balance);
  document.getElementById('statFlats').textContent = v.contributedCount+' / '+v.totalFlats;
  const balHint = document.getElementById('statBalanceHint');
  const balHintParts = [];
  if(v.openingBalance) balHintParts.push('Includes '+fmtINR(v.openingBalance)+' opening balance');
  balHintParts.push('cash only — excludes in-kind value');
  balHint.classList.remove('hidden');
  balHint.textContent = balHintParts.join(' · ');

  // "Available to Spend" = Current Balance minus advances already given
  // that still owe a balance later -- money that's already committed even
  // though it hasn't left the account yet, so it shouldn't read as free.
  const availEl = document.getElementById('statAvailable');
  availEl.textContent = fmtINR(v.availableToSpend);
  availEl.classList.remove('green','red','blue','orange','teal');
  availEl.classList.add(v.availableToSpend < 0 ? 'red' : 'teal');
  const availHint = document.getElementById('statAvailableHint');
  availHint.classList.toggle('hidden', !v.pendingBalanceDue);
  availHint.textContent = v.pendingBalanceDue
    ? 'After '+fmtINR(v.pendingBalanceDue)+' committed (advances owing a balance)'
    : '';

  const pendingPanel = document.getElementById('pendingBalancePanel');
  pendingPanel.classList.toggle('hidden', !v.pendingRows.length);
  document.getElementById('pendingBalanceAmt').textContent = fmtINR(v.pendingBalanceDue);
  document.getElementById('pendingBalanceSub').textContent =
    v.pendingRows.length + ' expense' + (v.pendingRows.length===1?'':'s') + ' with a balance still due';

  document.getElementById('flatsProgressTitle').textContent = v.contributedCount+' / '+v.totalFlats+' Flats Contributed';
  document.getElementById('flatsProgressBar').style.width = v.contributedPct+'%';
  document.getElementById('legendContributed').textContent = v.contributedCount+' Contributed';
  document.getElementById('legendNotContributed').textContent = v.notContributedCount+' Not Contributed';

  renderSevaProgress(v);

  document.getElementById('incomeAmt').textContent = fmtINR(v.totalCollected);
  document.getElementById('expenseAmt').textContent = fmtINR(v.totalExpenses);
  document.getElementById('incomeBar').style.width = Math.round(v.totalCollected/v.maxIE*100)+'%';
  document.getElementById('expenseBar').style.width = Math.round(v.totalExpenses/v.maxIE*100)+'%';

  document.getElementById('custodyBreakdown').innerHTML = v.custodyBreakdown.map(c=>`
    <div class="bar-row-clickable" data-key="${escapeHtml(c.key)}" title="Click to see money in/out for ${escapeHtml(c.person)}">
      <div class="stack-row"><span>${escapeHtml(c.person)}</span><span class="${c.isNegative?'red':'green'}">${c.amountFmt}</span></div>
      <div class="bar-track"><div class="bar-fill ${c.isNegative?'red':'green'}" style="width:${c.pct}%"></div></div>
    </div>
  `).join('') || '<p class="empty-sub">Nothing collected or spent yet for '+ui.year+'.</p>';
  // Only super_admin can edit/delete a transfer per RLS (treasurer can record
  // one but not alter history) — gate the buttons the same way so they never
  // appear only to fail.
  const transferActions = perms.isAdmin ? `
        <button class="item-card-edit edit-transfer" data-id="${'{{ID}}'}" title="Edit">✎</button>
        <button class="item-card-edit delete-transfer" data-id="${'{{ID}}'}" title="Delete">🗑</button>` : '';
  document.getElementById('recentTransfersList').innerHTML = v.recentTransfers.map(t=>`
    <div class="txn-row">
      <div class="txn-left">
        <span class="txn-dot" style="background:#2563EB"></span>
        <div>
          <div class="txn-title">${escapeHtml(t.title)}</div>
          <div class="txn-sub">${escapeHtml(t.subtitle)} · ${t.dateFmt}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div class="txn-amt" style="color:#2563EB">${t.amountFmt}</div>
        ${transferActions.replaceAll('{{ID}}', t.id)}
      </div>
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
  const c = v.yearComparison;
  document.getElementById('yearCompareEmpty').classList.toggle('hidden', !!c);
  document.getElementById('yearCompareGrid').classList.toggle('hidden', !c);
  if(!c){ document.getElementById('yearCompareTitle').textContent = 'This Year vs Last Year'; return; }
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

/* ============================================================
   GLOBAL SEARCH — across donations, expenses, pledges, flats,
   spanning every year (not just the one currently selected).
   ============================================================ */
function runGlobalSearch(qRaw){
  const q = qRaw.trim().toLowerCase();
  if(q.length < 2) return null;

  const donationHits = store.donations.filter(d=>{
    const f = store.flats.find(x=>x.id===d.flat_id);
    return (d.name||'').toLowerCase().includes(q) || (d.flat_id||'').toLowerCase().includes(q)
      || (f && (f.label||'').toLowerCase().includes(q)) || (d.note||'').toLowerCase().includes(q)
      || (d.item_description||'').toLowerCase().includes(q);
  }).sort((a,b)=> (b.date>a.date?1:-1)).slice(0,6).map(d=>{
    const f = store.flats.find(x=>x.id===d.flat_id);
    return { type:'donation', id:d.id, year:yearOf(d.date),
      title:(f?f.label:(d.flat_id||'Unknown / Vacated Tenant'))+' — '+d.name, sub:'Donation · '+fmtDate(d.date),
      amtFmt: d.amount>0 ? fmtINR(d.amount) : (d.item_description||'In-kind'), color:'#16A34A' };
  });

  const expenseHits = store.expenses.filter(e=>{
    return (e.category||'').toLowerCase().includes(q) || (e.description||'').toLowerCase().includes(q) || (e.note||'').toLowerCase().includes(q);
  }).sort((a,b)=> (b.date>a.date?1:-1)).slice(0,6).map(e=>({
    type:'expense', id:e.id, year:yearOf(e.date),
    title:e.category+' — '+e.description, sub:'Expense · '+fmtDate(e.date),
    amtFmt: fmtINR(e.amount), color:'#DC2626',
  }));

  const pledgeHits = store.pledges.filter(p=>{
    const f = store.flats.find(x=>x.id===p.flat_id);
    return (p.name||'').toLowerCase().includes(q) || (p.flat_id||'').toLowerCase().includes(q)
      || (f && (f.label||'').toLowerCase().includes(q)) || (p.note||'').toLowerCase().includes(q);
  }).sort((a,b)=> (b.pledged_date>a.pledged_date?1:-1)).slice(0,6).map(p=>{
    const f = store.flats.find(x=>x.id===p.flat_id);
    return { type:'pledge', id:p.id, year:yearOf(p.pledged_date),
      title:(f?f.label:p.flat_id)+' — '+p.name, sub:'Pledge ('+p.status+') · '+fmtDate(p.pledged_date),
      amtFmt: fmtINR(p.amount), color:'#D97706' };
  });

  const flatHits = store.flats.filter(f=>{
    return (f.id||'').toLowerCase().includes(q) || (f.label||'').toLowerCase().includes(q)
      || (f.owner||'').toLowerCase().includes(q) || (f.tenant||'').toLowerCase().includes(q);
  }).slice(0,6).map(f=>({
    type:'flat', id:f.id, title:f.label, sub:[f.owner,f.tenant].filter(Boolean).join(' / ') || 'Unassigned', amtFmt:'', color:'#2563EB',
  }));

  return { donationHits, expenseHits, pledgeHits, flatHits,
    total: donationHits.length + expenseHits.length + pledgeHits.length + flatHits.length };
}
function renderGlobalSearchResults(results){
  const box = document.getElementById('globalSearchResults');
  if(!results){ box.classList.add('hidden'); box.innerHTML=''; return; }
  if(results.total===0){
    box.innerHTML = '<div class="gsr-empty">No matches. Try a flat number, name, or category.</div>';
    box.classList.remove('hidden');
    return;
  }
  const group = (label, rows) => !rows.length ? '' : `
    <div class="gsr-group-label">${label.toUpperCase()}</div>
    ${rows.map(r=>`
      <div class="gsr-row" data-type="${r.type}" data-id="${r.id}" data-year="${r.year||''}">
        <div class="gsr-row-left">
          <div class="gsr-row-title">${escapeHtml(r.title)}</div>
          <div class="gsr-row-sub">${escapeHtml(r.sub)}</div>
        </div>
        <div class="gsr-row-amt" style="color:${r.color}">${escapeHtml(r.amtFmt)}</div>
      </div>`).join('')}`;
  box.innerHTML = group('Donations', results.donationHits) + group('Expenses', results.expenseHits)
    + group('Pledges', results.pledgeHits) + group('Flats', results.flatHits);
  box.classList.remove('hidden');
}
let globalSearchTimer;
const globalSearchInput = document.getElementById('globalSearchInput');
globalSearchInput.addEventListener('input', ()=>{
  const val = globalSearchInput.value;
  document.getElementById('globalSearchClear').classList.toggle('hidden', !val);
  clearTimeout(globalSearchTimer);
  globalSearchTimer = setTimeout(()=> renderGlobalSearchResults(runGlobalSearch(val)), 150);
});
globalSearchInput.addEventListener('focus', ()=>{
  if(globalSearchInput.value.trim().length>=2) renderGlobalSearchResults(runGlobalSearch(globalSearchInput.value));
});
document.getElementById('globalSearchClear').addEventListener('click', ()=>{
  globalSearchInput.value = '';
  document.getElementById('globalSearchClear').classList.add('hidden');
  renderGlobalSearchResults(null);
  globalSearchInput.focus();
});
document.getElementById('globalSearchResults').addEventListener('click', (e)=>{
  const row = e.target.closest('.gsr-row'); if(!row) return;
  const type = row.dataset.type, year = row.dataset.year;
  if(year) ui.year = year;
  if(type==='donation') goScreen('donations');
  else if(type==='expense') goScreen('expenses');
  else if(type==='pledge') goScreen('donations');
  else if(type==='flat'){ ui.flatsFilter='all'; ui.flatsSearch = row.querySelector('.gsr-row-title').textContent; goScreen('flats'); }
  renderGlobalSearchResults(null);
  globalSearchInput.value = '';
  document.getElementById('globalSearchClear').classList.add('hidden');
});
document.addEventListener('click', (e)=>{
  const wrap = document.querySelector('.global-search-wrap');
  if(wrap && !wrap.contains(e.target)) renderGlobalSearchResults(null);
});

/* ============================================================
   COMPARE ANY TWO YEARS — full expense category breakdown,
   not just the automatic "this year vs last year" summary above.
   ============================================================ */
function pctDeltaGlobal(curr, prev){
  if(!prev) return curr>0 ? null : 0;
  return Math.round(((curr-prev)/Math.abs(prev))*100);
}
function allDataYears(){
  const years = new Set([ui.year]);
  store.donations.forEach(d=>years.add(yearOf(d.date)));
  store.expenses.forEach(e=>years.add(yearOf(e.date)));
  store.pledges.forEach(p=>years.add(yearOf(p.pledged_date)));
  return Array.from(years).filter(Boolean).sort((a,b)=>b.localeCompare(a));
}
function yearSummary(year){
  const b = balanceOf(year, store.donations, store.expenses);
  const contributedIds = new Set(store.donations.filter(d=>yearOf(d.date)===year).map(d=>d.flat_id));
  const totalFlatsNow = store.flats.length;
  const contributedPct = totalFlatsNow ? Math.round(store.flats.filter(f=>contributedIds.has(f.id)).length/totalFlatsNow*100) : 0;
  return { collected:b.collected, expenses:b.spent, balance:b.balance, contributedPct };
}
function categoryTotalsForYear(year){
  const totals = {};
  store.expenses.filter(e=>yearOf(e.date)===year).forEach(e=>{ totals[e.category] = (totals[e.category]||0) + e.amount; });
  return totals;
}
function computeYearsComparison(yearA, yearB){
  const sa = yearSummary(yearA), sb = yearSummary(yearB);
  const hasData = (sa.collected>0 || sa.expenses>0) && (sb.collected>0 || sb.expenses>0);
  const summaryRows = [
    { name:'Collected', aFmt:fmtINR(sa.collected), bFmt:fmtINR(sb.collected), delta:pctDeltaGlobal(sb.collected,sa.collected), good:'up' },
    { name:'Expenses', aFmt:fmtINR(sa.expenses), bFmt:fmtINR(sb.expenses), delta:pctDeltaGlobal(sb.expenses,sa.expenses), good:'down' },
    { name:'Balance', aFmt:fmtINR(sa.balance), bFmt:fmtINR(sb.balance), delta:pctDeltaGlobal(sb.balance,sa.balance), good:'up' },
    { name:'Flats Contributed', aFmt:sa.contributedPct+'%', bFmt:sb.contributedPct+'%', delta:sb.contributedPct-sa.contributedPct, good:'up' },
  ];

  const catA = categoryTotalsForYear(yearA), catB = categoryTotalsForYear(yearB);
  const allCats = Array.from(new Set([...Object.keys(catA), ...Object.keys(catB)]));
  const categoryRows = allCats.map(cat=>{
    const a = catA[cat]||0, b = catB[cat]||0;
    return { category:cat, a, b, aFmt:fmtINR(a), bFmt:fmtINR(b), delta:pctDeltaGlobal(b,a), absChange:Math.abs(b-a) };
  }).sort((x,y)=> y.absChange - x.absChange);

  return { hasData, summaryRows, categoryRows };
}

const compareYearsModal = document.getElementById('compareYearsModal');
function populateCompareYearSelects(){
  const years = allDataYears();
  const selA = document.getElementById('compareYearA');
  const selB = document.getElementById('compareYearB');
  const opts = years.map(y=>`<option value="${y}">${y}</option>`).join('');
  selA.innerHTML = opts;
  selB.innerHTML = opts;
  selB.value = ui.year;
  selA.value = years.find(y=>y!==selB.value) || years[0];
}
function openCompareYearsModal(){
  populateCompareYearSelects();
  renderCompareYearsModal();
  compareYearsModal.classList.remove('hidden');
}
function closeCompareYearsModal(){ compareYearsModal.classList.add('hidden'); }
document.getElementById('openCompareYearsBtn').addEventListener('click', openCompareYearsModal);
document.getElementById('closeCompareYearsModal').addEventListener('click', closeCompareYearsModal);
document.getElementById('closeCompareYearsBtn2').addEventListener('click', closeCompareYearsModal);
document.getElementById('compareYearA').addEventListener('change', renderCompareYearsModal);
document.getElementById('compareYearB').addEventListener('change', renderCompareYearsModal);

function renderCompareYearsModal(){
  const yearA = document.getElementById('compareYearA').value;
  const yearB = document.getElementById('compareYearB').value;
  const c = computeYearsComparison(yearA, yearB);
  document.getElementById('compareYearsEmpty').classList.toggle('hidden', c.hasData);
  document.getElementById('compareYearsBody').classList.toggle('hidden', !c.hasData);
  if(!c.hasData) return;

  document.getElementById('compareYearsSummary').innerHTML = c.summaryRows.map(r=>`
    <div class="compare-row">
      <span class="name">${escapeHtml(r.name)}</span>
      <span class="figures"><span class="curr">${r.bFmt}</span> vs ${r.aFmt}</span>
      ${deltaTag(r.delta, r.good)}
    </div>
  `).join('');

  document.getElementById('compareYearsCategories').innerHTML = c.categoryRows.map(r=>`
    <div class="compare-row">
      <span class="name">${escapeHtml(r.category)}</span>
      <span class="figures"><span class="curr">${r.bFmt}</span> vs ${r.aFmt}</span>
      ${deltaTag(r.delta, 'down')}
    </div>
  `).join('') || '<p class="empty-sub">No expenses recorded in either year.</p>';
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

const FLATS_SORT_FNS = {
  flat: f => Number(flatNumberOf(f.label)) || 0,
  owner: f => (f.owner||'').toLowerCase(),
  tenant: f => (f.tenant||'').toLowerCase(),
  contribution: f => f.contribution,
  status: f => f.contributed ? 1 : 0,
};
function renderFlats(v){
  document.getElementById('flatsCount').textContent = store.flats.length + ' units';
  document.querySelectorAll('#flatsFilterSeg .seg-btn').forEach(b=>b.classList.toggle('active', b.dataset.filter===ui.flatsFilter));
  document.getElementById('flatsSearch').value = ui.flatsSearch;
  updateSortHeaderUI('#screen-flats .data-table thead', ui.flatsSort);
  const sortedFlats = applySort(v.filteredFlats, ui.flatsSort, FLATS_SORT_FNS);

  const editBtn = (id) => perms.canEditFlats ? `<button class="item-card-edit" data-flat="${id}" title="Edit">✎</button>` : '';
  const editCell = (id) => perms.canEditFlats ? `<button class="row-edit-btn" data-flat="${id}" title="Edit">✎</button>` : '';

  const cardHtml = sortedFlats.map(f=>`
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

  const rowHtml = sortedFlats.map(f=>`
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

const DONATIONS_SORT_FNS = {
  donor: d => (d.title||'').toLowerCase(),
  mode: d => (d.mode||'').toLowerCase(),
  date: d => d.date,
  amount: d => d.amount,
};
function renderDonations(v){
  renderPledges(v);
  document.getElementById('donationsTotalLabel').textContent = fmtINR(v.totalCollected);
  document.getElementById('collectedByBreakdown').innerHTML = v.collectedByBreakdown.map(c=>`
    <div>
      <div class="stack-row"><span>${escapeHtml(c.person)}</span><span class="green">${c.amountFmt}</span></div>
      <div class="bar-track"><div class="bar-fill green" style="width:${c.pct}%"></div></div>
    </div>
  `).join('') || '<p class="empty-sub">No donations recorded for '+ui.year+'.</p>';
  updateSortHeaderUI('#screen-donations .data-table thead', ui.donationsSort);
  const sortedDonations = applySort(v.donationsSorted, ui.donationsSort, DONATIONS_SORT_FNS);
  const editDonBtn = (id) => perms.canDonations ? `<button class="item-card-edit edit-donation" data-id="${id}" title="Edit">✎</button>` : '';
  document.getElementById('donationsCards').innerHTML = sortedDonations.map(d=>`
    <div class="item-card">
      <div>
        <div class="item-card-title">${escapeHtml(d.title)}</div>
        <div class="item-card-sub">${escapeHtml(d.mode)} · ${d.dateFmt}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="item-card-amt" style="color:#16A34A">${d.amountFmt}</div>
        ${editDonBtn(d.id)}
        <button class="item-card-edit print-receipt" data-id="${d.id}" title="Print receipt">🖨</button>
        <button class="item-card-edit share-receipt" data-id="${d.id}" title="Share receipt">🔗</button>
      </div>
    </div>
  `).join('') || '<p class="empty-sub">No donations recorded for '+ui.year+'.</p>';

  const delCell = (id) => perms.canDonations ? `<button class="row-edit-btn delete-donation" data-id="${id}" title="Delete">🗑</button>` : '';
  const editDonCell = (id) => perms.canDonations ? `<button class="row-edit-btn edit-donation" data-id="${id}" title="Edit">✎</button>` : '';
  document.getElementById('donationsTableBody').innerHTML = sortedDonations.map(d=>`
    <tr>
      <td class="strong">${escapeHtml(d.title)}</td>
      <td>${escapeHtml(d.mode)}</td>
      <td>${d.dateFmt}</td>
      <td class="num" style="color:#16A34A">${d.amountFmt}</td>
      <td>${editDonCell(d.id)} <button class="row-edit-btn print-receipt" data-id="${d.id}" title="Print receipt">🖨</button> <button class="row-edit-btn share-receipt" data-id="${d.id}" title="Share receipt">🔗</button> ${delCell(d.id)}</td>
    </tr>
  `).join('') || '<tr class="empty-row"><td colspan="5">No donations recorded for '+ui.year+'.</td></tr>';
}

const EXPENSES_SORT_FNS = {
  category: e => (e.title||'').toLowerCase(),
  description: e => (e.description||'').toLowerCase(),
  mode: e => (e.mode||'').toLowerCase(),
  date: e => e.date,
  amount: e => e.amount,
};
function renderExpenses(v){
  document.getElementById('expensesTotalLabel').textContent = fmtINR(v.totalExpenses);
  document.getElementById('categoryBreakdown').innerHTML = v.categoryBreakdown.map(c=>`
    <div>
      <div class="stack-row"><span>${escapeHtml(c.category)}</span><span class="red">${c.amountFmt}</span></div>
      <div class="bar-track"><div class="bar-fill red" style="width:${c.pct}%"></div></div>
    </div>
  `).join('') || '<p class="empty-sub">No expenses recorded for '+ui.year+'.</p>';
  const activeFilterKey = ui.expensesPersonFilter ? ui.expensesPersonFilter.key : null;
  document.getElementById('recordedByBreakdown').innerHTML = v.recordedByBreakdown.map(c=>`
    <div class="bar-row-clickable${c.key===activeFilterKey?' active':''}" data-key="${escapeHtml(c.key)}" data-name="${escapeHtml(c.person)}" title="Click to see all expenses recorded by ${escapeHtml(c.person)}">
      <div class="stack-row"><span>${escapeHtml(c.person)}</span><span class="red">${c.amountFmt}</span></div>
      <div class="bar-track"><div class="bar-fill red" style="width:${c.pct}%"></div></div>
    </div>
  `).join('') || '<p class="empty-sub">No expenses recorded for '+ui.year+'.</p>';

  document.getElementById('expensesPersonFilterChip').innerHTML = ui.expensesPersonFilter ? `
    <div class="person-filter-chip">
      Showing expenses recorded by <strong>${escapeHtml(ui.expensesPersonFilter.name)}</strong>
      <button class="person-filter-clear" id="clearExpensesPersonFilter">✕ Clear</button>
    </div>
  ` : '';

  updateSortHeaderUI('#screen-expenses .data-table thead', ui.expensesSort);
  const sortedExpenses = applySort(v.filteredExpensesSorted, ui.expensesSort, EXPENSES_SORT_FNS);
  const billLink = (url) => url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" title="View bill photo" style="margin-left:8px">📎</a>` : '';
  const editExpBtn = (id) => perms.canExpenses ? `<button class="item-card-edit edit-expense" data-id="${id}" title="Edit">✎</button>` : '';
  // Advance/Balance entries get a small badge + balance-due note so a
  // part-payment (e.g. priest's advance on day 1) never looks like the
  // full amount was settled -- what's still owed stays visible.
  const paymentBadge = (e) => {
    if(e.paymentType==='full') return '';
    const label = e.paymentType==='advance' ? 'ADVANCE' : 'BALANCE';
    const color = e.paymentType==='advance' ? '#D97706' : '#2563EB';
    return `<span class="pill-tag" style="background:${color}1a;color:${color}">${label}</span>`;
  };
  const balanceNote = (e) => {
    if(e.paymentType==='full' || e.balanceDue==null) return '';
    // On an Advance, totalExpected is the whole cost, so balanceDue reads
    // "X of Y total". On a Balance/Final payment, totalExpected instead
    // means "what was still owed going in", so balanceDue reads as what's
    // still left after this specific payment -- no "of Y total" suffix.
    if(e.paymentType==='advance'){
      if(e.balanceDue>0) return `<div class="hint" style="color:#D97706;margin-top:2px">Balance due: ${fmtINR(e.balanceDue)} of ${fmtINR(e.totalExpected)} total</div>`;
      if(e.balanceDue===0) return `<div class="hint" style="color:#16A34A;margin-top:2px">Fully settled — ${fmtINR(e.totalExpected)} total</div>`;
      return `<div class="hint" style="color:#DC2626;margin-top:2px">${fmtINR(-e.balanceDue)} over the expected ${fmtINR(e.totalExpected)} total</div>`;
    }
    if(e.balanceDue>0) return `<div class="hint" style="color:#D97706;margin-top:2px">Still owed after this payment: ${fmtINR(e.balanceDue)}</div>`;
    if(e.balanceDue===0) return `<div class="hint" style="color:#16A34A;margin-top:2px">Fully settled</div>`;
    return `<div class="hint" style="color:#DC2626;margin-top:2px">${fmtINR(-e.balanceDue)} more than what was owed</div>`;
  };
  document.getElementById('expensesCards').innerHTML = sortedExpenses.map(e=>`
    <div class="item-card">
      <div>
        <div class="item-card-title">${escapeHtml(e.title)}${billLink(e.billUrl)} ${paymentBadge(e)}</div>
        <div class="item-card-sub">${escapeHtml(e.subtitle)} · ${e.dateFmt}</div>
        ${balanceNote(e)}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="item-card-amt" style="color:#DC2626">${e.amountFmt}</div>
        ${editExpBtn(e.id)}
      </div>
    </div>
  `).join('') || '<p class="empty-sub">No expenses recorded'+(ui.expensesPersonFilter?' by '+escapeHtml(ui.expensesPersonFilter.name):'')+' for '+ui.year+'.</p>';

  const delCell = (id) => perms.canExpenses ? `<button class="row-edit-btn delete-expense" data-id="${id}" title="Delete">🗑</button>` : '';
  const editCell = (id) => perms.canExpenses ? `<button class="row-edit-btn edit-expense" data-id="${id}" title="Edit">✎</button>` : '';
  document.getElementById('expensesTableBody').innerHTML = sortedExpenses.map(e=>`
    <tr>
      <td class="strong">${escapeHtml(e.title)}${billLink(e.billUrl)} ${paymentBadge(e)}</td>
      <td>${escapeHtml(e.description)}${balanceNote(e)}</td>
      <td>${escapeHtml(e.mode)}</td>
      <td>${e.dateFmt}</td>
      <td class="num" style="color:#DC2626">${e.amountFmt}</td>
      <td>${editCell(e.id)} ${delCell(e.id)}</td>
    </tr>
  `).join('') || '<tr class="empty-row"><td colspan="6">No expenses recorded'+(ui.expensesPersonFilter?' by '+escapeHtml(ui.expensesPersonFilter.name):'')+' for '+ui.year+'.</td></tr>';
}

const TXN_SORT_FNS = {
  type: tx => tx.typeLabel,
  details: tx => (tx.title||'').toLowerCase(),
  date: tx => tx.date,
  amount: tx => tx.amount,
};
function renderTransactions(v){
  document.querySelectorAll('#txnFilterSeg .seg-btn').forEach(b=>b.classList.toggle('active', b.dataset.filter===ui.txnFilter));
  updateSortHeaderUI('#screen-transactions .data-table thead', ui.txnSort);
  const sortedTxns = applySort(v.filteredTransactions, ui.txnSort, TXN_SORT_FNS);

  document.getElementById('txnCards').innerHTML = sortedTxns.map(tx=>`
    <div class="item-card accent-left" style="border-left-color:${tx.color}">
      <div>
        <div class="item-card-title">${escapeHtml(tx.title)}</div>
        <div class="item-card-sub">${escapeHtml(tx.subtitle)} · ${tx.dateFmt}</div>
      </div>
      <div class="item-card-amt" style="color:${tx.color}">${tx.amountSigned}</div>
    </div>
  `).join('') || '<p class="empty-sub">No transactions.</p>';

  document.getElementById('txnTableBody').innerHTML = sortedTxns.map(tx=>`
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
  renderPeopleList();
  renderPrasadam();
}

// Reference-only people (name + mobile) Super Admin added for someone who
// hasn't signed up yet -- selectable for Collected By / Recorded By /
// transfers. Once linked to a real account, "Link" becomes a status pill
// instead, since new entries should go under their real login from then on.
function renderPeopleList(){
  const el = document.getElementById('peopleList');
  if(!perms.isAdmin){ el.innerHTML=''; return; }
  el.innerHTML = store.people.map(p=>{
    const linkedProfile = p.profile_id ? store.profiles.find(x=>x.id===p.profile_id) : null;
    const status = linkedProfile
      ? `<span class="pill-tag" style="background:#DCFCE7;color:#16A34A">Linked → ${escapeHtml(displayName(linkedProfile))}</span>`
      : `<button class="btn-link link-person" data-id="${p.id}" style="font-size:11px;font-weight:800">Link to Account</button>`;
    return `
      <div class="user-row">
        <div class="user-row-email" title="${escapeHtml(p.mobile_number||'')}">${escapeHtml(p.full_name)}${p.mobile_number ? ' · '+escapeHtml(p.mobile_number) : ''}</div>
        ${status}
        <button class="item-card-edit delete-person" data-id="${p.id}" title="Delete">🗑</button>
      </div>`;
  }).join('') || '<p class="empty-sub">No reference-only people added yet.</p>';
}
document.getElementById('addPersonBtn').addEventListener('click', ()=>{
  document.getElementById('personName').value = '';
  document.getElementById('personMobile').value = '';
  document.getElementById('addPersonModal').classList.remove('hidden');
});
document.getElementById('closeAddPersonModal').addEventListener('click', ()=> document.getElementById('addPersonModal').classList.add('hidden'));
document.getElementById('cancelAddPersonBtn').addEventListener('click', ()=> document.getElementById('addPersonModal').classList.add('hidden'));
document.getElementById('saveAddPersonBtn').addEventListener('click', async ()=>{
  if(!perms.isAdmin) return;
  const name = document.getElementById('personName').value.trim();
  const mobile = document.getElementById('personMobile').value.trim();
  if(!name){ showToast('Please enter a name'); return; }
  const btn = document.getElementById('saveAddPersonBtn');
  btn.disabled = true;
  const { error } = await sb.from('ganesh_people').insert({ full_name: name, mobile_number: mobile, created_by: profile.id });
  btn.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity('Added team member', name+(mobile?' ('+mobile+')':''));
  await fetchAllData();
  document.getElementById('addPersonModal').classList.add('hidden');
  renderAll();
  showToast('Person added ✓');
});

let linkingPersonId = null;
document.getElementById('peopleList').addEventListener('click', async (e)=>{
  const linkBtn = e.target.closest('.link-person');
  if(linkBtn){
    if(!perms.isAdmin) return;
    const p = store.people.find(x=>x.id===linkBtn.dataset.id);
    if(!p) return;
    linkingPersonId = p.id;
    document.getElementById('linkPersonContext').textContent = p.full_name + (p.mobile_number ? ' · '+p.mobile_number : '');
    const sel = document.getElementById('linkPersonProfileSelect');
    sel.innerHTML = store.profiles.map(pr=>`<option value="${pr.id}">${escapeHtml(displayName(pr))}</option>`).join('') || '<option value="">No signed-up accounts yet</option>';
    document.getElementById('linkPersonModal').classList.remove('hidden');
    return;
  }
  const delBtn = e.target.closest('.delete-person');
  if(delBtn){
    if(!perms.isAdmin) return;
    const p = store.people.find(x=>x.id===delBtn.dataset.id);
    if(!(await showConfirm(`Remove ${p?p.full_name:'this person'} from the reference list? Entries already recorded under their name are not affected.`, { title:'Remove person?' }))) return;
    const { error } = await sb.from('ganesh_people').delete().eq('id', delBtn.dataset.id);
    if(error){ showToast('Error: '+error.message); return; }
    await logActivity('Removed team member', p ? p.full_name : delBtn.dataset.id);
    await fetchAllData(); renderAll(); showToast('Person removed');
  }
});
document.getElementById('closeLinkPersonModal').addEventListener('click', ()=>{ document.getElementById('linkPersonModal').classList.add('hidden'); linkingPersonId=null; });
document.getElementById('cancelLinkPersonBtn').addEventListener('click', ()=>{ document.getElementById('linkPersonModal').classList.add('hidden'); linkingPersonId=null; });
document.getElementById('saveLinkPersonBtn').addEventListener('click', async ()=>{
  if(!perms.isAdmin || !linkingPersonId) return;
  const profileId = document.getElementById('linkPersonProfileSelect').value;
  if(!profileId){ showToast('No account to link to'); return; }
  const btn = document.getElementById('saveLinkPersonBtn');
  btn.disabled = true;
  const { error } = await sb.from('ganesh_people').update({ profile_id: profileId }).eq('id', linkingPersonId);
  btn.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  const p = store.people.find(x=>x.id===linkingPersonId);
  const pr = store.profiles.find(x=>x.id===profileId);
  await logActivity('Linked team member to account', (p?p.full_name:'')+' → '+(pr?displayName(pr):''));
  await fetchAllData();
  document.getElementById('linkPersonModal').classList.add('hidden');
  linkingPersonId = null;
  renderAll();
  showToast('Linked ✓');
});

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
    const editBtn = perms.isAdmin ? `<button class="seva-day-edit" data-day="${day.id}" title="Edit day">✎</button>` : '';
    const deleteBtn = perms.isAdmin ? `<button class="seva-day-delete" data-day="${day.id}" title="Remove day">🗑</button>` : '';
    const sessionsHtml = SEVA_TIMES.map(time=>{
      const signups = store.sevaSignups.filter(s=>s.day_id===day.id && sevaTimeOf(s.session)===time.key);
      const rows = signups.map(s=>{
        const f = store.flats.find(x=>x.id===s.flat_id);
        const type = SEVA_TYPES.find(t=>t.key===sevaTypeOf(s.session)) || SEVA_TYPES[0];
        const actions = perms.isAdmin ? `
          <span class="seva-signup-actions">
            <button class="edit-signup" data-signup="${s.id}" title="Edit">✎</button>
            <button class="delete-signup" data-signup="${s.id}" title="Delete">🗑</button>
          </span>` : '';
        return `<div class="seva-signup-row">
          <span><span class="seva-signup-flat">${escapeHtml(f?f.label:s.flat_id)}</span> — <span class="seva-signup-name">${escapeHtml(s.name)}</span> <span class="seva-type-tag">${escapeHtml(type.tag)}</span></span>
          ${actions}
        </div>`;
      }).join('') || '<div class="seva-empty">No one signed up yet.</div>';
      // Multiple people can sign up for the same slot -- it should never
      // read as "taken" once someone joins. Both states say OPEN; a filled
      // slot just adds how many have joined so far, still inviting more.
      const statusClass = signups.length ? 'filled' : 'empty';
      const statusTag = signups.length
        ? `<span class="seva-status-tag filled">OPEN · ${signups.length} JOINED</span>`
        : `<span class="seva-status-tag empty">OPEN</span>`;
      return `
        <div class="seva-session ${statusClass}">
          <div class="seva-session-head">
            <div class="seva-session-title">${time.icon} ${time.label} ${statusTag}</div>
          </div>
          <div class="seva-signup-list">${rows}</div>
          <button class="seva-add-btn" data-day="${day.id}" data-time="${time.key}">+ Add Your Name</button>
        </div>`;
    }).join('');
    return `
      <div class="seva-day-card">
        <div class="seva-day-head">
          <div>
            <div class="seva-day-title">${escapeHtml(dateLabel)}</div>
            ${day.label ? `<div class="seva-day-sub">${escapeHtml(day.label)}</div>` : ''}
          </div>
          <span class="seva-day-actions">${editBtn}${deleteBtn}</span>
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
   THEMED CONFIRM DIALOG -- replaces window.confirm()/prompt() for
   delete and other risky actions. Usage:
     if(!(await showConfirm('Delete this donation?'))) return;
   Pass { requireText:'ALL YEARS' } to force the user to type an exact
   phrase before the confirm button enables (for the scariest actions).
   ============================================================ */
function showConfirm(message, opts={}){
  return new Promise(resolve=>{
    const overlay = document.getElementById('confirmModal');
    const okBtn = document.getElementById('confirmModalOkBtn');
    const cancelBtn = document.getElementById('confirmModalCancelBtn');
    const typedWrap = document.getElementById('confirmModalTypedWrap');
    const typedInput = document.getElementById('confirmModalTypedInput');
    const typedLabel = document.getElementById('confirmModalTypedLabel');

    document.getElementById('confirmModalIcon').textContent = opts.icon || (opts.danger===false ? '❓' : '🗑');
    document.getElementById('confirmModalTitle').textContent = opts.title || (opts.danger===false ? 'Please confirm' : 'Delete this?');
    document.getElementById('confirmModalMessage').textContent = message;
    okBtn.textContent = opts.okLabel || (opts.danger===false ? 'Confirm' : 'Delete');
    okBtn.className = 'btn ' + (opts.danger===false ? 'btn-orange' : 'btn-red');

    const needsTyped = !!opts.requireText;
    typedWrap.classList.toggle('hidden', !needsTyped);
    typedInput.value = '';
    okBtn.disabled = needsTyped;
    if(needsTyped){ typedLabel.textContent = `Type ${opts.requireText} to confirm`; }

    const onTypedInput = ()=>{ okBtn.disabled = typedInput.value.trim() !== opts.requireText; };
    if(needsTyped) typedInput.addEventListener('input', onTypedInput);

    overlay.classList.remove('hidden');
    setTimeout(()=>{ (needsTyped ? typedInput : okBtn).focus(); }, 10);

    const cleanup = (result)=>{
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('mousedown', onOverlay);
      document.removeEventListener('keydown', onKey);
      if(needsTyped) typedInput.removeEventListener('input', onTypedInput);
      resolve(result);
    };
    const onOk = ()=>{ if(!okBtn.disabled) cleanup(true); };
    const onCancel = ()=>cleanup(false);
    const onOverlay = (e)=>{ if(e.target===overlay) cleanup(false); };
    const onKey = (e)=>{
      if(e.key==='Escape'){ cleanup(false); }
      else if(e.key==='Enter' && !needsTyped){ cleanup(true); }
    };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('mousedown', onOverlay);
    document.addEventListener('keydown', onKey);
  });
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
document.getElementById('viewSevaBtn').addEventListener('click', ()=> goScreen('prasadam'));
document.getElementById('viewPendingBalanceBtn').addEventListener('click', ()=> goScreen('expenses'));

function renderSevaProgress(v){
  const panel = document.getElementById('sevaProgressPanel');
  panel.classList.toggle('hidden', v.sevaTotalSlots===0);
  if(v.sevaTotalSlots===0) return;
  document.getElementById('sevaProgressTitle').textContent = v.sevaOpenSlots+' Slot'+(v.sevaOpenSlots===1?'':'s')+' Still Need Volunteers';
  document.getElementById('sevaProgressBar').style.width = v.sevaFilledPct+'%';
  document.getElementById('legendSevaFilled').textContent = v.sevaFilledSlots+' Filled';
  document.getElementById('legendSevaOpen').textContent = v.sevaOpenSlots+' Open';
}
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

// Called after any donation is saved — if that flat still has no Owner name
// on file, adopt this donor's name automatically so it doesn't stay blank
// forever waiting for someone to open the Edit Flat modal by hand.
async function maybeAutoFillFlatOwner(flatId, name){
  if(!flatId || !name || name==='Resident') return;
  const f = store.flats.find(x=>x.id===flatId);
  if(!f || f.owner) return;
  await sb.from('ganesh_flats').update({ owner: name }).eq('id', flatId);
}

// One-time backfill: donations already have donor names, but a flat's Owner
// field only ever gets set if someone opens the Edit-Flat modal for it. This
// fills every currently-blank Owner from that flat's earliest donation, so
// years of already-imported donation names don't have to be retyped by hand.
document.getElementById('fillOwnerNamesBtn').addEventListener('click', async ()=>{
  if(!perms.isAdmin){ showToast('Only Super Admin can do this'); return; }
  const blankFlats = store.flats.filter(f=>!f.owner);
  if(!blankFlats.length){ showToast('Every flat already has an owner name'); return; }
  const updates = [];
  blankFlats.forEach(f=>{
    const flatDonations = store.donations.filter(d=>d.flat_id===f.id && d.name && d.name!=='Resident')
      .sort((a,b)=> (a.date<b.date?-1:1));
    if(flatDonations.length) updates.push({ id:f.id, owner: flatDonations[0].name });
  });
  if(!updates.length){ showToast('No donations on file to fill names from yet'); return; }
  if(!(await showConfirm(`Fill in Owner for ${updates.length} flat(s) using their earliest donation? You can still edit any of these by hand afterward.`, { danger:false, okLabel:'Fill Names', icon:'✏️' }))) return;
  const btn = document.getElementById('fillOwnerNamesBtn');
  btn.disabled = true;
  let ok = 0;
  for(const u of updates){
    const { error } = await sb.from('ganesh_flats').update({ owner: u.owner }).eq('id', u.id);
    if(!error) ok++;
  }
  btn.disabled = false;
  await logActivity('Filled owner names', ok+' flat(s) from donation records');
  await fetchAllData();
  renderAll();
  showToast(`Filled ${ok} owner name${ok===1?'':'s'} ✓`);
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
// flatId pre-selects a flat when adding a fresh donation (or is null).
// donationId, when passed, switches the modal into edit mode for that
// existing donation instead — a wrong amount/date/flat no longer requires
// delete-and-re-add, which used to lose collected_by/created_at provenance.
function openDonationModal(flatId, donationId){
  if(!perms.canDonations){ showToast('You do not have permission to add donations'); return; }
  ui.pledgeBeingFulfilled = null;
  const existing = donationId ? store.donations.find(x=>x.id===donationId) : null;
  ui.editingDonationId = existing ? donationId : null;
  document.getElementById('donationModalTitle').textContent = existing ? 'Edit Donation' : 'Add Donation';
  const effectiveFlatId = existing ? existing.flat_id : flatId;
  const f = effectiveFlatId ? store.flats.find(x=>x.id===effectiveFlatId) : null;
  const sel = document.getElementById('donFlatSelect');
  sel.innerHTML = '<option value="">Select flat</option>' + store.flats.map(fl=>
    `<option value="${escapeHtml(fl.id)}">${escapeHtml(fl.label)} — ${escapeHtml(fl.owner||'Unassigned')}</option>`).join('')
    + '<option value="__unknown__">🕵️ Unknown / Vacated Tenant (no flat)</option>';
  sel.value = existing ? (existing.flat_id || '__unknown__') : (flatId || '');
  document.getElementById('donName').value = existing ? existing.name : (f ? (f.owner||'') : '');
  document.getElementById('donAmount').value = existing && existing.kind==='cash' ? existing.amount : '';
  document.getElementById('donAmount').dispatchEvent(new Event('input'));
  document.getElementById('donItem').value = existing && existing.kind==='in_kind' ? existing.item_description : '';
  document.getElementById('donItemValue').value = existing && existing.kind==='in_kind' ? existing.amount : '';
  document.getElementById('donItemValue').dispatchEvent(new Event('input'));
  document.getElementById('donDate').value = existing ? existing.date : todayISO();
  document.getElementById('donDate').dispatchEvent(new Event('change'));
  document.getElementById('donNote').value = existing ? (existing.note||'') : '';
  setModeButtons('donModeRow', existing ? (existing.mode || 'UPI') : 'UPI');
  setDonationKind(existing ? existing.kind : 'cash');
  const cbField = document.getElementById('donCollectedByField');
  cbField.hidden = !perms.isAdmin;
  if(perms.isAdmin){
    const cbSel = document.getElementById('donCollectedBy');
    cbSel.innerHTML = assignablePeopleOptionsHtml();
    cbSel.value = existing ? (existing.collected_by || profile.id) : profile.id;
  }
  donationModal.classList.remove('hidden');
}
function closeDonationModal(){ donationModal.classList.add('hidden'); ui.pledgeBeingFulfilled = null; ui.editingDonationId = null; }
document.getElementById('addDonationBtnDash').addEventListener('click', ()=>openDonationModal(null));
document.getElementById('addDonationBtnList').addEventListener('click', ()=>openDonationModal(null));

/* "Copy This Year's Donations" -- builds a ready-to-paste WhatsApp message
   listing every individual donation recorded for the currently-selected
   year (cash + in-kind), so the committee can post a full running list in
   the residents' group without retyping anything. Uses the dashboard's
   selected year filter (ui.year), not necessarily the current calendar
   year -- so it still works correctly if someone checks a past year.
   Numbered, sorted by flat number, no dates -- matches the committee's
   existing WhatsApp posting style, with an in-kind item getting a themed
   emoji instead of a rupee figure. */
function flatNumberOf(flatLabelOrId){
  // Strips a leading letter prefix ("A001" -> "001") since the WhatsApp
  // posts refer to flats as "Flat 001", not "Flat A001".
  const m = String(flatLabelOrId||'').match(/\d+/);
  return m ? m[0] : String(flatLabelOrId||'');
}
function inKindEmoji(itemDescription){
  const s = (itemDescription||'').toLowerCase();
  if(s.includes('laddu') || s.includes('prasad')) return '🍬';
  if(s.includes('idol')) return '🪔';
  if(s.includes('flower')) return '🌸';
  if(s.includes('decor')) return '🎈';
  if(s.includes('sound') || s.includes('light')) return '🔊';
  if(s.includes('cultural') || s.includes('program')) return '🎭';
  return '🎁';
}
function buildYearDonationsMessage(){
  const yearDonations = store.donations.filter(d=>yearOf(d.date)===ui.year);
  if(!yearDonations.length){
    return { message: null, count: 0 };
  }

  // Unknown-flat donors (guests) come first, then known flats sorted by
  // flat number ascending. Multiple donations from the same flat/guest
  // keep their original recorded order.
  const sorted = [...yearDonations].sort((a,b)=>{
    const fa = a.flat_id ? store.flats.find(x=>x.id===a.flat_id) : null;
    const fb = b.flat_id ? store.flats.find(x=>x.id===b.flat_id) : null;
    const na = fa ? Number(flatNumberOf(fa.label)) : -Infinity;
    const nb = fb ? Number(flatNumberOf(fb.label)) : -Infinity;
    if(na !== nb) return na - nb;
    return new Date(a.created_at) - new Date(b.created_at);
  });

  const lines = sorted.map((d,i)=>{
    const f = d.flat_id ? store.flats.find(x=>x.id===d.flat_id) : null;
    const who = d.name || 'Resident';
    // When the flat isn't known (long-vacated tenant, unrecognized name),
    // skip the "Flat Unknown –" prefix and just show the name.
    const whoPart = f ? `Flat ${flatNumberOf(f.label)} – ${who}` : who;
    if(d.kind === 'cash'){
      return `${i+1}. ${whoPart} – ${fmtINR(d.amount)}`;
    }
    const item = d.item_description || 'Item Sponsor';
    return `${i+1}. ${whoPart} – ${inKindEmoji(item)} *${item}*`;
  });

  const upiParts = [store.settings.upi_number_1, store.settings.upi_number_2].filter(Boolean);
  const upiLine = upiParts.length ? upiParts.join(' or ') : '(add your UPI number in Settings)';

  const message = [
    `🙏 *Ganesh Festival ${ui.year} – Donations Received* 🙏`,
    'Thank you to all our residents for the generous support! 🎉',
    'Sorted by flat number:',
    ...lines,
    "We truly appreciate everyone's contribution towards making this festival a grand success! 🙌",
    'More names to be added as donations come in. 🕉️',
    '💳 *Whoever wants to contribute, kindly pay to this UPI number:*',
    upiLine,
    'Please mention your flat number in the transaction note.'
  ].join('\n');

  return { message, count: yearDonations.length };
}
async function copyToClipboard(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch(e){
    // Fallback for browsers/contexts where the async Clipboard API is
    // unavailable (e.g. non-HTTPS or older WebView) -- a hidden textarea
    // plus the legacy execCommand still works in those cases.
    try{
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }catch(e2){
      return false;
    }
  }
}
document.getElementById('copyYearDonationsBtn').addEventListener('click', async ()=>{
  const { message, count } = buildYearDonationsMessage();
  if(!message){ showToast('No donations recorded for '+ui.year+' yet'); return; }
  const ok = await copyToClipboard(message);
  showToast(ok ? `Copied! ${count} donation${count===1?'':'s'} — paste into WhatsApp` : 'Could not copy — please copy manually');
});
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
/* Advance / Balance payment type for expenses -- e.g. a priest gets an
   advance on day 1 and the remainder a few days later. Each entry stands
   on its own (no linked "vendor" record); Total Expected is just typed in
   again on the balance entry so both show what's left, per the simpler
   design chosen over a full commitments/vendor tracking system. */
function setPaymentTypeButtons(active){
  document.querySelectorAll('#expPaymentTypeRow .mode-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.ptype===active);
  });
  document.getElementById('expTotalExpectedField').classList.toggle('hidden', active==='full');
  // What this field means changes with the payment type, since entries
  // aren't linked to each other -- on the Advance it's the whole expected
  // cost; on the Balance/Final it must be what was STILL OWED going into
  // this payment (not the original total), or the balance math below would
  // come out wrong.
  const label = document.getElementById('expTotalExpectedLabel');
  const staticHint = document.getElementById('expTotalExpectedStaticHint');
  if(active==='balance'){
    label.textContent = 'AMOUNT STILL OWED BEFORE THIS PAYMENT (OPTIONAL)';
    staticHint.textContent = "e.g. Priest's advance was ₹5,000 of a ₹15,000 total, so ₹10,000 was still owed — enter ₹10,000 here (not the original ₹15,000) and the amount you're paying now above.";
  } else {
    label.textContent = 'TOTAL EXPECTED AMOUNT (OPTIONAL)';
    staticHint.textContent = 'e.g. Priest costs ₹15,000 total — enter ₹15,000 here and the advance you\'re paying now above.';
  }
}
function updateExpBalanceDueHint(){
  const hint = document.getElementById('expBalanceDueHint');
  const ptype = document.querySelector('#expPaymentTypeRow .mode-btn.active')?.dataset.ptype || 'full';
  const totalExpected = Number(document.getElementById('expTotalExpected').value);
  const amount = Number(document.getElementById('expAmount').value);
  if(!totalExpected || totalExpected<=0){ hint.textContent = ''; return; }
  const remaining = totalExpected - amount;
  if(ptype==='balance'){
    if(remaining>0) hint.textContent = 'Still owed after this payment: '+fmtINR(remaining);
    else if(remaining===0) hint.textContent = 'Fully settled — no balance remaining. 🎉';
    else hint.textContent = 'This payment is '+fmtINR(-remaining)+' more than what was owed.';
  } else {
    if(remaining>0) hint.textContent = 'Balance due after this payment: '+fmtINR(remaining);
    else if(remaining===0) hint.textContent = 'Fully paid — no balance remaining. 🎉';
    else hint.textContent = 'This payment is '+fmtINR(-remaining)+' more than the expected total.';
  }
}
document.getElementById('expPaymentTypeRow').addEventListener('click', (e)=>{
  const btn = e.target.closest('.mode-btn'); if(!btn) return;
  setPaymentTypeButtons(btn.dataset.ptype);
  updateExpBalanceDueHint();
});
document.getElementById('expTotalExpected').addEventListener('input', updateExpBalanceDueHint);
document.getElementById('expAmount').addEventListener('input', updateExpBalanceDueHint);
document.getElementById('saveDonationBtn').addEventListener('click', async ()=>{
  if(!perms.canDonations){ showToast('You do not have permission to add donations'); return; }
  const rawFlatId = document.getElementById('donFlatSelect').value;
  const flatId = rawFlatId === '__unknown__' ? null : rawFlatId;
  const name = document.getElementById('donName').value.trim();
  const kind = document.querySelector('#donKindRow .mode-btn.active')?.dataset.kind || 'cash';
  const date = document.getElementById('donDate').value || todayISO();
  const note = document.getElementById('donNote').value.trim();
  if(!rawFlatId){ showToast('Please select a flat'); return; }
  if(!flatId && !name){ showToast('Please enter a name or note for this unknown donor'); return; }

  let collectedBy = profile.id, collectedByName = displayName(profile);
  if(perms.isAdmin){
    const cbSel = document.getElementById('donCollectedBy');
    const chosenName = cbSel.selectedOptions[0]?.dataset.name;
    if(cbSel.value && chosenName){ collectedBy = cbSel.value; collectedByName = chosenName; }
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
  const editingId = ui.editingDonationId;
  let inserted, error;
  if(editingId){
    // Editing keeps the original created_by/collected_by/created_at provenance
    // unless the admin explicitly re-picks "Collected By" — only the fields
    // shown in the form are touched.
    const updatePayload = { flat_id: flatId, name: name||'Resident', kind, date, note, collected_by: collectedBy, collected_by_name: collectedByName, amount: payload.amount, mode: payload.mode, item_description: payload.item_description };
    ({ error } = await sb.from('ganesh_donations').update(updatePayload).eq('id', editingId));
  } else {
    ({ data: inserted, error } = await sb.from('ganesh_donations').insert(payload).select());
  }
  btn.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity(editingId ? 'Edited donation' : 'Added donation', (name||'Resident')+' ('+(flatId||'Unknown/Vacated')+') — '+(kind==='cash'?fmtINR(payload.amount):payload.item_description));
  if(!editingId) await maybeAutoFillFlatOwner(flatId, name);

  // If this donation was entered from "Mark Received" on a pledge, close the loop:
  // mark that pledge as received and link it to the new donation row.
  if(ui.pledgeBeingFulfilled){
    const newDonationId = inserted && inserted[0] ? inserted[0].id : null;
    await sb.from('ganesh_pledges').update({ status:'received', fulfilled_donation_id: newDonationId }).eq('id', ui.pledgeBeingFulfilled);
    await logActivity('Pledge received', (name||'Resident')+' ('+flatId+') — '+fmtINR(payload.amount));
    ui.pledgeBeingFulfilled = null;
  }

  await fetchAllData();
  closeDonationModal();
  renderAll();
  showToast(editingId ? 'Donation updated ✓' : (kind==='cash' ? 'Donation added successfully ✓' : 'In-kind contribution recorded ✓'));
});

/* ============================================================
   PLEDGES (promised, not yet received — noted for follow-up,
   NOT counted in Total Collected until marked received)
   ============================================================ */
const pledgeModal = document.getElementById('pledgeModal');
function openPledgeModal(){
  if(!perms.canDonations){ showToast('You do not have permission to add pledges'); return; }
  const sel = document.getElementById('pledgeFlatSelect');
  sel.innerHTML = '<option value="">Select flat</option>' + store.flats.map(fl=>
    `<option value="${escapeHtml(fl.id)}">${escapeHtml(fl.label)} — ${escapeHtml(fl.owner||'Unassigned')}</option>`).join('');
  sel.value = '';
  document.getElementById('pledgeName').value = '';
  document.getElementById('pledgeAmount').value = '';
  const dateInput = document.getElementById('pledgeDate');
  dateInput.value = todayISO();
  dateInput.dispatchEvent(new Event('change'));
  document.getElementById('pledgeNote').value = '';
  pledgeModal.classList.remove('hidden');
}
function closePledgeModal(){ pledgeModal.classList.add('hidden'); }
document.getElementById('addPledgeBtn').addEventListener('click', openPledgeModal);
document.getElementById('closePledgeModal').addEventListener('click', closePledgeModal);
document.getElementById('cancelPledgeBtn').addEventListener('click', closePledgeModal);
document.getElementById('pledgeFlatSelect').addEventListener('change', (e)=>{
  const f = store.flats.find(x=>x.id===e.target.value);
  if(f && !document.getElementById('pledgeName').value){ document.getElementById('pledgeName').value = f.owner||''; }
});
document.getElementById('savePledgeBtn').addEventListener('click', async ()=>{
  if(!perms.canDonations){ showToast('You do not have permission to add pledges'); return; }
  const flatId = document.getElementById('pledgeFlatSelect').value;
  const name = document.getElementById('pledgeName').value.trim();
  const amount = Number(document.getElementById('pledgeAmount').value);
  const date = document.getElementById('pledgeDate').value || todayISO();
  const note = document.getElementById('pledgeNote').value.trim();
  if(!flatId){ showToast('Please select a flat'); return; }
  if(!amount || amount<=0){ showToast('Please enter a valid promised amount'); return; }

  const btn = document.getElementById('savePledgeBtn');
  btn.disabled = true;
  const { error } = await sb.from('ganesh_pledges').insert({
    flat_id: flatId, name: name||'Resident', amount, pledged_date: date, note, status: 'pending', created_by: profile.id,
  });
  btn.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity('Added pledge', (name||'Resident')+' ('+flatId+') — '+fmtINR(amount)+' promised');
  await fetchAllData();
  closePledgeModal();
  renderAll();
  showToast('Pledge noted — follow up later ✓');
});

// "Mark Received" opens the regular donation modal, pre-filled from the
// pledge, so the money actually gets recorded through the normal flow
// (and counted in Total Collected). Saving that donation then marks this
// pledge as received (see saveDonationBtn handler above).
function markPledgeReceived(pledgeId){
  const p = store.pledges.find(x=>x.id===pledgeId);
  if(!p) return;
  if(!perms.canDonations){ showToast('You do not have permission to record donations'); return; }
  openDonationModal(p.flat_id);
  document.getElementById('donName').value = p.name || '';
  document.getElementById('donAmount').value = p.amount;
  document.getElementById('donAmount').dispatchEvent(new Event('input'));
  ui.pledgeBeingFulfilled = pledgeId;
}
async function deletePledge(pledgeId){
  if(!perms.canDonations){ showToast('You do not have permission to remove pledges'); return; }
  if(!(await showConfirm('Remove this pledge? This cannot be undone.', { title:'Remove pledge?' }))) return;
  const { error } = await sb.from('ganesh_pledges').delete().eq('id', pledgeId);
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity('Removed pledge', pledgeId);
  await fetchAllData();
  renderAll();
  showToast('Pledge removed');
}
document.getElementById('pledgesList').addEventListener('click', (e)=>{
  const mark = e.target.closest('.pledge-mark-received');
  if(mark){ markPledgeReceived(mark.dataset.pledge); return; }
  const del = e.target.closest('.pledge-delete');
  if(del){ deletePledge(del.dataset.pledge); }
});
document.getElementById('viewPledgesBtn').addEventListener('click', ()=> goScreen('donations'));

function renderPledges(v){
  const listEl = document.getElementById('pledgesList');
  const emptyEl = document.getElementById('pledgesEmpty');
  emptyEl.classList.toggle('hidden', v.pledgeRows.length>0);
  listEl.innerHTML = v.pledgeRows.map(p=>{
    const actions = perms.canDonations ? `
      <div class="pledge-row-actions">
        <button class="pledge-mark-received" data-pledge="${p.id}">✓ Mark Received</button>
        <button class="pledge-delete" data-pledge="${p.id}">🗑</button>
      </div>` : '';
    return `
      <div class="pledge-row">
        <div class="pledge-row-left">
          <div class="pledge-row-title">${escapeHtml(p.flatLabel)} — ${escapeHtml(p.name)}</div>
          <div class="pledge-row-sub">Pledged ${p.pledgedDateFmt}${p.note ? ' · '+escapeHtml(p.note) : ''}</div>
        </div>
        <div class="pledge-row-amt">${p.amountFmt}</div>
        ${actions}
      </div>`;
  }).join('');

  const panel = document.getElementById('pledgesPanel');
  panel.classList.toggle('hidden', v.pledgeRows.length===0);
  document.getElementById('pledgeSummaryAmt').textContent = v.totalPledgedFmt;
  document.getElementById('pledgeSummarySub').textContent = v.pledgeRows.length+' pledge'+(v.pledgeRows.length===1?'':'s')+' awaiting follow-up';
}

/* ============================================================
   BULK IMPORT — paste the daily WhatsApp donation update, upload
   an Excel/CSV cash-book export, or upload a PDF, and import
   every recognized line in one go instead of typing each entry
   into the Add Donation / Add Expense form by hand.
   ============================================================ */
const bulkImportModal = document.getElementById('bulkImportModal');
let bulkImportRows = [];

// Recognizes lines like:
//   "1. Flat 001 – Babu – ₹10,000"
//   "Flat 212 – Pramod – 🍬 *Laddu Sponsor*"
//   "51. Flat 308 – Srinivas – 🪔 *Ganesh Idol* (in-kind)"
function parseWhatsAppDonationText(text){
  const lines = (text||'').split('\n');
  const rows = [];
  const flatLineRe = /Flat\s*[#:]?\s*(\d{2,3})\s*[-–—]\s*([^-–—\n]+?)\s*[-–—]\s*(.+)/i;
  lines.forEach(rawLine=>{
    const line = rawLine.trim();
    if(!line) return;
    const m = line.match(flatLineRe);
    if(!m) return;
    const flatCode = m[1].padStart(3,'0');
    const name = m[2].replace(/^\W+|\W+$/g,'').trim();
    let valuePart = m[3].trim();
    const amountMatch = valuePart.match(/₹\s*([\d,]+(?:\.\d+)?)/);
    if(amountMatch){
      const amount = Number(amountMatch[1].replace(/,/g,''));
      if(name && amount>0){
        rows.push({ flatCode, name, kind:'cash', amount, itemDescription:'' });
      }
    } else if(name){
      // No ₹ amount found — treat as an in-kind contribution (idol, laddu sponsor, decoration, etc.)
      const item = valuePart.replace(/[*_]/g,'').replace(/\(in-?kind\)/i,'').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,'').trim();
      rows.push({ flatCode, name, kind:'in_kind', amount:0, itemDescription: item || 'In-kind contribution' });
    }
  });
  return rows;
}

// Simple Levenshtein edit distance, used to fuzzy-match donor names.
function levenshtein(a, b){
  a = a||''; b = b||'';
  const m = a.length, n = b.length;
  if(!m) return n; if(!n) return m;
  const dp = Array.from({length:m+1}, (_,i)=>[i, ...Array(n).fill(0)]);
  for(let j=0;j<=n;j++) dp[0][j] = j;
  for(let i=1;i<=m;i++){
    for(let j=1;j<=n;j++){
      dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}
// Overly common Indian name components — a shared "Kumar" or "Reddy" between
// two names is not good evidence they're the same person, so it alone should
// never earn a confident suggestion.
const COMMON_NAME_TOKENS = new Set(['kumar','reddy','singh','rao','babu','sharma','prasad','naidu','devi','nath','goud','raju','das']);
// When an old ledger row has no flat number at all — just a donor name like
// "Mallaiah" — search donations already in the database (any year) for a
// similarly-named donor and suggest their flat. Never auto-applies; the
// bulk-import preview shows it as a one-click suggestion the user confirms.
function suggestFlatByName(rawName){
  const name = String(rawName||'').trim().toLowerCase();
  if(!name || name.length<3) return null;
  const nameTokens = name.split(/\s+/).filter(Boolean);
  let best = null;
  store.donations.forEach(d=>{
    const dName = String(d.name||'').trim().toLowerCase();
    if(!dName) return;
    let score;
    if(dName===name){
      score = 1;
    } else {
      const dTokens = dName.split(/\s+/).filter(Boolean);
      const sharedTokens = nameTokens.filter(t=>t.length>=3 && dTokens.includes(t));
      const meaningfulShared = sharedTokens.filter(t=>!COMMON_NAME_TOKENS.has(t));
      if(meaningfulShared.length>0){
        score = 0.85;
      } else if(sharedTokens.length>0){
        // Only a common surname-style word overlaps (e.g. both have "Kumar")
        // — too weak on its own to suggest.
        score = 0.6;
      } else {
        const dist = levenshtein(name, dName);
        const maxLen = Math.max(name.length, dName.length);
        score = 1 - dist/maxLen;
      }
    }
    if(score >= 0.72 && (!best || score>best.score)){
      const f = store.flats.find(x=>x.id===d.flat_id);
      best = { score, flatId: d.flat_id, flatLabel: f?f.label:d.flat_id, matchedName: d.name };
    }
  });
  return best;
}

// Pulls a flat number and a donor name out of messy free-text cash-book
// notes like "Flat-101 Murthy-yettogive", "Sunil Kumar 204", "016-Owner",
// "Pramod-212(For laddu)", or a bare "210" with no name at all.
function parseFlatAndNameFromNotes(notesRaw){
  let text = String(notesRaw||'').trim();
  if(!text) return null;
  let note = '';
  const parenMatch = text.match(/\(([^)]+)\)/);
  if(parenMatch){ note = parenMatch[1].trim(); text = text.replace(/\([^)]*\)/g,'').trim(); }
  // "yettogive" / "yet to give" marks a PLEDGE — promised but not actually
  // handed over yet — not a received donation, even though the ledger's
  // Cash In column may still show the promised amount.
  const isPledge = /yet\s*to\s*give/i.test(text);
  text = text.replace(/-?\s*yet\s*to\s*give/gi,'').trim();
  // Plain "102" or "104-Someone" have the flat number as its own token, caught by
  // the word-boundary regex below. But "A010-Rohan" style notes have a letter
  // glued directly onto the digits (no boundary between "A" and "0"), so that
  // regex finds nothing there — fall back to a pattern that also eats 1-2
  // leading letters glued onto the number.
  let flatMatch = text.match(/\b(\d{1,3})\b/);
  let matchedToken = flatMatch ? flatMatch[0] : null;
  if(!flatMatch){
    const prefixed = text.match(/\b[A-Za-z]{1,2}(\d{2,3})\b/);
    if(prefixed){ flatMatch = prefixed; matchedToken = prefixed[0]; }
  }
  if(!flatMatch) return null;
  const flatCode = flatMatch[1].padStart(3,'0');
  let name = text.replace(matchedToken,'')
    .replace(/\bflat\b[-\s]*/gi,'')
    .replace(/^[-\s]+|[-\s]+$/g,'')
    .replace(/[-\s]+/g,' ')
    .trim();
  return { flatCode, name, note, isPledge };
}

const MONTH_ABBR = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
function parseLedgerDate(cell){
  if(cell instanceof Date && !isNaN(cell)) return cell.getFullYear()+'-'+String(cell.getMonth()+1).padStart(2,'0')+'-'+String(cell.getDate()).padStart(2,'0');
  const s = String(cell||'').trim();
  if(!s) return null;
  const m = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{4})$/);
  if(m){
    const mon = MONTH_ABBR[m[2].slice(0,3).toLowerCase()];
    if(mon!=null) return m[3]+'-'+String(mon+1).padStart(2,'0')+'-'+m[1].padStart(2,'0');
  }
  const d = new Date(s);
  if(!isNaN(d)) return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  return null;
}
function parseLedgerAmount(cell){
  const n = Number(String(cell||'').replace(/,/g,'').trim());
  return isNaN(n) ? 0 : n;
}
// Finds the header row of a "Date | Notes | Cash In | Cash Out | Balance"
// style cash-book export — tolerant of column order and minor naming.
function findLedgerHeader(rows2D){
  for(let i=0;i<rows2D.length;i++){
    const row = (rows2D[i]||[]).map(c=>String(c||'').trim().toLowerCase());
    const dateIdx = row.findIndex(c=>c==='date');
    const notesIdx = row.findIndex(c=>/notes|description|particulars/.test(c));
    const cashInIdx = row.findIndex(c=>/cash\s*in|credit|^amount$/.test(c));
    if(dateIdx>=0 && notesIdx>=0 && cashInIdx>=0){
      const cashOutIdx = row.findIndex(c=>/cash\s*out|debit/.test(c));
      return { headerRowIdx:i, dateIdx, notesIdx, cashInIdx, cashOutIdx };
    }
  }
  return null;
}
function parseLedgerWorkbookRows(rows2D){
  const header = findLedgerHeader(rows2D);
  if(!header) return null;
  const out = [];
  for(let i=header.headerRowIdx+1; i<rows2D.length; i++){
    const row = rows2D[i]||[];
    const notesRaw = String(row[header.notesIdx]||'').trim();
    if(!notesRaw || /previous balance/i.test(notesRaw) || /^total\b/i.test(notesRaw) || /^balance$/i.test(notesRaw)) continue;
    const cashIn = parseLedgerAmount(row[header.cashInIdx]);
    const cashOut = header.cashOutIdx>=0 ? parseLedgerAmount(row[header.cashOutIdx]) : 0;
    if(cashIn<=0 && cashOut<=0) continue;
    const date = parseLedgerDate(row[header.dateIdx]) || todayISO();
    if(cashIn>0){
      const parsed = parseFlatAndNameFromNotes(notesRaw);
      // A note mentioning a specific item (laddu, idol, prasadam, flowers, decoration,
      // sponsorship of a specific thing) means the value was contributed as an
      // in-kind donation, not handed over as cash — even though the ledger still
      // records a rupee value for it in the Cash In column.
      const inKindNote = parsed && parsed.note ? parsed.note : '';
      const isInKind = /laddu|prasad|idol|flower|decoration|garland|fruit(s)?\b/i.test(inKindNote);
      if(!parsed){
        const suggestion = suggestFlatByName(notesRaw);
        out.push({ source:'donation', date, flatCode:null, name: notesRaw, amount:cashIn, kind:'cash', itemDescription:'', note:'Imported from cash book', matched:false, flatId:null, flatLabel: notesRaw, suggestion });
        continue;
      }
      const flatId = 'A'+parsed.flatCode;
      const f = store.flats.find(x=>x.id===flatId);
      if(parsed.isPledge){
        out.push({
          source:'pledge', date, flatCode: parsed.flatCode, flatId, flatLabel: f?f.label:flatId,
          name: parsed.name || (f&&f.owner) || 'Resident', amount: cashIn,
          note: parsed.note ? 'Imported from cash book — '+parsed.note : 'Imported from cash book',
          matched: !!f,
        });
        continue;
      }
      out.push({
        source:'donation', date, flatCode: parsed.flatCode, flatId, flatLabel: f?f.label:flatId,
        name: parsed.name || (f&&f.owner) || 'Resident', kind: isInKind?'in_kind':'cash', amount: cashIn,
        itemDescription: isInKind ? inKindNote : '',
        note: parsed.note ? 'Imported from cash book — '+parsed.note : 'Imported from cash book',
        matched: !!f,
      });
    } else {
      out.push({
        source:'expense', date, category:'Miscellaneous', description: notesRaw.replace(/\([^)]*\)/g,'').trim() || 'Imported expense',
        amount: cashOut, note:'Imported from cash book', matched:true,
      });
    }
  }
  return out;
}

function openBulkImportModal(){
  if(!perms.canDonations){ showToast('You do not have permission to add donations'); return; }
  document.getElementById('bulkImportText').value = '';
  document.getElementById('bulkImportExcelFile').value = '';
  document.getElementById('bulkImportPdfFile').value = '';
  document.getElementById('bulkImportFileStatus').textContent = '';
  const dateInput = document.getElementById('bulkImportDate');
  dateInput.value = todayISO();
  dateInput.dispatchEvent(new Event('change'));
  document.querySelectorAll('#bulkImportModeRow .mode-btn').forEach(b=>b.classList.toggle('active', b.dataset.mode==='UPI'));
  document.getElementById('bulkImportStep1').classList.remove('hidden');
  document.getElementById('bulkImportStep2').classList.add('hidden');
  document.getElementById('parseBulkImportBtn').classList.remove('hidden');
  document.getElementById('confirmBulkImportBtn').classList.add('hidden');
  document.getElementById('backBulkImportBtn').classList.add('hidden');
  bulkImportModal.classList.remove('hidden');
}
function closeBulkImportModal(){ bulkImportModal.classList.add('hidden'); }
document.getElementById('bulkImportBtn').addEventListener('click', openBulkImportModal);
document.getElementById('closeBulkImportModal').addEventListener('click', closeBulkImportModal);
document.getElementById('cancelBulkImportBtn').addEventListener('click', closeBulkImportModal);
document.getElementById('bulkImportModeRow').addEventListener('click', (e)=>{
  const btn = e.target.closest('.mode-btn'); if(!btn) return;
  setModeButtons('bulkImportModeRow', btn.dataset.mode);
});

function goToBulkImportPreview(){
  renderBulkImportPreview();
  document.getElementById('bulkImportStep1').classList.add('hidden');
  document.getElementById('bulkImportStep2').classList.remove('hidden');
  document.getElementById('parseBulkImportBtn').classList.add('hidden');
  document.getElementById('confirmBulkImportBtn').classList.remove('hidden');
  document.getElementById('backBulkImportBtn').classList.remove('hidden');
}

function rowIsDuplicate(r){
  if(r.source==='donation' && r.flatId){
    return store.donations.some(d=> d.flat_id===r.flatId && (d.name||'').toLowerCase()===(r.name||'').toLowerCase()
      && d.date===r.date && Number(d.amount)===Number(r.amount));
  } else if(r.source==='pledge' && r.flatId){
    return store.pledges.some(p=> p.flat_id===r.flatId && (p.name||'').toLowerCase()===(r.name||'').toLowerCase()
      && p.pledged_date===r.date && Number(p.amount)===Number(r.amount));
  } else if(r.source==='expense'){
    return store.expenses.some(e=> (e.description||'').toLowerCase()===(r.description||'').toLowerCase()
      && e.date===r.date && Number(e.amount)===Number(r.amount));
  }
  return false;
}
function markDuplicates(rows){
  return rows.map(r=>{
    const isDuplicate = rowIsDuplicate(r);
    return Object.assign({}, r, { isDuplicate, included: !isDuplicate });
  });
}

document.getElementById('parseBulkImportBtn').addEventListener('click', ()=>{
  const text = document.getElementById('bulkImportText').value;
  const batchDate = document.getElementById('bulkImportDate').value || todayISO();
  const parsed = parseWhatsAppDonationText(text);
  if(!parsed.length){ showToast('No "Flat NNN – Name – ₹Amount" style lines found — paste text or upload a file first'); return; }

  const rows = parsed.map(r=>{
    const flatId = 'A'+r.flatCode;
    const f = store.flats.find(x=>x.id===flatId);
    return Object.assign({}, r, {
      source:'donation', date: batchDate, flatId, matched: !!f, flatLabel: f ? f.label : flatId,
      note:'Imported from WhatsApp daily update',
    });
  });
  bulkImportRows = markDuplicates(rows);
  goToBulkImportPreview();
});

/* ---------- Excel / CSV cash-book upload ---------- */
document.getElementById('bulkImportExcelFile').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const statusEl = document.getElementById('bulkImportFileStatus');
  if(typeof XLSX === 'undefined'){ statusEl.textContent = 'Could not load the spreadsheet reader — check your internet connection and try again.'; return; }
  statusEl.textContent = 'Reading '+file.name+'…';
  const reader = new FileReader();
  reader.onload = (ev)=>{
    try{
      const wb = XLSX.read(new Uint8Array(ev.target.result), { type:'array', cellDates:true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows2D = XLSX.utils.sheet_to_json(sheet, { header:1, raw:true, defval:'' });
      const parsed = parseLedgerWorkbookRows(rows2D);
      if(!parsed){ statusEl.textContent = 'Could not find Date / Notes / Cash In columns in that file — try pasting the text instead.'; return; }
      if(!parsed.length){ statusEl.textContent = 'No donation or expense rows found in that file.'; return; }
      bulkImportRows = markDuplicates(parsed);
      statusEl.textContent = '';
      goToBulkImportPreview();
    }catch(err){
      statusEl.textContent = 'Could not read that file: '+(err.message||err);
    }
  };
  reader.readAsArrayBuffer(file);
});

/* ---------- PDF upload: extract text into the textarea for the normal parser ---------- */
document.getElementById('bulkImportPdfFile').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const statusEl = document.getElementById('bulkImportFileStatus');
  if(typeof pdfjsLib === 'undefined'){ statusEl.textContent = 'Could not load the PDF reader — check your internet connection and try again.'; return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  statusEl.textContent = 'Reading '+file.name+'…';
  const reader = new FileReader();
  reader.onload = async (ev)=>{
    try{
      const pdf = await pdfjsLib.getDocument({ data:new Uint8Array(ev.target.result) }).promise;
      let fullText = '';
      for(let p=1; p<=pdf.numPages; p++){
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        fullText += content.items.map(it=>it.str).join(' ') + '\n';
      }
      document.getElementById('bulkImportText').value = fullText.trim();
      statusEl.textContent = 'Extracted text from '+file.name+' — review below, then click Preview.';
    }catch(err){
      statusEl.textContent = 'Could not read that PDF: '+(err.message||err);
    }
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById('backBulkImportBtn').addEventListener('click', ()=>{
  document.getElementById('bulkImportStep1').classList.remove('hidden');
  document.getElementById('bulkImportStep2').classList.add('hidden');
  document.getElementById('parseBulkImportBtn').classList.remove('hidden');
  document.getElementById('confirmBulkImportBtn').classList.add('hidden');
  document.getElementById('backBulkImportBtn').classList.add('hidden');
});

function renderBulkImportPreview(){
  const listEl = document.getElementById('bulkImportPreviewList');
  listEl.innerHTML = bulkImportRows.map((r,i)=>{
    const flag = !r.matched ? '<span class="bi-flag unmatched">NO FLAT FOUND</span>'
      : r.isDuplicate ? '<span class="bi-flag dupe">POSSIBLE DUPLICATE</span>' : '';
    const rowClass = !r.matched ? 'bi-unmatched' : r.isDuplicate ? 'bi-dupe' : '';
    const typeTag = r.source==='expense' ? '<span class="bi-row-type expense">Expense</span>'
      : r.source==='pledge' ? '<span class="bi-row-type pledge">Pledge</span>'
      : '<span class="bi-row-type donation">Donation</span>';
    const title = r.source==='expense' ? (r.category+' — '+r.description) : (escapeHtml(r.flatLabel||'No flat')+' — '+escapeHtml(r.name));
    const flatSub = r.flatCode ? ('Flat '+escapeHtml(r.flatCode)) : (r.matched ? 'No flat on record' : 'Flat '+escapeHtml('?'));
    const sub = r.source==='expense' ? fmtDate(r.date)
      : r.source==='pledge' ? (flatSub+' · promised '+fmtDate(r.date)+(r.matched?'':' — pick a flat below'))
      : (flatSub+' · '+fmtDate(r.date)+(r.matched?'':' — pick a flat below'));
    const amtText = r.source==='expense' ? fmtINR(r.amount)
      : r.source==='pledge' ? fmtINR(r.amount)+' (pledged)'
      : (r.kind==='cash' ? fmtINR(r.amount) : '🎁 '+escapeHtml(r.itemDescription));
    // Rows where no flat number could be found in the source text (a name-only
    // ledger entry, e.g. "Mallaiah" with no flat number written anywhere) can't
    // be auto-matched — let the user pick the flat by hand instead of just
    // blocking the row from import.
    const flatPicker = (!r.matched && r.source!=='expense')
      ? `<select class="bi-flat-picker" data-idx="${i}">
          <option value="">Assign a flat…</option>
          ${store.flats.map(fl=>`<option value="${escapeHtml(fl.id)}">${escapeHtml(fl.label)}${fl.owner?' — '+escapeHtml(fl.owner):''}</option>`).join('')}
          ${r.source==='donation' ? '<option value="__unknown__">🕵️ Unknown / Vacated Tenant (no flat)</option>' : ''}
        </select>`
      : '';
    // Cross-references the donor name against donations already imported
    // (any year) — if a close name match exists, offer its flat as a
    // one-click suggestion instead of making the user hunt manually.
    const suggestionHint = (!r.matched && r.source!=='expense' && r.suggestion)
      ? `<div class="bi-suggestion">💡 Did you mean <b>${escapeHtml(r.suggestion.flatLabel)}</b> — ${escapeHtml(r.suggestion.matchedName)}?
          <button type="button" class="bi-suggestion-use" data-idx="${i}" data-flat="${escapeHtml(r.suggestion.flatId)}">Use this</button>
        </div>`
      : '';
    return `
      <div class="bi-row ${rowClass}">
        <input type="checkbox" class="bi-check" id="bi-check-${i}" data-idx="${i}" ${r.included && r.matched ? 'checked' : ''} ${r.matched ? '' : 'disabled'}>
        <label for="bi-check-${i}" class="bi-row-left">
          ${typeTag}
          <div>
            <div class="bi-row-title">${title}</div>
            <div class="bi-row-sub">${sub}</div>
            ${suggestionHint}
          </div>
        </label>
        ${flatPicker}
        ${flag}
        <div class="bi-row-amt">${amtText}</div>
      </div>`;
  }).join('') || '<p class="empty-sub">No rows recognized.</p>';

  const includedCount = bulkImportRows.filter(r=>r.included && r.matched).length;
  const donationTotal = bulkImportRows.filter(r=>r.included && r.matched && r.source==='donation' && r.kind==='cash').reduce((s,r)=>s+r.amount,0);
  const pledgeTotal = bulkImportRows.filter(r=>r.included && r.matched && r.source==='pledge').reduce((s,r)=>s+r.amount,0);
  const expenseTotal = bulkImportRows.filter(r=>r.included && r.matched && r.source==='expense').reduce((s,r)=>s+r.amount,0);
  document.getElementById('bulkImportSummary').textContent =
    `Found ${bulkImportRows.length} row${bulkImportRows.length===1?'':'s'} — ${includedCount} selected: ${fmtINR(donationTotal)} in donations`
    + (pledgeTotal>0 ? `, ${fmtINR(pledgeTotal)} in pledges (not yet received)` : '')
    + (expenseTotal>0 ? `, ${fmtINR(expenseTotal)} in expenses.` : '.');
}

function applyFlatToBulkImportRow(idx, flatId){
  if(!flatId) return;
  const r = bulkImportRows[idx];
  if(flatId==='__unknown__'){
    // No flat could be identified — a long-vacated tenant or an unrecognized
    // name — record the donation with no flat rather than blocking it.
    r.flatId = null;
    r.flatCode = null;
    r.flatLabel = 'Unknown / Vacated Tenant';
    if(!r.name) r.name = 'Unknown Donor';
    r.matched = true;
    r.isDuplicate = false;
    r.included = true;
    renderBulkImportPreview();
    return;
  }
  const f = store.flats.find(x=>x.id===flatId);
  r.flatId = flatId;
  r.flatCode = flatId.replace(/^A/,'');
  r.flatLabel = f ? f.label : flatId;
  if(!r.name) r.name = (f && f.owner) || 'Resident';
  r.matched = true;
  r.isDuplicate = rowIsDuplicate(r);
  r.included = !r.isDuplicate;
  renderBulkImportPreview();
}

document.getElementById('bulkImportPreviewList').addEventListener('click', (e)=>{
  const useBtn = e.target.closest('.bi-suggestion-use');
  if(!useBtn) return;
  applyFlatToBulkImportRow(Number(useBtn.dataset.idx), useBtn.dataset.flat);
});

document.getElementById('bulkImportPreviewList').addEventListener('change', (e)=>{
  const picker = e.target.closest('.bi-flat-picker');
  if(picker){
    applyFlatToBulkImportRow(Number(picker.dataset.idx), picker.value);
    return;
  }
  const check = e.target.closest('.bi-check'); if(!check) return;
  bulkImportRows[Number(check.dataset.idx)].included = check.checked;
  renderBulkImportPreview();
});

document.getElementById('confirmBulkImportBtn').addEventListener('click', async ()=>{
  if(!perms.canDonations){ showToast('You do not have permission to add donations'); return; }
  const mode = document.querySelector('#bulkImportModeRow .mode-btn.active')?.dataset.mode || 'UPI';
  const toImport = bulkImportRows.filter(r=>r.included && r.matched);
  if(!toImport.length){ showToast('Nothing selected to import'); return; }

  const btn = document.getElementById('confirmBulkImportBtn');
  btn.disabled = true;
  let donationCount = 0, expenseCount = 0, pledgeCount = 0;
  for(const r of toImport){
    if(r.source==='expense'){
      if(!perms.canExpenses) continue;
      const { error } = await sb.from('ganesh_expenses').insert({
        category: r.category, description: r.description, amount: r.amount, mode:'Cash', date: r.date, note: r.note,
        created_by: profile.id, recorded_by: profile.id, recorded_by_name: displayName(profile),
      });
      if(!error) expenseCount++;
    } else if(r.source==='pledge'){
      const { error } = await sb.from('ganesh_pledges').insert({
        flat_id: r.flatId, name: r.name, amount: r.amount, pledged_date: r.date, note: r.note,
        status: 'pending', created_by: profile.id,
      });
      if(!error) pledgeCount++;
    } else {
      const payload = {
        flat_id: r.flatId, name: r.name, kind: r.kind, date: r.date,
        note: r.note, created_by: profile.id, collected_by: profile.id, collected_by_name: displayName(profile),
        amount: r.amount,
        mode: r.kind==='cash' ? mode : '',
        item_description: r.kind==='in_kind' ? r.itemDescription : '',
      };
      const { error } = await sb.from('ganesh_donations').insert(payload);
      if(!error){ donationCount++; await maybeAutoFillFlatOwner(r.flatId, r.name); }
    }
  }
  btn.disabled = false;
  const summary = donationCount+' donation'+(donationCount===1?'':'s')
    + (pledgeCount ? ' and '+pledgeCount+' pledge'+(pledgeCount===1?'':'s') : '')
    + (expenseCount ? ' and '+expenseCount+' expense'+(expenseCount===1?'':'s') : '');
  await logActivity('Bulk imported', summary);
  await fetchAllData();
  closeBulkImportModal();
  renderAll();
  showToast(summary+' imported ✓');
});

/* ============================================================
   EXPENSE MODAL
   ============================================================ */
const expenseModal = document.getElementById('expenseModal');
// Pass an existing expense's id to edit it in place (including changing its
// category — the field is free-text with a suggestion list, so any old or
// custom category can simply be retyped); omit it to add a new expense.
function openExpenseModal(expenseId){
  if(!perms.canExpenses){ showToast('You do not have permission to add expenses'); return; }
  const existing = expenseId ? store.expenses.find(x=>x.id===expenseId) : null;
  ui.editingExpenseId = existing ? expenseId : null;
  document.getElementById('expenseModalTitle').textContent = existing ? 'Edit Expense' : 'Add Expense';
  // The usual CATEGORIES list, plus the expense's own category if it's an
  // older/custom one that's since fallen off that list — so editing never
  // silently blanks out or hides what it was actually filed under.
  const categoryOptions = existing && !CATEGORIES.includes(existing.category)
    ? [...CATEGORIES, existing.category] : CATEGORIES;
  document.getElementById('expense-categories').innerHTML = categoryOptions.map(c=>`<option value="${escapeHtml(c)}"></option>`).join('');
  document.getElementById('expCategory').value = existing ? existing.category : CATEGORIES[0];
  document.getElementById('expDesc').value = existing ? existing.description : '';
  document.getElementById('expAmount').value = existing ? existing.amount : '';
  document.getElementById('expAmount').dispatchEvent(new Event('input'));
  document.getElementById('expDate').value = existing ? existing.date : todayISO();
  document.getElementById('expDate').dispatchEvent(new Event('change'));
  document.getElementById('expNote').value = existing ? (existing.note||'') : '';
  setModeButtons('expModeRow', existing ? existing.mode : 'Cash');
  document.getElementById('expTotalExpected').value = existing && existing.total_expected!=null ? existing.total_expected : '';
  document.getElementById('expTotalExpected').dispatchEvent(new Event('input'));
  setPaymentTypeButtons(existing ? (existing.payment_type || 'full') : 'full');
  updateExpBalanceDueHint();
  document.getElementById('expBillFile').value = '';
  const billLabel = document.getElementById('billUploadLabel');
  if(existing && existing.bill_url){ billLabel.textContent = '📎 Bill attached — choose a file to replace it'; billLabel.classList.add('attached'); }
  else { billLabel.textContent = '📎 Attach bill photo (optional)'; billLabel.classList.remove('attached'); }
  const rbField = document.getElementById('expRecordedByField');
  rbField.hidden = !perms.isAdmin;
  if(perms.isAdmin){
    const rbSel = document.getElementById('expRecordedBy');
    rbSel.innerHTML = assignablePeopleOptionsHtml();
    rbSel.value = existing ? (existing.recorded_by || profile.id) : profile.id;
  }
  expenseModal.classList.remove('hidden');
}
function closeExpenseModal(){ expenseModal.classList.add('hidden'); ui.editingExpenseId = null; }
document.getElementById('addExpenseBtnDash').addEventListener('click', ()=>openExpenseModal());
document.getElementById('addExpenseBtnList').addEventListener('click', ()=>openExpenseModal());
document.getElementById('expensesCards').addEventListener('click', (e)=>{
  const btn = e.target.closest('.edit-expense'); if(!btn) return;
  openExpenseModal(btn.dataset.id);
});
// Clicking a name in the "Recorded By" breakdown narrows the expense
// list/cards down to just that person's entries; clicking it again (or the
// clear chip) removes the filter.
document.getElementById('recordedByBreakdown').addEventListener('click', (e)=>{
  const row = e.target.closest('.bar-row-clickable'); if(!row) return;
  const key = row.dataset.key;
  ui.expensesPersonFilter = (ui.expensesPersonFilter && ui.expensesPersonFilter.key===key)
    ? null : { key, name: row.dataset.name };
  renderAll();
});
document.getElementById('expensesPersonFilterChip').addEventListener('click', (e)=>{
  if(!e.target.closest('#clearExpensesPersonFilter')) return;
  ui.expensesPersonFilter = null;
  renderAll();
});
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
  const paymentType = document.querySelector('#expPaymentTypeRow .mode-btn.active')?.dataset.ptype || 'full';
  const totalExpectedRaw = document.getElementById('expTotalExpected').value;
  const totalExpected = totalExpectedRaw !== '' ? Number(totalExpectedRaw) : null;
  if(!description){ showToast('Please enter a description'); return; }
  if(!amount || amount<=0){ showToast('Please enter a valid amount'); return; }
  let recordedBy = profile.id, recordedByName = displayName(profile);
  if(perms.isAdmin){
    const rbSel = document.getElementById('expRecordedBy');
    const chosenName = rbSel.selectedOptions[0]?.dataset.name;
    if(rbSel.value && chosenName){ recordedBy = rbSel.value; recordedByName = chosenName; }
  }
  const btn = document.getElementById('saveExpenseBtn');
  btn.disabled = true;

  const editingId = ui.editingExpenseId;
  const existing = editingId ? store.expenses.find(x=>x.id===editingId) : null;
  const expenseId = editingId || uuidv4();
  let billUrl = existing ? (existing.bill_url || null) : null;
  if(billFile){
    try{ billUrl = await uploadBillPhoto(expenseId, billFile); }
    catch(e){ btn.disabled = false; showToast('Bill upload failed: '+e.message); return; }
  }

  let error;
  if(editingId){
    ({ error } = await sb.from('ganesh_expenses').update({
      category, description, amount, mode, date, note, bill_attached: !!billUrl, bill_url: billUrl,
      payment_type: paymentType, total_expected: totalExpected,
      recorded_by: recordedBy, recorded_by_name: recordedByName,
    }).eq('id', editingId));
  } else {
    ({ error } = await sb.from('ganesh_expenses').insert({
      id: expenseId, category, description, amount, mode, date, note,
      bill_attached: !!billUrl, bill_url: billUrl, created_by: profile.id,
      recorded_by: recordedBy, recorded_by_name: recordedByName,
      payment_type: paymentType, total_expected: totalExpected,
    }));
  }
  btn.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity(editingId ? 'Edited expense' : 'Added expense', category+' — '+fmtINR(amount));
  await fetchAllData();
  closeExpenseModal();
  renderAll();
  showToast(editingId ? 'Expense updated ✓' : 'Expense added successfully ✓');
});

/* ---------- delete donation/expense ---------- */
// If this donation had fulfilled a pledge (via "Mark Received"), deleting it
// must not leave that pledge stranded: revert it to pending and unlink it,
// otherwise the money disappears from both Total Collected AND the pledge
// tracker at once, with no trace either place.
async function revertPledgeIfFulfilledBy(donationId){
  const linked = store.pledges.find(p=>p.fulfilled_donation_id===donationId);
  if(!linked) return;
  await sb.from('ganesh_pledges').update({ status:'pending', fulfilled_donation_id:null }).eq('id', linked.id);
  await logActivity('Pledge reverted to pending', (linked.name||'Resident')+' — its donation was deleted');
}
document.getElementById('donationsTableBody').addEventListener('click', async (e)=>{
  const receiptBtn = e.target.closest('.print-receipt');
  if(receiptBtn){ printDonationReceipt(receiptBtn.dataset.id); return; }
  const shareBtn = e.target.closest('.share-receipt');
  if(shareBtn){ shareDonationReceipt(shareBtn.dataset.id); return; }
  const editBtn = e.target.closest('.edit-donation');
  if(editBtn){ openDonationModal(null, editBtn.dataset.id); return; }
  const btn = e.target.closest('.delete-donation'); if(!btn) return;
  if(!perms.canDonations) return;
  if(!(await showConfirm('Delete this donation?', { title:'Delete donation?' }))) return;
  const d = store.donations.find(x=>x.id===btn.dataset.id);
  const { error } = await sb.from('ganesh_donations').delete().eq('id', btn.dataset.id);
  if(error){ showToast('Error: '+error.message); return; }
  await revertPledgeIfFulfilledBy(btn.dataset.id);
  await logActivity('Deleted donation', d ? (d.name+' — '+fmtINR(d.amount)) : btn.dataset.id);
  await fetchAllData(); renderAll(); showToast('Donation deleted');
});
document.getElementById('donationsCards').addEventListener('click', (e)=>{
  const receiptBtn = e.target.closest('.print-receipt');
  if(receiptBtn){ printDonationReceipt(receiptBtn.dataset.id); return; }
  const shareBtn = e.target.closest('.share-receipt');
  if(shareBtn){ shareDonationReceipt(shareBtn.dataset.id); return; }
  const editBtn = e.target.closest('.edit-donation');
  if(editBtn) openDonationModal(null, editBtn.dataset.id);
});
document.getElementById('expensesTableBody').addEventListener('click', async (e)=>{
  const editBtn = e.target.closest('.edit-expense');
  if(editBtn){ openExpenseModal(editBtn.dataset.id); return; }
  const btn = e.target.closest('.delete-expense'); if(!btn) return;
  if(!perms.canExpenses) return;
  if(!(await showConfirm('Delete this expense?', { title:'Delete expense?' }))) return;
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
  document.getElementById('flatIdField').hidden = !perms.isAdmin;
  document.getElementById('flatIdInput').value = f.id;
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
  const oldId = ui.editingFlatId;

  // Rename (Super Admin only, field is hidden for everyone else): a plain
  // `update ganesh_flats set id=...` is safe now that every flat_id foreign
  // key carries "on update cascade" (supabase-setup.sql), so donations/
  // pledges/seva sign-ups referencing this flat move with it automatically.
  let newId = oldId;
  if(perms.isAdmin){
    newId = document.getElementById('flatIdInput').value.trim();
    if(!newId){ showToast('Flat number cannot be blank'); return; }
    if(newId !== oldId){
      if(store.flats.some(f=>f.id===newId)){ showToast('A flat with that number already exists'); return; }
      if(!(await showConfirm(`Rename flat ${oldId} to ${newId}? This updates it everywhere it's referenced.`, { danger:false, title:'Rename flat?', okLabel:'Rename', icon:'✏️' }))) return;
    }
  }

  const btn = document.getElementById('saveFlatBtn');
  btn.disabled = true;
  if(newId !== oldId){
    const { error: renameErr } = await sb.from('ganesh_flats').update({ id: newId }).eq('id', oldId);
    if(renameErr){ showToast('Error renaming flat: '+renameErr.message); btn.disabled=false; return; }
  }
  const { error } = await sb.from('ganesh_flats').update({ owner, tenant }).eq('id', newId);
  btn.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  if(newId !== oldId) await logActivity('Renamed flat', oldId+' → '+newId);
  await logActivity('Edited flat', newId+' — owner: '+(owner||'—')+', tenant: '+(tenant||'—'));
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
function openTransferModal(transferId){
  // Editing/deleting an existing transfer is Super Admin only per RLS — only
  // inserting a new one is also open to Treasurer.
  if(transferId && !perms.isAdmin){ showToast('Only Super Admin can edit a transfer'); return; }
  if(!transferId && !perms.canExpenses){ showToast('Only Super Admin or Treasurer can record transfers'); return; }
  const existing = transferId ? store.fundTransfers.find(x=>x.id===transferId) : null;
  ui.editingTransferId = existing ? transferId : null;
  document.getElementById('transferModalTitle').textContent = existing ? 'Edit Transfer' : 'Record Transfer';
  const options = assignablePeopleOptionsHtml();
  document.getElementById('transferFrom').innerHTML = options;
  document.getElementById('transferTo').innerHTML = options;
  document.getElementById('transferFrom').value = existing ? existing.from_user : profile.id;
  const otherProfile = store.profiles.find(p=>p.id!==profile.id);
  document.getElementById('transferTo').value = existing ? existing.to_user : (otherProfile ? otherProfile.id : profile.id);
  document.getElementById('transferAmount').value = existing ? existing.amount : '';
  document.getElementById('transferAmount').dispatchEvent(new Event('input'));
  document.getElementById('transferDate').value = existing ? existing.date : todayISO();
  document.getElementById('transferDate').dispatchEvent(new Event('change'));
  document.getElementById('transferNote').value = existing ? (existing.note||'') : '';
  transferModal.classList.remove('hidden');
}
function closeTransferModal(){ transferModal.classList.add('hidden'); ui.editingTransferId = null; }
document.getElementById('recordTransferBtn').addEventListener('click', ()=>openTransferModal());
document.getElementById('closeTransferModal').addEventListener('click', closeTransferModal);
document.getElementById('cancelTransferBtn').addEventListener('click', closeTransferModal);
document.getElementById('recentTransfersList').addEventListener('click', async (e)=>{
  const editBtn = e.target.closest('.edit-transfer');
  if(editBtn){ openTransferModal(editBtn.dataset.id); return; }
  const delBtn = e.target.closest('.delete-transfer');
  if(!delBtn) return;
  if(!perms.isAdmin) return;
  if(!(await showConfirm('Delete this transfer?', { title:'Delete transfer?' }))) return;
  const t = store.fundTransfers.find(x=>x.id===delBtn.dataset.id);
  const { error } = await sb.from('ganesh_fund_transfers').delete().eq('id', delBtn.dataset.id);
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity('Deleted transfer', t ? (t.from_user_name+' → '+t.to_user_name+' — '+fmtINR(t.amount)) : delBtn.dataset.id);
  await fetchAllData(); renderAll(); showToast('Transfer deleted');
});
document.getElementById('saveTransferBtn').addEventListener('click', async ()=>{
  if(ui.editingTransferId ? !perms.isAdmin : !perms.canExpenses) return;
  const fromId = document.getElementById('transferFrom').value;
  const toId = document.getElementById('transferTo').value;
  const amount = Number(document.getElementById('transferAmount').value);
  const date = document.getElementById('transferDate').value || todayISO();
  const note = document.getElementById('transferNote').value.trim();
  if(!fromId || !toId){ showToast('Please select both people'); return; }
  if(fromId===toId){ showToast('From and To must be different people'); return; }
  if(!amount || amount<=0){ showToast('Please enter a valid amount'); return; }
  const fromName = document.getElementById('transferFrom').selectedOptions[0]?.dataset.name || 'Unassigned';
  const toName = document.getElementById('transferTo').selectedOptions[0]?.dataset.name || 'Unassigned';
  const btn = document.getElementById('saveTransferBtn');
  btn.disabled = true;
  const editingId = ui.editingTransferId;
  let error;
  if(editingId){
    ({ error } = await sb.from('ganesh_fund_transfers').update({
      from_user: fromId, from_user_name: fromName,
      to_user: toId, to_user_name: toName,
      amount, date, note,
    }).eq('id', editingId));
  } else {
    ({ error } = await sb.from('ganesh_fund_transfers').insert({
      from_user: fromId, from_user_name: fromName,
      to_user: toId, to_user_name: toName,
      amount, date, note, created_by: profile.id,
    }));
  }
  btn.disabled = false;
  if(error){ showToast('Error: '+error.message); return; }
  await logActivity(editingId ? 'Edited transfer' : 'Recorded transfer', fromName+' → '+toName+' — '+fmtINR(amount));
  await fetchAllData();
  closeTransferModal();
  renderAll();
  showToast(editingId ? 'Transfer updated ✓' : 'Transfer recorded ✓');
});

// Clicking a name in "Who Has How Much (Cash in Hand)" opens a breakdown of
// every donation/expense/transfer that made up their current balance, split
// into money in vs. money out -- so e.g. multiple transfers handed to
// someone are easy to find rather than just seeing the net figure.
const custodyDetailModal = document.getElementById('custodyDetailModal');
function openCustodyDetailModal(c){
  document.getElementById('custodyDetailTitle').textContent = c.person;
  document.getElementById('custodyDetailIn').textContent = c.totalInFmt;
  document.getElementById('custodyDetailOut').textContent = c.totalOutFmt;
  const netEl = document.getElementById('custodyDetailNet');
  netEl.textContent = c.amountFmt;
  netEl.className = 'custody-detail-value '+(c.isNegative?'red':'green');
  const row = (x) => `
    <div class="custody-detail-row">
      <div><div>${escapeHtml(x.label)}</div><div class="custody-detail-row-date">${x.dateFmt}</div></div>
      <div class="strong">${x.amountFmt}</div>
    </div>
  `;
  document.getElementById('custodyDetailInList').innerHTML = c.itemsIn.map(row).join('') || '<p class="empty-sub">No money in recorded.</p>';
  document.getElementById('custodyDetailOutList').innerHTML = c.itemsOut.map(row).join('') || '<p class="empty-sub">No money out recorded.</p>';
  custodyDetailModal.classList.remove('hidden');
}
function closeCustodyDetailModal(){ custodyDetailModal.classList.add('hidden'); }
document.getElementById('custodyBreakdown').addEventListener('click', (e)=>{
  const row = e.target.closest('.bar-row-clickable'); if(!row) return;
  const c = computeView().custodyBreakdown.find(x=>x.key===row.dataset.key);
  if(c) openCustodyDetailModal(c);
});
document.getElementById('closeCustodyDetailModal').addEventListener('click', closeCustodyDetailModal);
document.getElementById('closeCustodyDetailBtn').addEventListener('click', closeCustodyDetailModal);

/* ============================================================
   CATEGORY BUDGETS
   ============================================================ */
const budgetModal = document.getElementById('budgetModal');
let budgetEditRows = [];
let budgetModalCollected = 0;

function renderBudgetSummary(){
  const allocated = budgetEditRows.reduce((sum,r)=>{
    const val = r.mode==='percent' ? Math.round(((Number(r.pct)||0)/100) * budgetModalCollected) : (Number(r.amount)||0);
    return sum + val;
  }, 0);
  const available = budgetModalCollected - allocated;
  document.getElementById('budgetSumCollected').textContent = fmtINR(budgetModalCollected);
  document.getElementById('budgetSumAllocated').textContent = fmtINR(allocated);
  const availEl = document.getElementById('budgetSumAvailable');
  availEl.textContent = (available<0?'-':'') + fmtINR(Math.abs(available));
  availEl.classList.toggle('over-budget', available < 0);
}

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
  renderBudgetSummary();
}

function openBudgetModal(){
  if(!perms.canExpenses){ showToast('Only Super Admin or Treasurer can manage budgets'); return; }
  document.getElementById('budgetModalYear').textContent = ui.year;
  budgetModalCollected = computeView().totalCollected;
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
  renderBudgetSummary();
});
document.getElementById('copyPrevBudgetBtn').addEventListener('click', ()=>{
  const prevYear = String(Number(ui.year)-1);
  const prevBudgets = store.budgets.filter(b=>b.year===prevYear);
  if(!prevBudgets.length){ showToast('No budget found for '+prevYear+' to copy from'); return; }
  prevBudgets.forEach(pb=>{
    let row = budgetEditRows.find(r=>r.category.toLowerCase()===pb.category.toLowerCase());
    if(!row){ row = { category: pb.category, mode:'amount', amount:'', pct:'' }; budgetEditRows.push(row); }
    row.mode = pb.mode;
    row.amount = pb.mode==='amount' ? pb.amount : '';
    row.pct = pb.mode==='percent' ? pb.pct : '';
  });
  renderBudgetRows();
  showToast('Copied from '+prevYear+' — review the amounts, then Save Budgets ✓');
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
function openSevaDayModal(dayId){
  if(!perms.isAdmin){ showToast('Only a Super Admin can add seva days'); return; }
  const existing = dayId ? store.sevaDays.find(x=>x.id===dayId) : null;
  ui.editingSevaDayId = existing ? dayId : null;
  document.getElementById('sevaDayModalTitle').textContent = existing ? 'Edit Seva Day' : 'Add Seva Day';
  document.getElementById('sevaDayDateLabel').textContent = existing ? 'DATE' : 'FROM DATE';
  // Editing only ever touches the one existing day — hide the range field so
  // it can't accidentally batch-generate more days while editing.
  document.getElementById('sevaDayDateToField').classList.toggle('hidden', !!existing);
  document.getElementById('sevaDayDate').value = existing ? existing.seva_date : '';
  document.getElementById('sevaDayDateTo').value = '';
  document.getElementById('sevaDayLabel').value = existing ? (existing.label||'') : '';
  document.getElementById('saveSevaDayBtn').textContent = existing ? 'Save Changes' : 'Add Day';
  sevaDayModal.classList.remove('hidden');
}
function closeSevaDayModal(){ sevaDayModal.classList.add('hidden'); ui.editingSevaDayId = null; }
document.getElementById('addSevaDayBtn').addEventListener('click', ()=>openSevaDayModal());
document.getElementById('copySevaUrlBtn').addEventListener('click', async ()=>{
  const url = (store.settings.seva_signup_url||'').trim();
  if(!url){
    if(perms.isAdmin){ showToast('Add the Seva Sign-Up Page URL in Settings first'); }
    else { showToast('Ask your Super Admin to set up the sign-up link in Settings'); }
    return;
  }
  const committeeName = store.settings.committee_name || 'Ganesh Pooja Committee';
  const message = [
    `🙏 *${committeeName} — Prasadam Seva Sign-Up* 🙏`,
    'Sign up for a Morning or Evening slot — Pooja, or Pooja & Prasadam both — no login needed:',
    url,
    'Just pick a day and option, and add your name and flat number. Multiple people can join the same slot — the more the better! 🕉️'
  ].join('\n');
  const ok = await copyToClipboard(message);
  showToast(ok ? 'Copied! Paste into WhatsApp' : 'Could not copy — please copy manually');
});
/* "Copy Sevaks" -- builds a ready-to-paste WhatsApp message showing who
   has signed up (the sevaks) for each seva day/session so far, and which
   slots are still open, so the committee can post a status update and
   nudge people toward empty slots without retyping the whole list by hand. */
function buildSevaSignupsMessage(){
  const days = [...store.sevaDays].sort((a,b)=>a.seva_date.localeCompare(b.seva_date));
  if(!days.length) return null;
  const committeeName = store.settings.committee_name || 'Ganesh Pooja Committee';

  const lines = [];
  days.forEach(day=>{
    const dateLabel = new Date(day.seva_date+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
    lines.push(`📅 *${dateLabel}*${day.label ? ' — '+day.label : ''}`);
    SEVA_SESSIONS.forEach(sess=>{
      const signups = store.sevaSignups.filter(s=>s.day_id===day.id && s.session===sess.key);
      if(signups.length){
        const names = signups.map(s=>{
          const f = s.flat_id ? store.flats.find(x=>x.id===s.flat_id) : null;
          const flatLabel = f ? flatNumberOf(f.label) : (s.flat_id || 'Unknown');
          return `Flat ${flatLabel} (${s.name})`;
        }).join(', ');
        // Multiple people can join the same slot -- listing names should
        // never read as "full"; it always still says Open, more welcome.
        lines.push(`${sess.icon} ${sess.label}: ${names} — Open, more welcome! 🙋`);
      } else {
        lines.push(`${sess.icon} ${sess.label}: Open — sign up! 🙋`);
      }
    });
    lines.push('');
  });
  while(lines.length && lines[lines.length-1]==='') lines.pop();

  const url = (store.settings.seva_signup_url||'').trim();
  const message = [
    `🙏 *${committeeName} — Prasadam Seva Sevaks* 🙏`,
    '',
    ...lines,
    '',
    url ? 'You can signup for an open slot using this URL: '+url : 'Ask your Super Admin to add the seva sign-up URL in Settings so this message can include it.'
  ].join('\n');
  return message;
}
document.getElementById('copySevaSignupsBtn').addEventListener('click', async ()=>{
  const message = buildSevaSignupsMessage();
  if(!message){ showToast('No seva days set up yet'); return; }
  const ok = await copyToClipboard(message);
  showToast(ok ? 'Copied! Paste into WhatsApp' : 'Could not copy — please copy manually');
});
document.getElementById('closeSevaDayModal').addEventListener('click', closeSevaDayModal);
document.getElementById('cancelSevaDayBtn').addEventListener('click', closeSevaDayModal);
const MAX_SEVA_DAY_RANGE = 45; // sane cap so a typo in "to date" can't try to insert years of rows
document.getElementById('saveSevaDayBtn').addEventListener('click', async ()=>{
  if(!perms.isAdmin) return;
  const fromDate = document.getElementById('sevaDayDate').value;
  const label = document.getElementById('sevaDayLabel').value.trim();
  if(!fromDate){ showToast('Please pick a date'); return; }

  if(ui.editingSevaDayId){
    const btn = document.getElementById('saveSevaDayBtn');
    btn.disabled = true;
    const { error } = await sb.from('ganesh_prasadam_days')
      .update({ seva_date: fromDate, label })
      .eq('id', ui.editingSevaDayId);
    btn.disabled = false;
    if(error){ showToast('Error: '+error.message); return; }
    await logActivity('Edited seva day', fromDate+(label?' — '+label:''));
    await fetchAllData();
    closeSevaDayModal();
    renderAll();
    showToast('Seva day updated ✓');
    return;
  }

  const toDateRaw = document.getElementById('sevaDayDateTo').value;
  const toDate = toDateRaw && toDateRaw > fromDate ? toDateRaw : fromDate;

  // Build one row per date in [fromDate, toDate]. For a single day, label is
  // used as-is; for a range, each day gets "<label> — Day N" so they're
  // distinguishable (or just "Day N" if no label was given).
  // NOTE: use LOCAL date parts (not toISOString, which converts to UTC and
  // rolls the date back a day in any timezone ahead of UTC, e.g. IST).
  const toLocalISO = (d) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  const rows = [];
  let cur = new Date(fromDate+'T00:00:00');
  const end = new Date(toDate+'T00:00:00');
  let dayNum = 1;
  const isRange = toDate !== fromDate;
  while(cur <= end){
    if(dayNum > MAX_SEVA_DAY_RANGE){ break; }
    const iso = toLocalISO(cur);
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
  const editDayBtn = e.target.closest('.seva-day-edit');
  if(editDayBtn){
    if(!perms.isAdmin) return;
    openSevaDayModal(editDayBtn.dataset.day);
    return;
  }
  const delDayBtn = e.target.closest('.seva-day-delete');
  if(delDayBtn){
    if(!perms.isAdmin) return;
    if(!(await showConfirm('Remove this seva day? This also removes any sign-ups for it.', { title:'Remove seva day?' }))) return;
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
  if(addBtn){ openSevaSignupModal(addBtn.dataset.day, addBtn.dataset.time, null); return; }
  const editBtn = e.target.closest('.edit-signup');
  if(editBtn){
    if(!perms.isAdmin) return;
    const s = store.sevaSignups.find(x=>x.id===editBtn.dataset.signup);
    if(s) openSevaSignupModal(s.day_id, sevaTimeOf(s.session), s);
    return;
  }
  const delBtn = e.target.closest('.delete-signup');
  if(delBtn){
    if(!perms.isAdmin) return;
    if(!(await showConfirm('Delete this sign-up?', { title:'Delete sign-up?' }))) return;
    const signupInfo = store.sevaSignups.find(s=>s.id===delBtn.dataset.signup);
    const { error } = await sb.from('ganesh_prasadam_signups').delete().eq('id', delBtn.dataset.signup);
    if(error){ showToast('Error: '+error.message); return; }
    await logActivity('Deleted seva sign-up', signupInfo ? signupInfo.name : '');
    await fetchAllData(); renderAll(); showToast('Sign-up deleted');
  }
});

const sevaSignupModal = document.getElementById('sevaSignupModal');
let sevaEditingId = null;
function openSevaSignupModal(dayId, time, existing){
  const day = store.sevaDays.find(d=>d.id===dayId);
  if(!day) return;
  sevaEditingId = existing ? existing.id : null;
  const dateLabel = new Date(day.seva_date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
  document.getElementById('sevaSignupTitle').textContent = existing ? 'Edit Sign-up' : 'Add Your Name';
  document.getElementById('sevaSignupContext').textContent = dateLabel;
  document.getElementById('sevaSignupModal').dataset.day = dayId;
  // Editable so an existing sign-up can be moved between Pooja / Pooja &
  // Prasadam (Both), or between Morning / Evening, without deleting and
  // re-adding it from scratch.
  const timeSel = document.getElementById('sevaTimeSelect');
  timeSel.innerHTML = SEVA_TIMES.map(t=>`<option value="${t.key}">${t.icon} ${t.label}</option>`).join('');
  timeSel.value = existing ? sevaTimeOf(existing.session) : (time || 'morning');
  const typeSel = document.getElementById('sevaTypeSelect');
  typeSel.innerHTML = SEVA_TYPES.map(t=>`<option value="${t.key}">${t.label}</option>`).join('');
  typeSel.value = existing ? sevaTypeOf(existing.session) : SEVA_TYPES[0].key;
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
  const time = document.getElementById('sevaTimeSelect').value;
  const type = document.getElementById('sevaTypeSelect').value;
  const session = sevaComposeSession(time, type);
  if(!flatId){ showToast('Please select a flat'); return; }
  if(!name){ showToast('Please enter a name'); return; }
  const btn = document.getElementById('saveSevaSignupBtn');
  btn.disabled = true;
  let error;
  if(sevaEditingId){
    ({ error } = await sb.from('ganesh_prasadam_signups').update({ flat_id: flatId, name, note, session }).eq('id', sevaEditingId));
  } else {
    const dayId = sevaSignupModal.dataset.day;
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
  document.getElementById('settingsUpi1').value = store.settings.upi_number_1 || '';
  document.getElementById('settingsUpi2').value = store.settings.upi_number_2 || '';
  document.getElementById('settingsSevaUrl').value = store.settings.seva_signup_url || '';
  document.getElementById('settingsFlatCount').value = store.flats.length;
  document.getElementById('obYearLabel').textContent = ui.year;
  const obRow = store.openingBalances.find(o=>o.year===ui.year);
  document.getElementById('settingsOpeningBalance').value = obRow ? obRow.amount : '';
  document.getElementById('settingsOpeningBalanceNote').value = obRow ? (obRow.note||'') : '';
  document.getElementById('clearYearBtnYear').textContent = ui.year;
  renderUsersList();
  renderActivityLog();
  settingsModal.classList.remove('hidden');
}
function closeSettingsModal(){ settingsModal.classList.add('hidden'); }
document.getElementById('settingsBtn').addEventListener('click', openSettingsModal);
document.getElementById('settingsBtnMobile').addEventListener('click', openSettingsModal);
document.getElementById('noOpeningBalanceSettingsLink').addEventListener('click', ()=>{
  if(!perms.isAdmin){ showToast('Ask your Super Admin to set the opening balance'); return; }
  openSettingsModal();
});
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
  const upi1 = document.getElementById('settingsUpi1').value.trim();
  const upi2 = document.getElementById('settingsUpi2').value.trim();
  const sevaUrl = document.getElementById('settingsSevaUrl').value.trim();
  const desiredCount = Math.max(1, Math.min(999, Number(document.getElementById('settingsFlatCount').value) || store.flats.length));
  const nameChanged = committeeName !== (store.settings.committee_name||'');

  const { error: settingsErr } = await sb.from('ganesh_settings').update({ committee_name: committeeName, upi_number_1: upi1, upi_number_2: upi2, seva_signup_url: sevaUrl, updated_at: new Date().toISOString() }).eq('id', 1);
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
    const inUse = store.donations.some(d=>removeIds.includes(d.flat_id))
      || store.pledges.some(p=>removeIds.includes(p.flat_id))
      || store.sevaSignups.some(s=>removeIds.includes(s.flat_id));
    if(inUse){
      showToast('Cannot remove flats that have donations, pledges, or seva sign-ups recorded');
    } else if(removeIds.length){
      const { error } = await sb.from('ganesh_flats').delete().in('id', removeIds);
      if(error){ showToast('Error removing flats: '+error.message); btn.disabled=false; return; }
      await logActivity('Removed flats', removeIds.join(', '));
    }
  }

  const obRaw = document.getElementById('settingsOpeningBalance').value;
  const obAmount = Number(obRaw) || 0;
  const obNote = document.getElementById('settingsOpeningBalanceNote').value.trim();
  const obRow = store.openingBalances.find(o=>o.year===ui.year);
  // Save whenever the field has anything typed in it (including an explicit
  // "0" for a brand-new year with no prior row) or a row already exists to
  // update/clear -- checking obAmount>0 alone silently dropped a genuine 0.
  if(obRaw !== '' || obRow){
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
function topDonorsHtml(v){
  const cashDonors = v.donationsSorted.filter(d=>d.amount>0).sort((a,b)=>b.amount-a.amount).slice(0,10);
  return `
    <div class="report-section-title">Top Donors</div>
    <table>
      <thead><tr><th>#</th><th>Flat / Donor</th><th>Date</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${cashDonors.map((d,i)=>`
          <tr>
            <td>${i+1}</td>
            <td>${escapeHtml(d.title)}</td>
            <td>${d.dateFmt}</td>
            <td class="num">${d.amountFmt}</td>
          </tr>`).join('') || '<tr><td colspan="4">No cash donations recorded.</td></tr>'}
      </tbody>
    </table>`;
}
function budgetPerformanceHtml(v){
  if(!v.budgetBreakdown.some(c=>c.hasBudget)) return '';
  return `
    <div class="report-section-title">Budget vs Actual</div>
    <table>
      <thead><tr><th>Category</th><th class="num">Budgeted</th><th class="num">Spent</th><th>Status</th></tr></thead>
      <tbody>
        ${v.budgetBreakdown.filter(c=>c.hasBudget).map(c=>`
          <tr>
            <td>${escapeHtml(c.category)}</td>
            <td class="num">${c.allocatedFmt}</td>
            <td class="num">${c.usedFmt}</td>
            <td>${STATUS_LABEL[c.status]||''}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}
function pledgesOutstandingHtml(v){
  return `
    <div class="report-section-title">Pledges Outstanding (${v.pledgeRows.length})</div>
    <table>
      <thead><tr><th>Flat / Name</th><th>Pledged</th><th class="num">Amount</th></tr></thead>
      <tbody>
        ${v.pledgeRows.map(p=>`
          <tr>
            <td>${escapeHtml(p.flatLabel)} — ${escapeHtml(p.name)}</td>
            <td>${p.pledgedDateFmt}</td>
            <td class="num">${p.amountFmt}</td>
          </tr>`).join('') || '<tr><td colspan="3">No pledges outstanding.</td></tr>'}
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
        <div class="report-stat"><div class="rlabel">TOTAL COLLECTED (INCL. IN-KIND)</div><div class="rval">${fmtINR(v.totalCollected)}</div></div>
        <div class="report-stat"><div class="rlabel">FLATS CONTRIBUTED</div><div class="rval">${v.contributedCount} / ${v.totalFlats}</div></div>
      </div>`;
    body = donationsTableHtml(v);
  } else if(kind==='expenses'){
    stats = `
      <div class="report-stats">
        <div class="report-stat"><div class="rlabel">TOTAL EXPENSES</div><div class="rval">${fmtINR(v.totalExpenses)}</div></div>
      </div>`;
    body = expensesTableHtml(v);
  } else if(kind==='annual'){
    stats = `
      <div class="report-stats">
        <div class="report-stat"><div class="rlabel">TOTAL COLLECTED (INCL. IN-KIND)</div><div class="rval">${fmtINR(v.totalCollected)}</div></div>
        <div class="report-stat"><div class="rlabel">TOTAL EXPENSES</div><div class="rval">${fmtINR(v.totalExpenses)}</div></div>
        <div class="report-stat"><div class="rlabel">BALANCE</div><div class="rval">${fmtINR(v.balance)}</div></div>
        <div class="report-stat"><div class="rlabel">FLATS CONTRIBUTED</div><div class="rval">${v.contributedCount} / ${v.totalFlats}</div></div>
      </div>`;
    body = donationsTableHtml(v)
      + expensesTableHtml(v)
      + budgetPerformanceHtml(v)
      + pledgesOutstandingHtml(v);
  } else {
    stats = `
      <div class="report-stats">
        <div class="report-stat"><div class="rlabel">TOTAL COLLECTED (INCL. IN-KIND)</div><div class="rval">${fmtINR(v.totalCollected)}</div></div>
        <div class="report-stat"><div class="rlabel">TOTAL EXPENSES</div><div class="rval">${fmtINR(v.totalExpenses)}</div></div>
        <div class="report-stat"><div class="rlabel">BALANCE</div><div class="rval">${fmtINR(v.balance)}</div></div>
        <div class="report-stat"><div class="rlabel">FLATS CONTRIBUTED</div><div class="rval">${v.contributedCount} / ${v.totalFlats}</div></div>
      </div>`;
    body = donationsTableHtml(v) + expensesTableHtml(v);
  }
  const titles = { donations:'Donations Report', expenses:'Expenses Report', both:'Financial Report', annual:'Annual Committee Report' };
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
document.getElementById('printAnnualReportBtn').addEventListener('click', ()=>printReport('annual'));

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
    ['Flat', f?f.label:(d.flat_id||'Unknown / Vacated Tenant')],
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

/* ---------- share a donation receipt with the donor (WhatsApp / any app / clipboard) ---------- */
function buildDonationReceiptText(id){
  const d = store.donations.find(x=>x.id===id);
  if(!d) return '';
  const f = store.flats.find(x=>x.id===d.flat_id);
  const isInKind = d.kind==='in_kind';
  const amountLine = isInKind
    ? (d.item_description||'In-kind contribution') + (d.amount>0 ? ' (est. '+fmtINR(d.amount)+')' : '')
    : fmtINR(d.amount) + ' via ' + d.mode;
  const lines = [
    `🙏 ${store.settings.committee_name || 'Ganesh Pooja Committee'} — Donation Receipt`,
    ``,
    `Flat: ${f?f.label:(d.flat_id||'Unknown / Vacated Tenant')}`,
    `Received From: ${d.name}`,
    `Amount: ${amountLine}`,
    `Date: ${fmtDate(d.date)}`,
    `Receipt No: ${d.id.slice(0,8).toUpperCase()}`,
  ];
  if(d.note) lines.push(`Note: ${d.note}`);
  lines.push(``, `Thank you for your contribution! 🎉`);
  return lines.join('\n');
}
async function shareDonationReceipt(id){
  const text = buildDonationReceiptText(id);
  if(!text) return;
  if(navigator.share){
    try{ await navigator.share({ title:'Donation Receipt', text }); return; }
    catch(e){ if(e && e.name==='AbortError') return; /* fall through to other options on real errors */ }
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    try{
      await navigator.clipboard.writeText(text);
      showToast('Receipt copied — paste it into WhatsApp or a message ✓');
      return;
    }catch(e){ /* fall through to WhatsApp link */ }
  }
  window.open('https://wa.me/?text='+encodeURIComponent(text), '_blank');
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

// Scoped to the currently-selected year only — the safe default. Deletes
// donations/expenses/pledges dated in ui.year; other years are untouched.
document.getElementById('clearYearBtn').addEventListener('click', async ()=>{
  if(!perms.isAdmin) return;
  const year = ui.year;
  if(!(await showConfirm(`This will permanently delete all donations, expenses, and pledges dated in ${year} (other years are untouched, flats are kept). This cannot be undone.`, { title:`Clear all of ${year}?`, okLabel:`Delete ${year} Data`, requireText: String(year) }))) return;
  const donIds = store.donations.filter(d=>yearOf(d.date)===year).map(d=>d.id);
  const expIds = store.expenses.filter(e=>yearOf(e.date)===year).map(e=>e.id);
  const pledgeIds = store.pledges.filter(p=>yearOf(p.pledged_date)===year).map(p=>p.id);
  const jobs = [];
  if(donIds.length) jobs.push(sb.from('ganesh_donations').delete().in('id', donIds));
  if(expIds.length) jobs.push(sb.from('ganesh_expenses').delete().in('id', expIds));
  if(pledgeIds.length) jobs.push(sb.from('ganesh_pledges').delete().in('id', pledgeIds));
  if(!jobs.length){ showToast('Nothing to clear for '+year); return; }
  const results = await Promise.all(jobs);
  if(results.some(r=>r.error)){ showToast('Error clearing data'); return; }
  await logActivity('Cleared year data', year+' — donations, expenses & pledges deleted');
  await fetchAllData();
  closeSettingsModal();
  renderAll();
  showToast(year+' data cleared');
});

// Deletes every year's donations/expenses/pledges — deliberately harder to
// trigger than the scoped version above, since this is the mistake that
// wipes years of financial history in one click.
document.getElementById('clearAllYearsBtn').addEventListener('click', async ()=>{
  if(!perms.isAdmin) return;
  const ok = await showConfirm('This deletes donations, expenses, and pledges for EVERY year, not just the current one — and cannot be undone. This is almost never what you want; use "Clear <Year>" above instead unless you are certain.', { title:'Delete ALL years\' data?', okLabel:'Delete Everything', requireText:'ALL YEARS' });
  if(!ok) return;
  const NIL = '00000000-0000-0000-0000-000000000000';
  const results = await Promise.all([
    sb.from('ganesh_donations').delete().neq('id', NIL),
    sb.from('ganesh_expenses').delete().neq('id', NIL),
    sb.from('ganesh_pledges').delete().neq('id', NIL),
  ]);
  if(results.some(r=>r.error)){ showToast('Error clearing data'); return; }
  await logActivity('Cleared ALL YEARS', 'All donations, expenses & pledges deleted across every year');
  await fetchAllData();
  closeSettingsModal();
  renderAll();
  showToast('All years cleared');
});

/* ---------- close modals on overlay click ---------- */
const ALL_MODALS = [donationModal, pledgeModal, bulkImportModal, expenseModal, flatModal, settingsModal, sevaDayModal, sevaSignupModal, transferModal, custodyDetailModal, budgetModal, compareYearsModal];
ALL_MODALS.forEach(modal=>{
  modal.addEventListener('click', (e)=>{ if(e.target===modal){ modal.classList.add('hidden'); if(modal===donationModal){ ui.pledgeBeingFulfilled = null; ui.editingDonationId = null; } if(modal===expenseModal) ui.editingExpenseId = null; if(modal===transferModal) ui.editingTransferId = null; if(modal===sevaDayModal) ui.editingSevaDayId = null; } });
});

/* ---------- Escape key closes whichever modal is open ---------- */
document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Escape') return;
  const open = ALL_MODALS.find(m => !m.classList.contains('hidden'));
  if(open){ open.classList.add('hidden'); if(open===donationModal){ ui.pledgeBeingFulfilled = null; ui.editingDonationId = null; } if(open===expenseModal) ui.editingExpenseId = null; if(open===transferModal) ui.editingTransferId = null; if(open===sevaDayModal) ui.editingSevaDayId = null; }
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
