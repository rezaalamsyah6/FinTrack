'use strict';
/* =====================================================================
   Simulasi gajian: rencanakan pembagian gaji ke pos-pos pengeluaran.
   Hanya perencanaan, tidak membuat transaksi. Disimpan di localStorage.
   Memakai global dari app.js / dashboard.js: transactions, $, rupiah, esc,
   withFees, isFlow, CATEGORIES, compact, iso, parseISO.
   ===================================================================== */

const SIM_KEY = 'kk_sim';
const SIM_DAYS = 30;   // untuk hitungan "≈ per hari"
const sim = (() => {
  try { const s = JSON.parse(localStorage.getItem(SIM_KEY)); if (s && Array.isArray(s.items)) return s; } catch { }
  return { salary: 0, items: [] };
})();
const saveSim = () => { try { localStorage.setItem(SIM_KEY, JSON.stringify(sim)); } catch { } };
const simId = () => Math.random().toString(36).slice(2, 9);
const toNum = s => Number(String(s).replace(/\D/g, '')) || 0;
const fmtInput = n => (n ? n.toLocaleString('id-ID') : '');
const roundUp = (n, step = 10000) => Math.ceil(n / step) * step;

/* Gaji terakhir yang tercatat (kategori Gaji) */
function lastSalary() {
  let best = null;
  for (const t of transactions) {
    if (t.type === 'in' && t.category === 'Gaji' && (!best || t.date > best.date)) best = t;
  }
  return best;
}

/* Rata-rata pengeluaran per kategori per bulan: 3 bulan penuh terakhir
   (atau bulan berjalan bila data baru ada bulan ini) */
function monthlyHabit() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const first = transactions.reduce((m, t) => (t.date < m ? t.date : m), iso(today)).slice(0, 7);
  const months = [];
  for (let i = 3; i >= 1; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const ym = iso(d).slice(0, 7);
    if (ym >= first) months.push(ym);
  }
  const label = months.length ? `rata-rata ${months.length} bulan terakhir` : 'bulan ini';
  if (!months.length) months.push(iso(today).slice(0, 7));
  const sum = {};
  for (const t of withFees(transactions)) {
    if (t.type !== 'out' || !isFlow(t, '') || !months.includes(t.date.slice(0, 7))) continue;
    sum[t.category] = (sum[t.category] || 0) + t.amount;
  }
  const avg = {};
  for (const [c, v] of Object.entries(sum)) avg[c.toLowerCase()] = { cat: c, v: v / months.length };
  return { avg, label };
}
const isAutoCat = c => CATEGORIES.out.some(x => x[0] === c && x[2] === 'auto');

/* ---------- Template ---------- */
const PRESETS = {
  habit() {
    const { avg } = monthlyHabit();
    const rows = Object.values(avg).filter(a => !isAutoCat(a.cat)).sort((a, b) => b.v - a.v);
    if (!rows.length) { alert('Belum ada pengeluaran yang tercatat untuk dijadikan acuan.'); return null; }
    return [...rows.map(a => ({ name: a.cat, amount: roundUp(a.v) })), { name: 'Tabungan', amount: 0 }];
  },
  '503020'() {
    const s = sim.salary;
    return [
      { name: 'Kebutuhan (makan, tagihan, transport)', amount: Math.round(s * .5) },
      { name: 'Keinginan (hiburan, belanja)', amount: Math.round(s * .3) },
      { name: 'Tabungan & investasi', amount: s - Math.round(s * .5) - Math.round(s * .3) },
    ];
  },
  clear() { return []; },
};

/* ---------- Render ---------- */
function simItemHTML(it) {
  return `<li class="sim-item" data-id="${esc(it.id)}">
    <div class="sim-row">
      <input class="sim-name" value="${esc(it.name)}" placeholder="Nama pos, mis. Makan" aria-label="Nama pos" autocomplete="off">
      <input class="sim-amt" value="${fmtInput(it.amount)}" placeholder="Rp0" inputmode="numeric" aria-label="Jumlah" autocomplete="off">
      <button type="button" class="icon-btn sim-del" aria-label="Hapus pos">✕</button>
    </div>
    <div class="sim-bar"><div></div></div>
    <p class="sim-meta"></p>
  </li>`;
}

function renderSim() {
  if ($('#view-sim').hidden) return;
  const inp = $('#sim-salary');
  if (document.activeElement !== inp) inp.value = fmtInput(sim.salary);
  $('#sim-list').innerHTML = sim.items.map(simItemHTML).join('');
  updateSim();
}

