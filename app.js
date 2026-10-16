import {clips, layout} from './clips.js';

// Step 1: drifted video only (real detection has no original). Step 2 opens after step 1 is saved and locked:
// original | drifted | difference in sync, cropped from one comparison file.
// "Too fast to judge" is its own answer and never counts as "not visible".
// Layouts: v2 (2026-10-13) five items; v3 (2026-10-14) two items, drift area computed by angle and only shown.
const FPS = 30;
const TOO_FAST = ['too_fast', '未判断（太快）'];
const VIS = [['none', '看不出'], ['subtle', '仔细看才看出'], ['obvious', '明显'], TOO_FAST];
const LAYOUTS = {
  v2: {
    step1: [{key: 'blind', title: '只看漂移视频、不对照原视频，能看出异常吗？', type: 'radio', options: VIS,
             hint: '这一项最重要：真实场景里检测时没有原视频可对照。太快没法判断就选"未判断"，不要选"看不出"。'}],
    step2: [
      {key: 'compare', title: '对照原视频，能看出漂移吗？', type: 'radio', options: VIS},
      {key: 'diff', title: '差异强弱（看右边的差异画面，所有片段同一标尺 ×4）', type: 'radio',
       options: [['none', '无'], ['weak', '弱（只在物体边缘）'], ['strong', '强（成片）'], TOO_FAST]},
      {key: 'defects', title: '瑕疵（可多选）', type: 'check', exclusive: 'none',
       options: [['none', '没有'], ['hole', '空洞'], ['seam', '接缝'], ['tear', '撕裂'], ['flicker', '闪烁'], ['jump', '画面跳变'], ['other', '其他（写在备注）']]},
      {key: 'area', title: '面积：和算好的占比一致吗？', type: 'radio', area: true,
       note: 'area_note', noteWhen: v => v === 'disagree', notePlaceholder: '面积不符时写一句（例如：肉眼看大约一半都在动）',
       options: [['agree', '相符'], ['disagree', '不符（在下面写一句）']]},
      {key: 'example', title: '可选：典型例子', type: 'radio', optional: true,
       note: 'example_reason', noteWhen: v => !!v, notePlaceholder: '选了典型例子时写一句原因',
       hint: '"好漂移"和"不合格"各挑 3–5 个就够。选了就写一句原因，并点播放器上的"截图"保存当前帧。',
       options: [['', '不选'], ['good', '好漂移'], ['bad', '不合格']]},
    ],
  },
  v3: {
    step1: [{key: 'visible', title: '只看漂移视频，肉眼能看出漂移吗？', type: 'radio',
             options: [['none', '看不出'], ['subtle', '仔细看能看出'], ['obvious', '一眼能看出'], TOO_FAST],
             hint: '不对照原视频判断。看得太快没法判断就选"未判断"，不要选"看不出"。'}],
    step2: [{key: 'natural', title: '看起来自不自然？', type: 'radio',
             note: 'natural_note', noteWhen: v => v === 'implausible',
             notePlaceholder: '是什么问题？例如撕裂、拉伸、接缝、闪烁（选"明显不合理"时必填，"有点怪"也建议写）',
             options: [['natural', '自然'], ['odd', '有点怪'], ['implausible', '明显不合理（写一句是什么问题）']]}],
  },
};
const {step1: STEP1, step2: STEP2} = LAYOUTS[layout];

const $ = id => document.getElementById(id);
let labels = {}, cursor = 0, rate = 1, startedAt = Date.now(), server = true, editing1 = false, player = null;
const site = clips[0].id[0], STORE = `calib-v3-labels-${layout}:${site}`, CURSOR = `calib-v3-cursor:${site}`;
// earlier layouts of this site, kept in their own slots and exportable from the footer
const OLD_STORES = {v1: `calib-v3-labels:${site}`, v2: `calib-v3-labels-v2:${site}`};
delete OLD_STORES[layout];
const rater = () => $('rater').value.trim();
const mine = () => labels[rater()] || {};
const isClean = c => !c.comparison;

function complete(qs, a, notes = {}) {
  return qs.every(q => {
    if (q.note && q.noteWhen(a[q.key]) && !(notes[q.note] || '').trim()) return false;
    if (q.optional) return true;
    return q.type === 'radio' ? !!a[q.key] : Array.isArray(a[q.key]) && a[q.key].length > 0;
  });
}
const done = c => {
  const l = mine()[c.id];
  return !!l && !!l.step1 && complete(STEP1, l.step1) && (isClean(c) || (!!l.step2 && complete(STEP2, l.step2, l)));
};

