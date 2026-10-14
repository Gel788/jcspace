// Shared rules for which DOM nodes are editable fields.
const SKIP = 'script,style,noscript,svg,template,[data-noedit]';
const LANGS = ['ru', 'en', 'zh'];
const FILES = { ru: 'index.html', en: 'en.html', zh: 'zh.html' };
// meta fields edited as attributes
const META = [
  ['meta.title', 'title', null],
  ['meta.description', 'meta[name=description]', 'content'],
  ['meta.ogTitle', 'meta[property="og:title"]', 'content'],
  ['meta.ogDescription', 'meta[property="og:description"]', 'content'],
];
function hasOwnText($, el) {
  return el.children.some((c) => c.type === 'text' && c.data.replace(/[\s\u200b\u00a0]/g, '').length);
}
// outermost elements in <body> that carry their own text
function candidates($) {
  const out = [];
  const walk = (el) => {
    for (const c of el.children || []) {
      if (c.type !== 'tag') continue;
      if ($(c).is(SKIP)) continue;
      if (hasOwnText($, c)) { out.push(c); continue; }
      walk(c);
    }
  };
  walk($('body')[0]);
  return out;
}
function sectionOf($, el) {
  const s = $(el).closest('section[id],section,footer,header,nav,main,div[id]').first();
  if (!s.length) return 'page';
  return s.attr('id') || (s.attr('class') || s[0].tagName).split(' ')[0];
}
module.exports = { SKIP, LANGS, FILES, META, candidates, sectionOf };
