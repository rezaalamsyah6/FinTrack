'use strict';

/* ================= Supabase ================= */
const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
const configured = window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('ISI_');
const sb = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const TABLE = 'transactions';

const KEY_OLD_TX = 'kk_tx';               // data versi lama (sebelum Supabase)
const cacheKey = () => 'kk_cache_' + user.id;

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
const iconOf = (type, cat) => (CATEGORIES[type].find(c => c[0] === cat) || [, type === 'in' ? '💰' : '📦'])[1];

let user = null;
let transactions = [];
let viewMonth = new Date(); viewMonth.setDate(1);
let editingId = null;

/* ================= Helpers ================= */
const $ = s => document.querySelector(s);
const rupiah = n => (n < 0 ? '-' : '') + 'Rp' + Math.abs(n).toLocaleString('id-ID');
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = t => ({ type: t.type, amount: Number(t.amount), category: t.category, date: t.date, note: t.note || '' });

function readOldTx() {
  try { return JSON.parse(localStorage.getItem(KEY_OLD_TX)) || []; } catch { return []; }
}
function saveCache() {
  try { localStorage.setItem(cacheKey(), JSON.stringify(transactions)); } catch { /* penuh: abaikan */ }
}
function needOnline() {
  if (!navigator.onLine) { alert('Tidak ada koneksi internet. Coba lagi saat online.'); return false; }
  return true;
}
function showError(err) {
  console.error(err);
  if (err?.code === '42501') {
    alert('Gagal: database belum memberi izin akses.\n\nJalankan perintah GRANT dari file supabase-setup.sql di Supabase SQL Editor.');
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
  try { localStorage.removeItem(cacheKey()); } catch { }
  await sb.auth.signOut().catch(() => {});
  user = null;
  transactions = [];
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
async function loadData() {
  // tampilkan cache dulu agar cepat (dan agar tetap ada isi saat offline)
  try { transactions = JSON.parse(localStorage.getItem(cacheKey())) || []; } catch { transactions = []; }
  render();

  try {
    const all = [];
    for (let from = 0; ; from += 1000) {           // Supabase membatasi 1000 baris per permintaan
      const { data, error } = await sb.from(TABLE).select('*')
        .order('date', { ascending: false }).order('created_at', { ascending: false })
        .range(from, from + 999);
      if (error) throw error;
      all.push(...data);
      if (data.length < 1000) break;
    }
    transactions = all.map(t => ({ ...t, amount: Number(t.amount) }));
    saveCache();
    $('#offline-note').hidden = true;
  } catch (err) {
    console.warn('Gagal memuat dari Supabase, pakai cache:', err);
    $('#offline-note').hidden = false;
  }
  render();
}

window.addEventListener('online', () => { if (user) loadData(); });
window.addEventListener('offline', () => { if (user) $('#offline-note').hidden = false; });

/* ================= Main app ================= */
function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#menu-user').textContent = '👤 ' + user.email;
  $('#migrate-btn').hidden = readOldTx().length === 0;
  updateInstallButton();
  loadData();
}

function render() {
  renderTx();
  if (typeof renderDashboard === 'function') renderDashboard();
}

function renderTx() {
  const mk = monthKey(viewMonth);
  $('#month-label').textContent = viewMonth.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

  const monthTx = transactions.filter(t => t.date.startsWith(mk))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at).localeCompare(String(a.created_at)));

  const sumIn = monthTx.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0);
  const sumOut = monthTx.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0);
  const all = transactions.reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0);
  $('#sum-in').textContent = rupiah(sumIn);
  $('#sum-out').textContent = rupiah(sumOut);
  $('#sum-balance').textContent = rupiah(sumIn - sumOut);
  $('#sum-all').textContent = rupiah(all);

  // Pengeluaran per kategori
  const byCat = {};
  monthTx.filter(t => t.type === 'out').forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
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
    html += `<li class="tx" data-id="${esc(t.id)}">
      <div class="tx-icon">${iconOf(t.type, t.category)}</div>
      <div class="tx-main"><div class="cat">${esc(t.category)}</div>${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}</div>
      <div class="tx-amt ${t.type}">${t.type === 'in' ? '+' : '-'}${rupiah(t.amount)}</div>
    </li>`;
  }
  $('#tx-list').innerHTML = html;
}

