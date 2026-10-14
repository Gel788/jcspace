// content.json + templates -> static index.html / en.html / zh.html (no JS needed to see content)
const fs = require('fs'), path = require('path'), cheerio = require('cheerio');
const { LANGS, FILES, META } = require('./fields');
module.exports = function render(dataDir, siteDir, content) {
  content = content || JSON.parse(fs.readFileSync(path.join(dataDir, 'content.json'), 'utf8'));
  const stamp = Math.floor(Date.now() / 1000);
  for (const l of LANGS) {
    const $ = cheerio.load(fs.readFileSync(path.join(dataDir, 'templates', FILES[l]), 'utf8'), { decodeEntities: false });
    $('[data-c]').each((i, el) => { const f = content.fields[$(el).attr('data-c')]; if (f && typeof f[l] === 'string') $(el).html(f[l]); });
    for (const [key, sel, attr] of META) { const f = content.fields[key]; if (!f) continue; const e = $(sel).first(); if (attr) e.attr(attr, f[l]); else e.text(f[l]); }
    $('[data-img]').each((i, el) => { const im = content.images[$(el).attr('data-img')]; if (!im) return; const changed = $(el).attr('src') !== im.src; $(el).attr('src', im.src); $(el).attr('alt', im.alt[l] || ''); if (changed) { $(el).removeAttr('srcset'); $(el).closest('picture').find('source').remove(); } });
    let html = $.html().replace(/\?v=\d+/g, '?v=' + stamp);
    const tmp = path.join(siteDir, FILES[l] + '.tmp'); fs.writeFileSync(tmp, html); fs.renameSync(tmp, path.join(siteDir, FILES[l]));
  }
  fs.writeFileSync(path.join(siteDir, 'content.json'), JSON.stringify(content));
  return stamp;
};
