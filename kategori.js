'use strict';
/* =====================================================================
   Kelola kategori: tambah, ganti nama/ikon, sembunyikan, hapus, gabungkan.
   Semua perubahan ditampung sebagai draf; baru diterapkan saat "Simpan"
   (termasuk mengubah nama kategori di transaksi lama). "Batal" membuang draf.
   Memakai global dari app.js: CATEGORIES, AUTO_ROLES, ROLE_LABEL, FEE_CAT, saveCats,
   transactions, saveCache, loadData, render, sb, TABLE, needOnline, showError, $, esc.
   ===================================================================== */

const catDlg = $('#cat-dialog');
// draft: salinan daftar; tiap item menyimpan orig (nama saat dialog dibuka, null = baru)
// dan merged (nama asli kategori lain yang digabung ke item ini)
const CM = { type: 'out', editing: null, draft: null, busy: false };

const catCount = (type, name) => transactions.filter(t => t.type === type && t.category === name).length;
const draftCount = (type, it) => [it.orig, ...it.merged].filter(Boolean).reduce((s, n) => s + catCount(type, n), 0);
const stripDraft = d => ({
  out: d.out.map(({ orig, merged, ...c }) => c),
  in: d.in.map(({ orig, merged, ...c }) => c),
});
function renameOps() {
  const ops = [];
  for (const type of ['out', 'in']) for (const it of CM.draft[type]) {
    if (it.orig && it.orig !== it.name) ops.push({ type, from: it.orig, to: it.name });
    for (const m of it.merged) ops.push({ type, from: m, to: it.name });
  }
  return ops;
}
const catDirty = () => !!CM.draft &&
  (renameOps().length > 0 || JSON.stringify(stripDraft(CM.draft)) !== JSON.stringify(CATEGORIES));

function openCatManager() {
  CM.draft = {
    out: CATEGORIES.out.map(c => ({ ...c, orig: c.name, merged: [] })),
    in: CATEGORIES.in.map(c => ({ ...c, orig: c.name, merged: [] })),
  };
  CM.editing = null;
  renderCatManager();
  catDlg.showModal();
  $('#cat-list').scrollTop = 0;
  $('#cat-cancel').focus({ preventScroll: true });   // jangan beri garis fokus ke baris pertama
}

function catEditHTML(c) {
  const auto = c && AUTO_ROLES.includes(c.role);
  const canDelete = c && !c.role;
  return `<div class="cat-edit">
    <div class="cat-edit-row">
      <input class="cat-icon-in" value="${esc(c?.icon || '')}" placeholder="🏷️" maxlength="8" aria-label="Ikon (emoji)" autocomplete="off">
      <input class="cat-name-in" value="${esc(c?.name || '')}" placeholder="Nama kategori" maxlength="30" aria-label="Nama kategori" autocomplete="off">
    </div>
    ${c ? `<p class="cat-edit-note">${c.role ? `Dipakai fitur <b>${esc(ROLE_LABEL[c.role])}</b>, jadi tidak bisa dihapus. Namanya boleh diganti.`
      : 'Ganti nama juga mengubah transaksi lama. Isi dengan nama kategori lain untuk menggabungkan keduanya.'}</p>` : ''}
    ${auto ? '' : `<label class="cat-check"><input type="checkbox" class="cat-show-in" ${c?.hidden ? '' : 'checked'}> Tampilkan di form transaksi</label>`}
    <div class="cat-edit-actions">
      ${canDelete ? '<button type="button" class="btn small danger" data-cat-act="delete">Hapus</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn small" data-cat-act="cancel">Batal</button>
      <button type="button" class="btn small primary" data-cat-act="ok">OK</button>
    </div>
  </div>`;
}