// perbarui angka & bar tanpa membangun ulang input (agar fokus/kursor tidak hilang)
function updateSim() {
  if ($('#view-sim').hidden) return;
  const salary = sim.salary;
  const alloc = sim.items.reduce((s, it) => s + it.amount, 0);
  const left = salary - alloc;

  const last = lastSalary();
  const lb = $('#sim-last-salary');
  lb.hidden = !last || last.amount === salary;
  if (last) lb.textContent = `Pakai gaji terakhir: ${rupiah(last.amount)}`;

  $('#sim-left').textContent = rupiah(left);
  $('#sim-left').classList.toggle('neg', left < 0);
  $('#sim-left-sub').textContent = !salary ? 'Isi gaji untuk mulai simulasi'
    : left < 0 ? `Kelebihan ${rupiah(-left)} dari gaji — kurangi beberapa pos`
    : `Sisa belum dialokasikan · ≈ ${rupiah(Math.floor(left / SIM_DAYS))}/hari`;
  $('#sim-alloc').textContent = rupiah(alloc);
  $('#sim-pct').textContent = salary ? `${Math.round(alloc / salary * 100)}% dari gaji` : '';
  const fill = $('#sim-meter-fill');
  fill.style.width = salary ? Math.min(100, alloc / salary * 100) + '%' : '0';
  fill.classList.toggle('over', left < 0);

  const { avg, label } = monthlyHabit();
  const maxAmt = Math.max(salary, ...sim.items.map(it => it.amount), 1);
  for (const li of document.querySelectorAll('#sim-list .sim-item')) {
    const it = sim.items.find(x => x.id === li.dataset.id);
    if (!it) continue;
    li.querySelector('.sim-bar div').style.width = (it.amount / maxAmt * 100) + '%';
    const parts = [];
    if (it.amount) {
      if (salary) parts.push(`${Math.round(it.amount / salary * 100)}%`);
      parts.push(`≈ ${rupiah(Math.floor(it.amount / SIM_DAYS))}/hari`);
    }
    const h = avg[it.name.trim().toLowerCase()];
    if (h) parts.push(`<span class="${it.amount && it.amount < h.v ? 'warn' : ''}">biasanya ${'Rp' + compact(Math.round(h.v))}/bln (${label})</span>`);
    li.querySelector('.sim-meta').innerHTML = parts.join(' · ');
  }
  $('#sim-empty').hidden = sim.items.length > 0;
}

/* ---------- Event ---------- */
$('#sim-salary').addEventListener('input', e => {
  sim.salary = toNum(e.target.value);
  e.target.value = fmtInput(sim.salary);
  saveSim(); updateSim();
});
$('#sim-last-salary').addEventListener('click', () => {
  const last = lastSalary(); if (!last) return;
  sim.salary = last.amount; $('#sim-salary').value = fmtInput(sim.salary);
  saveSim(); updateSim();
});
$('#sim-list').addEventListener('input', e => {
  const li = e.target.closest('.sim-item'); if (!li) return;
  const it = sim.items.find(x => x.id === li.dataset.id); if (!it) return;
  if (e.target.classList.contains('sim-amt')) {
    it.amount = toNum(e.target.value);
    e.target.value = fmtInput(it.amount);
  } else it.name = e.target.value;
  saveSim(); updateSim();
});
$('#sim-list').addEventListener('click', e => {
  const del = e.target.closest('.sim-del'); if (!del) return;
  sim.items = sim.items.filter(x => x.id !== del.closest('.sim-item').dataset.id);
  saveSim(); renderSim();
});
$('#sim-add').addEventListener('click', () => {
  sim.items.push({ id: simId(), name: '', amount: 0 });
  saveSim(); renderSim();
  document.querySelector('#sim-list .sim-item:last-child .sim-name')?.focus();
});
document.querySelectorAll('[data-sim-preset]').forEach(b => b.addEventListener('click', () => {
  const key = b.dataset.simPreset;
  if (key === '503020' && !sim.salary) { alert('Isi gaji dulu untuk memakai pola 50/30/20.'); return; }
  if (sim.items.length && !confirm('Ganti semua pos yang ada dengan template ini?')) return;
  const rows = PRESETS[key](); if (!rows) return;
  sim.items = rows.map(r => ({ id: simId(), ...r }));
  saveSim(); renderSim();
}));

renderSim();
