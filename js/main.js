import { createScene } from './scene.js';
const { gsap, ScrollTrigger } = window;
gsap.registerPlugin(ScrollTrigger);

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = matchMedia('(max-width: 820px)').matches || matchMedia('(pointer: coarse)').matches;
const params = new URLSearchParams(location.search);
if (RM) document.documentElement.classList.add('rm');

/* ---------- smooth scroll ---------- */
let lenis = null;
if (!RM && window.Lenis) {
  lenis = new window.Lenis({ lerp: MOBILE ? 0.14 : 0.09, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const id = a.getAttribute('href'); if (id.length < 2) return;
  const el = document.querySelector(id); if (!el) return;
  e.preventDefault(); closeMenu();
  lenis ? lenis.scrollTo(el, { offset: id === '#top' ? 0 : -60, duration: 1.6 }) : el.scrollIntoView({ behavior: RM ? 'auto' : 'smooth' });
}));

/* ---------- header / menu ---------- */
const hdr = document.querySelector('.hdr');
const burger = document.querySelector('.hdr__burger'), mnav = document.querySelector('.mnav');
function closeMenu() { mnav.hidden = true; burger.setAttribute('aria-expanded', 'false'); lenis && lenis.start(); }
burger.addEventListener('click', () => {
  const open = mnav.hidden; mnav.hidden = !open; burger.setAttribute('aria-expanded', String(open));
  if (open) { lenis && lenis.stop(); gsap.from('.mnav nav a', { y: 30, opacity: 0, stagger: 0.05, duration: 0.6, ease: 'power3.out' }); } else lenis && lenis.start();
});
ScrollTrigger.create({ start: 80, onUpdate: (s) => hdr.classList.toggle('is-solid', s.scroll() > window.innerHeight * 0.9) });

/* ---------- hero simulation ---------- */
const canvas = document.querySelector('.hero__gl');
const flash = document.querySelector('.hero__flash');
const clockV = document.querySelector('.hud__clock-v'), clockL = document.querySelector('.hud__clock-l');
const phases = [...document.querySelectorAll('.hud__phases li')];
const bar = document.querySelector('.hud__bar i');
const caps = [...document.querySelectorAll('.cap')];
const intro = document.querySelector('.hero__intro');
const tl = document.querySelector('.hud__tl');
let sim = null;
try { sim = createScene(canvas, { mobile: MOBILE, reduced: RM }); } catch (e) { console.warn('WebGL unavailable', e); canvas.style.background = 'radial-gradient(60% 60% at 50% 70%,#2a1206,#05060A)'; }

let target = RM ? 0.17 : 0, cur = target, heroVisible = true;
const fixedP = params.has('p') ? parseFloat(params.get('p')) : null;
if (fixedP !== null) { target = cur = fixedP; }
window.__setP = (p) => { target = cur = p; };
window.__frame = (p, t) => { window.__manual = true; hud(p); if (sim) { const r = sim.update(p, t); flash.style.opacity = (r.fade * 0.92).toFixed(3); } };

if (!RM) {
  ScrollTrigger.create({
    trigger: '#hero', start: 'top top', end: 'bottom bottom',
    onUpdate: (s) => { if (fixedP === null) target = s.progress; },
    onToggle: (s) => (heroVisible = s.isActive || s.progress < 1),
  });
  ScrollTrigger.create({ trigger: '#hero', start: 'top top', end: 'bottom top', onLeave: () => (heroVisible = false), onEnterBack: () => (heroVisible = true) });
}

const pad = (n) => String(Math.floor(n)).padStart(2, '0');
function hud(p) {
  // clock: T-10 → T0 at p=.2, then simulated mission time
  if (p < 0.2) { const s = 10 * (1 - p / 0.2); clockL.textContent = 'T−'; clockV.textContent = `00:00:${pad(Math.ceil(s - 0.001))}`; }
  else { const s = Math.pow((p - 0.2) / 0.8, 1.3) * 560; clockL.textContent = 'T+'; clockV.textContent = `00:${pad(s / 60)}:${pad(s % 60)}`; }
  let ci = 0; phases.forEach((li, i) => { const on = p >= parseFloat(li.dataset.at); li.classList.toggle('on', on); if (on) ci = i; });
  phases.forEach((li, i) => li.classList.toggle('cur', i === ci));
  bar.style.width = (p * 100).toFixed(2) + '%';
  intro.style.opacity = String(Math.max(0, 1 - p / 0.08));
  tl.style.opacity = String(Math.min(1, p / 0.06));
  intro.style.transform = `translateY(${-p * 600}px)`;
  caps.forEach((c) => {
    const a = parseFloat(c.dataset.from), b = parseFloat(c.dataset.to);
    const fi = Math.min(1, Math.max(0, (p - a) / 0.015)), fo = Math.min(1, Math.max(0, (b - p) / 0.015));
    const o = Math.min(fi, fo);
    c.style.opacity = o.toFixed(3);
    c.style.transform = `${MOBILE ? '' : 'translateY(-50%) '}translateX(${(1 - o) * 30}px)`;
  });
}