// ---------- synced player: one <video>, cropped onto 1 or 3 canvases ----------
function makePlayer(src, crops) {
  const v = document.createElement('video');
  Object.assign(v, {src, muted: true, loop: true, playsInline: true, preload: 'auto'});
  const figs = crops.map(([title]) => {
    const f = document.createElement('figure'), cap = document.createElement('figcaption'), cv = document.createElement('canvas');
    cap.textContent = title; cv.width = 848; cv.height = 480; f.append(cap, cv);
    return {f, cv, ctx: cv.getContext('2d')};
  });
  const rows = Math.max(...crops.map(c => c[1])) + 1;
  const total = () => Math.max(1, Math.round((v.duration || 2.7) * FPS));
  const frame = () => Math.min(total() - 1, Math.floor(v.currentTime * FPS + 1e-3));
  const draw = () => {
    if (v.readyState < 2) return;
    const h = v.videoHeight / rows;
    figs.forEach((g, i) => g.ctx.drawImage(v, 0, crops[i][1] * h, v.videoWidth, h, 0, 0, 848, 480));
    $('frame').textContent = `帧 ${frame() + 1} / ${total()}`;
    $('scrub').max = total() - 1; $('scrub').value = frame();
    $('play').textContent = v.paused ? '播放' : '暂停';
  };
  let alive = true;
  const loop = () => {
    if (!alive) return;
    draw();
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(loop); else requestAnimationFrame(loop);
  };
  v.addEventListener('loadeddata', () => { v.playbackRate = rate; draw(); v.play().catch(() => {}); loop(); });
  ['seeked', 'pause', 'play'].forEach(e => v.addEventListener(e, draw));
  const seek = i => { v.pause(); v.currentTime = (Math.max(0, Math.min(total() - 1, i)) + 0.5) / FPS; };
  return {
    figs: figs.map(g => g.f),
    toggle: () => (v.paused ? v.play() : v.pause()),
    step: d => seek(frame() + d),
    seek,
    setRate: r => { v.playbackRate = r; },
    shot: name => {
      const out = document.createElement('canvas');
      out.width = 848 * figs.length; out.height = 480;
      figs.forEach((g, i) => out.getContext('2d').drawImage(g.cv, 848 * i, 0));
      const a = document.createElement('a'); a.href = out.toDataURL('image/png'); a.download = `${name}_f${String(frame() + 1).padStart(2, '0')}.png`; a.click();
    },
    destroy: () => { alive = false; v.pause(); v.removeAttribute('src'); v.load(); },
  };
}

// ---------- form ----------
function fieldset(q, a, locked, clip) {
  const fs = document.createElement('fieldset');
  if (locked) fs.className = 'locked';
  const lg = document.createElement('legend');
  lg.textContent = q.title;
  if (q.hint) { const s = document.createElement('small'); s.textContent = ' ' + q.hint; lg.append(document.createElement('br'), s); }
  fs.append(lg);
  if (q.area) {
    const p = document.createElement('div'), b = document.createElement('span'), s = document.createElement('small');
    b.className = 'area-value'; b.textContent = clip.area == null ? '无数据' : `${(100 * clip.area).toFixed(0)}%`;
    s.textContent = ` 算好的占比（${clip.area_def}）`;
    p.append(b, s); fs.append(p);
  }
  for (const [v, text] of q.options) {
    const l = document.createElement('label'), i = document.createElement('input');
    l.className = 'opt';
    i.type = q.type === 'radio' ? 'radio' : 'checkbox';
    i.name = q.key; i.value = v; i.disabled = locked;
    i.checked = q.type === 'radio' ? (q.optional ? (a[q.key] || '') === v : a[q.key] === v) : (a[q.key] || []).includes(v);
    l.append(i, document.createTextNode(text));
    fs.append(l);
  }
  return fs;
}
function read(qs, form) {
  const a = {};
  for (const q of qs) {
    if (q.type === 'radio') a[q.key] = form.querySelector(`input[name="${q.key}"]:checked`)?.value ?? (q.optional ? '' : null);
    else a[q.key] = [...form.querySelectorAll(`input[name="${q.key}"]:checked`)].map(i => i.value);
  }
  return a;
}
function textarea(name, placeholder, value, disabled = false) {
  const t = document.createElement('textarea');
  Object.assign(t, {name, placeholder, value: value || '', disabled});
  return t;
}

