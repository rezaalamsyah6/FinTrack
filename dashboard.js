'use strict';
/* =====================================================================
   Dashboard: ringkasan, grafik arus kas, tren saldo, kategori, top 5.
   Memakai variabel global dari app.js: transactions, $, rupiah, esc,
   iconOf, openForm.
   ===================================================================== */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const pad2 = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseISO = s => new Date(s + 'T00:00:00');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayLabel = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const fmt1 = v => (Math.round(v * 10) / 10).toLocaleString('id-ID');
function compact(n) {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + fmt1(a / 1e9) + ' M';
  if (a >= 1e6) return s + fmt1(a / 1e6) + ' jt';
  if (a >= 1e3) return s + fmt1(a / 1e3) + ' rb';
  return s + a.toLocaleString('id-ID');
}

const D = {
  period: (() => { try { return localStorage.getItem('kk_period') || 'month'; } catch { return 'month'; } })(),
  tables: {},
  showTable: {},
};

/* ---------------- Periode ---------------- */
function getPeriod(key) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let months = { month: 1, '3m': 3, '6m': 6, '12m': 12, ytd: today.getMonth() + 1 }[key];
  if (key === 'all') {
    const first = transactions.reduce((m, t) => (t.date < m ? t.date : m), iso(today));
    const f = parseISO(first);
    months = (today.getFullYear() - f.getFullYear()) * 12 + today.getMonth() - f.getMonth() + 1;
  }
  const start = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  let end = new Date(today.getFullYear(), today.getMonth() + 1, 0);          // akhir bulan ini
  if (key === 'all') {
    const last = transactions.reduce((m, t) => (t.date > m ? t.date : m), iso(end));
    end = parseISO(last);
  }
  // Pembanding: periode sama panjang sebelumnya, dipotong pada hari yang sama (adil untuk bulan berjalan)
  let prev = null;
  if (key !== 'all') {
    const ps = new Date(start.getFullYear(), start.getMonth() - months, 1);
    const pm = new Date(today.getFullYear(), today.getMonth() - months, 1);
    const lastDay = new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate();
    const pe = new Date(pm.getFullYear(), pm.getMonth(), Math.min(today.getDate(), lastDay));
    prev = { a: iso(ps), b: iso(pe) };
  }
  const elapsedEnd = today < end ? today : end;
  const days = Math.max(1, Math.round((elapsedEnd - start) / 864e5) + 1);
  return {
    key, months, start, end, today, days, prev,
    a: iso(start), b: iso(end),
    prevLabel: key === 'month' ? 'bulan lalu' : 'periode sebelumnya',
  };
}


function totals(a, b) {
  let inc = 0, out = 0, food = 0;
  const foodCat = catByRole('out', 'food');
  for (const t of withFees(transactions)) {
    if (t.date < a || t.date > b || !isFlow(t)) continue;
    if (t.type === 'in') inc += t.amount; else out += t.amount;
    if (t.type === 'out' && t.category === foodCat) food += t.amount;
  }
  return { inc, out, food, net: inc - out };
}

/* ---------------- Sembunyikan nominal (khusus Ringkasan) ---------------- */
const PRIVACY_KEY = 'kk_hide_dash';
function setPrivacy(on) {
  $('#view-dash').classList.toggle('private', on);
  document.body.classList.toggle('dash-private', on);
  const btn = $('#privacy-btn'), label = on ? 'Tampilkan nominal' : 'Sembunyikan nominal';
  btn.setAttribute('aria-pressed', on);
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.querySelector('use').setAttribute('href', on ? '#i-eye-off' : '#i-eye');
  try { localStorage.setItem(PRIVACY_KEY, on ? '1' : ''); } catch { }
}
setPrivacy((() => { try { return !!localStorage.getItem(PRIVACY_KEY); } catch { return false; } })());
$('#privacy-btn').addEventListener('click', () => setPrivacy(!$('#view-dash').classList.contains('private')));

/* ---------------- Tooltip ---------------- */
const tipEl = $('#tip');
function showTip(html, x, y) {
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  let left = x + 14, top = y - r.height - 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (left < 8) left = 8;
  if (top < 8) top = y + 18;
  tipEl.style.left = left + 'px';
  tipEl.style.top = top + 'px';
}
let clearHover = () => { tipEl.hidden = true; };
function setHoverClear(fn) { clearHover = () => { tipEl.hidden = true; fn(); }; }
document.addEventListener('pointerdown', e => { if (!e.target.closest('.chart, .hb-row')) clearHover(); });
addEventListener('scroll', () => clearHover(), { passive: true });