let last = performance.now(), t0 = last;
function loop(now) {
  requestAnimationFrame(loop);
  if (window.__manual) return;
  if (!heroVisible && fixedP === null) return;
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  cur += (target - cur) * (1 - Math.exp(-dt * (MOBILE ? 10 : 6)));
  if (Math.abs(target - cur) < 1e-5) cur = target;
  hud(cur);
  if (sim) { const r = sim.update(cur, (now - t0) / 1000); flash.style.opacity = (r.fade * 0.92).toFixed(3); }
}
if (RM) { hud(0); intro.style.opacity = 1; if (sim) sim.update(0.17, 1); }
else requestAnimationFrame(loop);
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { sim && sim.resize(); if (RM && sim) sim.update(0.17, 1); }, 120); });

/* ---------- fit long Cyrillic words ---------- */
function fitHeads() {
  document.querySelectorAll('.h-xl,.h-l,.hero__h,.cap__v,.spec__big').forEach((el) => {
    el.style.fontSize = '';
    let s = parseFloat(getComputedStyle(el).fontSize), n = 0;
    while (el.scrollWidth > el.clientWidth + 1 && s > 16 && n++ < 40) { s *= 0.95; el.style.fontSize = s + 'px'; }
  });
}
document.fonts.ready.then(() => { fitHeads(); ScrollTrigger.refresh(); });
addEventListener('resize', () => requestAnimationFrame(fitHeads));

/* ---------- split headings ---------- */
function splitWords(el) {
  const html = el.innerHTML.replace(/&nbsp;/g, '\u00A0');
  const tmp = document.createElement('div'); tmp.innerHTML = html;
  const words = tmp.textContent.split(/ +/);
  el.innerHTML = words.map((w) => `<span class="w"><span>${w}</span></span>`).join(' ');
  return el.querySelectorAll('.w>span');
}
document.querySelectorAll('.split').forEach((el) => {
  const w = splitWords(el);
  if (!RM) gsap.from(w, { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: 0.06, scrollTrigger: { trigger: el, start: 'top 85%' } });
});
const mt = document.querySelector('[data-words]');
if (mt) {
  const html = mt.innerHTML.replace(/&nbsp;/g, '\u00A0'); const d = document.createElement('div'); d.innerHTML = html;
  mt.innerHTML = d.textContent.split(/ +/).map((w) => `<span class="w">${w}</span>`).join(' ');
  if (!RM) gsap.to(mt.querySelectorAll('.w'), { opacity: 1, color: '#E8ECF2', stagger: 0.1, ease: 'none', scrollTrigger: { trigger: mt, start: 'top 80%', end: 'bottom 45%', scrub: true } });
  if (!RM) gsap.to(mt.querySelectorAll('.w:nth-last-child(-n+2)'), { color: '#FF5A1F', scrollTrigger: { trigger: mt, start: 'bottom 50%', end: 'bottom 45%', scrub: true } });
}

