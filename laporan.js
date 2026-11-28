'use strict';
/* =====================================================================
   Laporan keuangan bulanan: ringkasan per bulan + unduh data per bulan.
   Memakai global dari app.js / dashboard.js: transactions, accounts, $, rupiah,
   esc, withFees, isFlow, matchAcc, effect, openingOf, accFilter, accName,
   accById, isInv, invAccounts, iconOf, download, TYPE_LABEL, iso, fmt1, compact.
   ===================================================================== */

const MONTHS_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus',
  'September', 'Oktober', 'November', 'Desember'];
const R = { ym: iso(new Date()).slice(0, 7) };   // bulan yang dipilih, format YYYY-MM

const ymLabel = ym => `${MONTHS_LONG[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
const ymShift = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1); return iso(d).slice(0, 7); };
const ymRange = ym => {
  const [y, m] = ym.split('-').map(Number);
  return { a: `${ym}-01`, b: iso(new Date(y, m, 0)), days: new Date(y, m, 0).getDate() };
};
const curYM = () => iso(new Date()).slice(0, 7);
const firstYM = () => transactions.reduce((m, t) => (t.date < m ? t.date : m), iso(new Date())).slice(0, 7);

/* Statistik satu bulan (mengikuti filter rekening) */
function monthStats(ym) {
  const { a, b } = ymRange(ym);
  const s = { inc: 0, out: 0, nTx: 0, catIn: {}, catOut: {}, cntOut: {}, open: openingOf(), close: 0 };
  for (const t of withFees(transactions)) {
    if (t.date < a || t.date > b || !isFlow(t)) continue;
    if (t.type === 'in') { s.inc += t.amount; s.catIn[t.category] = (s.catIn[t.category] || 0) + t.amount; }
    else {
      s.out += t.amount;
      s.catOut[t.category] = (s.catOut[t.category] || 0) + t.amount;
      s.cntOut[t.category] = (s.cntOut[t.category] || 0) + 1;
    }
  }
  for (const t of transactions) {
    if (t.date <= b && t.date >= a && matchAcc(t)) s.nTx++;
    if (t.date < a) s.open += effect(t);
  }
  s.close = s.open + transactions.reduce((v, t) => v + (t.date >= a && t.date <= b ? effect(t) : 0), 0);
  s.net = s.inc - s.out;
  return s;
}

/* ---------- Render ---------- */
function renderReport() {
  if ($('#view-rep').hidden) return;
  const ym = R.ym, now = curYM();
  const s = monthStats(ym);
  const p = monthStats(ymShift(ym, -1));
  const { days } = ymRange(ym);
  const elapsed = ym === now ? new Date().getDate() : days;

  $('#rep-month').textContent = ymLabel(ym);
  $('#rep-next').disabled = ym >= now;
  $('#rep-prev').disabled = ym <= firstYM();
  $('#rep-note').textContent = ym === now ? `Bulan berjalan · data s.d. hari ini (${elapsed} dari ${days} hari)` : '';

  const vs = (cur, prev, upGood) => {
    if (!prev) return '<span class="t-delta">Bulan lalu: –</span>';
    const d = cur - prev;
    if (!d) return '<span class="t-delta">= sama dengan bulan lalu</span>';
    return `<span class="t-delta ${(d > 0) === upGood ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${fmt1(Math.abs(d / prev * 100))}% vs bulan lalu</span>`;
  };
  const rate = s.inc > 0 ? s.net / s.inc * 100 : null;
  $('#rep-tiles').innerHTML =
    tile('Pemasukan', rupiah(s.inc), vs(s.inc, p.inc, true), 'in') +
    tile('Pengeluaran', rupiah(s.out), vs(s.out, p.out, false), 'out') +
    tile('Selisih', (s.net > 0 ? '+' : '') + rupiah(s.net), `<span class="t-delta">${s.nTx} transaksi</span>`) +
    tile('Rasio menabung', rate === null ? '–' : `${fmt1(rate)}%`,
      `<span class="t-delta">Rata-rata keluar ${rupiah(Math.round(s.out / elapsed))}/hari</span>`);

  const costNote = (accFilter ? isInv(accById(accFilter)) : invAccounts().length > 0) ? ' Investasi dihitung sebesar modal.' : '';
  const chg = s.close - s.open;
  $('#rep-balance').innerHTML = `
    <div class="rep-bal"><span>Saldo awal bulan</span><b>${rupiah(s.open)}</b></div>
    <div class="rep-bal"><span>Saldo akhir bulan${ym === now ? ' (hari ini)' : ''}</span><b>${rupiah(s.close)}</b></div>
    <div class="rep-bal"><span>Perubahan</span><b class="${chg < 0 ? 'neg' : chg > 0 ? 'pos' : ''}">${chg > 0 ? '+' : ''}${rupiah(chg)}</b></div>
    <p class="sub">Termasuk transfer dan fee.${costNote}</p>`;

  $('#rep-out').innerHTML = catTable(s.catOut, s.out, 'out', p.catOut, s.cntOut);
  $('#rep-in').innerHTML = catTable(s.catIn, s.inc, 'in');

  // ringkasan setahun
  const y = ym.slice(0, 4), first = firstYM();
  const rows = [];
  let tIn = 0, tOut = 0;
  for (let m = 1; m <= 12; m++) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (k > now) break;
    if (k < first) continue;
    const st = monthStats(k);
    tIn += st.inc; tOut += st.out;
    rows.push(`<tr class="clickable${k === ym ? ' sel' : ''}" data-ym="${k}"><td>${MONTHS_LONG[m - 1]}</td>
      <td class="num">${rupiah(st.inc)}</td><td class="num">${rupiah(st.out)}</td>
      <td class="num ${st.net < 0 ? 'neg' : ''}">${st.net > 0 ? '+' : ''}${rupiah(st.net)}</td></tr>`);
  }
  $('#rep-year-title').textContent = `Ringkasan ${y}`;
  $('#rep-year').innerHTML = rows.length ? `<div class="top-table"><table class="data-table"><thead><tr>
      <th>Bulan</th><th class="num">Pemasukan</th><th class="num">Pengeluaran</th><th class="num">Selisih</th></tr></thead>
      <tbody>${rows.join('')}</tbody><tfoot><tr><td>Total</td><td class="num">${rupiah(tIn)}</td>
      <td class="num">${rupiah(tOut)}</td><td class="num ${tIn - tOut < 0 ? 'neg' : ''}">${tIn - tOut > 0 ? '+' : ''}${rupiah(tIn - tOut)}</td></tr></tfoot>
    </table></div>` : '<p class="empty">Belum ada data di tahun ini.</p>';
}

