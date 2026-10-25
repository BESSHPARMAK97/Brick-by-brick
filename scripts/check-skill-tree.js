// Проверка страницы и данных дерева: синтаксис скриптов, связи этапов, шаблоны, переводы, регионы, финмодель.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "prototype/index.html"), "utf8");
const errors = [];
const fail = msg => errors.push(msg);

const scripts = [...html.matchAll(/<script(?: id="([\w-]+)")?>([\s\S]*?)<\/script>/g)];
scripts.forEach(([, id, src], i) => { try { new Function(src); } catch (e) { fail(`script ${id || i}: ${e.message}`); } });
const pick = id => (scripts.find(s => s[1] === id) || [])[2] || "";
const ctx = { window: {}, TextEncoder };
vm.runInNewContext(["tree-data", "tree-data-kk", "regions", "docx-lib", "model-lib", "vars-data"].map(pick).join("\n"), ctx);
const { TREE: T, TREE_KK: KK, REGIONS: REG } = ctx.window;

const ids = new Set(T.nodes.map(n => n.id));
const fields = new Set(T.fields.map(f => f.id));
T.nodes.forEach(n => {
  n.req.forEach(r => ids.has(r) || fail(`${n.id}: unknown requirement ${r}`));
  n.docs.forEach(d => T.templates[d] || fail(`${n.id}: unknown template ${d}`));
  const k = KK.nodes[n.id];
  if (!k) fail(`${n.id}: no Kazakh translation`);
  else if (k.tasks.length !== n.tasks.length) fail(`${n.id}: ${n.tasks.length} tasks but ${k.tasks.length} in Kazakh`);
  if (!(T.refs[n.id] || []).length) fail(`${n.id}: no norm references`);
  if ((T.refs[n.id] || []).length !== ((KK.refs || {})[n.id] || []).length) fail(`${n.id}: norm references differ between languages`);
});
Object.entries(T.templates).forEach(([id, t]) => {
  const toks = new Set([...(t.body || "").matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]));
  toks.forEach(f => fields.has(f) || fail(`template ${id}: unknown field {{${f}}}`));
  const k = KK.templates[id];
  if (!k || !k.title) fail(`template ${id}: no Kazakh title`);
  if (t.ext !== "csv" && (!k || !k.body)) fail(`template ${id}: no Kazakh body`);
  if (k && k.body) [...k.body.matchAll(/\{\{(\w+)\}\}/g)].forEach(m => fields.has(m[1]) || fail(`template ${id} (kk): unknown field {{${m[1]}}}`));
});
Object.entries(REG).forEach(([rid, r]) => {
  Object.entries(r.tasks).forEach(([sid, list]) => {
    ids.has(sid) || fail(`region ${rid}: unknown stage ${sid}`);
    const seen = new Set();
    list.forEach(t => {
      if (/^\d+$/.test(t.id)) fail(`region ${rid}/${sid}: task id ${t.id} clashes with base task keys`);
      if (seen.has(t.id)) fail(`region ${rid}/${sid}: duplicate id ${t.id}`);
      seen.add(t.id);
      if (!t.ru || !t.kk) fail(`region ${rid}/${sid}/${t.id}: missing text`);
    });
  });
});
// Словарь данных проекта: уникальные коды, известные разделы и владельцы, пути к существующим полям.
const V = ctx.window.VARS, vids = new Set();
const PROJECT_EXTRA = ["mission", "kpi_nps", "kpi_engagement", "regcode", "stage", "work", "construct", "region", "building", "ge", "sales"];
const CALC = (html.match(/function calcAll\(\)[\s\S]*?\n  \}/) || [""])[0];
V.items.forEach(v => {
  if (vids.has(v.id)) fail(`variable ${v.id}: duplicate id`);
  vids.add(v.id);
  if (!V.sections.includes(v.sec)) fail(`variable ${v.id}: unknown section ${v.sec}`);
  if (!V.owners.includes(v.owner)) fail(`variable ${v.id}: unknown owner ${v.owner}`);
  if (!(v.used || []).length) fail(`variable ${v.id}: no consumers`);
  if (v.calc) { if (!new RegExp("\\b" + v.id + ":").test(CALC)) fail(`variable ${v.id}: not computed in calcAll()`); return; }
  const [root, k] = (v.path || "").split(".");
  if (!["text", "num", "sel", "month", "flag"].includes(v.type)) fail(`variable ${v.id}: bad type ${v.type}`);
  if (root === "model" && !(k in ctx.window.MODEL_DEFAULTS)) fail(`variable ${v.id}: unknown model input ${k}`);
  else if (root === "project" && !fields.has(k) && !PROJECT_EXTRA.includes(k)) fail(`variable ${v.id}: unknown project field ${k}`);
  else if (root === "sched" && k !== "start") fail(`variable ${v.id}: unknown schedule field ${k}`);
  else if (!["model", "project", "sched"].includes(root)) fail(`variable ${v.id}: bad path ${v.path}`);
});
const m = ctx.window.runModel(ctx.window.MODEL_DEFAULTS).t;
if (!isFinite(m.margin) || !isFinite(m.pbt)) fail("model: non-finite result with default inputs");
const docx = ctx.window.buildDocx("ПРОВЕРКА\nстрока");
if (!(docx[0] === 0x50 && docx[1] === 0x4b)) fail("docx: not a zip file");

if (errors.length) { console.error(errors.map(e => "✗ " + e).join("\n")); process.exit(1); }
console.log(`✓ ${scripts.length} scripts, ${T.nodes.length} stages, ${Object.keys(T.templates).length} templates, ${Object.keys(REG).length} regions, ${V.items.length} variables: all checks passed`);
