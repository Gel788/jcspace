import * as THREE from 'three';
import { EffectComposer } from '../vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/postprocessing/OutputPass.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (p, a, b) => clamp((p - a) / (b - a));
const sm = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const NOISE = /* glsl */ `
float h31(vec3 p){p=fract(p*0.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vnoise(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);
return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<OCT;i++){s+=a*vnoise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return s;}
`;

/* ---------- flame: volumetric-looking shader plume ---------- */
function flameMaterial(q, opts = {}) {
  return new THREE.ShaderMaterial({
    defines: { OCT: q.mobile ? 3 : 4 },
    uniforms: {
      uTime: { value: 0 }, uI: { value: 0 }, uGain: { value: q.mobile ? 1.7 : 1 }, uLen: { value: opts.len || 8 },
      uR0: { value: opts.r0 || 0.25 }, uR1: { value: opts.r1 || 1.2 },
      uSeed: { value: Math.random() * 50 }, uDiam: { value: opts.diam ?? 1 },
      uVac: { value: 0 }, uHot: { value: new THREE.Color(1.0, 0.86, 0.62) },
      uTail: { value: new THREE.Color(1.0, 0.33, 0.1) },
    },
    vertexShader: /* glsl */ `
      uniform float uLen,uR0,uR1,uTime,uSeed,uVac;
      varying float vT; varying vec3 vN; varying vec3 vV; varying vec3 vL;
      ${NOISE}
      void main(){
        vec3 p=position; float t=clamp(-p.y,0.,1.); vT=t;
        float r=mix(uR0,uR1,pow(t,mix(.55,.4,uVac)))*(1.0+uVac*.9*t);
        r*=1.0-smoothstep(.82,1.0,t)*.55;
        float w=vnoise(vec3(p.x*3.,t*6.-uTime*9.,p.z*3.+uSeed));
        p.xz*=r*(.9+.22*w); p.y*=uLen;
        vL=vec3(p.x/max(uR1,.001),t,p.z/max(uR1,.001));
        vec4 mv=modelViewMatrix*vec4(p,1.);
        vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz);
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime,uI,uSeed,uDiam,uVac,uGain; uniform vec3 uHot,uTail;
      varying float vT; varying vec3 vN; varying vec3 vV; varying vec3 vL;
      ${NOISE}
      void main(){
        float t=vT;
        float rim=pow(abs(dot(normalize(vN),normalize(vV))),1.6);
        float n=fbm(vec3(vL.x*2.2,t*7.-uTime*14.,vL.z*2.2+uSeed));
        float n2=fbm(vec3(vL.x*5.,t*16.-uTime*26.,vL.z*5.-uSeed));
        float body=(1.-smoothstep(mix(.25,.0,uVac),mix(1.,.75,uVac),t+(n-.5)*.7));
        float d=mix(1.,.55+.45*cos(t*38.),uDiam*(1.-smoothstep(.05,.45,t))*(1.-uVac));
        float core=(1.-smoothstep(0.,.32,t))*pow(rim,3.);
        vec3 col=mix(uHot*1.6,uTail,smoothstep(.04,.55,t+(n2-.5)*.3));
        col=mix(col,vec3(.55,.7,1.)*1.2,uVac*.7);
        col+=vec3(1.,.95,.9)*core*3.;
        float a=rim*body*d*(.55+.75*n2);
        gl_FragColor=vec4(col*a*uI*uGain,1.);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
function flameMesh(mat) {
  const g = new THREE.CylinderGeometry(1, 1, 1, 40, 48, true);
  g.translate(0, -0.5, 0);
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

/* ---------- smoke: noise-displaced, soft volumetric shells ---------- */
function smokeMaterial(q) {
  return new THREE.ShaderMaterial({
    defines: { OCT: q.mobile ? 3 : 4 },
    uniforms: { uTime: { value: 0 }, uOp: { value: 0 }, uFire: { value: 0 }, uSeed: { value: Math.random() * 99 },
      uFireY: { value: 0 }, uAmb: { value: new THREE.Color(0.2, 0.22, 0.27) } },
    vertexShader: /* glsl */ `
      uniform float uTime,uSeed; varying vec3 vN,vV,vW; varying float vD;
      ${NOISE}
      void main(){
        vec3 p=position;
        float d=fbm(p*1.3+vec3(uSeed,uSeed*.3,uTime*.06));
        vD=d; p+=normal*(d-.45)*.9;
        vec4 w=modelMatrix*vec4(p,1.); vW=w.xyz;
        vec4 mv=viewMatrix*w; vV=normalize(-mv.xyz); vN=normalize(normalMatrix*normal);
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime,uOp,uFire,uSeed,uFireY; uniform vec3 uAmb; varying vec3 vN,vV,vW; varying float vD;
      ${NOISE}
      void main(){
        float rim=abs(dot(normalize(vN),normalize(vV)));
        float n=fbm(vW*.16+vec3(uSeed,-uTime*.08,uTime*.05));
        float a=pow(smoothstep(.0,.8,rim),1.4)*smoothstep(.38,.72,n+vD*.35-(1.-rim)*.25)*uOp;
        float up=clamp(vN.y*.5+.5,0.,1.);
        vec3 c=uAmb*(.55+1.1*up)+vec3(.16,.17,.2)*n;
        float glow=uFire*exp(-max(vW.y-uFireY,0.)*.09)*(1.-up*.7);
        c+=vec3(1.,.38,.12)*glow*1.1;
        gl_FragColor=vec4(c,a*.82);
      }`,
    transparent: true, depthWrite: false,
  });
}

/* ---------- textures ---------- */
function bodyTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 2048;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 512, 0);
  g.addColorStop(0, '#d9dde4'); g.addColorStop(1, '#eef0f4');
  x.fillStyle = g; x.fillRect(0, 0, 512, 2048);
  for (let i = 0; i < 2048; i += 128) { x.fillStyle = 'rgba(0,0,0,.05)'; x.fillRect(0, i, 512, 2); }
  x.save(); x.translate(300, 1700); x.rotate(-Math.PI / 2);
  x.fillStyle = '#0b0c10'; x.font = '900 118px Unbounded, Arial Black, sans-serif';
  x.fillText('JC SPACE', 0, 0); x.restore();
  x.fillStyle = '#FF5A1F'; x.fillRect(0, 1880, 512, 18);
  x.fillStyle = '#16181d'; x.fillRect(0, 1990, 512, 58);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function concreteTexture(lz) {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#2a2c31'; x.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 9000; i++) { x.fillStyle = `rgba(${Math.random() < .5 ? 0 : 255},${Math.random() < .5 ? 0 : 255},255,${Math.random() * .035})`; x.fillRect(Math.random() * 1024, Math.random() * 1024, 3, 3); }
  x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 3;
  for (let i = 0; i <= 1024; i += 128) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 1024); x.moveTo(0, i); x.lineTo(1024, i); x.stroke(); }
  if (lz) {
    x.strokeStyle = '#e9ecf1'; x.lineWidth = 22; x.beginPath(); x.arc(512, 512, 440, 0, 7); x.stroke();
    x.strokeStyle = '#FF5A1F'; x.lineWidth = 10; x.beginPath(); x.arc(512, 512, 395, 0, 7); x.stroke();
    x.fillStyle = '#e9ecf1'; x.font = '800 300px Unbounded, Arial Black, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('JC', 512, 530);
  } else {
    x.fillStyle = '#0c0d10'; x.fillRect(420, 0, 184, 1024); // flame trench
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/* ---------- rocket ---------- */
function buildRocket(q) {
  const white = new THREE.MeshStandardMaterial({ map: bodyTexture(), roughness: 0.42, metalness: 0.2 });
  const plainWhite = new THREE.MeshStandardMaterial({ color: 0xe7eaef, roughness: 0.45, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x17191f, roughness: 0.55, metalness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9a9fa8, roughness: 0.28, metalness: 0.95, side: THREE.DoubleSide });
  const R = 1.2, seg = q.mobile ? 32 : 64;
  const rocket = new THREE.Group();

  // ----- stage 1 (origin = engine plane)
  const s1 = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 22, seg, 1, true), white);
  body.position.y = 11.6; s1.add(body);
  const oct = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.08, 0.6, seg), dark); oct.position.y = 0.3; s1.add(oct);
  const inter = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 2.4, seg, 1, true), dark); inter.position.y = 23.8; s1.add(inter);
  const bellPts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; bellPts.push(new THREE.Vector2(0.09 + 0.19 * Math.pow(t, 0.7), -t * 0.78)); }
  const bellG = new THREE.LatheGeometry(bellPts, q.mobile ? 16 : 28);
  const engines = [];
  const enginePos = [[0, 0]]; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; enginePos.push([Math.cos(a) * 0.8, Math.sin(a) * 0.8]); }
  const flames1 = [];
  enginePos.forEach(([x, z], i) => {
    const b = new THREE.Mesh(bellG, metal); b.position.set(x, 0, z); s1.add(b); engines.push(b);
    const fm = flameMesh(flameMaterial(q, { len: 5, r0: 0.25, r1: 0.42 })); fm.position.set(x, -0.78, z); s1.add(fm); flames1.push(fm);
  });
  const plume1 = flameMesh(flameMaterial(q, { len: 26, r0: 1.0, r1: 2.8, diam: 0.4 })); plume1.position.y = -0.9; s1.add(plume1);

  // legs
  const legs = [];
  const legMat = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.5, metalness: 0.6 });
  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group(); holder.rotation.y = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const hinge = new THREE.Group(); hinge.position.set(R + 0.04, 1.2, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 7, 0.36), legMat); leg.position.set(0.1, 3.5, 0);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.15, 12), legMat); foot.position.set(0.1, 7, 0);
    hinge.add(leg, foot); holder.add(hinge); s1.add(holder); legs.push(hinge);
  }
  // grid fins
  const fins = [];
  const finTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#fff'; for (let i = 0; i < 64; i += 8) { x.fillRect(i, 0, 2, 64); x.fillRect(0, i, 64, 2); } x.fillRect(0, 0, 64, 4); x.fillRect(0, 60, 64, 4); x.fillRect(0, 0, 4, 64); x.fillRect(60, 0, 4, 64); return new THREE.CanvasTexture(c); })();
  const finMat = new THREE.MeshStandardMaterial({ color: 0x3a3e46, metalness: 0.8, roughness: 0.35, alphaMap: finTex, alphaTest: 0.5, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const holder = new THREE.Group(); holder.rotation.y = (i / 4) * Math.PI * 2;
    const hinge = new THREE.Group(); hinge.position.set(R, 21.9, 0);
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.9), finMat); fin.rotation.x = -Math.PI / 2; fin.position.x = 0.5;
    hinge.add(fin); holder.add(hinge); s1.add(holder); fins.push(hinge);
  }
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,240,220,1)'); g.addColorStop(0.18, 'rgba(255,170,90,.75)'); g.addColorStop(0.5, 'rgba(255,90,31,.18)'); g.addColorStop(1, 'rgba(255,90,31,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const glow1 = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  glow1.position.y = -1.6; s1.add(glow1);
  const boosterLight = new THREE.PointLight(0xff7a33, 0, 120, 1.6); boosterLight.position.y = -4; s1.add(boosterLight);
  rocket.add(s1);

  // ----- stage 2 (origin = its engine plane at y=25)
  const s2 = new THREE.Group(); s2.position.y = 25;
  const b2 = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 6.2, seg, 1, true), plainWhite); b2.position.y = 3.1; s2.add(b2);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.01, R + 0.01, 0.35, seg, 1, true), new THREE.MeshStandardMaterial({ color: 0xff5a1f, emissive: 0x401000, roughness: .5 })); band.position.y = 5.9; s2.add(band);
  const mvacPts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; mvacPts.push(new THREE.Vector2(0.12 + 0.62 * Math.pow(t, 0.75), -t * 1.7)); }
  const mvac = new THREE.Mesh(new THREE.LatheGeometry(mvacPts, q.mobile ? 20 : 36), metal); s2.add(mvac);
  const plume2 = flameMesh(flameMaterial(q, { len: 22, r0: 0.6, r1: 1.3, diam: 0.2 })); plume2.position.y = -1.7; s2.add(plume2);
  // fairing halves
  const fpts = [new THREE.Vector2(R + 0.05, 0)];
  for (let i = 0; i <= 3; i++) fpts.push(new THREE.Vector2(R + 0.05, 0.4 + i));
  for (let i = 1; i <= 14; i++) { const t = i / 14; fpts.push(new THREE.Vector2((R + 0.05) * Math.sqrt(1 - t * t) + 0.02 * (1 - t), 3.4 + t * 4.2)); }
  const fairing = [];
  for (let k = 0; k < 2; k++) {
    const hg = new THREE.Group(); hg.position.y = 6.2;
    const m = new THREE.Mesh(new THREE.LatheGeometry(fpts, q.mobile ? 20 : 36, k * Math.PI, Math.PI), plainWhite);
    m.material = plainWhite.clone(); m.material.side = THREE.DoubleSide;
    hg.add(m); s2.add(hg); fairing.push(hg);
  }
  // payload (hidden inside fairing)
  const payload = new THREE.Group(); payload.position.y = 7.4;
  const bus = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 1.1), new THREE.MeshStandardMaterial({ color: 0xb8933f, metalness: 0.55, roughness: 0.5 }));
  payload.add(bus);
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x1a2a55, metalness: 0.6, roughness: 0.25, emissive: 0x050a1c });
  const panels = [];
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.04, 0.9), panelMat); p.position.x = s * 1.9; p.scale.x = 0.05; payload.add(p); panels.push(p);
  }
  s2.add(payload);
  rocket.add(s2);
  return { rocket, s1, s2, flames1, plume1, plume2, legs, fins, fairing, payload, panels, boosterLight, glow1 };
}

/* ---------- launch tower ---------- */
function buildTower(q) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.7, metalness: 0.5 });
  const H = 44, W = 3;
  const members = [];
  for (const [x, z] of [[0, 0], [W, 0], [0, W], [W, W]]) members.push({ p: [x, H / 2, z], s: [0.22, H, 0.22], r: 0 });
  for (let y = 0; y < H; y += 2.2) {
    members.push({ p: [W / 2, y, 0], s: [W, 0.12, 0.12], r: 0 }, { p: [W / 2, y, W], s: [W, 0.12, 0.12], r: 0 },
      { p: [0, y, W / 2], s: [0.12, 0.12, W], r: 0 }, { p: [W, y, W / 2], s: [0.12, 0.12, W], r: 0 });
    members.push({ p: [W / 2, y + 1.1, 0], s: [0.08, 3.3, 0.08], r: 0.93 }, { p: [W / 2, y + 1.1, W], s: [0.08, 3.3, 0.08], r: -0.93 });
  }
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, members.length);
  const o = new THREE.Object3D();
  members.forEach((m, i) => { o.position.set(...m.p); o.scale.set(...m.s); o.rotation.set(0, 0, m.r); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  g.add(im);
  const arm = new THREE.Group(); arm.position.set(W, 30, W / 2);
  const armMesh = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.5, 0.9), mat); armMesh.position.x = 2.6; arm.add(armMesh); g.add(arm);
  const lamps = [];
  for (let y = 10; y <= H; y += 11) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    l.position.set(W + 0.2, y, 0); g.add(l); lamps.push(l);
  }
  g.position.set(-7.5, 0, -1.5);
  return { tower: g, arm, lamps };
}

function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uAlt: { value: 0 }, uHor: { value: new THREE.Color(0x141a2c) } }, side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vP; void main(){vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: /* glsl */ `uniform float uAlt; uniform vec3 uHor; varying vec3 vP;
      void main(){ float h=vP.y;
        vec3 night=mix(uHor,vec3(.004,.006,.014),smoothstep(0.,.5,h));
        night+=vec3(.22,.1,.05)*exp(-max(h,0.)*18.)*.3*step(0.,h);
        vec3 space=vec3(.002,.003,.008)+vec3(.05,.25,.6)*exp(-abs(h+.08)*30.)*.5;
        vec3 col=mix(night,space,uAlt); col=mix(col,uHor,smoothstep(.0,-.04,h)); gl_FragColor=vec4(col,1.);}`,
  });
}
function stars(n, r) {
  const g = new THREE.BufferGeometry(); const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = new THREE.Vector3().randomDirection(); if (v.y < -0.05) v.y *= -1; v.multiplyScalar(r); a.set([v.x, v.y, v.z], i * 3); }
  g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false }));
}

/* ---------- Earth ---------- */
function buildEarth(q) {
  const g = new THREE.Group();
  const sun = V(-0.55, 0.32, -0.75).normalize();
  const mat = new THREE.ShaderMaterial({
    defines: { OCT: q.mobile ? 4 : 6 },
    uniforms: { uSun: { value: sun }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vN,vW; void main(){ vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uSun; uniform float uTime; varying vec3 vN,vW;
      ${NOISE}
      void main(){
        vec3 n=normalize(vN); vec3 v=normalize(cameraPosition-vW);
        float land=smoothstep(.5,.54,fbm(n*3.2+vec3(2.,7.,1.)));
        float tex=fbm(n*22.);
        vec3 ocean=vec3(.008,.035,.09)+vec3(0,.02,.04)*tex;
        vec3 ground=mix(vec3(.07,.09,.05),vec3(.16,.13,.08),tex);
        vec3 col=mix(ocean,ground,land);
        float cl=smoothstep(.5,.75,fbm(n*7.+vec3(uTime*.004,0,0)));
        float dl=dot(n,uSun); float day=smoothstep(-.12,.25,dl);
        col=mix(col,vec3(.62,.66,.72),cl*.75);
        vec3 h=normalize(uSun+v); float spec=pow(max(dot(n,h),0.),60.)*(1.-land)*(1.-cl);
        vec3 lit=col*(day*.95)+vec3(1.,.9,.75)*spec*.8*day;
        float city=step(.8,vnoise(n*420.))*smoothstep(.45,.75,fbm(n*40.))*land*(1.-cl);
        lit+=vec3(1.,.55,.2)*city*(1.-smoothstep(-.2,.05,dl))*1.6;
        float fr=pow(1.-max(dot(n,v),0.),3.);
        lit+=vec3(.2,.45,1.)*fr*(.1+.55*smoothstep(-.3,.4,dl));
        lit+=vec3(1.,.4,.15)*exp(-abs(dl)*14.)*.12;
        gl_FragColor=vec4(lit,1.);
      }`,
  });
  const R = 600, s = q.mobile ? 96 : 160;
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, s, s / 2), mat); g.add(earth);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, s, s / 2), new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sun } }, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN,vW; void main(){ vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vN,vW; void main(){ vec3 v=normalize(cameraPosition-vW); float f=pow(clamp(1.-abs(dot(vN,v))*1.0,0.,1.),2.2)*0.0+pow(max(dot(-vN,v),0.),5.);
      float d=smoothstep(-.4,.5,dot(-vN,-uSun)*-1.); vec3 c=mix(vec3(.15,.4,1.),vec3(1.,.55,.3),.25*exp(-abs(dot(vN,uSun))*6.));
      gl_FragColor=vec4(c*f*1.6*(.25+.75*d),1.);}`,
  }));
  g.add(atmo);
  g.position.set(0, -R - 70, 0);
  return { earth: g, mat, sun };
}

/* ========================================================== */
export function createScene(canvas, opts) {
  const q = { mobile: opts.mobile };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !q.mobile, powerPreference: 'high-performance' });
  const dpr = q.mobile ? Math.min(window.devicePixelRatio, 1.25) : Math.min(window.devicePixelRatio, 1.75);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 6000);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x141a2c, 0.0042);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial()); scene.add(sky);
  const fogBase = new THREE.Color(0x141a2c), fogSpace = new THREE.Color().setRGB(0.002, 0.003, 0.008);
  sky.material.uniforms.uHor.value = scene.fog.color;
  const starField = stars(q.mobile ? 900 : 2200, 2800); scene.add(starField);

  scene.add(new THREE.HemisphereLight(0x3a4a70, 0x0a0a0c, 0.75));
  const rim = new THREE.DirectionalLight(0xffd2b0, 0); scene.add(rim, rim.target);
  const moon = new THREE.DirectionalLight(0xa9bcff, 1.3); moon.position.set(-60, 90, 40); scene.add(moon);
  const floods = [];
  const floodPos = q.mobile ? [[34, 26]] : [[34, 26], [-30, 30], [10, -38]];
  floodPos.forEach(([x, z]) => {
    const s = new THREE.SpotLight(0xdfe8ff, 900, 140, 0.28, 0.6, 1.6); s.position.set(x, 26, z); s.target.position.set(0, 16, 0);
    scene.add(s, s.target); floods.push(s);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 26, 8), new THREE.MeshStandardMaterial({ color: 0x30333a })); pole.position.set(x, 13, z); scene.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 0.5), new THREE.MeshBasicMaterial({ color: 0xf2f6ff })); lamp.position.set(x, 26.2, z); lamp.lookAt(0, 16, 0); scene.add(lamp);
    // volumetric beam
    const len = Math.hypot(x, 10, z);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(7, len, 24, 1, true), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying float vY; varying vec3 vN,vV; void main(){ vY=uv.y; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying float vY; varying vec3 vN,vV; void main(){ float r=pow(abs(dot(vN,vV)),2.); gl_FragColor=vec4(vec3(.55,.65,.9)*r*vY*.05,1.); }`,
    }));
    beam.position.set(x / 2, 21, z / 2); beam.lookAt(0, 16, 0); beam.rotateX(-Math.PI / 2); scene.add(beam);
  });

  const ground = new THREE.Mesh(new THREE.CircleGeometry(2900, 64), new THREE.MeshStandardMaterial({ color: 0x0b0d11, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; scene.add(ground);
  const padTex = concreteTexture(false);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(46, 3, 46), [0, 0, 1, 0, 0, 0].map((k) => new THREE.MeshStandardMaterial(k ? { map: padTex, roughness: 0.85 } : { color: 0x22252b, roughness: 0.9 })));
  pad.position.y = -1.5; scene.add(pad);
  const lz = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 0.4, 64), [new THREE.MeshStandardMaterial({ color: 0x1d2025 }), new THREE.MeshStandardMaterial({ map: concreteTexture(true), roughness: 0.85 }), new THREE.MeshStandardMaterial({ color: 0x1d2025 })]);
  const LZ = V(-150, 0, 70);
  lz.position.set(LZ.x, -0.1, LZ.z); scene.add(lz);
  const lzLights = new THREE.Group();
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffd9a0 })); m.position.set(LZ.x + Math.cos(a) * 23, 0.35, LZ.z + Math.sin(a) * 23); lzLights.add(m); }
  scene.add(lzLights);
  // distant site lights
  const far = new THREE.Group();
  for (let i = 0; i < (q.mobile ? 60 : 160); i++) { const a = Math.random() * Math.PI * 2, r = 300 + Math.random() * 900; const m = new THREE.Mesh(new THREE.SphereGeometry(0.6 + Math.random(), 6, 6), new THREE.MeshBasicMaterial({ color: Math.random() < 0.7 ? 0xffc27a : 0xbfd4ff, fog: false })); m.position.set(Math.cos(a) * r, 1, Math.sin(a) * r); far.add(m); }
  scene.add(far);

  const { tower, arm, lamps } = buildTower(q); scene.add(tower);
  const R = buildRocket(q); scene.add(R.rocket);
  const padLight = new THREE.PointLight(0xff6a2a, 0, 220, 1.4); padLight.position.set(0, 2, 0); scene.add(padLight);

  // smoke clouds
  const smokeGeo = new THREE.IcosahedronGeometry(1, q.mobile ? 3 : 4);
  const puffs = [];
  const nP = q.mobile ? 10 : 26;
  for (let i = 0; i < nP; i++) {
    const m = new THREE.Mesh(smokeGeo, smokeMaterial(q)); m.renderOrder = 2; scene.add(m);
    const side = i % 2 ? 1 : -1;
    puffs.push({ m, side, ang: Math.random() * 0.8, delay: (i / nP) * 0.06, dist: 25 + Math.random() * 50, sc: 5 + Math.random() * 8, lift: 3 + Math.random() * 10 });
  }
  const lzPuffs = [];
  for (let i = 0; i < (q.mobile ? 4 : 8); i++) {
    const m = new THREE.Mesh(smokeGeo, smokeMaterial(q)); m.renderOrder = 2; scene.add(m);
    lzPuffs.push({ m, a: (i / 8) * Math.PI * 2 + Math.random(), d: 10 + Math.random() * 18, sc: 5 + Math.random() * 6 });
  }

  /* ----- orbit scene ----- */
  const oScene = new THREE.Scene();
  oScene.add(stars(q.mobile ? 1200 : 3000, 2800));
  const E = buildEarth(q); oScene.add(E.earth);
  const sunL = new THREE.DirectionalLight(0xfff3e0, 2.6); sunL.position.copy(E.sun).multiplyScalar(100); oScene.add(sunL);
  oScene.add(new THREE.AmbientLight(0x223355, 0.35));
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(18, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 4) }));
  sunDisc.position.copy(E.sun).multiplyScalar(2400); oScene.add(sunDisc);
  const orbitStage = buildRocket(q);
  orbitStage.s1.visible = false; orbitStage.s2.position.y = 0;
  const oRocket = new THREE.Group(); oRocket.add(orbitStage.s2); oScene.add(oRocket);
  oRocket.rotation.z = -Math.PI / 2; // flying horizontally along +x
  // orbit path line (SSO-ish ring) seen as glowing teal arc
  const ringPts = []; const rr = 670; for (let i = 0; i <= 256; i++) { const a = (i / 256) * Math.PI * 2; ringPts.push(V(Math.cos(a) * rr, Math.sin(a) * rr, 0)); }
  const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
  const ringMat = new THREE.LineDashedMaterial({ color: 0x38f2c3, dashSize: 6, gapSize: 5, transparent: true, opacity: 0 });
  const ring = new THREE.Line(ringGeo, ringMat); ring.computeLineDistances(); ring.position.copy(E.earth.position); ring.rotation.y = 0.0; oScene.add(ring);

  /* ----- post ----- */
  let composer = null, bloom = null, renderPass = null;
  if (!q.mobile) {
    composer = new EffectComposer(renderer);
    renderPass = new RenderPass(scene, camera); composer.addPass(renderPass);
    bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.85, 0.55, 0.82); composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    if (composer) { composer.setSize(w, h); composer.setPixelRatio(dpr); }
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 64 : camera.aspect < 1.2 ? 52 : 40;
    camera.updateProjectionMatrix();
  }
  resize();
  try { renderer.compile(scene, camera); renderer.compile(oScene, camera); } catch (e) {}

  /* ----- state per progress ----- */
  const tmp = V(0, 0, 0), look = V(0, 0, 0), camPos = V(0, 0, 0);
  const shake = V(0, 0, 0);
  let fade = 0;
  const allFlames = [...R.flames1, R.plume1, R.plume2, ...orbitStage.flames1, orbitStage.plume1, orbitStage.plume2];

  function ascentY(p) { const t = seg(p, 0.2, 0.47); return Math.pow(t, 2.3) * 620; }
  function rocketPos(p, out) { const y = ascentY(p); out.set(Math.pow(y / 620, 2) * 140, y, -Math.pow(y / 620, 2) * 20); return out; }

  function update(p, time) {
    const portrait = camera.aspect < 0.8;
    const k = portrait ? 1.5 : camera.aspect < 1.2 ? 1.2 : 1;
    const ox = camera.aspect > 1.2 ? 9 : 0;
    for (const f of allFlames) f.material.uniforms.uTime.value = time;

    // ---- ignition & thrust
    const ign = sm(seg(p, 0.13, 0.19));
    const meco = 1 - sm(seg(p, 0.42, 0.435));
    const thrust1 = ign * meco;
    const altN = clamp(ascentY(p) / 620);
    R.flames1.forEach((f, i) => { const s = sm(seg(p, 0.13 + (i % 3) * 0.008, 0.17 + (i % 3) * 0.008)) * meco; f.material.uniforms.uI.value = s * lerp(1.3, 0.6, altN); f.scale.set(1, lerp(0.4, 1.0, s), 1); f.material.uniforms.uVac.value = altN; });
    R.plume1.material.uniforms.uI.value = thrust1 * lerp(1.2, 0.3, Math.sqrt(altN));
    R.plume1.material.uniforms.uVac.value = altN;
    R.plume1.scale.set(lerp(1, 1.7, altN), lerp(0.35, 1.25, ign) * lerp(1, 1.8, altN), lerp(1, 1.7, altN));

    // ---- separation
    const sep = seg(p, 0.435, 0.52);
    const s2ign = sm(seg(p, 0.455, 0.47));
    rocketPos(Math.min(p, 0.435), tmp);
    const sepPos = tmp.clone();
    // stage 2 position (continues up & downrange)
    const s2World = V(0, 0, 0);
    if (p < 0.435) { R.rocket.position.copy(rocketPos(p, V(0, 0, 0))); R.s1.position.set(0, 0, 0); R.s2.position.set(0, 25, 0); R.s1.rotation.set(0, 0, 0); R.rocket.rotation.set(0, 0, 0); }
    else {
      R.rocket.position.copy(sepPos); R.rocket.rotation.set(0, 0, 0);
      const t = p - 0.435;
      R.s2.position.set(t * 260, 25 + 6 * sm(seg(p, 0.435, 0.455)) + Math.max(0, t - 0.02) * t * 9000, 0);
    }
    R.plume2.material.uniforms.uI.value = s2ign * 0.75; R.plume2.material.uniforms.uVac.value = 1;
    R.plume2.scale.set(1, lerp(0.3, 1, s2ign), 1);
    R.s2.visible = p < 0.6;

    // ---- booster return
    let boosterThrust = 0, boosterCount = 0;
    if (p >= 0.435) {
      const flip = sm(seg(p, 0.47, 0.53)) - sm(seg(p, 0.585, 0.63));
      R.s1.rotation.z = flip * 1.75;
      const u = seg(p, 0.5, 0.745);
      const P0 = V(0, 0, 0), P1 = V(-30, 70, 10), P2 = V(LZ.x - sepPos.x, 250 - sepPos.y, LZ.z - sepPos.z), P3 = V(LZ.x - sepPos.x, 4.5 - sepPos.y, LZ.z - sepPos.z);
      const e = easeOut(Math.pow(u, 1.15));
      const b = new THREE.CubicBezierCurve3(P0, P1, P2, P3).getPoint(e);
      R.s1.position.copy(b);
      if (p > 0.5 && p < 0.565) { boosterThrust = sm(seg(p, 0.505, 0.515)) * (1 - sm(seg(p, 0.555, 0.565))); boosterCount = 3; }
      if (p > 0.635 && p < 0.665) { boosterThrust = sm(seg(p, 0.635, 0.64)) * (1 - sm(seg(p, 0.66, 0.665))); boosterCount = 3; }
      if (p > 0.695 && p < 0.75) { boosterThrust = sm(seg(p, 0.695, 0.7)) * (1 - sm(seg(p, 0.742, 0.748))); boosterCount = 1; }
      R.flames1.forEach((f, i) => { const on = i < boosterCount ? boosterThrust : 0; f.material.uniforms.uI.value = Math.max(f.material.uniforms.uI.value, on * 1.3); f.scale.set(1, lerp(0.4, 1.2, on), 1); f.material.uniforms.uVac.value = 0.3; });
      R.plume1.material.uniforms.uI.value = Math.max(R.plume1.material.uniforms.uI.value, boosterThrust * (boosterCount === 1 ? 0.45 : 0.7));
      R.plume1.scale.set(boosterCount === 1 ? 0.7 : 1.3, Math.max(0.02, boosterThrust * (boosterCount === 1 ? 0.5 : 0.9)), boosterCount === 1 ? 0.7 : 1.3);
    }
    const bw0 = V(0, 0, 0); R.s1.getWorldPosition(bw0);
    const legD = sm(seg(p, 0.685, 0.72));
    R.legs.forEach((h) => (h.rotation.z = -legD * 2.55));
    const finD = sm(seg(p, 0.48, 0.51));
    R.fins.forEach((h) => (h.rotation.z = (1 - finD) * Math.PI / 2));
    R.boosterLight.intensity = (thrust1 + boosterThrust) * 400;
    const gI = Math.max(thrust1 * (1 - altN * 0.6), boosterThrust * 0.8);
    R.glow1.material.opacity = Math.min(1, gI * (q.mobile ? 1 : 0.55));
    R.glow1.scale.setScalar(lerp(8, 18, gI) * (q.mobile ? 1.2 : 1));
    R.glow1.visible = gI > 0.01;

    // ---- environment lights
    const hi = clamp((Math.max(R.rocket.position.y, bw0.y) - 150) / 300);
    rim.intensity = hi * 2.2; rim.position.set(camera.position.x - 200, camera.position.y + 120, camera.position.z - 300); rim.target.position.copy(camera.position);
    padLight.intensity = thrust1 * 2600 * (1 - sm(seg(ascentY(p), 0, 160) )) + (p > 0.69 ? boosterThrust * 1800 : 0);
    padLight.position.set(p > 0.6 ? LZ.x : 0, 2, p > 0.6 ? LZ.z : 0);
    floods.forEach((s) => (s.intensity = 900 * (1 - ign * 0.4)));
    arm.rotation.y = -sm(seg(p, 0.06, 0.12)) * 1.4;
    lamps.forEach((l, i) => (l.material.color.setScalar(0).r = ((time * 1.2 + i * 0.3) % 1 < 0.5 ? 1 : 0.15)));
    sky.material.uniforms.uAlt.value = sm(clamp(R.rocket.position.y / 520 + (p > 0.435 ? 0 : 0)) ) * (p > 0.5 ? clamp(1 - seg(p, 0.55, 0.68)) : 1);
    const al = sky.material.uniforms.uAlt.value;
    scene.fog.density = lerp(0.0042, 0.0048, al);
    scene.fog.color.lerpColors(fogBase, fogSpace, al);

    // ---- smoke
    const sAge = seg(p, 0.13, 0.42);
    puffs.forEach((pf, i) => {
      const s = clamp((sAge - pf.delay) / 0.75);
      const d = 6 + easeOut(s) * pf.dist;
      pf.m.position.set(pf.side * d * Math.cos(pf.ang), -1 + pf.lift * easeOut(s) + s * s * 10, -Math.abs(d * Math.sin(pf.ang)) * 1.6 - 4);
      const sc = (2 + easeOut(s) * pf.sc) * (0.8 + 0.6 * s);
      pf.m.scale.set(sc * 1.3, sc * 0.85, sc);
      const u = pf.m.material.uniforms; u.uTime.value = time; u.uOp.value = sm(clamp(s * 5)) * (1 - sm(seg(p, 0.5, 0.6))); u.uFire.value = thrust1 * (1 - altN * 2); u.uFireY.value = -2;
      pf.m.visible = u.uOp.value > 0.005;
    });
    const lAge = seg(p, 0.71, 0.8);
    lzPuffs.forEach((pf) => {
      const s = easeOut(lAge); const d = 4 + s * pf.d;
      pf.m.position.set(LZ.x + Math.cos(pf.a) * d, 0.5 + s * 3, LZ.z + Math.sin(pf.a) * d);
      const sc = 1 + s * pf.sc; pf.m.scale.set(sc * 1.4, sc * 0.7, sc * 1.4);
      const u = pf.m.material.uniforms; u.uTime.value = time; u.uOp.value = sm(clamp(lAge * 6)) * (1 - sm(seg(p, 0.77, 0.8))) * 0.9; u.uFire.value = boosterThrust; u.uFireY.value = 0;
      pf.m.visible = u.uOp.value > 0.005;
    });

    // ---- camera
    const bw = V(0, 0, 0); R.s1.getWorldPosition(bw);
    if (p < 0.13) {
      const t = easeInOut(seg(p, 0, 0.13));
      const kk = portrait ? 1.15 : k;
      camPos.set(lerp(70, 30, t) * kk, lerp(10, 3.5, t), lerp(85, 40, t) * kk);
      look.set(-ox, lerp(20, 15, t) - (portrait ? 12 : 0), 0);
    } else if (p < 0.2) {
      const t = easeInOut(seg(p, 0.13, 0.2));
      const kk = portrait ? lerp(1.15, 1.5, t) : k;
      camPos.set(lerp(30, 24, t) * kk, lerp(3.5, 1.5, t), lerp(40, 30, t) * kk);
      look.set(-ox * (1 - t), lerp(15, 9, t) - (portrait ? lerp(12, 0, t) : 0), 0);
    } else if (p < 0.435) {
      const rp = R.rocket.position;
      const ground = V(24 * k, 1.5, 30 * k);
      const chase = V(rp.x + 44 * k, rp.y + 20, rp.z + 82 * k);
      const t = sm(seg(p, 0.235, 0.3));
      camPos.lerpVectors(ground, chase, t);
      look.set(rp.x, rp.y + lerp(9, 13, t), rp.z);
    } else if (p < 0.52) {
      const t = sm(seg(p, 0.435, 0.52));
      const s2w = V(0, 0, 0); R.s2.getWorldPosition(s2w);
      camPos.set(sepPos.x + lerp(22, 30, t) * k, sepPos.y + lerp(10, 34, t), sepPos.z + lerp(34, 28, t) * k);
      look.lerpVectors(V(sepPos.x, sepPos.y + 22, sepPos.z), bw.clone().add(V(0, 8, 0)), t);
    } else if (p < 0.68) {
      camPos.set(bw.x + 26 * k, bw.y + 12, bw.z + 30 * k);
      look.set(bw.x, bw.y + 8, bw.z);
    } else {
      const t = sm(seg(p, 0.68, 0.72));
      const follow = V(bw.x + 26 * k, bw.y + 12, bw.z + 30 * k);
      const groundCam = V(LZ.x + 34 * k, 3, LZ.z + 46 * k);
      camPos.lerpVectors(follow, groundCam, t);
      look.lerpVectors(V(bw.x, bw.y + 8, bw.z), V(LZ.x, Math.max(bw.y, 0) + 9, LZ.z), t);
      camPos.x += seg(p, 0.75, 0.8) * 6;
    }
    look.x += ox * 1.5 * sm(seg(p, 0.2, 0.28)) * (1 - sm(seg(p, 0.76, 0.79)));
    const sk = (thrust1 * (1 - altN) * 0.25 + (p > 0.69 ? boosterThrust * 0.08 : 0)) * (opts.reduced ? 0 : 1);
    shake.set(Math.sin(time * 61) * sk, Math.sin(time * 47 + 1) * sk, Math.sin(time * 53 + 2) * sk);
    camera.position.copy(camPos).add(shake);
    camera.lookAt(look);

    // ---- orbit phase
    const orbit = p >= 0.79;
    fade = sm(seg(p, 0.765, 0.79)) * (1 - sm(seg(p, 0.79, 0.815)));
    if (orbit) {
      const t = seg(p, 0.79, 1);
      const S = orbitStage;
      const seco = 1 - sm(seg(p, 0.84, 0.85));
      S.plume2.material.uniforms.uI.value = seco * 0.45; S.plume2.material.uniforms.uVac.value = 1;
      const fsep = sm(seg(p, 0.86, 0.9));
      S.fairing.forEach((h, i) => { const s = i ? 1 : -1; h.position.set(0, 6.2 + fsep * 3, s * fsep * 3); h.rotation.x = s * fsep * 0.9; h.children[0].material.opacity = 1; });
      const psep = sm(seg(p, 0.9, 0.97));
      S.payload.position.set(0, 7.4 + psep * 9, 0);
      S.payload.rotation.y = psep * 0.8;
      S.panels.forEach((pn) => { pn.scale.x = lerp(0.05, 1, sm(seg(p, 0.93, 0.98))); });
      oRocket.position.set(t * 40, 0, 0);
      E.earth.rotation.z = t * 0.06;
      E.mat.uniforms.uTime.value = time;
      ringMat.opacity = sm(seg(p, 0.88, 0.96)) * 0.8;
      const ang = lerp(-0.4, 0.75, easeInOut(t));
      const dist = lerp(20, 40, easeInOut(seg(p, 0.86, 1))) * k;
      const center = oRocket.position.clone().add(V(4, 0, 0));
      camera.position.set(center.x + Math.sin(ang) * dist, center.y + lerp(4, 10, t), center.z + Math.cos(ang) * dist);
      camera.lookAt(center.x + (camera.aspect > 1.2 ? 4 : 0), center.y - (portrait ? 6 : 2), center.z);
    }

    for (const f of allFlames) f.visible = f.material.uniforms.uI.value > 0.004;
    // ---- render
    const target = orbit ? oScene : scene;
    if (composer) {
      renderPass.scene = target;
      bloom.strength = orbit ? 0.3 : 0.85; bloom.threshold = orbit ? 0.95 : 0.82;
      composer.render();
    } else renderer.render(target, camera);
    return { fade, thrust: thrust1 };
  }
  return { update, resize, renderer };
}