function renderCatManager() {
  document.querySelectorAll('input[name="cat-type"]').forEach(r => { r.checked = r.value === CM.type; });
  const list = CM.draft[CM.type];
  $('#cat-list').innerHTML = list.map((c, i) => {
    if (CM.editing === i) return `<li class="cat-item editing" data-i="${i}">${catEditHTML(c)}</li>`;
    const n = draftCount(CM.type, c);
    const changed = !c.orig || c.orig !== c.name || c.merged.length;
    const tags = [
      !c.orig ? '<span class="cat-tag new">baru</span>' : changed ? '<span class="cat-tag new">diubah</span>' : '',
      c.hidden ? '<span class="cat-tag">disembunyikan</span>' : '',
      c.role ? `<span class="cat-tag role" title="Dipakai fitur: ${esc(ROLE_LABEL[c.role])}">${AUTO_ROLES.includes(c.role) ? 'otomatis' : 'dipakai fitur'}</span>` : '',
    ].join('');
    return `<li class="cat-item${c.hidden ? ' is-hidden' : ''}" data-i="${i}">
      <button type="button" class="cat-row" data-cat-act="edit">
        <span class="cat-ic">${esc(c.icon)}</span>
        <span class="cat-nm">${esc(c.name)}${tags}</span>
        <span class="cat-n">${n ? `${n} transaksi` : ''}</span>
        <svg class="i"><use href="#i-right"/></svg>
      </button></li>`;
  }).join('') + (CM.editing === 'new' ? `<li class="cat-item editing" data-i="new">${catEditHTML(null)}</li>` : '');
  $('#cat-add').disabled = CM.editing === 'new';
  $('#cat-save').disabled = !catDirty() || CM.busy;
  const ed = $('#cat-list .editing');
  if (ed) {
    ed.scrollIntoView({ block: 'nearest' });
    ed.querySelector('.cat-name-in').focus({ preventScroll: true });
  }
}

/* ---------- Ubah draf (belum ke database) ---------- */
function applyRowEdit(li) {
  const type = CM.type, list = CM.draft[type];
  const cur = li.dataset.i === 'new' ? null : list[+li.dataset.i];
  const name = li.querySelector('.cat-name-in').value.trim().replace(/\s+/g, ' ');
  const icon = li.querySelector('.cat-icon-in').value.trim() || '🏷️';
  const show = li.querySelector('.cat-show-in');
  const hidden = show ? !show.checked : false;

  if (!name) { alert('Nama kategori wajib diisi.'); return; }
  if (name === FEE_CAT) { alert(`"${FEE_CAT}" dipakai otomatis untuk fee transfer. Pilih nama lain.`); return; }
  const other = list.find(c => c.name.toLowerCase() === name.toLowerCase() && c !== cur);

  if (!cur) {                                          // kategori baru, diletakkan sebelum "Lainnya"
    if (other) { alert(`Kategori "${other.name}" sudah ada.`); return; }
    const at = list.length && /^lainnya$/i.test(list[list.length - 1].name) ? list.length - 1 : list.length;
    list.splice(at, 0, { name, icon, ...(hidden ? { hidden } : {}), orig: null, merged: [] });
  } else if (other) {                                  // ganti nama ke kategori yang sudah ada = gabungkan
    if (cur.role) { alert(`"${cur.name}" dipakai fitur (${ROLE_LABEL[cur.role]}), jadi tidak bisa digabung ke kategori lain. Ganti dengan nama yang belum dipakai.`); return; }
    const n = draftCount(type, cur);
    if (!confirm(`Gabungkan "${cur.name}" ke "${other.name}"?\n\n${n} transaksi akan dipindah ke "${other.name}" saat kamu menekan Simpan.`)) return;
    other.merged.push(...[cur.orig, ...cur.merged].filter(Boolean));
    list.splice(list.indexOf(cur), 1);
  } else {
    cur.name = name; cur.icon = icon;
    if (hidden) cur.hidden = true; else delete cur.hidden;
  }
  CM.editing = null;
  renderCatManager();
}

