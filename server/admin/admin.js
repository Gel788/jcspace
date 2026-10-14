(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const LANGS = ['ru', 'en', 'zh'], LBL = { ru: 'RU', en: 'EN', zh: '中文' };
  const NAMES = { meta: 'SEO / мета', hero: 'Главный экран', about: 'О нас', specs: 'Цели', mission: 'Миссия', first: 'Первая и единственная', work: 'В работе', team: 'Основатель', creds: 'Компетенции', faq: 'Вопросы', contacts: 'Контакты', contact: 'Партнёрство', footer: 'Подвал', header: 'Шапка', menu: 'Меню', hdr: 'Шапка', img: 'Изображения', page: 'Общее', hdr__nav: 'Навигация в шапке', menu__nav: 'Навигация в меню', tabs: 'Нижняя панель (моб.)', top: 'Цели · заголовок', gives: 'Что даёт миссия', cx: 'Компетенции', ftr: 'Подвал' };
  const PAGE = { ru: '../index.html?ru', en: '../en.html', zh: '../zh.html' };
  let data = null, orig = null, csrf = null, readOnly = false, pl = 'ru';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = (m, err) => { const t = $('#toast'); t.textContent = m; t.className = 'toast on' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'toast'), 3200); };
  const api = async (url, opt = {}) => { const r = await fetch(url, { credentials: 'same-origin', ...opt, headers: { ...(opt.body && !(opt.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(opt.headers || {}) } });
    let j = null; try { j = await r.json(); } catch (e) {} if (!r.ok) { const e = new Error((j && j.error) || r.statusText); e.status = r.status; e.details = j && j.details; throw e; } return j; };

  // ---------- boot
  async function boot() {
    let s = null; try { s = await api('/api/session'); } catch (e) { s = null; }
    if (!s) { readOnly = true; data = await (await fetch('../content.json', { cache: 'no-store' })).json(); return start(); }
    if (!s.user) return showLogin(); csrf = s.csrf; data = await api('/api/content'); start();
  }
  function showLogin() {
    $('#login').hidden = false; $('#app').hidden = true; const f = $('#login form'); setTimeout(() => f.password.focus(), 50);
    f.onsubmit = async (e) => { e.preventDefault(); $('.login__err').textContent = ''; const b = f.querySelector('button'); b.disabled = true;
      try { const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ user: f.user.value, password: f.password.value }) }); csrf = r.csrf; data = await api('/api/content'); $('#login').hidden = true; start(); }
      catch (er) { $('.login__err').textContent = er.status === 429 ? 'Слишком много попыток. Попробуйте через 15 минут.' : 'Неверный логин или пароль'; } finally { b.disabled = false; } };
  }

  // ---------- render editor
  function start() {
    orig = JSON.parse(JSON.stringify(data)); $('#app').hidden = false; $('#ro').hidden = !readOnly; $('#btnOut').hidden = readOnly; $('#btnVers').hidden = readOnly;
    const groups = {}; for (const [k, f] of Object.entries(data.fields)) (groups[f.section] = groups[f.section] || []).push(k);
    const order = ['meta', ...Object.keys(groups).filter((g) => g !== 'meta')];
    let html = '', nav = '';
    for (const g of order) { const keys = groups[g]; if (!keys) continue;
      nav += `<a href="#s-${esc(g)}" data-g="${esc(g)}">${esc(NAMES[g] || g)}<i>${keys.length}</i></a>`;
      html += `<section class="sec" id="s-${esc(g)}" data-g="${esc(g)}"><h2>${esc(NAMES[g] || g)} <small>${keys.length} полей</small></h2>` + keys.map(field).join('') + '</section>'; }
    const imgs = Object.entries(data.images || {});
    if (imgs.length) { nav += `<a href="#s-img" data-g="img">${NAMES.img}<i>${imgs.length}</i></a>`;
      html += `<section class="sec" id="s-img" data-g="img"><h2>${NAMES.img} <small>${imgs.length}</small></h2>` + imgs.map(([k, im]) => `<div class="img" data-img="${k}"><figure><img src="../${esc(im.src)}" alt=""></figure><div><div class="f__h"><code>${k}</code><span class="tag">${esc(im.src)}</span><label class="btn" ${readOnly ? 'hidden' : ''}>Заменить<input type="file" accept="image/jpeg,image/png,image/webp" hidden></label></div><div class="alts">${LANGS.map((l) => `<label><span class="mono">alt ${LBL[l]}</span><input type="text" lang="${l}" data-l="${l}" value="${esc(im.alt[l] || '')}" ${readOnly ? 'readonly' : ''}></label>`).join('')}</div></div></div>`).join('') + '</section>'; }
    $('#side').innerHTML = nav; $('#main').innerHTML = html;
    $$('#main textarea').forEach((t) => { t.addEventListener('input', onEdit); t.addEventListener('focus', () => locate(t.closest('.f').dataset.k)); });
    $$('.img input[type=text]').forEach((i) => i.addEventListener('input', () => { data.images[i.closest('.img').dataset.img].alt[i.dataset.l] = i.value; dirty(); }));
    $$('.img input[type=file]').forEach((i) => i.addEventListener('change', () => upload(i)));
    spy(); setPrev(pl); dirty();
  }
  function field(k) { const f = data.fields[k];
    return `<div class="f" data-k="${esc(k)}"><div class="f__h"><code>${esc(k)}</code><span class="tag">${esc(f.tag)}${f.cls ? '.' + esc(f.cls) : ''}</span></div>` +
      LANGS.map((l) => `<label><span>${LBL[l]}</span><textarea lang="${l === 'zh' ? 'zh-Hans' : l}" data-l="${l}" rows="${Math.min(6, Math.ceil(f[l].length / 46) || 1)}" ${readOnly ? 'readonly' : ''}>${esc(f[l])}</textarea></label>`).join('') + '<p class="f__msg" hidden></p></div>'; }
  function check(k) { const f = data.fields[k], box = $(`.f[data-k="${CSS.escape(k)}"]`); if (!box) return 0; let bad = 0, msg = [];
    for (const l of LANGS) { const t = box.querySelector(`[data-l=${l}]`), v = f[l]; t.classList.remove('bad', 'warn');
      if (!v.trim()) { t.classList.add('bad'); msg.push(`${LBL[l]}: пусто`); bad++; }
      else if (/<\s*(script|iframe|style)|\son\w+=|javascript:/i.test(v)) { t.classList.add('bad'); msg.push(`${LBL[l]}: запрещённая разметка`); bad++; }
      else if ((v.match(/<(b|i|em|strong|span|small|a)\b/gi) || []).length !== (v.match(/<\/(b|i|em|strong|span|small|a)>/gi) || []).length) { t.classList.add('bad'); msg.push(`${LBL[l]}: незакрытый тег`); bad++; }
      else if (l !== 'ru' && f.ru.length > 12 && v.length > f.ru.length * 1.8) { t.classList.add('warn'); msg.push(`${LBL[l]}: заметно длиннее RU — проверьте вёрстку`); } }
    const m = box.querySelector('.f__msg'); m.hidden = !msg.length; m.textContent = msg.join(' · '); box.classList.toggle('chg', LANGS.some((l) => f[l] !== orig.fields[k][l])); return bad; }
  function onEdit(e) { const t = e.target, k = t.closest('.f').dataset.k, l = t.dataset.l; data.fields[k][l] = t.value; check(k); dirty(); if (l === pl) live(k); }
  function changes() { let n = 0; for (const k in data.fields) for (const l of LANGS) if (data.fields[k][l] !== orig.fields[k][l]) n++;
    for (const k in data.images) { if (data.images[k].src !== orig.images[k].src) n++; for (const l of LANGS) if (data.images[k].alt[l] !== orig.images[k].alt[l]) n++; } return n; }
  function dirty() { const n = changes(); $('#dirty').hidden = !n; $('#dirty').textContent = n + ' ' + (n === 1 ? 'изменение' : n < 5 ? 'изменения' : 'изменений'); $('#btnSave').disabled = readOnly || !n;
    $$('.side a').forEach((a) => a.classList.toggle('chg', !!$$(`#s-${CSS.escape(a.dataset.g)} .f.chg`).length)); }

  // ---------- live preview (same origin iframe, no save)
  const doc = () => { try { return $('#frame').contentDocument; } catch (e) { return null; } };
  function live(k) { const d = doc(); if (!d) return; const f = data.fields[k];
    if (k.startsWith('meta.')) return; d.querySelectorAll(`[data-c="${CSS.escape(k)}"]`).forEach((el) => (el.innerHTML = f[pl])); }
  function locate(k) { const d = doc(); const el = d && d.querySelector(`[data-c="${CSS.escape(k)}"]`); if (!el) return; el.scrollIntoView({ block: 'center' }); el.style.outline = '1px solid #ff4d00'; setTimeout(() => (el.style.outline = ''), 1400); }
  function setPrev(l) { pl = l; $$('#pl button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.l === l)); const fr = $('#frame');
    fr.onload = () => { for (const k in data.fields) if (data.fields[k][l] !== orig.fields[k][l]) live(k); }; fr.src = PAGE[l] + (PAGE[l].includes('?') ? '&' : '?') + 't=' + Date.now(); }
  $('#pl').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setPrev(b.dataset.l); });
  $('#btnPrev').onclick = () => { const on = $('#app').classList.toggle('noprev'); $('#btnPrev').setAttribute('aria-pressed', !on); };

  // ---------- nav, search
  function spy() { const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) $$('.side a').forEach((a) => a.classList.toggle('on', a.dataset.g === e.target.dataset.g)); }), { root: $('#main'), rootMargin: '0px 0px -80% 0px' });
    $$('.sec').forEach((s) => io.observe(s)); }
  $('#q').addEventListener('input', (e) => { const q = e.target.value.trim().toLowerCase();
    $$('.f').forEach((b) => { const k = b.dataset.k, f = data.fields[k]; b.hidden = !!q && !(k.toLowerCase().includes(q) || LANGS.some((l) => f[l].toLowerCase().includes(q))); });
    $$('.sec').forEach((s) => (s.hidden = !!q && s.dataset.g !== 'img' && !$$('.f:not([hidden])', s).length)); });

  // ---------- save / versions / upload / logout
  $('#btnSave').onclick = async () => { let bad = 0; for (const k in data.fields) bad += check(k); if (bad) { toast('Исправьте отмеченные поля', true); $('.f .bad').scrollIntoView({ block: 'center' }); return; }
    const b = $('#btnSave'); b.disabled = true; b.textContent = 'Сохраняю…';
    try { await api('/api/content', { method: 'PUT', body: JSON.stringify(data), headers: { 'X-Note': changes() + ' changes' } }); orig = JSON.parse(JSON.stringify(data)); $$('.f.chg').forEach((f) => f.classList.remove('chg')); dirty(); setPrev(pl); toast('Сохранено. Сайт пересобран.'); }
    catch (e) { toast(e.status === 401 ? 'Сессия истекла — войдите снова' : 'Ошибка: ' + e.message + (e.details ? ' — ' + e.details[0] : ''), true); if (e.status === 401) showLogin(); dirty(); }
    finally { b.textContent = 'Сохранить'; } };
  $('#btnVers').onclick = async () => { const v = await api('/api/versions'); $('#vers').hidden = false;
    $('#versList').innerHTML = v.length ? v.map((x) => `<li><div><b>${new Date(x.at || 0).toLocaleString('ru-RU')}</b><span>${esc(x.note || 'сохранение')}</span></div><button class="btn" data-id="${esc(x.id)}">Откатить</button></li>`).join('') : '<li><span>Пока нет сохранённых версий</span></li>'; };
  $('#vers').addEventListener('click', async (e) => { if (e.target.closest('[data-close]')) return ($('#vers').hidden = true); const b = e.target.closest('[data-id]'); if (!b) return;
    if (changes() && !confirm('Несохранённые изменения будут потеряны. Продолжить?')) return; if (!confirm('Вернуть сайт к этой версии? Текущая будет сохранена в истории.')) return;
    try { await api('/api/rollback/' + encodeURIComponent(b.dataset.id), { method: 'POST' }); data = await api('/api/content'); $('#vers').hidden = true; start(); toast('Откат выполнен. Сайт пересобран.'); } catch (er) { toast('Ошибка отката: ' + er.message, true); } });
  async function upload(inp) { const file = inp.files[0]; if (!file) return; if (file.size > 8 * 1024 * 1024) return toast('Файл больше 8 МБ', true);
    const fd = new FormData(); fd.append('file', file); try { const r = await api('/api/upload', { method: 'POST', body: fd }); const box = inp.closest('.img'); data.images[box.dataset.img].src = r.src; box.querySelector('img').src = '../' + r.src; box.querySelector('.tag').textContent = r.src; dirty(); toast('Загружено. Не забудьте сохранить.'); }
    catch (e) { toast('Загрузка: ' + e.message, true); } inp.value = ''; }
  $('#btnOut').onclick = async () => { try { await api('/api/logout', { method: 'POST' }); } catch (e) {} location.reload(); };
  addEventListener('beforeunload', (e) => { if (data && !readOnly && changes()) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (!$('#btnSave').disabled) $('#btnSave').click(); } });
  boot();
})();