$('#prev-month').onclick = () => { viewMonth.setMonth(viewMonth.getMonth() - 1); render(); };
$('#next-month').onclick = () => { viewMonth.setMonth(viewMonth.getMonth() + 1); render(); };

/* ================= Form transaksi ================= */
const dlg = $('#tx-dialog');
const amountInput = $('#f-amount');
const saveBtn = $('#tx-form button[type="submit"]');

function fillCategories(type, selected) {
  $('#f-category').innerHTML = CATEGORIES[type]
    .map(([c, i]) => `<option value="${c}" ${c === selected ? 'selected' : ''}>${i} ${c}</option>`).join('');
}
document.querySelectorAll('input[name="type"]').forEach(r =>
  r.addEventListener('change', () => fillCategories(r.value)));

// Format angka otomatis: 150000 -> 150.000
amountInput.addEventListener('input', () => {
  const digits = amountInput.value.replace(/\D/g, '').replace(/^0+/, '');
  amountInput.value = digits ? Number(digits).toLocaleString('id-ID') : '';
});

function openForm(tx) {
  editingId = tx ? tx.id : null;
  const type = tx ? tx.type : 'out';
  $('#tx-title').textContent = tx ? 'Ubah Transaksi' : 'Tambah Transaksi';
  document.querySelector(`input[name="type"][value="${type}"]`).checked = true;
  fillCategories(type, tx && tx.category);
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
  const amount = Number(amountInput.value.replace(/\D/g, ''));
  if (!amount) { amountInput.focus(); return; }
  if (!needOnline()) return;
  const data = {
    type: document.querySelector('input[name="type"]:checked').value,
    amount,
    category: $('#f-category').value,
    date: $('#f-date').value,
    note: $('#f-note').value.trim(),
  };
  saveBtn.disabled = true;
  try {
    if (editingId) {
      const { data: row, error } = await sb.from(TABLE).update(data).eq('id', editingId).select().single();
      if (error) throw error;
      transactions = transactions.map(t => t.id === editingId ? { ...row, amount: Number(row.amount) } : t);
    } else {
      const { data: row, error } = await sb.from(TABLE).insert(data).select().single();
      if (error) throw error;
      transactions.push({ ...row, amount: Number(row.amount) });
    }
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
async function insertMany(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(TABLE).insert(rows.slice(i, i + 500).map(pick));
    if (error) throw error;
  }
}
const validTx = t => t && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && ['in', 'out'].includes(t.type)
  && Number(t.amount) > 0 && typeof t.category === 'string';

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

menu.addEventListener('click', async e => {
  const act = e.target.dataset.act;
  if (act === 'export') {
    download(`backup-keuangan-${todayISO()}.json`, JSON.stringify(transactions.map(pick), null, 2), 'application/json');
  } else if (act === 'import') {
    if (needOnline()) $('#import-file').click();
  } else if (act === 'csv') {
    const rows = [['Tanggal', 'Jenis', 'Kategori', 'Jumlah', 'Catatan']]
      .concat([...transactions].sort((a, b) => a.date.localeCompare(b.date))
        .map(t => [t.date, t.type === 'in' ? 'Pemasukan' : 'Pengeluaran', t.category, t.amount, t.note]));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    download(`keuangan-${todayISO()}.csv`, '﻿' + csv, 'text/csv');
  } else if (act === 'migrate') {
    const old = readOldTx().filter(validTx);
    if (!old.length || !needOnline()) return;
    if (!confirm(`Pindahkan ${old.length} transaksi lama dari perangkat ini ke akun ${user.email}?`)) return;
    try {
      await insertMany(old);
      localStorage.removeItem(KEY_OLD_TX);
      $('#migrate-btn').hidden = true;
      await loadData();
      alert(`${old.length} transaksi berhasil dipindahkan ke akun.`);
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
  if (!confirm(`Tambahkan ${data.length} transaksi dari backup ke akun Anda?`)) return;
  try {
    await insertMany(data);
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