function deleteRow(li) {
  const type = CM.type, list = CM.draft[type];
  const cur = list[+li.dataset.i];
  if (!cur || cur.role) return;
  const n = draftCount(type, cur);
  if (n) {
    alert(`"${cur.name}" masih dipakai ${n} transaksi, jadi tidak bisa dihapus.\n\n` +
      `• Hilangkan centang "Tampilkan di form transaksi" agar tidak muncul lagi, atau\n` +
      `• Ganti namanya menjadi nama kategori lain untuk menggabungkan.`);
    return;
  }
  list.splice(list.indexOf(cur), 1);
  CM.editing = null;
  renderCatManager();
}

/* ---------- Simpan: terapkan draf ke transaksi & profil akun ---------- */
async function dbRename(type, from, to) {
  if (!catCount(type, from)) return;
  const { error } = await sb.from(TABLE).update({ category: to }).eq('type', type).eq('category', from);
  if (error) throw error;
  transactions.forEach(t => { if (t.type === type && t.category === from) t.category = to; });
}

async function commitCats() {
  if (CM.editing !== null && !confirm('Ada kategori yang sedang diedit dan belum di-OK. Simpan tanpa perubahan itu?')) return;
  const ops = renameOps().filter(o => catCount(o.type, o.from) > 0);
  if (ops.length && !needOnline()) return;
  CM.busy = true; $('#cat-save').disabled = true; $('#cat-save').textContent = 'Menyimpan…';
  try {
    // nama tujuan bisa sama dengan nama asal operasi lain (mis. tukar nama): lewati nama sementara dulu
    const clash = ops.some(o => ops.some(p => p !== o && p.from === o.to && p.type === o.type));
    if (clash) {
      const tmp = ops.map((o, i) => ({ ...o, tmp: `__kk_tmp_${Date.now()}_${i}` }));
      for (const o of tmp) await dbRename(o.type, o.from, o.tmp);
      for (const o of tmp) await dbRename(o.type, o.tmp, o.to);
    } else {
      for (const o of ops) await dbRename(o.type, o.from, o.to);
    }
    saveCache();
  } catch (err) {
    showError(err);
    await loadData();                                  // tampilkan keadaan database yang sebenarnya
    CM.busy = false; $('#cat-save').textContent = 'Simpan'; renderCatManager();
    return;
  }
  CATEGORIES = stripDraft(CM.draft);
  const ok = await saveCats();
  CM.busy = false; $('#cat-save').textContent = 'Simpan';
  CM.draft = null;
  catDlg.close();
  render();
  if (!ok) alert('Kategori tersimpan di perangkat ini, tapi belum tersinkron ke akun. Akan dicoba lagi saat aplikasi dibuka online.');
}

function cancelCats() {
  if (CM.busy) return;
  if (catDirty() && !confirm('Buang semua perubahan kategori?')) return;
  CM.draft = null;
  catDlg.close();
}

/* ---------- Event ---------- */
$('#cat-list').addEventListener('click', e => {
  const btn = e.target.closest('[data-cat-act]'); if (!btn) return;
  const li = btn.closest('.cat-item');
  const act = btn.dataset.catAct;
  if (act === 'edit') { CM.editing = +li.dataset.i; renderCatManager(); }
  else if (act === 'cancel') { CM.editing = null; renderCatManager(); }
  else if (act === 'ok') applyRowEdit(li);
  else if (act === 'delete') deleteRow(li);
});
// Enter di kolom nama = OK untuk baris itu (jangan menutup dialog)
$('#cat-form').addEventListener('submit', e => {
  e.preventDefault();
  const li = $('#cat-list .editing');
  if (li) applyRowEdit(li);
});
document.querySelectorAll('input[name="cat-type"]').forEach(r => r.addEventListener('change', () => {
  CM.type = r.value; CM.editing = null; renderCatManager();
}));
$('#cat-add').addEventListener('click', () => { CM.editing = 'new'; renderCatManager(); });
$('#cat-cancel').addEventListener('click', cancelCats);
$('#cat-save').addEventListener('click', commitCats);
catDlg.addEventListener('cancel', e => { e.preventDefault(); cancelCats(); });   // tombol Esc / kembali