function render() {
  const c = clips[cursor], l = mine()[c.id] || {}, form = $('form');
  startedAt = Date.now();
  $('clip-title').textContent = `${c.id}  (${cursor + 1} / ${clips.length})`;
  const locked1 = !!l.step1 && !editing1;
  $('step-badge').textContent = !l.step1 ? '第一步 · 只看漂移视频' : editing1 ? '修改第一步' : isClean(c) ? '干净对照' : '第二步 · 三联对照';

  player?.destroy();
  if (!locked1 || isClean(c)) {
    player = makePlayer(c.video, [[isClean(c) && locked1 ? '待检查视频（本段是干净对照，没有注入漂移）' : '漂移视频', 0]]);
    $('panels').className = 'panels one';
    $('hint').textContent = !locked1 ? '只看这一段判断。可用 0.1× / 0.25× / 0.5× 慢放，或用 ← → 逐帧翻看。' :
      '这是混入的干净对照，用来估计误报率，没有第二步。';
  } else {
    player = makePlayer(c.comparison, [['原视频', 1], ['漂移视频', 0], ['差异 ×4', 2]]);
    $('panels').className = 'panels three';
    $('hint').textContent = '三个画面来自同一个文件，逐帧翻看时严格对齐。';
  }
  $('panels').replaceChildren(...player.figs);

  form.replaceChildren();
  const t1 = document.createElement('div'); t1.className = 'section-title'; t1.textContent = '第一步 · 只看漂移视频';
  form.append(t1);
  STEP1.forEach(q => form.append(fieldset(q, l.step1 || {}, locked1, c)));
  form.append(textarea('note1', '备注（可选）', l.note1, locked1));
  if (locked1) {
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'link';
    edit.textContent = l.step1_original ? '再次修改第一步' : '修改第一步';
    edit.onclick = () => {
      if (!confirm('第一步要在没看原视频时判断。你已经看过对照，修改后的答案不再是盲看。\n第一次的答案会原样保留，修改会被记录。确定要修改吗？')) return;
      editing1 = true; render();
    };
    form.append(edit);
  }
  if (locked1 && !isClean(c)) {
    const t2 = document.createElement('div'); t2.className = 'section-title'; t2.textContent = '第二步 · 三联对照';
    form.append(t2);
    const a2 = l.step2 || {};
    if (c.drift_area != null) {
      const info = document.createElement('div'), v = document.createElement('span'), d = document.createElement('small');
      const jump = document.createElement('button');
      info.className = 'area-info'; v.className = 'area-value';
      v.textContent = `漂移面积 ${(100 * c.drift_area).toFixed(1)}%`;
      d.textContent = '画面中挪动 ≥0.6° 的像素占整帧的比例，取各帧最大值';
      jump.type = 'button'; jump.className = 'link'; jump.textContent = `跳到这一帧（第 ${c.drift_frame + 1} 帧）`;
      jump.onclick = () => player?.seek(c.drift_frame);
      info.append(v, document.createElement('br'), d, document.createElement('br'), jump);
      form.append(info);
    }
    for (const q of STEP2) {
      form.append(fieldset(q, a2, false, c));
      if (q.note) form.append(textarea(q.note, q.notePlaceholder, l[q.note]));
    }
    form.append(textarea('note2', '其他备注（可选）', l.note2));
  }
  const act = document.createElement('div'); act.className = 'actions';
  const prev = document.createElement('button'); prev.type = 'button'; prev.className = 'secondary'; prev.textContent = '上一段';
  prev.onclick = () => go(cursor - 1);
  const save = document.createElement('button'); save.type = 'submit';
  save.textContent = editing1 ? '保存第一步的修改' : !l.step1 ? '保存并显示对照' : isClean(c) ? '下一段' : '保存并下一段';
  act.append(prev, save);
  form.append(act);
  form.onchange = e => {
    const q = STEP2.find(x => x.exclusive && x.key === e.target.name);
    if (q && e.target.checked) form.querySelectorAll(`input[name="${q.key}"]`).forEach(i => {
      if (i !== e.target && (i.value === q.exclusive || e.target.value === q.exclusive)) i.checked = false;
    });
  };
  form.onsubmit = e => { e.preventDefault(); submit(); };
  $('status').textContent = '';
  renderList();
}

async function post(clip, label) {
  label.layout = layout;
  if (server) {
    const r = await fetch('/api/label', {method: 'POST', headers: {'Content-Type': 'application/json'},
                                         body: JSON.stringify({rater: rater(), clip, label})});
    if (!r.ok) throw new Error(await r.text());
  }
  label.saved_at = new Date().toISOString();
  (labels[rater()] ||= {})[clip] = label;
  if (!server) localStorage.setItem(STORE, JSON.stringify(labels));
}

