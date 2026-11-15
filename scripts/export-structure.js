// Генерирует docs/db/structure-seed.sql — структуру «от кирпича до ЖК» из данных портала prototype/index.html:
//   кирпичи — переменные window.VARS;
//   стены — расчёты: у каждой переменной с calc одна стена, её результат — эта переменная;
//   комнаты — разделы портала (VIEWS): шаги этапов и разделы, которые считают переменные;
//   этажи — этапы дорожной карты (window.TREE) с шагами по порядку из window.STAGE_STEPS.
// Портал — единственный источник: файл не правится руками, CI сверяет его с порталом.
//   входы стен — from у переменной (window.VARS: из каких переменных считается calc);
//   комната и вводимые в ней кирпичи — window.VARS.homes (начало path → раздел);
//   квартиры — направления отделов (window.VARS.areas): отдел и разделы, которые он ведёт.
// Чего в портале нет, того нет и в базе: разделы без отдела ни в какую квартиру не входят.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "prototype/index.html"), "utf8");
const pick = id => html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'))[1];
const ctx = { window: {} };
vm.runInNewContext(["tree-data", "dicts", "pnr-data", "model-lib", "vars-data", "stage-steps"].map(pick).join("\n"), ctx);
const { VARS, TREE, STAGE_STEPS } = ctx.window;

// Названия разделов — из VIEWS основного скрипта портала
const VIEW_T = require("./portal-views")(html);

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
const owners = [...new Set(VARS.owners.concat(items.map(v => v.owner)))]; // и отделы без своих переменных (Стройка)
const calcs = items.filter(v => v.calc).map(v => [v.id, calcView(v.calc)]);
const inputs = [];
items.filter(v => v.calc).forEach(v => (v.from || []).forEach(x => inputs.push([v.id, x])));

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
const areas = VARS.areas || [];
areas.forEach(a => a.views.forEach(k => { if (!VIEW_T[k]) throw new Error(`export-structure: раздела ${k} направления ${a.id} нет в портале`); }));
const areaViews = [].concat(...areas.map(a => a.views.map(k => [a.id, k])));
// Где вводится: начало path → раздел (window.VARS.homes)
const homeOf = v => { const k = VARS.homes[v.path.split(".")[0]]; if (!VIEW_T[k]) throw new Error(`export-structure: у ${v.id} нет раздела ввода для ${v.path}`); return k; };
const entered = items.filter(v => !v.calc).map(v => [homeOf(v), v.id]);
const procs = [...new Set(steps.map(s => s[1]).concat(calcs.map(c => c[1]), areaViews.map(x => x[1]), entered.map(x => x[0])))].sort();
const noArea = procs.filter(k => !areaViews.some(x => x[1] === k));
if (noArea.length) throw new Error(`export-structure: разделы без отдела (добавьте в window.VARS.areas): ${noArea.join(", ")}`);

const out = `-- СГЕНЕРИРОВАНО scripts/export-structure.js из prototype/index.html. Не править руками:
-- после изменений портала запустите node scripts/export-skill-tree.js.
-- Структура «от кирпича до ЖК» (docs/concept.md). Кирпичи: ${items.length}, стены-расчёты: ${calcs.length}, комнаты-разделы: ${procs.length},
-- входы стен: ${inputs.length}, вводимые кирпичи в комнатах: ${entered.length}, этажи-этапы: ${TREE.nodes.length}, шаги этапов: ${steps.length},
-- квартиры-направления: ${areas.length} (разделов за отделами: ${areaViews.length} из ${procs.length}).
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

-- Комната и кирпичи, которые в ней вводятся (window.VARS.homes): у вводимой переменной одна комната ввода
insert into element_links (parent_id, child_id)
select p.id, a.id
from (values
${rows(entered, ([k, id]) => [q("proc." + k), q("atom." + id)])}
) as x (proc, atom)
join elements p on p.code = x.proc
join elements a on a.code = x.atom;

-- То же в tool_variables: раздел вводит переменную (writes), одно место ввода проверяет индекс one_writer_per_variable
insert into tool_variables (tool_id, variable_id, direction)
select p.tool_id, a.variable_id, 'writes'
from element_links l
join elements p on p.id = l.parent_id and p.level_id = 3
join elements a on a.id = l.child_id and a.level_id = 1;

-- Стены: у каждой расчётной переменной одна стена, её результат — переменная
insert into elements (level_id, code, name)
select 2, 'op.' || code, 'Расчёт: ' || name from variables where source = 'calc';

insert into element_links (parent_id, child_id, role)
select o.id, a.id, 'output' from elements o join elements a on a.code = 'atom.' || substr(o.code, 4)
where o.code like 'op.%';

-- Входы стен: из каких переменных считается расчёт (from в window.VARS)
insert into element_links (parent_id, child_id, role)
select o.id, a.id, 'input'
from (values
${rows(inputs, ([id, x]) => [q("op." + id), q("atom." + x)])}
) as x (op, atom)
join elements o on o.code = x.op
join elements a on a.code = x.atom;

-- Стена стоит в комнате раздела, который считает переменную (calc)
insert into element_links (parent_id, child_id)
select p.id, o.id
from (values
${rows(calcs, ([id, k]) => [q("proc." + k), q("op." + id)])}
) as x (proc, op)
join elements p on p.code = x.proc
join elements o on o.code = x.op;

-- Квартиры: направления отделов (window.VARS.areas) и разделы, которые отдел ведёт
-- Отдел ищется подзапросом, а не соединением: неизвестный отдел даёт ошибку триггера, а не тихо пропадает
insert into elements (level_id, code, name, owner_dept_id)
select 4, 'area.' || x.id, x.owner, (select d.id from departments d where d.name = x.owner)
from (values
${rows(areas, a => [q(a.id), q(a.owner)])}
) as x (id, owner);

insert into element_links (parent_id, child_id)
select a.id, p.id
from (values
${rows(areaViews, ([id, k]) => [q("area." + id), q("proc." + k)])}
) as x (area, proc)
join elements a on a.code = x.area
join elements p on p.code = x.proc;

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

-- Самопроверка: в базу попало ровно столько, сколько в портале (соединение не отбросило строку молча)
do $$ begin
${[["кирпичей", "select count(*) from elements where level_id = 1", items.length],
   ["стен", "select count(*) from elements where level_id = 2", calcs.length],
   ["комнат", "select count(*) from elements where level_id = 3", procs.length],
   ["квартир", "select count(*) from elements where level_id = 4", areas.length],
   ["этажей", "select count(*) from elements where level_id = 5", TREE.nodes.length],
   ["входов стен", "select count(*) from element_links where role = 'input'", inputs.length],
   ["результатов стен", "select count(*) from element_links where role = 'output'", calcs.length],
   ["связей «стена в комнате»", "select count(*) from element_links l join elements c on c.id = l.child_id and c.level_id = 2 where l.role = 'part'", calcs.length],
   ["вводимых кирпичей в комнатах", "select count(*) from element_links l join elements p on p.id = l.parent_id and p.level_id = 3 join elements c on c.id = l.child_id and c.level_id = 1", entered.length],
   ["разделов у отделов", "select count(*) from element_links l join elements p on p.id = l.parent_id and p.level_id = 4", areaViews.length],
   ["шагов этапов", "select count(*) from element_links l join elements p on p.id = l.parent_id and p.level_id = 5", steps.length]
  ].map(([t, sql, n]) => `  if (${sql}) <> ${n} then raise exception 'structure-seed: ${t} не ${n}'; end if;`).join("\n")}
end $$;
`;
fs.writeFileSync(path.join(root, "docs/db/structure-seed.sql"), out);
