// Генерирует docs/db/structure-seed.sql — структуру «от кирпича до ЖК» из данных портала prototype/index.html:
//   кирпичи — переменные window.VARS;
//   стены — расчёты: у каждой переменной с calc одна стена, её результат — эта переменная;
//   комнаты — разделы портала (VIEWS): шаги этапов и разделы, которые считают переменные;
//   этажи — этапы дорожной карты (window.TREE) с шагами по порядку из window.STAGE_STEPS.
// Портал — единственный источник: файл не правится руками, CI сверяет его с порталом.
// Чего в портале нет, того нет и в базе: входы расчётов и направления отделов (квартиры) не размечены.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "prototype/index.html"), "utf8");
const pick = id => html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'))[1];
const ctx = { window: {} };
vm.runInNewContext(["tree-data", "dicts", "pnr-data", "vars-data", "stage-steps"].map(pick).join("\n"), ctx);
const { VARS, TREE, STAGE_STEPS } = ctx.window;

// Названия разделов — из VIEWS основного скрипта портала
const viewsSrc = html.match(/const VIEWS = \{\n([\s\S]*?)\n\};/)[1];
const VIEW_T = {};
viewsSrc.split("\n").forEach(l => { const m = l.match(/^\s+(\w+): \{.*?\bt: "([^"]+)"/); if (m) VIEW_T[m[1]] = m[2]; });
if (Object.keys(VIEW_T).length < 10) throw new Error("export-structure: не найдены разделы VIEWS в prototype/index.html");

// calc у переменной называет раздел, который её считает. Обычно это название раздела; два исключения — старые имена.
const CALC_VIEW = { "Калькулятор ПНР": "pnr", "Дорожная карта": "roadmap" };
const calcView = name => {
  const k = CALC_VIEW[name] || Object.keys(VIEW_T).find(k => VIEW_T[k] === name);
  if (!k || !VIEW_T[k]) throw new Error(`export-structure: calc «${name}» не совпадает ни с одним разделом портала`);
  return k;
};
// Тип переменной без type — то же правило, что vType в портале
const vType = v => v.type || (v.id.indexOf("keys_") === 0 ? "month" : v.id === "cur_stage" ? "text" : "num");

const q = s => s == null ? "null" : "'" + String(s).replace(/'/g, "''") + "'";
const rows = (list, f) => list.map(x => "  (" + f(x).join(", ") + ")").join(",\n");

const items = VARS.items;
const owners = [...new Set(items.map(v => v.owner))];
const calcs = items.filter(v => v.calc).map(v => [v.id, calcView(v.calc)]);

// Шаги этапов: как в портале, только разделы, которые есть в VIEWS
const steps = [];
TREE.nodes.forEach(n => {
  const seen = new Set();
  (STAGE_STEPS[n.id] || []).filter(([k]) => VIEW_T[k]).forEach(([k, task], i) => {
    if (seen.has(k)) throw new Error(`export-structure: раздел ${k} дважды в шагах этапа ${n.id}`);
    seen.add(k);
    steps.push([n.id, k, i + 1, task]);
  });
});
Object.keys(STAGE_STEPS).forEach(id => {
  if (!TREE.nodes.some(n => n.id === id)) throw new Error(`export-structure: этап ${id} из STAGE_STEPS нет в дорожной карте`);
});
const procs = [...new Set(steps.map(s => s[1]).concat(calcs.map(c => c[1])))].sort();

const out = `-- СГЕНЕРИРОВАНО scripts/export-structure.js из prototype/index.html. Не править руками:
-- после изменений портала запустите node scripts/export-skill-tree.js.
-- Структура «от кирпича до ЖК» (docs/concept.md). Кирпичи: ${items.length}, стены-расчёты: ${calcs.length}, комнаты-разделы: ${procs.length},
-- этажи-этапы: ${TREE.nodes.length}, шаги этапов: ${steps.length}. Входы расчётов и направления отделов в портале пока не размечены.
-- Запуск: psql -v ON_ERROR_STOP=1 -f docs/db/project-data.sql -f docs/db/structure-seed.sql -f docs/db/structure-seed-check.sql

-- Отделы-владельцы переменных
insert into departments (name) values
${rows(owners, o => [q(o)])}
on conflict (name) do nothing;

-- Словарь переменных (window.VARS)
insert into variables (code, name, unit, section, value_type, owner_dept_id, source, better)
select x.code, x.name, x.unit, x.section, x.value_type, d.id, x.source, x.better
from (values
${rows(items, v => [q(v.id), q(v.name), q(v.unit), q(v.sec), q(vType(v)), q(v.owner), q(v.calc ? "calc" : "input"), q(v.better)])}
) as x (code, name, unit, section, value_type, owner, source, better)
join departments d on d.name = x.owner;

-- Разделы портала — инструменты и комнаты
insert into tools (name) values
${rows(procs, k => [q(VIEW_T[k])])};

-- Кирпичи: по одному на переменную
insert into elements (level_id, code, name, variable_id)
select 1, 'atom.' || code, name, id from variables;

-- Комнаты: разделы портала
insert into elements (level_id, code, name, tool_id)
select 3, 'proc.' || x.view, t.name, t.id
from (values
${rows(procs, k => [q(k), q(VIEW_T[k])])}
) as x (view, title)
join tools t on t.name = x.title;

-- Стены: у каждой расчётной переменной одна стена, её результат — переменная
insert into elements (level_id, code, name)
select 2, 'op.' || code, 'Расчёт: ' || name from variables where source = 'calc';

insert into element_links (parent_id, child_id, role)
select o.id, a.id, 'output' from elements o join elements a on a.code = 'atom.' || substr(o.code, 4)
where o.code like 'op.%';

-- Стена стоит в комнате раздела, который считает переменную (calc)
insert into element_links (parent_id, child_id)
select p.id, o.id
from (values
${rows(calcs, ([id, k]) => [q("proc." + k), q("op." + id)])}
) as x (proc, op)
join elements p on p.code = x.proc
join elements o on o.code = x.op;

-- Этажи: этапы дорожной карты по порядку
insert into elements (level_id, code, name, sort) values
${rows(TREE.nodes, n => ["5", q("stage." + n.id), q(n.code + ". " + n.name), String(TREE.nodes.indexOf(n) + 1)])};

-- Шаги этапов (window.STAGE_STEPS): этап → раздел, порядок, что сделать
insert into element_links (parent_id, child_id, ord, task)
select s.id, p.id, x.ord, x.task
from (values
${rows(steps, ([sid, k, ord, task]) => [q("stage." + sid), q("proc." + k), String(ord), q(task)])}
) as x (stage, proc, ord, task)
join elements s on s.code = x.stage
join elements p on p.code = x.proc;
`;
fs.writeFileSync(path.join(root, "docs/db/structure-seed.sql"), out);
