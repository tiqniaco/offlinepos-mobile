import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('/home/user/offlinepos-mobile/node_modules/');
const { chromium } = require('playwright');
const F = '/home/user/offlinepos-mobile/node_modules/@expo-google-fonts/ibm-plex-sans-arabic';
const font = (w, n) => `@font-face{font-family:P;font-weight:${w};src:url(data:font/ttf;base64,${readFileSync(`${F}/${n}/IBMPlexSansArabic_${n}.ttf`).toString('base64')})}`;
const icon = readFileSync('/home/user/offlinepos-mobile/apps/mobile/assets/brand/kashiro-foreground.svg').toString('base64');
const shot = readFileSync('raw/pos.png').toString('base64');
const lang = process.argv[2];
const t = lang === 'ar'
  ? { h: 'كاشيرو', p: 'كاشير وفواتير ومخازن لمحلك<br>شغال حتى من غير نت', dir: 'rtl' }
  : { h: 'Kashiro', p: 'POS, invoices & stock for your shop<br>works even offline', dir: 'ltr' };
const html = `<!doctype html><html><head><style>${font(700, '700Bold')}${font(500, '500Medium')}
*{margin:0;box-sizing:border-box}html,body{width:1024px;height:500px;overflow:hidden}
body{font-family:P,sans-serif;background:linear-gradient(120deg,#0F4CC7 0%,#0866FF 60%,#0080F9 100%);position:relative;color:#fff}
.glow{position:absolute;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.18),transparent 60%);top:-300px;left:-200px}
.txt{position:absolute;top:0;bottom:0;${lang === 'ar' ? 'right:70px' : 'left:70px'};width:560px;display:flex;flex-direction:column;justify-content:center;gap:18px;direction:${t.dir}}
.brand{display:flex;align-items:center;gap:22px}
.ic{width:110px;height:110px;border-radius:28px;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center}
.ic img{width:120px;height:120px}
h1{font-weight:700;font-size:84px;line-height:1.1}
p{font-weight:500;font-size:34px;line-height:1.45;color:rgba(255,255,255,.9)}
.phone{position:absolute;${lang === 'ar' ? 'left:80px' : 'right:80px'};top:60px;width:300px;height:650px;border-radius:46px;background:#0B0F19;padding:9px;box-shadow:0 30px 60px rgba(5,15,45,.45),inset 0 0 0 2px #2A3142}
.screen{width:100%;height:100%;border-radius:38px;overflow:hidden;background:#F8F9FC;position:relative}
.screen img{width:100%;position:absolute;top:30px}
.isl{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:90px;height:26px;border-radius:13px;background:#000;z-index:2}
</style></head><body><div class="glow"></div>
<div class="txt"><div class="brand"><div class="ic"><img src="data:image/svg+xml;base64,${icon}"></div><h1>${t.h}</h1></div><p>${t.p}</p></div>
<div class="phone"><div class="screen"><div class="isl"></div><img src="data:image/png;base64,${shot}"></div></div></body></html>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1024, height: 500 } });
await pg.setContent(html, { waitUntil: 'load' });
await pg.waitForTimeout(300);
await pg.screenshot({ path: `feature-${lang}.png` });
await b.close();