function catTable(cat, total, type, prev, cnt) {
  const rows = Object.entries(cat).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return `<p class="empty">Tidak ada ${type === 'in' ? 'pemasukan' : 'pengeluaran'} di bulan ini.</p>`;
  return `<div class="top-table"><table class="data-table"><thead><tr><th>Kategori</th><th class="num">Jumlah</th>
    <th class="num">Porsi</th>${prev ? '<th class="num">Bulan lalu</th>' : ''}</tr></thead><tbody>
    ${rows.map(([c, v]) => `<tr><td>${iconOf(type, c)} ${esc(c)}${cnt ? ` <small class="muted">${cnt[c]}×</small>` : ''}</td>
      <td class="num">${rupiah(v)}</td><td class="num muted">${Math.round(v / total * 100)}%</td>
      ${prev ? `<td class="num muted">${prev[c] ? rupiah(prev[c]) : '–'}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>`;
}

/* ---------- Unduh ---------- */
const csvOf = rows => '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
const fileTag = () => R.ym + (accFilter ? '-' + accName(accFilter).replace(/[^\w-]+/g, '_') : '');

function downloadMonthTx() {
  const { a, b } = ymRange(R.ym);
  const list = transactions.filter(t => t.date >= a && t.date <= b && matchAcc(t))
    .sort((x, y) => x.date.localeCompare(y.date));
  if (!list.length) { alert(`Tidak ada transaksi di ${ymLabel(R.ym)}.`); return; }
  const rows = [['Tanggal', 'Jenis', 'Rekening', 'Ke Rekening', 'Kategori', 'Jumlah', 'Catatan', 'Fee']]
    .concat(list.map(t => [t.date, TYPE_LABEL[t.type], accName(t.account_id), t.to_account_id ? accName(t.to_account_id) : '',
      t.category, t.amount, t.note, t.fee || '']));
  download(`transaksi-${fileTag()}.csv`, csvOf(rows), 'text/csv');
}

function downloadMonthReport() {
  const s = monthStats(R.ym);
  const sec = (title, cat, total) => [[], [title], ['Kategori', 'Jumlah', 'Porsi (%)']]
    .concat(Object.entries(cat).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, v, Math.round(v / total * 100)]));
  const rows = [
    ['Laporan keuangan', ymLabel(R.ym)],
    ['Rekening', accFilter ? accName(accFilter) : 'Semua rekening'],
    [],
    ['Ringkasan', 'Jumlah'],
    ['Pemasukan', s.inc], ['Pengeluaran', s.out], ['Selisih', s.net],
    ['Rasio menabung (%)', s.inc > 0 ? Math.round(s.net / s.inc * 1000) / 10 : ''],
    ['Saldo awal bulan', s.open], ['Saldo akhir bulan', s.close], ['Jumlah transaksi', s.nTx],
    ...sec('Pengeluaran per kategori', s.catOut, s.out),
    ...sec('Pemasukan per kategori', s.catIn, s.inc),
  ];
  download(`laporan-${fileTag()}.csv`, csvOf(rows), 'text/csv');
}

/* ---------- Event ---------- */
$('#rep-prev').addEventListener('click', () => { R.ym = ymShift(R.ym, -1); renderReport(); });
$('#rep-next').addEventListener('click', () => { R.ym = ymShift(R.ym, 1); renderReport(); });
$('#rep-year').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-ym]');
  if (tr) { R.ym = tr.dataset.ym; renderReport(); scrollTo({ top: 0, behavior: 'smooth' }); }
});
$('#rep-dl-tx').addEventListener('click', downloadMonthTx);
$('#rep-dl-sum').addEventListener('click', downloadMonthReport);
$('#rep-print').addEventListener('click', () => print());

renderReport();
