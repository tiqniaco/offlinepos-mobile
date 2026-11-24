import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
const require = createRequire('/home/user/offlinepos-mobile/node_modules/');
const { chromium } = require('playwright');
const F = '/home/user/offlinepos-mobile/node_modules/@expo-google-fonts/ibm-plex-sans-arabic';
const font = (w, n) => `@font-face{font-family:P;font-weight:${w};src:url(data:font/ttf;base64,${readFileSync(`${F}/${n}/IBMPlexSansArabic_${n}.ttf`).toString('base64')})}`;
const css = font(700, '700Bold') + font(500, '500Medium');
const lang = process.argv[2]; // ar | en
const shots = JSON.parse(readFileSync('shots.json', 'utf8'));
mkdirSync(`out/${lang}`, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1320, height: 2868 }, deviceScaleFactor: 1 });
let i = 0;
for (const s of shots) {
  i++;
  const img = readFileSync(`raw/${s.file}.png`).toString('base64');
  const dark = !!s.dark;
  const html = `<!doctype html><html dir="ltr"><head><style>${css}
  *{margin:0;box-sizing:border-box}html{overflow:hidden;width:1320px;height:2868px}
  body{width:1320px;height:2868px;overflow:hidden;font-family:P,sans-serif;position:relative;
    background:${dark ? 'linear-gradient(160deg,#0B1F4D 0%,#101828 70%)' : 'linear-gradient(165deg,#0F4CC7 0%,#0866FF 55%,#0080F9 100%)'}}
  .glow{position:absolute;width:1400px;height:1400px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.18),transparent 60%);top:-500px;${lang === 'ar' ? 'left' : 'right'}:-500px}
  .ring{position:absolute;width:900px;height:900px;border-radius:50%;border:2px solid rgba(255,255,255,.10);bottom:-300px;${lang === 'ar' ? 'right' : 'left'}:-350px}
  .head{position:relative;padding:120px 90px 0;text-align:center;color:#fff;z-index:2}
  .chip{display:inline-block;font-weight:500;font-size:40px;padding:10px 34px;border-radius:999px;background:rgba(255,255,255,.16);color:#fff;margin-bottom:34px}
  h1{font-weight:700;font-size:${lang === 'ar' ? 112 : 100}px;line-height:1.2;letter-spacing:${lang === 'ar' ? 0 : -1}px}
  p{font-weight:500;font-size:52px;line-height:1.45;color:rgba(255,255,255,.86);margin-top:26px}
  .phone{position:absolute;left:160px;top:740px;width:1000px;height:2166px;border-radius:150px;background:#0B0F19;padding:26px;
    box-shadow:0 60px 120px rgba(5,15,45,.45),inset 0 0 0 4px #2A3142}
  .screen{width:100%;height:100%;border-radius:126px;overflow:hidden;position:relative;background:${dark ? '#0B1220' : '#F8F9FC'}}
  .screen img{position:absolute;top:118px;left:0;width:100%}
  .sb{position:absolute;top:0;left:0;right:0;height:118px;background:${s.bar};display:flex;align-items:center;justify-content:space-between;padding:22px 80px 0;direction:ltr;
    font-family:-apple-system,Inter,sans-serif;font-weight:600;font-size:44px;color:${s.barText}}
  .island{position:absolute;top:30px;left:50%;transform:translateX(-50%);width:300px;height:88px;border-radius:44px;background:#000;z-index:3}
  </style></head><body><div class="glow"></div><div class="ring"></div>
  <div class="head" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">${s[lang].chip ? `<div class="chip">${s[lang].chip}</div>` : ''}<h1>${s[lang].h}</h1><p>${s[lang].p}</p></div>
  <div class="phone"><div class="screen"><div class="island"></div>
   <div class="sb"><span>9:41</span><span><svg width="150" height="40" viewBox="0 0 150 40" fill="${s.barText}"><rect x="0" y="26" width="9" height="12" rx="2"/><rect x="14" y="20" width="9" height="18" rx="2"/><rect x="28" y="13" width="9" height="25" rx="2"/><rect x="42" y="6" width="9" height="32" rx="2"/>
   <path d="M76 14c8-7 20-7 28 0l-4 4c-6-5-14-5-20 0zM83 21c4-3 10-3 14 0l-7 7z"/><rect x="112" y="9" width="32" height="22" rx="6" fill="none" stroke="${s.barText}" stroke-width="3"/><rect x="116" y="13" width="22" height="14" rx="3"/><rect x="146" y="16" width="3" height="8" rx="1"/></svg></span></div>
   <img src="data:image/png;base64,${img}"></div></div></body></html>`;
  await p.setContent(html, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `out/${lang}/${String(i).padStart(2, '0')}-${s.file}.png` });
}
await b.close();
