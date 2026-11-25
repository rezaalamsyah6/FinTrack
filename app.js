'use strict';

/* ================= Supabase ================= */
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
const configured = window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('ISI_');
const sb = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const TABLE = 'transactions';
const ACC_TABLE = 'accounts';

const KEY_OLD_TX = 'kk_tx';               // data versi lama (sebelum Supabase)
const cacheKey = () => 'kk_cache2_' + user.id;

const CATEGORIES = {
  out: [
    ['Makan & Minum', '🍜'], ['Transportasi', '🚗'], ['Belanja', '🛒'], ['Tagihan', '💡'],
    ['Pulsa & Internet', '📱'], ['Kesehatan', '💊'], ['Hiburan', '🎬'], ['Pendidikan', '📚'],
    ['Keluarga', '👨‍👩‍👧'], ['Lainnya', '📦'],
  ],
  in: [
    ['Gaji', '💼'], ['Bonus', '🎁'], ['Usaha', '🏪'], ['Investasi', '📈'], ['Lainnya', '💰'],
  ],
};
const iconOf = (type, cat) => type === 'transfer' ? '🔁'
  : (CATEGORIES[type].find(c => c[0] === cat) || [, type === 'in' ? '💰' : '📦'])[1];

// [label, ikon, kelompok]  kelompok: cash = kas, inv = investasi
const KINDS = {
  bank: ['Bank', '🏦', 'cash'], ewallet: ['E-wallet', '📱', 'cash'], cash: ['Tunai', '💵', 'cash'], other: ['Lainnya', '💼', 'cash'],
  bond: ['Obligasi', '📜', 'inv'], mmf: ['Reksa dana pasar uang', '🏛️', 'inv'], crypto: ['Kripto', '₿', 'inv'], invest: ['Investasi lainnya', '📈', 'inv'],
};
const kindOf = a => KINDS[a?.kind] || KINDS.other;
const isInv = a => kindOf(a)[2] === 'inv';
const COINS = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', tether: 'USDT' };
const coinSym = a => COINS[a?.coin] || 'BTC';
const STALE_DAYS = 30;

let user = null;
let transactions = [];
let accounts = [];
let accFilter = (() => { try { return localStorage.getItem('kk_acc_filter') || ''; } catch { return ''; } })();
let viewMonth = new Date(); viewMonth.setDate(1);
let editingId = null;
let editingAccId = null;

/* ================= Helpers ================= */
const $ = s => document.querySelector(s);
const rupiah = n => (n < 0 ? '-' : '') + 'Rp' + Math.abs(n).toLocaleString('id-ID');
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = t => ({
  type: t.type, amount: Number(t.amount), category: t.category, date: t.date, note: t.note || '',
  account_id: t.account_id, to_account_id: t.type === 'transfer' ? t.to_account_id : null,
  ...(t.units ? { units: Number(t.units) } : {}),
});
const normTx = t => ({ ...t, amount: Number(t.amount), units: t.units == null ? null : Number(t.units) });
const normAcc = a => ({
  ...a, opening_balance: Number(a.opening_balance),
  opening_units: Number(a.opening_units || 0),
  market_value: a.market_value == null ? null : Number(a.market_value),
});
const digits = s => Number(String(s).replace(/\D/g, '')) || 0;
// "0,0123" / "0.0123" / "1.234,5" → angka
function parseUnits(s) {
  s = String(s).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
const fmtUnits = n => n.toLocaleString('id-ID', { maximumFractionDigits: 8 });
const daysAgo = iso => Math.floor((Date.now() - new Date(iso)) / 864e5);
const fmtDate = iso => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = ms => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
function formatAmountInput(input) {
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '').replace(/^0+/, '');
    input.value = d ? Number(d).toLocaleString('id-ID') : '';
  });
}

/* ---------- Rekening & saldo ---------- */
const accById = id => accounts.find(a => a.id === id);
const accName = id => accById(id)?.name || '(rekening terhapus)';
const accIcon = id => kindOf(accById(id))[1];

// transaksi yang menyentuh rekening terpilih (semua jika tidak difilter)
const matchAcc = (t, acc = accFilter) => !acc || t.account_id === acc || t.to_account_id === acc;
// pemasukan/pengeluaran (transfer TIDAK termasuk)
const isFlow = (t, acc = accFilter) => t.type !== 'transfer' && (!acc || t.account_id === acc);
// pengaruh transaksi terhadap saldo
function effect(t, acc = accFilter) {
  if (t.type === 'transfer') {
    if (!acc) return 0;
    if (t.account_id === acc) return -t.amount;
    if (t.to_account_id === acc) return t.amount;
    return 0;
  }
  if (acc && t.account_id !== acc) return 0;
  return t.type === 'in' ? t.amount : -t.amount;
}
const openingOf = (acc = accFilter) => acc
  ? (accById(acc)?.opening_balance || 0)
  : accounts.reduce((s, a) => s + a.opening_balance, 0);
// Saldo buku (untuk investasi = modal bersih: setoran − penarikan)
const balanceOf = (acc = accFilter) => openingOf(acc) + transactions.reduce((s, t) => s + effect(t, acc), 0);