const tipRow = (label, value, cls) =>
  `<div class="row"><span>${cls ? `<i class="swatch ${cls}"></i>` : ''}${label}</span><span>${value}</span></div>`;

/* ---------------- Skala & bentuk ---------------- */
function niceScale(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const raw = (max - min) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return { lo, hi, ticks };
}
// kolom dengan ujung data membulat 4px, rata di baseline
function colPath(x, yTop, w, yBase) {
  const h = yBase - yTop;
  const r = Math.min(4, w / 2, h);
  return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`;
}
const svgOpen = (W, H) => `<svg viewBox="0 0 ${W} ${H}" height="${H}" preserveAspectRatio="none" role="img">`;
function svgPoint(svg, e) {
  const r = svg.getBoundingClientRect();
  return (e.clientX - r.left) * (svg.viewBox.baseVal.width / r.width);
}

/* ---------------- Grafik kolom ---------------- */
// cfg: { labels, series:[{cls, values}], tips:[html], every, ariaLabel }
function columnChart(el, cfg) {
  const W = Math.max(280, el.clientWidth), H = 220;
  const m = { t: 10, r: 4, b: 24, l: 46 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const n = cfg.labels.length, k = cfg.series.length;
  const max = Math.max(0, ...cfg.series.flatMap(s => s.values));
  const sc = niceScale(0, max || 1);
  const y = v => m.t + ph - (v - sc.lo) / (sc.hi - sc.lo) * ph;
  const band = pw / n, gap = 2;
  const bw = Math.max(2, Math.min(24, (band * 0.72 - gap * (k - 1)) / k));
  const gw = bw * k + gap * (k - 1);

  let s = svgOpen(W, H).replace('role="img"', `role="img" aria-label="${esc(cfg.ariaLabel)}"`);
  for (const t of sc.ticks) {
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/>`;
    s += `<text class="ya" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
  }
  s += `<rect class="hover-band" x="0" y="${m.t}" width="${band}" height="${ph}" fill="var(--grid)" opacity="0" />`;
  for (let i = 0; i < n; i++) {
    cfg.series.forEach((se, j) => {
      const v = se.values[i];
      if (v <= 0) return;
      const x = m.l + band * i + (band - gw) / 2 + j * (bw + gap);
      s += `<path d="${colPath(x, y(v), bw, y(0))}" fill="var(--s-${se.cls})"/>`;
    });
    if (i % cfg.every === 0) s += `<text x="${m.l + band * (i + .5)}" y="${H - 6}" text-anchor="middle">${cfg.labels[i]}</text>`;
  }
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)" stroke-width="1"/>`;
  for (let i = 0; i < n; i++) {
    s += `<rect data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ph + m.b}" fill="transparent"/>`;
  }
  el.innerHTML = s + '</svg>';

  const hb = el.querySelector('.hover-band');
  const move = e => {
    const hit = e.target.closest('[data-i]');
    if (!hit) return;
    const i = +hit.dataset.i;
    hb.setAttribute('x', m.l + band * i); hb.setAttribute('opacity', '.55');
    setHoverClear(() => hb.setAttribute('opacity', '0'));
    showTip(cfg.tips[i], e.clientX, e.clientY);
  };
  el.onpointermove = move;
  el.onpointerdown = move;
  el.onpointerleave = e => { if (e.pointerType === 'mouse') clearHover(); };
}