async function submit() {
  const c = clips[cursor], l = {...(mine()[c.id] || {})}, form = $('form');
  if (!rater()) { $('status').textContent = '请先在顶部填写标注者名字。'; $('rater').focus(); return; }
  const secs = Math.round((Date.now() - startedAt) / 1000);
  try {
    if (!l.step1 || editing1) {
      const a = read(STEP1, form);
      if (!complete(STEP1, a)) { $('status').textContent = '第一步还没答。'; return; }
      if (editing1) {
        await post(c.id, {...l, step1_original: l.step1_original || l.step1, note1_original: l.note1_original ?? l.note1,
                          step1: a, note1: form.note1.value, step1_edit_count: (l.step1_edit_count || 0) + 1,
                          step1_edited_at: new Date().toISOString()});
        editing1 = false;
      } else {
        await post(c.id, {step1: a, note1: form.note1.value, step1_seconds: secs});
      }
      return render();
    }
    if (isClean(c)) return go(cursor + 1);
    const a = read(STEP2, form);
    const notes = Object.fromEntries(STEP2.filter(q => q.note).map(q => [q.note, form[q.note].value]));
    const missingNote = STEP2.find(q => q.note && q.noteWhen(a[q.key]) && !notes[q.note].trim());
    if (missingNote) { $('status').textContent = `「${missingNote.title}」这一题需要写一句说明。`; return; }
    if (!complete(STEP2, a, notes)) { $('status').textContent = '第二步还有题没答。'; return; }
    await post(c.id, {...l, step2: a, ...notes, note2: form.note2.value, step2_seconds: secs,
                      area_shown: layout === 'v3' ? c.drift_area : c.area});
    go(cursor + 1);
  } catch (err) {
    $('status').textContent = '保存失败：' + err.message;
  }
}

function go(i) { editing1 = false; cursor = Math.max(0, Math.min(clips.length - 1, i)); localStorage.setItem(CURSOR, cursor); render(); }

function renderList() {
  const n = clips.filter(done).length;
  $('progress-text').textContent = `已完成 ${n} / ${clips.length}`;
  $('bar').style.width = `${(100 * n / clips.length).toFixed(1)}%`;
  $('list').replaceChildren(...clips.map((c, i) => {
    const b = document.createElement('button'), l = mine()[c.id];
    b.className = (i === cursor ? 'current ' : '') + (done(c) ? 'done' : '');
    const s = document.createElement('span'); s.className = 's'; s.textContent = done(c) ? '✓' : l?.step1 ? '½' : '';
    b.append(document.createTextNode(c.id), s);
    b.onclick = () => go(i);
    return b;
  }));
}

function setRate(r) {
  rate = r; localStorage.setItem('calib-v3-rate', r);
  document.querySelectorAll('.speed button').forEach(x => x.classList.toggle('on', +x.dataset.rate === r));
  player?.setRate(r);
}
document.querySelectorAll('.speed button').forEach(b => b.onclick = () => setRate(+b.dataset.rate));
$('play').onclick = () => player?.toggle();
$('prev').onclick = () => player?.step(-1);
$('next').onclick = () => player?.step(1);
$('scrub').oninput = e => player?.seek(+e.target.value);
$('shot').onclick = () => player?.shot(clips[cursor].id);
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target.type === 'text')) return;
  if (e.key === 'ArrowLeft' || e.key === ',') { e.preventDefault(); player?.step(-1); }
  else if (e.key === 'ArrowRight' || e.key === '.') { e.preventDefault(); player?.step(1); }
  else if (e.key === ' ') { e.preventDefault(); player?.toggle(); }
});
$('rater').value = localStorage.getItem('calib-rater') || '';
$('rater').onchange = () => { localStorage.setItem('calib-rater', rater()); go(firstOpen()); };
const download = (obj, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], {type: 'application/json'})); a.download = name; a.click();
};
$('export').onclick = () => download({rater: rater(), layout, site, exported_at: new Date().toISOString(), labels: mine()},
                                      `calib_v3_${site}_labels_${layout}_${rater() || 'unnamed'}.json`);
$('export-old').onclick = () => {
  let n = 0;
  for (const [ver, key] of Object.entries(OLD_STORES)) {
    let old = null; try { old = JSON.parse(localStorage.getItem(key)); } catch {}
    if (old && Object.keys(old).length) { n++; download({layout: ver, site, exported_at: new Date().toISOString(), labels: old}, `calib_v3_${site}_labels_${ver}_old.json`); }
  }
  if (!n) $('status').textContent = '这个浏览器里没有旧版标签。';
};
const firstOpen = () => { const i = clips.findIndex(c => !done(c)); return i < 0 ? 0 : i; };

try {
  const r = await fetch('/api/labels');
  if (!r.ok || !(r.headers.get('Content-Type') || '').includes('json')) throw new Error();
  const all = await r.json();
  // the server keeps every layout; only records of this layout count here
  labels = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, x]) => x.layout === layout))]));
} catch {
  server = false;
  try { labels = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { labels = {}; }
  $('store-note').textContent = '标签保存在这个浏览器里（换浏览器或清除网站数据会丢失）。标完请点"导出全部标签"，把 JSON 发给研究者。';
}
setRate(+localStorage.getItem('calib-v3-rate') || 1);
const saved = +localStorage.getItem(CURSOR);
go(Number.isFinite(saved) && saved > 0 && saved < clips.length ? saved : firstOpen());