/* ---------- Investasi: jumlah koin, harga, nilai pasar ---------- */
const PRICE_KEY = 'kk_prices';
let prices = (() => { try { return JSON.parse(localStorage.getItem(PRICE_KEY)) || {}; } catch { return {}; } })();

function unitsOf(id) {
  let u = accById(id)?.opening_units || 0;
  for (const t of transactions) {
    if (t.type !== 'transfer' || !t.units) continue;
    if (t.to_account_id === id) u += t.units;
    if (t.account_id === id) u -= t.units;
  }
  return u;
}
// Nilai saat ini. Kas = saldo buku. Kripto = koin × harga.
// Manual = nilai terakhir yang diisi + setoran/penarikan yang dicatat sesudahnya.
function valueOf(id) {
  const a = accById(id);
  const ledger = balanceOf(id);
  if (!a || !isInv(a)) return ledger;
  if (a.kind === 'crypto') {
    const p = prices[a.coin || 'bitcoin'];
    return p ? Math.round(unitsOf(id) * p.idr) : ledger;
  }
  if (a.market_value == null || !a.value_updated_at) return ledger;
  const since = new Date(a.value_updated_at);
  return a.market_value + transactions
    .filter(t => matchAcc(t, id) && new Date(t.created_at) > since)
    .reduce((s, t) => s + effect(t, id), 0);
}
const invAccounts = () => accounts.filter(isInv);
const cashAccounts = () => accounts.filter(a => !isInv(a));
const netWorth = () => accounts.reduce((s, a) => s + valueOf(a.id), 0);
// nilai untuk filter yang aktif (semua → kekayaan bersih)
const valueOfFilter = (acc = accFilter) => acc ? valueOf(acc) : netWorth();
function gainHTML(value, cost) {
  const g = value - cost;
  if (!g) return '';
  const pct = cost > 0 ? ` (${g > 0 ? '+' : ''}${(g / cost * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%)` : '';
  return `<span class="acc-gain ${g > 0 ? 'good' : 'bad'}">${g > 0 ? '▲ +' : '▼ -'}Rp${Math.abs(g).toLocaleString('id-ID')}${pct}</span>`;
}

async function refreshPrices() {
  const coins = [...new Set(accounts.filter(a => a.kind === 'crypto').map(a => a.coin || 'bitcoin'))];
  if (!coins.length || !navigator.onLine) return;
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?vs_currencies=idr'
      + '&include_24hr_change=true&include_last_updated_at=true&ids=' + coins.join(','));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    for (const c of coins) {
      if (j[c]?.idr) prices[c] = { idr: j[c].idr, chg: j[c].idr_24h_change, at: (j[c].last_updated_at || Date.now() / 1000) * 1000, fetched: Date.now() };
    }
    try { localStorage.setItem(PRICE_KEY, JSON.stringify(prices)); } catch { }
    render();
  } catch (err) {
    console.warn('Gagal mengambil harga kripto, memakai harga terakhir:', err);
  }
}
setInterval(() => { if (user && document.visibilityState === 'visible') refreshPrices(); }, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (user && document.visibilityState === 'visible') {
    const oldest = Math.min(...Object.values(prices).map(p => p.fetched || 0), Infinity);
    if (Date.now() - oldest > 5 * 60 * 1000) refreshPrices();
  }
});

function setAccFilter(id) {
  accFilter = id && accById(id) ? id : '';
  try { localStorage.setItem('kk_acc_filter', accFilter); } catch { }
  render();
}
function fillAccFilters() {
  if (accFilter && accounts.length && !accById(accFilter)) accFilter = '';
  const opts = `<option value="">Semua rekening</option>` +
    accounts.map(a => `<option value="${a.id}">${kindOf(a)[1]} ${esc(a.name)}</option>`).join('');
  document.querySelectorAll('.acc-filter').forEach(sel => {
    sel.innerHTML = opts;
    sel.value = accFilter;
    sel.hidden = accounts.length < 2;
  });
}
document.querySelectorAll('.acc-filter').forEach(sel =>
  sel.addEventListener('change', () => setAccFilter(sel.value)));

/* ---------- Penyimpanan lokal ---------- */
function readOldTx() {
  try { return JSON.parse(localStorage.getItem(KEY_OLD_TX)) || []; } catch { return []; }
}
function saveCache() {
  try { localStorage.setItem(cacheKey(), JSON.stringify({ transactions, accounts })); } catch { /* penuh: abaikan */ }
}
function needOnline() {
  if (!navigator.onLine) { alert('Tidak ada koneksi internet. Coba lagi saat online.'); return false; }
  return true;
}
function showError(err) {
  console.error(err);
  if (err?.code === '42501') {
    alert('Gagal: database belum memberi izin akses.\n\nJalankan perintah GRANT dari file SQL di Supabase SQL Editor.');
    return;
  }
  if (err?.code === '42P01' || err?.code === 'PGRST205' || err?.code === '42703' || err?.code === 'PGRST204') {
    alert('Gagal: database belum diperbarui untuk fitur terbaru.\n\nJalankan file SQL migrasi (02-rekening lalu 03-investasi) di Supabase SQL Editor.');
    return;
  }
  if (err?.code === '23514' && /kind_check/.test(err.message)) {
    alert('Gagal: database belum mendukung jenis investasi.\n\nJalankan file supabase-migration-03-investasi.sql di Supabase SQL Editor.');
    return;
  }
  alert('Gagal: ' + (err?.message || err));
}

