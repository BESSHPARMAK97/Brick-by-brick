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
const ctx = { window: {}, TextEncoder, TextDecoder };
vm.runInNewContext(["tree-data", "tree-data-kk", "regions", "docx-lib", "model-lib", "dicts", "pnr-data", "xlsx-engine", "vars-data"].map(pick).join("\n"), ctx);
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
// Принцип «Кирпич за кирпичом»: одно значение — одна переменная и одно место ввода.
const V = ctx.window.VARS, vids = new Set(), vpaths = new Map(), vnames = new Map();
const PROJECT_EXTRA = ["mission", "kpi_nps", "kpi_engagement", "loc_text", "facade_text", "client_text", "regcode", "stage", "work", "construct", "region", "building", "ge", "sales", "ceil_h"];
const CALC = (html.match(/function calcAll\(\)[\s\S]*?\n  \}/) || [""])[0];
V.items.forEach(v => {
  if (vids.has(v.id)) fail(`variable ${v.id}: duplicate id`);
  vids.add(v.id);
  if (vnames.has(v.name)) fail(`variable ${v.id}: same name as ${vnames.get(v.name)} (duplicate data)`);
  vnames.set(v.name, v.id);
  if (v.path) { if (vpaths.has(v.path)) fail(`variable ${v.id}: same input ${v.path} as ${vpaths.get(v.path)}`); vpaths.set(v.path, v.id); }
  if (!V.sections.includes(v.sec)) fail(`variable ${v.id}: unknown section ${v.sec}`);
  if (!V.owners.includes(v.owner)) fail(`variable ${v.id}: unknown owner ${v.owner}`);
  if (!(v.used || []).length) fail(`variable ${v.id}: no consumers`);
  if (v.calc) { if (!new RegExp("\\b" + v.id + ":").test(CALC)) fail(`variable ${v.id}: not computed in calcAll()`); return; }
  const [root, k] = (v.path || "").split(".");
  if (!["text", "num", "sel", "month", "flag"].includes(v.type)) fail(`variable ${v.id}: bad type ${v.type}`);
  if (root === "model" && !(k in ctx.window.MODEL_DEFAULTS)) fail(`variable ${v.id}: unknown model input ${k}`);
  else if (root === "project" && !fields.has(k) && !PROJECT_EXTRA.includes(k)) fail(`variable ${v.id}: unknown project field ${k}`);
  else if (root === "sched" && k !== "start") fail(`variable ${v.id}: unknown schedule field ${k}`);
  else if (root === "pnr" && !ctx.window.PNR.some(p => "n" + p[0] === k)) fail(`variable ${v.id}: unknown PNR indicator ${k}`);
  else if (root === "equip" && (!["mono", "mas", "lift", "craneTail", "liftTail", "abn", "stagger"].includes(k) || typeof v.dflt !== "number")) fail(`variable ${v.id}: unknown equipment norm ${k} or no default`);
  else if (!["model", "project", "sched", "pnr", "equip"].includes(root)) fail(`variable ${v.id}: bad path ${v.path}`);
  if (v.type === "sel" && v.dict && !ctx.window.DICTS[v.dict]) fail(`variable ${v.id}: unknown dictionary ${v.dict}`);
});
// Справочники: уникальные значения без запятых (в Excel запятая делит пункт выпадающего списка на два)
const DICTS = ctx.window.DICTS;
const DKEYS = Object.keys(DICTS).filter(k => typeof DICTS[k] === "object");
DKEYS.forEach(k => {
  const vals = DICTS[k].items.map(i => i.v);
  if (new Set(vals).size !== vals.length) fail(`dict ${k}: duplicate values`);
  vals.forEach(v => { if (/,/.test(v)) fail(`dict ${k}: comma in value "${v}"`); });
});
["klass", "city"].forEach(id => { if (!DICTS[id]) fail(`variable ${id}: no dictionary`); });
// Движок формул калькуляторов отделов: синтетическая книга вместо файла ОРС (его нет в репозитории)
{
  const E = ctx.window.XLSXEngine, cell = (r, c, v, f) => [r * 16384 + c, { r, c, v, f }];
  const wb = { sheets: {
    "Показатели проекта": new Map([cell(2, 4, "Караганда"), cell(3, 4, 45685), cell(4, 4, 46178), cell(5, 4, null, "IF(AND(ISNUMBER(D3),ISNUMBER(D4)),(YEAR(D4)-YEAR(D3))*12+MONTH(D4)-MONTH(D3)+1,\"\")")]),
    "Ресурсы": new Map([cell(12, 1, "29-01"), cell(12, 5, 100), cell(12, 10, 120), cell(13, 1, "29-02"), cell(13, 5, 7), cell(13, 10, 9)]),
    "Калькулятор": new Map([
      cell(6, 2, "29-01"), cell(6, 5, null, "ROUNDUP('Показатели проекта'!$D$5/4,0)"),
      cell(6, 6, null, "_xlfn.IFS('Показатели проекта'!$D$2=\"Караганда\",VLOOKUP(B6,Ресурсы!$A:$J,10,FALSE),'Показатели проекта'!$D$2=\"Астана\",VLOOKUP(B6,Ресурсы!$A:$J,5,FALSE))*1.12"),
      cell(7, 2, "29-02"), cell(7, 5, 3), cell(7, 6, null, E.shift("_xlfn.IFS('Показатели проекта'!$D$2=\"Караганда\",VLOOKUP(B6,Ресурсы!$A:$J,10,FALSE),'Показатели проекта'!$D$2=\"Астана\",VLOOKUP(B6,Ресурсы!$A:$J,5,FALSE))*1.12", 1, 0)),
      cell(8, 7, null, "ROUND(SUM(E6*F6,E7*F7),2)"), cell(9, 7, null, "VLOOKUP(B6,Ресурсы!$A:$I,10,FALSE)")]) } };
  const ev = E.evaluator(wb, {}), v = r => ev.value("Калькулятор", r);
  const want = { E6: 5, F6: 134.4, F7: 10.08, G8: 702.24 };
  Object.keys(want).forEach(k => { const g = v(k); if (Math.abs(g - want[k]) > 1e-9) fail(`xlsx-engine: ${k} = ${JSON.stringify(g)}, ожидалось ${want[k]}`); });
  if (!E.isErr(v("G9")) || v("G9").err !== "#REF!") fail("xlsx-engine: VLOOKUP за пределами диапазона должен давать #REF!");
  const ov = E.evaluator(wb, { "Показатели проекта!D2": "Астана" });
  if (Math.abs(ov.value("Калькулятор", "F6") - 112) > 1e-9) fail("xlsx-engine: подстановка показателя не сработала");
}
const m = ctx.window.runModel(ctx.window.MODEL_DEFAULTS).t;
if (!isFinite(m.margin) || !isFinite(m.pbt)) fail("model: non-finite result with default inputs");
const docx = ctx.window.buildDocx("ПРОВЕРКА\nстрока");
if (!(docx[0] === 0x50 && docx[1] === 0x4b)) fail("docx: not a zip file");

if (errors.length) { console.error(errors.map(e => "✗ " + e).join("\n")); process.exit(1); }
console.log(`✓ ${scripts.length} scripts, ${T.nodes.length} stages, ${Object.keys(T.templates).length} templates, ${Object.keys(REG).length} regions, ${V.items.length} variables, ${DKEYS.length} dictionaries: all checks passed`);
