// One-time: turn the three built pages into templates (data-c keys) + content.json.
const fs = require('fs'), path = require('path'), cheerio = require('cheerio');
const { LANGS, FILES, META, candidates, sectionOf } = require('./fields');
module.exports = function extract(siteDir, dataDir) {
  const doms = {}; for (const l of LANGS) doms[l] = cheerio.load(fs.readFileSync(path.join(siteDir, FILES[l]), 'utf8'), { decodeEntities: false });
  const lists = {}; for (const l of LANGS) lists[l] = candidates(doms[l]);
  const n = lists.ru.length; for (const l of LANGS) if (lists[l].length !== n) throw new Error(`structure mismatch ${l}: ${lists[l].length} vs ${n}`);
  const content = { version: 1, fields: {}, images: {} }, used = {};
  for (let i = 0; i < n; i++) {
    const $ = doms.ru, el = lists.ru[i], sec = sectionOf($, el);
    used[sec] = (used[sec] || 0) + 1; const key = `${sec}.${String(used[sec]).padStart(3, '0')}`;
    const f = { section: sec, tag: el.tagName, cls: ($(el).attr('class') || '').split(' ')[0] || '' };
    for (const l of LANGS) { const $l = doms[l], e = lists[l][i]; f[l] = $l(e).html().trim(); $l(e).attr('data-c', key); }
    content.fields[key] = f;
  }
  for (const [key, sel, attr] of META) {
    const f = { section: 'meta', tag: attr ? 'attr' : 'title' };
    for (const l of LANGS) { const e = doms[l](sel).first(); f[l] = attr ? (e.attr(attr) || '') : e.text(); }
    content.fields[key] = f;
  }
  // images: every <img> in body, shared across languages
  let k = 0; doms.ru('body img').each((i, el) => { const key = `img.${String(++k).padStart(2, '0')}`; content.images[key] = { src: doms.ru(el).attr('src'), alt: { ru: doms.ru(el).attr('alt') || '', en: doms.en('body img').eq(i).attr('alt') || '', zh: doms.zh('body img').eq(i).attr('alt') || '' } };
    for (const l of LANGS) doms[l]('body img').eq(i).attr('data-img', key); });
  fs.mkdirSync(path.join(dataDir, 'templates'), { recursive: true });
  for (const l of LANGS) fs.writeFileSync(path.join(dataDir, 'templates', FILES[l]), doms[l].html());
  fs.writeFileSync(path.join(dataDir, 'content.json'), JSON.stringify(content, null, 1));
  return { fields: Object.keys(content.fields).length, images: k };
};
if (require.main === module) console.log(module.exports(process.argv[2], process.argv[3]));