/* ================= Login / Daftar ================= */
let signupMode = false;

const AUTH_MSG = {
  'Invalid login credentials': 'Email atau password salah.',
  'Email not confirmed': 'Email belum dikonfirmasi. Cek kotak masuk (atau folder spam) Anda.',
  'User already registered': 'Email ini sudah terdaftar. Silakan masuk.',
};
const authMessage = msg =>
  AUTH_MSG[msg] || (/Email address .* is invalid/.test(msg)
    ? 'Email ditolak Supabase. Gunakan email asli Anda, atau matikan "Confirm email" di pengaturan Supabase.'
    : /rate limit/i.test(msg) ? 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.'
    : msg);

function setLoginMode(signup) {
  signupMode = signup;
  $('#login-hint').textContent = signup ? 'Buat akun baru' : 'Masuk ke akun Anda';
  $('#login-btn').textContent = signup ? 'Daftar' : 'Masuk';
  $('#switch-text').textContent = signup ? 'Sudah punya akun?' : 'Belum punya akun?';
  $('#switch-mode').textContent = signup ? 'Masuk' : 'Daftar';
  $('#password').autocomplete = signup ? 'new-password' : 'current-password';
  $('#login-error').textContent = '';
  $('#login-info').textContent = '';
}
$('#switch-mode').addEventListener('click', e => { e.preventDefault(); setLoginMode(!signupMode); });

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#password').value = '';
  if (!configured) {
    $('#login-error').textContent = window.supabase
      ? 'Aplikasi belum dihubungkan ke Supabase. Isi anon key di config.js.'
      : 'Tidak bisa memuat Supabase. Periksa koneksi internet.';
    $('#login-btn').disabled = true;
  }
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#email').value.trim();
  const password = $('#password').value;
  const btn = $('#login-btn');
  $('#login-error').textContent = '';
  $('#login-info').textContent = '';
  btn.disabled = true;
  try {
    if (signupMode) {
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
      if (!data.session) {
        setLoginMode(false);
        $('#login-info').textContent = 'Akun dibuat! Cek email Anda dan klik link konfirmasi, lalu masuk.';
        return;
      }
      user = data.session.user;
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      user = data.user;
    }
    if ($('#app').hidden) showApp();
  } catch (err) {
    $('#login-error').textContent = authMessage(err.message || 'Terjadi kesalahan.');
  } finally {
    btn.disabled = false;
  }
});

async function logout() {
  if (!confirm('Keluar dari akun?')) return;
  try { localStorage.removeItem(cacheKey()); localStorage.removeItem('kk_acc_filter'); } catch { }
  await sb.auth.signOut().catch(() => {});
  user = null;
  transactions = [];
  accounts = [];
  accFilter = '';
  updateInstallButton();
  showLogin();
}

/* ================= Install (PWA) ================= */
// Tombol install hanya muncul SETELAH login.
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  updateInstallButton();
});
window.addEventListener('appinstalled', () => { deferredPrompt = null; updateInstallButton(); });

function updateInstallButton() {
  $('#install-btn').hidden = !(user && deferredPrompt);
}
$('#install-btn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  updateInstallButton();
});

/* ================= Data ================= */
async function fetchAll(table, orderCols) {
  const all = [];
  for (let from = 0; ; from += 1000) {           // Supabase membatasi 1000 baris per permintaan
    let q = sb.from(table).select('*');
    for (const [col, asc] of orderCols) q = q.order(col, { ascending: asc });
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

async function loadData() {
  // tampilkan cache dulu agar cepat (dan agar tetap ada isi saat offline)
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey())) || {};
    transactions = c.transactions || [];
    accounts = c.accounts || [];
  } catch { transactions = []; accounts = []; }
  render();

  try {
    const [accs, txs] = await Promise.all([
      fetchAll(ACC_TABLE, [['created_at', true]]),
      fetchAll(TABLE, [['date', false], ['created_at', false]]),
    ]);
    accounts = accs.map(normAcc);
    transactions = txs.map(normTx);
    saveCache();
    $('#offline-note').hidden = true;
    refreshPrices();
  } catch (err) {
    if (navigator.onLine && err?.code) {        // error dari database, bukan karena offline
      showError(err);
    } else {
      console.warn('Gagal memuat dari Supabase, pakai cache:', err);
      $('#offline-note').hidden = false;
    }
  }
  render();
}

window.addEventListener('online', () => { if (user) loadData(); });
window.addEventListener('offline', () => { if (user) $('#offline-note').hidden = false; });