/* ---------- reveals ---------- */
if (!RM) {
  gsap.utils.toArray('.lead,.body,.card,.spec,.faq__list details,.gauge,.scope,.phone,.form,.team blockquote,.team__role,.note').forEach((el) => {
    gsap.fromTo(el, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 90%' } });
  });
  gsap.fromTo('.team__photo img', { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: 1.4, ease: 'power3.out', scrollTrigger: { trigger: '.team', start: 'top 70%' } });
  gsap.to('.ftr__mark', { backgroundPosition: '0 0', yPercent: -10, ease: 'none', scrollTrigger: { trigger: '.ftr', start: 'top bottom', end: 'bottom bottom', scrub: true } });
}

/* ---------- gauges ---------- */
const NS = 'http://www.w3.org/2000/svg';
document.querySelectorAll('.gauge').forEach((g) => {
  const ticks = g.querySelector('.gauge__ticks');
  const kind = g.dataset.gauge;
  const n = kind === 'reuse' ? 10 : 25;
  if (ticks) for (let i = 0; i <= n; i++) {
    const a = (i / n) * 270 * Math.PI / 180;
    const r1 = 88, r2 = kind === 'reuse' || i % 5 === 0 ? 98 : 93;
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', 100 + Math.cos(a) * r1); l.setAttribute('y1', 100 + Math.sin(a) * r1);
    l.setAttribute('x2', 100 + Math.cos(a) * r2); l.setAttribute('y2', 100 + Math.sin(a) * r2);
    ticks.appendChild(l);
  }
  const lines = ticks ? [...ticks.children] : [];
  const arc = g.querySelector('.gauge__arc'), needle = g.querySelector('.gauge__needle');
  const num = g.querySelector('[data-count]');
  const full = 367.6;
  const fill = kind === 'mass' ? 0.72 : 1;
  const run = (v) => {
    if (arc) arc.style.strokeDasharray = `${full * fill * v} 490`;
    if (needle) needle.style.transform = `rotate(${-45 + 270 * fill * v}deg)`;
    lines.forEach((l, i) => l.classList.toggle('lit', i / lines.length < fill * v));
    if (num) num.textContent = Math.round(+num.dataset.count * v);
    g.querySelectorAll('.tank i').forEach((t, i) => (t.style.height = `${v * (i ? 88 : 76)}%`));
  };
  if (needle) needle.setAttribute('transform', '');
  if (RM) { run(1); return; }
  run(0);
  const o = { v: 0 };
  gsap.to(o, { v: 1, duration: 2.4, ease: 'power3.inOut', onUpdate: () => run(o.v), scrollTrigger: { trigger: g, start: 'top 80%' } });
});

/* ---------- trajectory ---------- */
const fillPath = document.querySelector('.traj__fill');
const nodes = [...document.querySelectorAll('.node')];
if (RM) { fillPath.style.strokeDashoffset = 0; nodes.forEach((n) => n.classList.add('on')); }
else {
  ScrollTrigger.create({
    trigger: '.traj', start: 'top 60%', end: 'bottom 60%', scrub: true,
    onUpdate: (s) => { fillPath.style.strokeDashoffset = String(1000 * (1 - s.progress)); },
  });
  nodes.forEach((n) => ScrollTrigger.create({ trigger: n, start: 'top 62%', onEnter: () => n.classList.add('on'), onLeaveBack: () => n.classList.remove('on') }));
}

/* ---------- FAQ: one open at a time ---------- */
const dets = document.querySelectorAll('.faq__list details');
dets.forEach((d) => d.addEventListener('toggle', () => { if (d.open) dets.forEach((o) => o !== d && (o.open = false)); setTimeout(() => ScrollTrigger.refresh(), 50); }));

/* ---------- contact form (no backend) ---------- */
const form = document.querySelector('.form');
const PHONE = '+79515869611';
form.addEventListener('submit', (e) => {
  e.preventDefault();
  let ok = true;
  ['name', 'contact'].forEach((k) => { const f = form.elements[k]; const bad = !f.value.trim(); f.closest('.fld').classList.toggle('err', bad); if (bad) ok = false; });
  if (!ok) { form.querySelector('.err input').focus(); return; }
  const txt = `JC SPACE — запрос на связь\nЯ: ${form.elements.who.value}\nИмя: ${form.elements.name.value.trim()}\nКонтакт: ${form.elements.contact.value.trim()}` + (form.elements.msg.value.trim() ? `\nСообщение: ${form.elements.msg.value.trim()}` : '');
  const done = form.querySelector('.form__done');
  done.hidden = false; form.querySelector('.form__out').textContent = txt;
  const sms = `sms:${PHONE}${/iP(hone|ad)/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(txt)}`;
  form.querySelector('.sms-link').href = sms;
  if (MOBILE) location.href = sms;
});
form.querySelector('.copy-btn').addEventListener('click', async (e) => {
  try { await navigator.clipboard.writeText(form.querySelector('.form__out').textContent); e.target.textContent = 'Скопировано ✓'; } catch { e.target.textContent = 'Не удалось'; }
});

addEventListener('load', () => ScrollTrigger.refresh());