/* ---------------- Grafik garis (tren saldo) ---------------- */
function lineChart(el, pts, ariaLabel) {
  const W = Math.max(280, el.clientWidth), H = 200;
  const m = { t: 12, r: 10, b: 24, l: 46 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const n = pts.length;
  const vals = pts.map(p => p.v);
  const sc = niceScale(Math.min(0, ...vals), Math.max(0, ...vals));
  const x = i => m.l + (n === 1 ? pw / 2 : i / (n - 1) * pw);
  const y = v => m.t + ph - (v - sc.lo) / (sc.hi - sc.lo) * ph;

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;

  let s = svgOpen(W, H).replace('role="img"', `role="img" aria-label="${esc(ariaLabel)}"`);
  for (const t of sc.ticks) {
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1"/>`;
    s += `<text class="ya" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`;
  }
  s += `<path d="${area}" fill="var(--s-in-wash)"/>`;
  s += `<path d="${line}" fill="none" stroke="var(--s-in)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const lab = [[0, 'start'], [Math.floor((n - 1) / 2), 'middle'], [n - 1, 'end']];
  if (n > 2) for (const [i, anchor] of lab) s += `<text x="${x(i)}" y="${H - 6}" text-anchor="${anchor}">${dayLabel(pts[i].d)}</text>`;
  else s += `<text x="${x(n - 1)}" y="${H - 6}" text-anchor="end">${dayLabel(pts[n - 1].d)}</text>`;
  // titik akhir
  s += `<circle cx="${x(n - 1)}" cy="${y(vals[n - 1])}" r="4" fill="var(--s-in)" stroke="var(--card)" stroke-width="2"/>`;
  // crosshair
  s += `<line class="xh" y1="${m.t}" y2="${m.t + ph}" stroke="var(--axis)" stroke-width="1" opacity="0"/>`;
  s += `<circle class="xd" r="5" fill="var(--s-in)" stroke="var(--card)" stroke-width="2" opacity="0"/>`;
  s += `<rect class="hit" x="${m.l}" y="0" width="${pw}" height="${H}" fill="transparent"/>`;
  el.innerHTML = s + '</svg>';

  const svg = el.querySelector('svg'), xh = el.querySelector('.xh'), xd = el.querySelector('.xd');
  const move = e => {
    const px = svgPoint(svg, e);
    const i = Math.max(0, Math.min(n - 1, Math.round((px - m.l) / pw * (n - 1))));
    const p = pts[i];
    xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('opacity', '1');
    xd.setAttribute('cx', x(i)); xd.setAttribute('cy', y(p.v)); xd.setAttribute('opacity', '1');
    setHoverClear(() => { xh.setAttribute('opacity', '0'); xd.setAttribute('opacity', '0'); });
    showTip(`<b>${p.d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b>`
      + tipRow('Saldo', rupiah(p.v))
      + (p.chg ? tipRow('Perubahan hari itu', (p.chg > 0 ? '+' : '') + rupiah(p.chg)) : ''), e.clientX, e.clientY);
  };
  el.onpointermove = move;
  el.onpointerdown = move;
  el.onpointerleave = e => { if (e.pointerType === 'mouse') clearHover(); };
}

/* ---------------- Tabel data (alternatif grafik) ---------------- */
function tableHTML({ head, rows, num }) {
  return `<table class="data-table"><thead><tr>${head.map((h, i) => `<th class="${num.includes(i) ? 'num' : ''}">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${num.includes(i) ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function applyTableState(key) {
  const card = document.querySelector(`[data-chart="${key}"]`);
  const on = !!D.showTable[key];
  card.querySelector('.tbl-toggle').setAttribute('aria-pressed', on);
  card.querySelector('.chart').hidden = on;
  const legend = card.querySelector('.legend'); if (legend) legend.style.visibility = on ? 'hidden' : '';
  const tbl = card.querySelector('.chart-table');
  tbl.hidden = !on;
  if (on && D.tables[key]) tbl.innerHTML = tableHTML(D.tables[key]);
}
document.querySelectorAll('.tbl-toggle').forEach(btn => btn.addEventListener('click', () => {
  const key = btn.closest('[data-chart]').dataset.chart;
  D.showTable[key] = !D.showTable[key];
  applyTableState(key);
}));

/* ---------------- Ubin statistik ---------------- */
function delta(cur, prev, upGood, P, mode = 'pct') {
  if (!P.prev) return '';
  if (mode === 'pct' && !prev) return `<span class="t-delta">Belum ada data ${P.prevLabel}</span>`;
  const diff = cur - prev;
  if (Math.abs(diff) < 1e-9) return `<span class="t-delta">= sama dengan ${P.prevLabel}</span>`;
  const up = diff > 0;
  const cls = up === upGood ? 'good' : 'bad';
  const txt = mode === 'pct' ? `${fmt1(Math.abs(diff / prev * 100))}%`
    : mode === 'pt' ? `${fmt1(Math.abs(diff))} poin`
    : 'Rp' + compact(Math.abs(diff));
  return `<span class="t-delta ${cls}">${up ? '▲' : '▼'} ${txt} vs ${P.prevLabel}</span>`;
}
const tile = (label, value, d, sw) =>
  `<div class="tile"><div class="t-label">${sw ? `<i class="swatch ${sw}"></i>` : ''}${label}</div><div class="t-value">${value}</div>${d}</div>`;

/* ---------------- Render utama ---------------- */
function renderDashboard() {
  if ($('#view-dash').hidden) return;
  document.querySelectorAll('#period-chips button').forEach(b => b.classList.toggle('active', b.dataset.p === D.period));

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const nTx = transactions.filter(t => matchAcc(t)).length;
  const fAcc = accById(accFilter);
  const hasInv = invAccounts().length > 0;
  $('#d-hero-label').textContent = fAcc
    ? `${isInv(fAcc) ? 'Nilai' : 'Saldo'} ${fAcc.name}`
    : (hasInv ? 'Kekayaan bersih' : 'Saldo semua rekening');
  $('#d-hero').textContent = rupiah(valueOfFilter());
  const asOf = `per ${today.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  if (fAcc && isInv(fAcc)) {
    $('#d-hero-sub').innerHTML = `Modal ${rupiah(balanceOf(fAcc.id))} ${gainHTML(valueOf(fAcc.id), balanceOf(fAcc.id))} · ${esc(invStatus(fAcc).text)}`;
  } else if (!fAcc && hasInv) {
    const inv = invAccounts();
    const iv = inv.reduce((s, a) => s + valueOf(a.id), 0), ic = inv.reduce((s, a) => s + balanceOf(a.id), 0);
    $('#d-hero-sub').innerHTML = `Kas ${rupiah(netWorth() - iv)} · Investasi ${rupiah(iv)} ${gainHTML(iv, ic)} · ${asOf}`;
  } else {
    $('#d-hero-sub').textContent = `Dari ${nTx.toLocaleString('id-ID')} transaksi · ${asOf}`;
  }

  const empty = transactions.length === 0 && accounts.length === 0;
  $('#d-empty').hidden = !empty;
  $('#d-body').hidden = empty;
  if (empty) return;

  const P = getPeriod(D.period);
  const cur = totals(P.a, P.b);
  const prv = P.prev ? totals(P.prev.a, P.prev.b) : null;
  // pembanding yang adil: periode berjalan s.d. hari ini vs periode lalu s.d. hari yang sama
  const curToDate = P.prev ? totals(P.a, iso(today)) : cur;
  const rate = t => (t.inc > 0 ? t.net / t.inc * 100 : null);
  const prevDays = P.prev ? Math.round((parseISO(P.prev.b) - parseISO(P.prev.a)) / 864e5) + 1 : 1;

  /* transfer masuk/keluar (hanya relevan saat melihat satu rekening) */
  let trIn = 0, trOut = 0;
  if (accFilter) {
    for (const t of transactions) {
      if (t.type !== 'transfer' || t.date < P.a || t.date > P.b) continue;
      if (t.to_account_id === accFilter) trIn += t.amount;
      if (t.account_id === accFilter) trOut += t.amount;
    }
  }
  const trNet = trIn - trOut;

  /* ubin */
  const r = rate(cur);
  // hari untuk rata-rata makan: mulai dari transaksi pertama bila itu jatuh di tengah periode
  const firstDate = transactions.reduce((m, t) => (t.date < m ? t.date : m), P.b);
  const fromD = parseISO(firstDate > P.a ? firstDate : P.a);
  const toD = today < P.end ? today : P.end;
  const foodDays = Math.max(1, Math.round((toD - fromD) / 864e5) + 1);
  const tile4 = accFilter
    ? tile('Transfer bersih', (trNet > 0 ? '+' : '') + rupiah(trNet),
        `<span class="t-delta">Masuk ${'Rp' + compact(trIn)} · keluar ${'Rp' + compact(trOut)}</span>`)
    : tile('Rata-rata makan/hari', rupiah(Math.round(cur.food / foodDays)),
        prv ? delta(curToDate.food / foodDays, prv.food / prevDays, false, P) : '');
  $('#d-tiles').innerHTML =
    tile('Pemasukan', rupiah(cur.inc), prv ? delta(curToDate.inc, prv.inc, true, P) : '', 'in') +
    tile('Pengeluaran', rupiah(cur.out), prv ? delta(curToDate.out, prv.out, false, P) : '', 'out') +
    tile('Selisih', (cur.net > 0 ? '+' : '') + rupiah(cur.net), prv ? delta(curToDate.net, prv.net, true, P, 'rp') : '') +
    tile4 +
    tile('Rata-rata pengeluaran/hari', rupiah(Math.round(cur.out / P.days)),
      prv ? delta(curToDate.out / P.days, prv.out / prevDays, false, P) : '');

  /* kategori */
  const byCat = {};
  const cnt = {};
  const catTx = {};
  for (const t of withFees(transactions)) {
    if (t.type !== 'out' || !isFlow(t) || t.date < P.a || t.date > P.b) continue;
    byCat[t.category] = (byCat[t.category] || 0) + t.amount;
    (catTx[t.category] ||= []).push(t);
    cnt[t.category] = (cnt[t.category] || 0) + 1;
  }
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  /* insight */
  const parts = [];
  if (cats.length) parts.push(`Pengeluaran terbesar ada di <b>${esc(cats[0][0])}</b> (${Math.round(cats[0][1] / cur.out * 100)}% dari total).`);
  if (accFilter && (trIn || trOut)) {
    const chg = cur.net + trNet;
    parts.push(`Termasuk transfer, saldo ${esc(accName(accFilter))} <b>${chg >= 0 ? 'naik' : 'turun'} ${rupiah(Math.abs(chg))}</b> di periode ini.`);
  } else {
    if (cur.inc > 0 && cur.net >= 0) parts.push(`Anda menyisihkan <b>${fmt1(r)}%</b> dari pemasukan.`);
    if (cur.net < 0) parts.push(`Pengeluaran <b>melebihi pemasukan ${rupiah(-cur.net)}</b> di periode ini.`);
  }
  $('#d-insight').innerHTML = parts.join(' ');

  renderCashflow(P, cur);
  renderBalance(P);

  $('#cat-sub').textContent = cats.length ? `Total ${rupiah(cur.out)}` : '';
  $('#d-cat').innerHTML = cats.length ? cats.map(([c, v]) => `
    <div class="hb-row${openCats.has('d:' + c) ? ' open' : ''}" data-cat="${esc(c)}">
      <button type="button" class="hb-top cat-toggle" aria-expanded="${openCats.has('d:' + c)}"><span class="hb-name">${iconOf('out', c)} ${esc(c)}</span>
        <span class="hb-val">${rupiah(v)}<small>${Math.round(v / cur.out * 100)}%</small><i class="chev"></i></span></button>
      <div class="hb-bar" style="width:${(v / cats[0][1] * 100).toFixed(1)}%"></div>
      ${catDetailHTML(catTx[c], v)}
    </div>`).join('') : '<p class="empty">Belum ada pengeluaran di periode ini.</p>';
  bindCatToggles($('#d-cat'), 'd:');
  document.querySelectorAll('#d-cat .hb-row').forEach(row => {
    const c = row.dataset.cat;
    const show = e => { if (e.target.closest('.cat-detail')) return clearHover(); setHoverClear(() => {}); showTip(`<b>${iconOf('out', c)} ${esc(c)}</b>`
      + tipRow('Jumlah', rupiah(byCat[c])) + tipRow('Porsi', `${fmt1(byCat[c] / cur.out * 100)}%`)
      + tipRow('Transaksi', `${cnt[c]}×`), e.clientX, e.clientY); };
    row.onpointermove = show; row.onpointerdown = show;
    row.onpointerleave = e => { if (e.pointerType === 'mouse') clearHover(); };
  });

  /* top 5 */
  renderAccBreakdown();

  const top = withFees(transactions).filter(t => t.type === 'out' && isFlow(t) && t.date >= P.a && t.date <= P.b)
    .sort((a, b) => b.amount - a.amount).slice(0, 5);
  $('#d-top').innerHTML = top.length ? `<div class="top-table"><table class="data-table"><thead><tr>
      <th>Tanggal</th><th>Kategori</th><th>Catatan</th><th class="num">Jumlah</th></tr></thead><tbody>
      ${top.map(t => `<tr class="clickable" data-id="${esc(t.id)}">
        <td class="muted" style="white-space:nowrap">${dayLabel(parseISO(t.date))}</td>
        <td style="white-space:nowrap">${iconOf('out', t.category)} ${esc(t.category)}</td>
        <td class="ellipsis muted">${esc(t.note || '—')}</td>
        <td class="num">${rupiah(t.amount)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">Belum ada pengeluaran di periode ini.</p>';
  document.querySelectorAll('#d-top tr[data-id]').forEach(tr =>
    tr.addEventListener('click', () => openForm(transactions.find(t => t.id === tr.dataset.id))));
}

function renderCashflow(P, cur) {
  const el = $('#cf-chart');
  if (P.months === 1) {
    // satu bulan → pengeluaran harian
    const nDays = P.end.getDate();
    const vals = Array(nDays).fill(0);
    for (const t of withFees(transactions)) {
      if (t.type === 'out' && isFlow(t) && t.date >= P.a && t.date <= P.b) vals[parseISO(t.date).getDate() - 1] += t.amount;
    }
    const labels = vals.map((_, i) => String(i + 1));
    $('#cf-title').textContent = 'Pengeluaran harian';
    $('#cf-sub').textContent = `${P.start.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })} · rata-rata ${rupiah(Math.round(cur.out / P.days))}/hari`;
    $('#cf-legend').innerHTML = '';
    columnChart(el, {
      labels, every: 5, ariaLabel: 'Grafik pengeluaran harian',
      series: [{ cls: 'out', values: vals }],
      tips: vals.map((v, i) => `<b>${dayLabel(new Date(P.start.getFullYear(), P.start.getMonth(), i + 1))}</b>` + tipRow('Pengeluaran', rupiah(v), 'out')),
    });
    D.tables.cf = {
      head: ['Tanggal', 'Pengeluaran'], num: [1],
      rows: vals.map((v, i) => [dayLabel(new Date(P.start.getFullYear(), P.start.getMonth(), i + 1)), rupiah(v)]).filter((_, i) => vals[i] > 0),
    };
  } else {
    const n = P.months;
    const inc = Array(n).fill(0), out = Array(n).fill(0);
    const idx = d => (d.getFullYear() - P.start.getFullYear()) * 12 + d.getMonth() - P.start.getMonth();
    for (const t of withFees(transactions)) {
      if (t.date < P.a || t.date > P.b || !isFlow(t)) continue;
      const i = idx(parseISO(t.date));
      if (i < 0 || i >= n) continue;
      (t.type === 'in' ? inc : out)[i] += t.amount;
    }
    const mDate = i => new Date(P.start.getFullYear(), P.start.getMonth() + i, 1);
    const labels = inc.map((_, i) => {
      const d = mDate(i);
      return d.getMonth() === 0 || i === 0 ? `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : MONTHS[d.getMonth()];
    });
    const net = cur.net;
    $('#cf-title').textContent = 'Arus kas bulanan';
    $('#cf-sub').textContent = `Selisih periode ini: ${net > 0 ? '+' : ''}${rupiah(net)}`;
    $('#cf-legend').innerHTML = '<span><i class="swatch in"></i>Pemasukan</span><span><i class="swatch out"></i>Pengeluaran</span>';
    const W = el.clientWidth || 320;
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W - 46) / 44))));
    columnChart(el, {
      labels, every, ariaLabel: 'Grafik pemasukan dan pengeluaran per bulan',
      series: [{ cls: 'in', values: inc }, { cls: 'out', values: out }],
      tips: inc.map((v, i) => `<b>${mDate(i).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</b>`
        + tipRow('Pemasukan', rupiah(v), 'in') + tipRow('Pengeluaran', rupiah(out[i]), 'out')
        + tipRow('Selisih', (v - out[i] > 0 ? '+' : '') + rupiah(v - out[i]))),
    });
    D.tables.cf = {
      head: ['Bulan', 'Pemasukan', 'Pengeluaran', 'Selisih'], num: [1, 2, 3],
      rows: inc.map((v, i) => [mDate(i).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' }),
        rupiah(v), rupiah(out[i]), rupiah(v - out[i])]),
    };
  }
  applyTableState('cf');
}

function renderBalance(P) {
  const endD = P.today < P.end ? P.today : P.end;
  let opening = openingOf();
  const perDay = {};
  for (const t of transactions) {
    const v = effect(t);
    if (!v) continue;
    if (t.date < P.a) opening += v;
    else if (t.date <= iso(endD)) perDay[t.date] = (perDay[t.date] || 0) + v;
  }
  const all = [];
  let bal = opening;
  for (let d = new Date(P.start); d <= endD; d = addDays(d, 1)) {
    const chg = perDay[iso(d)] || 0;
    bal += chg;
    all.push({ d: new Date(d), v: bal, chg });
  }
  // kurangi titik untuk rentang panjang (saldo kumulatif → aman di-sampling)
  const step = Math.ceil(all.length / 370);
  const pts = step > 1 ? all.filter((_, i) => i % step === 0 || i === all.length - 1) : all;
  const change = bal - opening;
  const costNote = (accFilter ? isInv(accById(accFilter)) : invAccounts().length > 0)
    ? ' · investasi dihitung sebesar modal' : '';
  $('#bal-sub').textContent = (change === 0 ? 'Tidak berubah di periode ini'
    : `${change > 0 ? 'Naik' : 'Turun'} ${rupiah(Math.abs(change))} di periode ini`) + costNote;
  lineChart($('#bal-chart'), pts, 'Grafik tren saldo');
  D.tables.bal = {
    head: ['Tanggal', 'Perubahan', 'Saldo'], num: [1, 2],
    rows: all.filter(p => p.chg).reverse().map(p => [dayLabel(p.d) + ' ' + p.d.getFullYear(), (p.chg > 0 ? '+' : '') + rupiah(p.chg), rupiah(p.v)]),
  };
  applyTableState('bal');
}

/* ---------------- Saldo per rekening ---------------- */
function renderAccBreakdown() {
  const card = $('#d-acc-card');
  card.hidden = accounts.length < 2 || !!accFilter;
  $('#d-top').closest('section').classList.toggle('span-2', card.hidden);
  if (card.hidden) return;
  const rows = accounts.map(a => ({ a, bal: valueOf(a.id) })).sort((x, y) => y.bal - x.bal);
  const posTotal = rows.reduce((s, r) => s + Math.max(0, r.bal), 0);
  $('#d-acc').previousElementSibling.querySelector('h2').textContent =
    invAccounts().length ? 'Kas & investasi' : 'Saldo per rekening';
  $('#d-acc-sub').textContent = `${accounts.length} rekening · ketuk untuk melihat detailnya`;
  $('#d-acc').innerHTML = rows.map(({ a, bal }) => `
    <div class="acc-row" data-acc="${a.id}">
      <span>${kindOf(a)[1]}</span>
      <span class="name">${esc(a.name)}${isInv(a) && invStatus(a).stale ? ' <small title="Nilai perlu diperbarui">⚠️</small>' : ''}</span>
      <span class="val">${rupiah(bal)}</span>
      <span class="share">${posTotal > 0 && bal > 0 ? Math.round(bal / posTotal * 100) + '%' : '–'}</span>
    </div>`).join('');
}
$('#d-acc').addEventListener('click', e => {
  const r = e.target.closest('[data-acc]');
  if (r) { setAccFilter(r.dataset.acc); scrollTo(0, 0); }
});

/* ---------------- Interaksi ---------------- */
$('#period-chips').addEventListener('click', e => {
  const b = e.target.closest('button[data-p]');
  if (!b) return;
  D.period = b.dataset.p;
  try { localStorage.setItem('kk_period', D.period); } catch { }
  clearHover();
  renderDashboard();
});

function setView(v) {
  $('#view-dash').hidden = v !== 'dash';
  $('#view-tx').hidden = v !== 'tx';
  $('#view-acc').hidden = v !== 'acc';
  $('#view-sim').hidden = v !== 'sim';
  $('#view-rep').hidden = v !== 'rep';
  document.querySelectorAll('.tabbar button[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  try { localStorage.setItem('kk_view', v); } catch { }
  clearHover();
  scrollTo(0, 0);
  if (v === 'dash') renderDashboard();
  if (v === 'sim' && typeof renderSim === 'function') renderSim();
  if (v === 'rep' && typeof renderReport === 'function') renderReport();
}
document.querySelectorAll('.tabbar button[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
setView((() => { try { return localStorage.getItem('kk_view') || 'dash'; } catch { return 'dash'; } })());

// gambar ulang grafik saat lebar layar berubah
let lastW = 0, rT;
new ResizeObserver(entries => {
  const w = Math.round(entries[0].contentRect.width);
  if (w === lastW || !w) return;
  lastW = w;
  clearTimeout(rT);
  rT = setTimeout(renderDashboard, 120);
}).observe($('main'));