/* ================= Main app ================= */
function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#menu-user').innerHTML = `<b>Akun saya</b>${esc(user.email)}`;
  $('#avatar-initial').textContent = (user.email || '?')[0].toUpperCase();
  $('#migrate-btn').hidden = readOldTx().length === 0;
  updateInstallButton();
  loadData();
}

function render() {
  fillAccFilters();
  renderTx();
  renderAccounts();
  if (typeof renderDashboard === 'function') renderDashboard();
}

function txRow(t) {
  let title, sub, sign, cls;
  if (t.type === 'transfer') {
    title = 'Transfer';
    sub = `${accName(t.account_id)} → ${accName(t.to_account_id)}`;
    const ca = [accById(t.to_account_id), accById(t.account_id)].find(a => a?.kind === 'crypto');
    if (t.units && ca) sub += ` · ${fmtUnits(t.units)} ${coinSym(ca)}`;
    if (accFilter === t.account_id) { sign = '-'; cls = 'out'; }
    else if (accFilter === t.to_account_id) { sign = '+'; cls = 'in'; }
    else { sign = ''; cls = 'tr'; }
  } else {
    title = t.category;
    sub = accFilter ? '' : accName(t.account_id);
    sign = t.type === 'in' ? '+' : '-';
    cls = t.type;
  }
  if (t.note) sub = sub ? `${sub} · ${t.note}` : t.note;
  return `<li class="tx" data-id="${esc(t.id)}">
      <div class="tx-icon">${iconOf(t.type, t.category)}</div>
      <div class="tx-main"><div class="cat">${esc(title)}</div>${sub ? `<div class="note">${esc(sub)}</div>` : ''}</div>
      <div class="tx-amt ${cls}">${sign}${rupiah(t.amount)}</div>
    </li>`;
}

function renderTx() {
  const mk = monthKey(viewMonth);
  $('#month-label').textContent = viewMonth.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  const monthTx = transactions.filter(t => t.date.startsWith(mk) && matchAcc(t))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at).localeCompare(String(a.created_at)));

  const flow = monthTx.filter(t => isFlow(t));
  const sumIn = flow.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0);
  const sumOut = flow.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0);
  $('#sum-in').textContent = rupiah(sumIn);
  $('#sum-out').textContent = rupiah(sumOut);
  $('#sum-balance').textContent = rupiah(sumIn - sumOut);
  $('#sum-all-label').textContent = accFilter
    ? `${isInv(accById(accFilter)) ? 'Nilai' : 'Saldo'} ${accName(accFilter)} saat ini`
    : (invAccounts().length ? 'Kekayaan bersih saat ini' : 'Saldo semua rekening saat ini');
  $('#sum-all').textContent = rupiah(valueOfFilter());

  // Pengeluaran per kategori
  const byCat = {};
  flow.filter(t => t.type === 'out').forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  $('#cat-bars').innerHTML = cats.length ? cats.map(([c, v]) => `
    <div class="bar-row">
      <div class="bar-label"><span>${iconOf('out', c)} ${esc(c)}</span><span>${rupiah(v)} · ${Math.round(v / sumOut * 100)}%</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(v / cats[0][1] * 100).toFixed(1)}%"></div></div>
    </div>`).join('') : '<p class="empty">Belum ada pengeluaran bulan ini.</p>';

  // Daftar transaksi, dikelompokkan per tanggal
  if (!monthTx.length) {
    $('#tx-list').innerHTML = '<p class="empty">Belum ada transaksi. Tekan ＋ untuk menambah.</p>';
    return;
  }
  let html = '', lastDate = '';
  for (const t of monthTx) {
    if (t.date !== lastDate) {
      lastDate = t.date;
      const d = new Date(t.date + 'T00:00:00');
      html += `<li class="day-head">${d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' })}</li>`;
    }
    html += txRow(t);
  }
  $('#tx-list').innerHTML = html;
}

$('#prev-month').onclick = () => { viewMonth.setMonth(viewMonth.getMonth() - 1); render(); };
$('#next-month').onclick = () => { viewMonth.setMonth(viewMonth.getMonth() + 1); render(); };

