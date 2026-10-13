(() => {
  const { gsap, ScrollTrigger } = window; gsap.registerPlugin(ScrollTrigger);
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOB = matchMedia('(max-width: 720px)').matches;
  if (RM) document.documentElement.classList.add('rm');

  let lenis = null;
  if (!RM && window.Lenis) {
    lenis = new Lenis({ lerp: 0.085 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000)); gsap.ticker.lagSmoothing(0);
  }

  /* ---------- frame sequence ---------- */
  const cv = document.querySelector('.hero__seq'), cx = cv.getContext('2d');
  const loadEl = document.querySelector('.hero__load'), loadPct = loadEl.querySelector('b');
  let N = 0, frames = [], cur = 0, want = 0, path = '';
  function size() {
    const d = Math.min(devicePixelRatio || 1, MOB ? 2 : 1.5);
    cv.width = Math.round(cv.clientWidth * d); cv.height = Math.round(cv.clientHeight * d); draw(true);
  }
  function nearest(i) { for (let k = 0; k < N; k++) { if (frames[i - k]?.ok) return frames[i - k]; if (frames[i + k]?.ok) return frames[i + k]; } return null; }
  let lastDrawn = -1;
  function draw(force) {
    const f = nearest(Math.round(cur)); if (!f) return;
    if (!force && f === lastDrawn) return; lastDrawn = f;
    const W = cv.width, H = cv.height, iw = f.img.naturalWidth, ih = f.img.naturalHeight;
    cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H);
    let s = MOB ? Math.max(W / iw, H / ih) : Math.max(H / ih * 1.04, W / iw * 0.0);
    if (!MOB && iw * s < W * 0.62) s = W * 0.62 / iw;
    const dw = iw * s, dh = ih * s, dx = (W - dw) / 2, dy = MOB ? (H - dh) / 2 : H - dh;
    cx.drawImage(f.img, dx, dy, dw, dh);
    if (!MOB && dw < W) { // feather edges into black
      for (const [x0, dir] of [[dx, 1], [dx + dw, -1]]) {
        const g = cx.createLinearGradient(x0, 0, x0 + dir * dw * 0.18, 0);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        cx.fillStyle = g; cx.fillRect(Math.min(x0, x0 + dir * dw * 0.18), 0, dw * 0.18, H);
      }
    }
    const v = cx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.6)'); cx.fillStyle = v; cx.fillRect(0, 0, W, H);
  }
  function load(manifest) {
    N = manifest.count; path = MOB ? manifest.m : manifest.d;
    frames = new Array(N);
    const order = []; const seen = new Set();
    for (const step of [N, 16, 8, 4, 2, 1]) for (let i = 0; i < N; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); }
    let done = 0, firstShown = false;
    const next = () => {
      const i = order.shift(); if (i === undefined) return;
      const img = new Image(); img.decoding = 'async';
      img.src = path.replace('%04d', String(i + 1).padStart(4, '0'));
      const fr = { img, ok: false }; frames[i] = fr;
      img.onload = img.onerror = () => {
        fr.ok = img.naturalWidth > 0; done++;
        loadPct.textContent = Math.round(done / N * 100) + '%';
        if (!firstShown && fr.ok) { firstShown = true; draw(true); }
        if (done >= Math.min(N, 12)) loadEl.classList.add('done');
        draw(true); next();
      };
    };
    for (let k = 0; k < 6; k++) next();
  }
  fetch('seq/manifest.json').then((r) => r.json()).then((m) => { load(m); size(); });
  addEventListener('resize', size);

  /* ---------- scroll choreography ---------- */
  const clockI = document.querySelector('.hud__clock i'), clockB = document.querySelector('.hud__clock b'), bar = document.querySelector('.hud__bar i');
  const pad = (n) => String(Math.floor(n)).padStart(2, '0');
  const IGN = 12 / 96, LIFT = 46 / 96;
  function hud(p) {
    const T = (p - LIFT) * 30; // simulated seconds around liftoff
    if (T < 0) { clockI.textContent = 'T−'; clockB.textContent = `00:00:${pad(Math.min(10, -T + 0.999))}`; }
    else { clockI.textContent = 'T+'; clockB.textContent = `00:00:${pad(T)}`; }
    bar.style.width = (p * 100).toFixed(1) + '%';
  }
  gsap.from('.mega .ln>span', { yPercent: 105, duration: 1.4, ease: 'expo.out', stagger: 0.09, delay: 0.3 });
  if (RM) { hud(0); return; }

  const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom bottom', scrub: true,
    onUpdate: (s) => { want = s.progress * (N - 1); hud(s.progress); } } });
  tl.to('.mega .ln:nth-child(1)>span', { yPercent: -110, duration: 0.06 }, 0.05)
    .to('.mega .ln:nth-child(2)>span', { yPercent: -110, duration: 0.06 }, 0.07)
    .to('.mega .ln:nth-child(3)>span', { yPercent: -110, duration: 0.06 }, 0.09)
    .to('.st--2', { opacity: 1, duration: 0.04 }, 0.14)
    .from('.big-num b', { yPercent: 40, duration: 0.12 }, 0.14)
    .to('.st--2', { opacity: 0, duration: 0.05 }, 0.42)
    .to('.st--3', { opacity: 1, duration: 0.04 }, 0.5)
    .to('.wordmark span', { yPercent: 0, duration: 0.2 }, 0.52)
    .from('.lede', { yPercent: 40, opacity: 0, duration: 0.1 }, 0.55)
    .to({}, { duration: 0.2 }, 0.8);

  gsap.ticker.add(() => { const d = want - cur; if (Math.abs(d) > 0.01) { cur += d * 0.22; draw(); } });
})();