/* ================= Rekening ================= */
// keterangan nilai investasi: kapan terakhir diperbarui / dari mana harganya
function invStatus(a) {
  if (a.kind === 'crypto') {
    const p = prices[a.coin || 'bitcoin'];
    const u = unitsOf(a.id);
    if (!p) return { text: `${fmtUnits(u)} ${coinSym(a)} · menunggu harga…`, stale: true };
    const chg = p.chg != null ? ` · 24j ${p.chg > 0 ? '+' : ''}${p.chg.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '';
    return { text: `${fmtUnits(u)} ${coinSym(a)} × Rp${p.idr.toLocaleString('id-ID')}${chg}`, stale: false };
  }
  if (a.market_value == null || !a.value_updated_at) return { text: 'Nilai belum pernah diperbarui (dihitung = modal)', stale: true };
  const d = daysAgo(a.value_updated_at);
  const ago = d <= 0 ? 'hari ini' : `${d} hari lalu`;
  return { text: `${d > STALE_DAYS ? '⚠️ ' : ''}Update terakhir ${fmtDate(a.value_updated_at)} · ${ago}`, stale: d > STALE_DAYS };
}

function renderAccounts() {
  const inv = invAccounts(), cash = cashAccounts();
  const hasInv = inv.length > 0;
  const cashTotal = cash.reduce((s, a) => s + balanceOf(a.id), 0);
  const invValue = inv.reduce((s, a) => s + valueOf(a.id), 0);
  const invCost = inv.reduce((s, a) => s + balanceOf(a.id), 0);
  $('#acc-total-label').textContent = hasInv ? 'Kekayaan bersih (kas + investasi)' : 'Total saldo semua rekening';
  $('#acc-total').textContent = rupiah(cashTotal + invValue);
  $('#acc-total-sub').innerHTML = hasInv
    ? `Kas ${rupiah(cashTotal)} · Investasi ${rupiah(invValue)} ${gainHTML(invValue, invCost)}` : '';
  $('#cash-head').hidden = !hasInv;
  $('#inv-head').hidden = !hasInv;

  if (!accounts.length) {
    $('#acc-list').innerHTML = '<p class="panel empty">Belum ada rekening. Tambahkan rekening pertama Anda, misalnya BCA, GoPay, atau Dompet.</p>';
    $('#inv-list').innerHTML = '';
    $('#price-note').hidden = true;
    return;
  }
  $('#acc-list').innerHTML = cash.map(a => {
    const bal = balanceOf(a.id);
    const n = transactions.filter(t => matchAcc(t, a.id)).length;
    return `<li class="acc-item" data-id="${a.id}">
      <div class="tx-icon">${kindOf(a)[1]}</div>
      <div class="acc-main"><div class="acc-name">${esc(a.name)}</div>
        <div class="acc-meta">${kindOf(a)[0]} · ${n.toLocaleString('id-ID')} transaksi</div></div>
      <div><div class="acc-bal ${bal < 0 ? 'neg' : ''}">${rupiah(bal)}</div>
        <div class="acc-actions"><button data-view-acc="${a.id}">Lihat dashboard ›</button></div></div>
    </li>`;
  }).join('') || '<p class="empty">Belum ada rekening kas.</p>';

  $('#inv-list').innerHTML = inv.map(a => {
    const value = valueOf(a.id), cost = balanceOf(a.id);
    const st = invStatus(a);
    return `<li class="acc-item" data-id="${a.id}">
      <div class="tx-icon">${kindOf(a)[1]}</div>
      <div class="acc-main"><div class="acc-name">${esc(a.name)}</div>
        <div class="acc-meta">${kindOf(a)[0]} · modal ${rupiah(cost)}</div>
        <div class="acc-sub ${st.stale ? 'stale' : ''}">${esc(st.text)}</div></div>
      <div><div class="acc-bal">${rupiah(value)}</div>${gainHTML(value, cost)}</div>
      <div class="acc-actions row">
        ${a.kind === 'crypto' ? '' : `<button data-update-val="${a.id}">↻ Perbarui nilai</button>`}
        <button data-view-acc="${a.id}">Lihat dashboard ›</button></div>
    </li>`;
  }).join('');

  const crypto = inv.filter(a => a.kind === 'crypto');
  const pNote = $('#price-note');
  pNote.hidden = !crypto.length;
  if (crypto.length) {
    const p = prices[crypto[0].coin || 'bitcoin'];
    pNote.textContent = p
      ? `Harga kripto otomatis dari CoinGecko (diperbarui tiap 5 menit). Terakhir: ${fmtTime(p.fetched || p.at)}.`
      + (navigator.onLine ? '' : ' Sedang offline: memakai harga terakhir.')
      : 'Harga kripto akan diambil otomatis saat online.';
  }
}

['#acc-list', '#inv-list'].forEach(sel => $(sel).addEventListener('click', e => {
  const v = e.target.closest('[data-view-acc]');
  if (v) { setAccFilter(v.dataset.viewAcc); setView('dash'); return; }
  const u = e.target.closest('[data-update-val]');
  if (u) { openValForm(accById(u.dataset.updateVal)); return; }
  const li = e.target.closest('.acc-item');
  if (li) openAccForm(accById(li.dataset.id));
}));

/* ---------- Perbarui nilai investasi (manual) ---------- */
const valDlg = $('#val-dialog');
let valAccId = null;
formatAmountInput($('#v-value'));
function openValForm(acc) {
  valAccId = acc.id;
  $('#val-name').textContent = `${kindOf(acc)[1]} ${acc.name} · ${invStatus(acc).text}`;
  $('#v-value').value = valueOf(acc.id).toLocaleString('id-ID');
  valDlg.showModal();
  $('#v-value').select();
}
$('#val-cancel').onclick = () => valDlg.close();
$('#val-form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!needOnline()) return;
  const data = { market_value: digits($('#v-value').value), value_updated_at: new Date().toISOString() };
  const btn = $('#val-form button[type="submit"]');
  btn.disabled = true;
  try {
    const { data: row, error } = await sb.from(ACC_TABLE).update(data).eq('id', valAccId).select().single();
    if (error) throw error;
    accounts = accounts.map(a => a.id === valAccId ? normAcc(row) : a);
    saveCache();
    valDlg.close();
    render();
  } catch (err) {
    showError(err);
  } finally {
    btn.disabled = false;
  }
});
$('#acc-add').onclick = () => openAccForm();

const accDlg = $('#acc-dialog');
formatAmountInput($('#a-opening'));

function applyAccKind() {
  const kind = $('#a-kind').value;
  const inv = KINDS[kind][2] === 'inv', crypto = kind === 'crypto';
  $('#a-coin-wrap').hidden = !crypto;
  $('#a-units-wrap').hidden = !crypto;
  $('#a-units-label').textContent = `Jumlah ${COINS[$('#a-coin').value]} yang sudah dimiliki`;
  $('#a-opening-label').textContent = inv ? 'Modal awal (Rp)' : 'Saldo awal (Rp)';
  $('#a-opening-hint').textContent = inv
    ? 'Total uang yang sudah Anda tanamkan sebelum mulai dicatat. Dipakai untuk menghitung untung/rugi.'
    : 'Saldo rekening sebelum mulai dicatat di aplikasi ini.';
}
$('#a-kind').addEventListener('change', applyAccKind);
$('#a-coin').addEventListener('change', applyAccKind);

function openAccForm(acc) {
  editingAccId = acc ? acc.id : null;
  $('#acc-title').textContent = acc ? 'Ubah Rekening' : 'Tambah Rekening / Investasi';
  $('#a-name').value = acc ? acc.name : '';
  $('#a-kind').value = acc ? acc.kind : 'bank';
  $('#a-coin').value = acc?.coin || 'bitcoin';
  $('#a-units').value = acc?.opening_units ? fmtUnits(acc.opening_units) : '';
  $('#a-opening').value = acc && acc.opening_balance ? acc.opening_balance.toLocaleString('id-ID') : '';
  applyAccKind();
  $('#acc-delete').hidden = !acc;
  accDlg.showModal();
  if (!acc) $('#a-name').focus();
}
$('#acc-cancel').onclick = () => accDlg.close();

$('#acc-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('#a-name').value.trim();
  if (!name) return;
  if (!needOnline()) return;
  const kind = $('#a-kind').value;
  const crypto = kind === 'crypto';
  const data = {
    name, kind,
    opening_balance: digits($('#a-opening').value),
    coin: crypto ? $('#a-coin').value : null,
    opening_units: crypto ? parseUnits($('#a-units').value) : 0,
  };
  if (crypto && $('#a-units').value.trim() && !data.opening_units) {
    alert('Jumlah koin tidak valid. Contoh penulisan: 0,0123');
    return;
  }
  if (!crypto) { delete data.coin; delete data.opening_units; }   // tetap jalan sebelum migrasi 03
  const btn = $('#acc-form button[type="submit"]');
  btn.disabled = true;
  try {
    if (editingAccId) {
      const { data: row, error } = await sb.from(ACC_TABLE).update(data).eq('id', editingAccId).select().single();
      if (error) throw error;
      accounts = accounts.map(a => a.id === editingAccId ? normAcc(row) : a);
    } else {
      const { data: row, error } = await sb.from(ACC_TABLE).insert(data).select().single();
      if (error) throw error;
      accounts.push(normAcc(row));
    }
    saveCache();
    accDlg.close();
    render();
    if (data.kind === 'crypto') refreshPrices();
    if (pendingTxAfterAcc) { pendingTxAfterAcc = false; openForm(); }
  } catch (err) {
    showError(err);
  } finally {
    btn.disabled = false;
  }
});

$('#acc-delete').onclick = async () => {
  const acc = accById(editingAccId);
  const n = transactions.filter(t => matchAcc(t, acc.id)).length;
  const msg = n
    ? `Hapus rekening "${acc.name}"?\n\n${n} transaksi di rekening ini (termasuk transfer) IKUT TERHAPUS dan tidak bisa dikembalikan.`
    : `Hapus rekening "${acc.name}"?`;
  if (!confirm(msg) || !needOnline()) return;
  try {
    const { error } = await sb.from(ACC_TABLE).delete().eq('id', acc.id);
    if (error) throw error;
    accounts = accounts.filter(a => a.id !== acc.id);
    transactions = transactions.filter(t => !matchAcc(t, acc.id));
    saveCache();
    accDlg.close();
    render();
  } catch (err) {
    showError(err);
  }
};

/* ================= Form transaksi ================= */
const dlg = $('#tx-dialog');
const amountInput = $('#f-amount');
const saveBtn = $('#tx-form button[type="submit"]');
let pendingTxAfterAcc = false;
formatAmountInput(amountInput);

function fillCategories(type, selected) {
  if (type === 'transfer') return;
  $('#f-category').innerHTML = CATEGORIES[type]
    .map(([c, i]) => `<option value="${c}" ${c === selected ? 'selected' : ''}>${i} ${c}</option>`).join('');
}
function fillAccountSelects(from, to) {
  const opts = accounts.map(a => `<option value="${a.id}">${kindOf(a)[1]} ${esc(a.name)}</option>`).join('');
  $('#f-account').innerHTML = opts;
  $('#f-to').innerHTML = opts;
  if (from) $('#f-account').value = from;
  $('#f-to').value = to || (accounts.find(a => a.id !== $('#f-account').value)?.id || '');
}
// akun kripto yang terlibat dalam transfer (tujuan = beli, asal = jual)
function cryptoLeg() {
  if (document.querySelector('input[name="type"]:checked').value !== 'transfer') return null;
  const to = accById($('#f-to').value), from = accById($('#f-account').value);
  if (to?.kind === 'crypto') return { acc: to, buy: true };
  if (from?.kind === 'crypto') return { acc: from, buy: false };
  return null;
}
function updateUnitsField() {
  const leg = cryptoLeg();
  $('#f-units-wrap').hidden = !leg;
  $('#f-units').required = !!leg;
  if (!leg) return;
  const sym = coinSym(leg.acc);
  $('#f-units-label').textContent = leg.buy ? `Jumlah ${sym} yang didapat` : `Jumlah ${sym} yang dijual`;
  const p = prices[leg.acc.coin || 'bitcoin'];
  $('#f-units-hint').textContent = p
    ? `Harga sekarang ±Rp${p.idr.toLocaleString('id-ID')} per ${sym}. Isi sesuai jumlah di aplikasi exchange Anda.`
    : 'Isi sesuai jumlah di aplikasi exchange Anda.';
}
$('#f-account').addEventListener('change', updateUnitsField);
$('#f-to').addEventListener('change', updateUnitsField);
function applyType(type) {
  const tr = type === 'transfer';
  $('#f-to-wrap').hidden = !tr;
  $('#f-cat-wrap').hidden = tr;
  $('#f-account-label').textContent = tr ? 'Dari rekening' : 'Rekening';
  fillCategories(type);
  updateUnitsField();
}
document.querySelectorAll('input[name="type"]').forEach(r =>
  r.addEventListener('change', () => applyType(r.value)));

function defaultAccount() {
  let last = '';
  try { last = localStorage.getItem('kk_last_acc') || ''; } catch { }
  return accById(accFilter)?.id || accById(last)?.id || accounts[0]?.id;
}

function openForm(tx) {
  if (!tx && !accounts.length) {
    alert('Buat rekening dulu (misalnya BCA, GoPay, atau Dompet) sebelum mencatat transaksi.');
    pendingTxAfterAcc = true;
    openAccForm();
    return;
  }
  editingId = tx ? tx.id : null;
  const type = tx ? tx.type : 'out';
  $('#tx-title').textContent = tx ? 'Ubah Transaksi' : 'Tambah Transaksi';
  document.querySelector(`input[name="type"][value="${type}"]`).checked = true;
  document.querySelector('input[name="type"][value="transfer"]').parentElement.hidden = accounts.length < 2 && type !== 'transfer';
  applyType(type);
  fillCategories(type, tx && tx.category);
  fillAccountSelects(tx ? tx.account_id : defaultAccount(), tx && tx.to_account_id);
  $('#f-units').value = tx?.units ? fmtUnits(tx.units) : '';
  updateUnitsField();
  amountInput.value = tx ? tx.amount.toLocaleString('id-ID') : '';
  $('#f-date').value = tx ? tx.date : todayISO();
  $('#f-note').value = tx ? tx.note : '';
  $('#tx-delete').hidden = !tx;
  dlg.showModal();
  if (!tx) amountInput.focus();
}

$('#add-btn').onclick = () => openForm();
$('#tx-cancel').onclick = () => dlg.close();
$('#tx-list').addEventListener('click', e => {
  const li = e.target.closest('.tx');
  if (li) openForm(transactions.find(t => t.id === li.dataset.id));
});

$('#tx-form').addEventListener('submit', async e => {
  e.preventDefault();
  const amount = digits(amountInput.value);
  if (!amount) { amountInput.focus(); return; }
  const type = document.querySelector('input[name="type"]:checked').value;
  const account_id = $('#f-account').value;
  const to_account_id = type === 'transfer' ? $('#f-to').value : null;
  if (type === 'transfer' && (!to_account_id || to_account_id === account_id)) {
    alert('Pilih rekening tujuan yang berbeda dari rekening asal.');
    return;
  }
  const leg = cryptoLeg();
  const units = leg ? parseUnits($('#f-units').value) : null;
  if (leg && !units) {
    alert(`Isi jumlah ${coinSym(leg.acc)} dengan benar. Contoh: 0,0012`);
    $('#f-units').focus();
    return;
  }
  if (!needOnline()) return;
  const data = {
    type, amount, account_id, to_account_id,
    category: type === 'transfer' ? 'Transfer' : $('#f-category').value,
    date: $('#f-date').value,
    note: $('#f-note').value.trim(),
  };
  // kolom units hanya dikirim bila relevan (agar tetap jalan sebelum migrasi 03)
  const prevUnits = editingId && transactions.find(t => t.id === editingId)?.units;
  if (leg || prevUnits) data.units = units;
  saveBtn.disabled = true;
  try {
    if (editingId) {
      const { data: row, error } = await sb.from(TABLE).update(data).eq('id', editingId).select().single();
      if (error) throw error;
      transactions = transactions.map(t => t.id === editingId ? normTx(row) : t);
    } else {
      const { data: row, error } = await sb.from(TABLE).insert(data).select().single();
      if (error) throw error;
      transactions.push(normTx(row));
    }
    try { localStorage.setItem('kk_last_acc', account_id); } catch { }
    saveCache();
    const d = new Date(data.date + 'T00:00:00'); d.setDate(1); viewMonth = d;   // pindah ke bulan transaksi
    dlg.close();
    render();
  } catch (err) {
    showError(err);
  } finally {
    saveBtn.disabled = false;
  }
});

$('#tx-delete').onclick = async () => {
  if (!confirm('Hapus transaksi ini?') || !needOnline()) return;
  try {
    const { error } = await sb.from(TABLE).delete().eq('id', editingId);
    if (error) throw error;
    transactions = transactions.filter(t => t.id !== editingId);
    saveCache();
    dlg.close();
    render();
  } catch (err) {
    showError(err);
  }
};

/* ================= Impor banyak transaksi sekaligus ================= */
// Rekening yang tidak dikenal → dimasukkan ke rekening tujuan impor; transfer yang tidak lengkap dilewati.
function prepareImport(rows, targetAcc) {
  return rows.map(t => {
    const r = pick(t);
    if (!accById(r.account_id)) r.account_id = targetAcc;
    if (r.type === 'transfer' && (!accById(r.to_account_id) || r.to_account_id === r.account_id)) return null;
    if (r.type !== 'transfer') r.to_account_id = null;
    return r;
  }).filter(Boolean);
}
async function insertMany(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(TABLE).insert(rows.slice(i, i + 500));
    if (error) throw error;
  }
}
const validTx = t => t && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && ['in', 'out', 'transfer'].includes(t.type)
  && Number(t.amount) > 0 && typeof t.category === 'string';
function importTarget() {
  if (!accounts.length) { alert('Buat rekening dulu sebelum mengimpor data.'); return null; }
  return defaultAccount();
}

/* ================= Menu ================= */
const menu = $('#menu');
$('#menu-btn').onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
document.addEventListener('click', () => { menu.hidden = true; });

function download(name, content, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const TYPE_LABEL = { in: 'Pemasukan', out: 'Pengeluaran', transfer: 'Transfer' };

menu.addEventListener('click', async e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'export') {
    download(`backup-keuangan-${todayISO()}.json`, JSON.stringify(transactions.map(pick), null, 2), 'application/json');
  } else if (act === 'import') {
    if (needOnline() && importTarget()) $('#import-file').click();
  } else if (act === 'csv') {
    const rows = [['Tanggal', 'Jenis', 'Rekening', 'Ke Rekening', 'Kategori', 'Jumlah', 'Catatan']]
      .concat([...transactions].sort((a, b) => a.date.localeCompare(b.date))
        .map(t => [t.date, TYPE_LABEL[t.type], accName(t.account_id), t.to_account_id ? accName(t.to_account_id) : '',
          t.category, t.amount, t.note]));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    download(`keuangan-${todayISO()}.csv`, '﻿' + csv, 'text/csv');
  } else if (act === 'migrate') {
    const target = importTarget();
    const old = readOldTx().filter(validTx);
    if (!target || !old.length || !needOnline()) return;
    if (!confirm(`Pindahkan ${old.length} transaksi lama dari perangkat ini ke rekening "${accName(target)}"?`)) return;
    try {
      await insertMany(prepareImport(old, target));
      localStorage.removeItem(KEY_OLD_TX);
      $('#migrate-btn').hidden = true;
      await loadData();
      alert(`${old.length} transaksi berhasil dipindahkan.`);
    } catch (err) { showError(err); }
  } else if (act === 'logout') {
    logout();
  }
});

$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!Array.isArray(data) || !data.every(validTx)) throw new Error('format');
  } catch {
    alert('File backup tidak valid.');
    return;
  }
  const target = importTarget();
  if (!target) return;
  const rows = prepareImport(data, target);
  const skipped = data.length - rows.length;
  if (!confirm(`Tambahkan ${rows.length} transaksi dari backup?\nTransaksi tanpa rekening yang cocok dimasukkan ke "${accName(target)}".`
    + (skipped ? `\n${skipped} transfer dilewati karena rekeningnya tidak ditemukan.` : ''))) return;
  try {
    await insertMany(rows);
    await loadData();
    alert('Data berhasil diimpor.');
  } catch (err) { showError(err); }
});

/* ================= Start ================= */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

(async () => {
  if (!configured) { showLogin(); return; }
  const { data: { session } } = await sb.auth.getSession();   // sesi tersimpan → langsung masuk
  if (session) { user = session.user; showApp(); } else { showLogin(); }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' && user) { user = null; showLogin(); }
    if (event === 'SIGNED_IN' && session && $('#app').hidden) { user = session.user; showApp(); }   // mis. dari link konfirmasi email
  });
})();
