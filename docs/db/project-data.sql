-- «Кирпич за кирпичом»: данные проекта. Черновик схемы для IT, PostgreSQL 16.
-- Идея: каждая переменная проекта вводится один раз, у неё есть отдел-владелец, статус и история;
-- инструменты (финмодель, график, ОРС, отчёты, ПК Start) читают и пишут значения через эти таблицы.
-- Проверка правил: docs/db/project-data-check.sql.

create extension if not exists pgcrypto;

-- Компании холдинга и проекты
create table companies (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique                      -- «BI Group», дочерние компании холдинга
);

create table projects (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  name        text not null,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Отделы: команда проекта и смежные (Развитие, Юристы, Продажи, ОРС, Финансы, Снабжение, Логистика…)
create table departments (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique
);

create table users (
  id    uuid primary key default gen_random_uuid(),
  name  text not null,
  email text unique
);

-- Кто в каком отделе и на каком проекте работает. Отдел определяет, какие переменные человек утверждает.
create table memberships (
  user_id        uuid not null references users(id),
  department_id  uuid not null references departments(id),
  project_id     uuid references projects(id),       -- null: отдел холдинга, видит все проекты
  role           text not null check (role in ('viewer', 'editor', 'approver')),
  primary key (user_id, department_id, project_id)
);

-- Словарь переменных: один на холдинг (docs/variables.md)
create table variables (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,              -- area_total, smr, fin_net…
  name           text not null,
  unit           text,
  section        text not null,
  value_type     text not null check (value_type in ('text', 'num', 'sel', 'month', 'flag')),
  owner_dept_id  uuid not null references departments(id),
  source         text not null check (source in ('input', 'calc')),
  better         text check (better in ('up', 'down'))  -- какое отклонение от базовой версии хорошее
);

-- Инструменты и их связь с переменными: кто вводит (writes), кто читает (reads)
create table tools (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique                         -- Карточка проекта, Финмодель, График, ОРС, ПК Start…
);

create table tool_variables (
  tool_id      uuid not null references tools(id),
  variable_id  uuid not null references variables(id),
  direction    text not null check (direction in ('writes', 'reads')),
  primary key (tool_id, variable_id, direction)
);

-- У переменной ровно одно место ввода: один инструмент с direction = 'writes'
create unique index one_writer_per_variable on tool_variables (variable_id) where direction = 'writes';

-- Текущие значения: одна строка на проект и переменную
create table variable_values (
  project_id   uuid not null references projects(id),
  variable_id  uuid not null references variables(id),
  value        jsonb,                                -- число, строка, 'YYYY-MM' или true/false
  status       text not null default 'draft' check (status in ('draft', 'agreed', 'approved')),
  updated_by   uuid references users(id),
  updated_at   timestamptz not null default now(),
  status_by    uuid references users(id),
  status_at    timestamptz,
  primary key (project_id, variable_id)
);

-- История изменений: только добавление, правка и удаление запрещены
create table value_history (
  id           bigint generated always as identity primary key,
  project_id   uuid not null,
  variable_id  uuid not null,
  old_value    jsonb,
  new_value    jsonb,
  changed_by   uuid references users(id),
  changed_at   timestamptz not null default now(),
  foreign key (project_id, variable_id) references variable_values(project_id, variable_id)
);

-- Базовые версии: значения, утверждённые на контрольной точке (ПК Start), для сравнения «утвердили → получилось»
create table baselines (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id),
  name        text not null default 'ПК Start',
  fixed_by    uuid references users(id),
  fixed_at    timestamptz not null default now(),
  unique (project_id, name)
);

create table baseline_values (
  baseline_id  uuid not null references baselines(id) on delete cascade,
  variable_id  uuid not null references variables(id),
  value        jsonb,
  primary key (baseline_id, variable_id)
);

-- Списки проекта: команда и реестр рисков. Это не переменные словаря: у проекта их переменное число.
create table project_team (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id),
  role        text not null,                        -- Руководитель проекта, ГИП, начальник участка…
  user_id     uuid references users(id),             -- null: роль не закрыта
  zone        text,                                  -- зона ответственности
  sort        int not null default 0
);

create table project_risks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id),
  kind        text not null default 'risk' check (kind in ('risk', 'opportunity')),
  level       text not null default 'mid' check (level in ('high', 'mid', 'low')),
  title       text not null,
  measure     text,                                  -- мера реагирования
  owner_id    uuid references project_team(id),      -- ответственный из команды проекта
  sort        int not null default 0
);

-- Изменение значения возвращает статус в «черновик»: утверждали другое число.
create function reset_status() returns trigger language plpgsql as $$
begin
  if new.value is distinct from old.value then
    new.status := 'draft';
    new.status_by := null;
    new.status_at := null;
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger value_reset_status before update on variable_values
  for each row execute function reset_status();

-- Каждое новое значение попадает в историю. Смена только статуса историю значения не пишет.
create function write_history() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.value is distinct from old.value then
    insert into value_history (project_id, variable_id, old_value, new_value, changed_by)
      values (new.project_id, new.variable_id, case when tg_op = 'UPDATE' then old.value end, new.value, new.updated_by);
  end if;
  return null;
end $$;

create trigger value_history_write after insert or update on variable_values
  for each row execute function write_history();

-- Расчётные переменные вводит только инструмент-расчёт, не человек: у них нет статуса согласования
create function check_value() returns trigger language plpgsql as $$
declare
  v variables;
  bad boolean;
begin
  select * into v from variables where id = new.variable_id;
  if v.source = 'calc' and new.status <> 'draft' then
    raise exception 'Расчётную переменную % не согласуют и не утверждают', v.code;
  end if;
  bad := new.value is not null and (case v.value_type
      when 'num' then jsonb_typeof(new.value) <> 'number'
      when 'flag' then jsonb_typeof(new.value) <> 'boolean'
      when 'month' then not (jsonb_typeof(new.value) = 'string' and new.value #>> '{}' ~ '^\d{4}-\d{2}$')
      else jsonb_typeof(new.value) <> 'string' end);
  if bad then
    raise exception 'Значение % не подходит к типу % переменной %', new.value, v.value_type, v.code;
  end if;
  return new;
end $$;

create trigger value_check before insert or update on variable_values
  for each row execute function check_value();

create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'История изменений не редактируется';
end $$;

create trigger history_append_only before update or delete on value_history
  for each row execute function forbid_change();

-- Отклонения от базовой версии по числовым переменным
create view v_baseline_delta as
select b.project_id, b.name as baseline, var.code, var.name, var.unit, var.better,
       (bv.value #>> '{}')::numeric as base_value,
       (vv.value #>> '{}')::numeric as current_value,
       (vv.value #>> '{}')::numeric - (bv.value #>> '{}')::numeric as delta
from baselines b
join baseline_values bv on bv.baseline_id = b.id
join variables var on var.id = bv.variable_id and var.value_type = 'num'
join variable_values vv on vv.project_id = b.project_id and vv.variable_id = bv.variable_id;

-- ============================================================================
-- Структура «от кирпича до ЖК» (docs/concept.md, раздел «Структура»).
-- Каждый уровень собран из элементов уровней ниже и добавляет то, чего не было у частей:
-- кирпич — значение, стена — действие, комната — результат, квартира — владельца,
-- этаж — порядок, дом — паспорт, ЖК — общее для всех проектов.
-- Таблица называется elements, а не blocks: «блоки» в портале — корпуса ЖК.
-- ============================================================================

-- Уровни: метафора — для людей, code — для кода. Число и названия уровней — данные, а не схема.
create table levels (
  id           smallint primary key,                -- чем больше, тем выше уровень
  code         text not null unique,                -- atom, operation, process, area, stage, project, portfolio
  name         text not null unique,                -- «Кирпич», «Стена»…
  name_kk      text not null unique,                -- казахское название
  stored_in    text not null check (stored_in in ('elements', 'projects', 'companies')),
  needs_owner  boolean not null default false       -- с этого уровня у элемента есть отдел-владелец
);

insert into levels (id, code, name, name_kk, stored_in, needs_owner) values
  (1, 'atom',      'Кирпич',          'Кірпіш',                'elements',  false), -- переменная словаря или список проекта
  (2, 'operation', 'Стена',           'Қабырға',               'elements',  false), -- расчёт или действие
  (3, 'process',   'Комната',         'Бөлме',                 'elements',  false), -- раздел или инструмент
  (4, 'area',      'Квартира',        'Пәтер',                 'elements',  true),  -- направление отдела
  (5, 'stage',     'Этаж',            'Қабат',                 'elements',  false), -- этап дорожной карты
  (6, 'project',   'Дом',             'Үй',                    'projects',  false), -- таблица projects
  (7, 'portfolio', 'Жилой комплекс',  'Тұрғын үй кешені',      'companies', false); -- таблица companies

-- Списки проекта (блоки, шахматка…): у проекта их переменное число строк. Справочник один на холдинг, как variables;
-- строки списка проекта — в list_rows. Владелец списка — отдел направления, где список вводится.
create table lists (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,              -- blocks, chess
  name           text not null,
  owner_dept_id  uuid not null references departments(id)
);

-- Строки списков проекта: row_id — id строки в портале, data — поля строки. Ссылки между списками — по id в data
-- (квартира шахматки → блок), не копией текста.
create table list_rows (
  project_id  uuid not null references projects(id),
  list_id     uuid not null references lists(id),
  row_id      text not null,
  data        jsonb not null default '{}',
  updated_at  timestamptz not null default now(),
  primary key (project_id, list_id, row_id)
);

-- Элементы уровней 1–5: шаблон, один на холдинг, как словарь переменных. Проект — экземпляр шаблона:
-- значения кирпичей лежат в variable_values, состояние остальных уровней считается (v_element_status).
create table elements (
  id             uuid primary key default gen_random_uuid(),
  level_id       smallint not null references levels(id),
  code           text not null unique,
  name           text not null,
  variable_id    uuid unique references variables(id),   -- только у кирпича: кирпич = переменная…
  list_id        uuid unique references lists(id),       -- …или список проекта
  tool_id        uuid references tools(id),              -- комната может быть инструментом портала
  owner_dept_id  uuid references departments(id),
  calc           text,                                   -- у стены: формула или правило
  sort           int not null default 0                  -- порядок этажей (этапов)
);

-- Сборка: из чего состоит элемент. Граф, а не дерево: одна стена может стоять в двух комнатах,
-- один кирпич — в десяти стенах. Кирпич не копируется, на него ссылаются.
create table element_links (
  parent_id  uuid not null references elements(id) on delete cascade,
  child_id   uuid not null references elements(id) on delete cascade,
  role       text not null default 'part' check (role in ('part', 'input', 'output')),
  ord        int,                                        -- порядок шагов этапа
  task       text,                                       -- что сделать на шаге: «Собрать презентацию для комитета»
  primary key (parent_id, child_id)
);

-- Расчётную переменную считает ровно одна стена
create unique index one_operation_per_output on element_links (child_id) where role = 'output';

create function check_element() returns trigger language plpgsql as $$
declare
  l levels;
begin
  select * into l from levels where id = new.level_id;
  if l.stored_in <> 'elements' then
    raise exception 'Уровень «%» хранится в таблице %, а не в elements', l.name, l.stored_in;
  end if;
  if (l.code = 'atom') <> (num_nonnulls(new.variable_id, new.list_id) = 1)
     or (l.code <> 'atom' and num_nonnulls(new.variable_id, new.list_id) > 0) then
    raise exception 'Элемент %: кирпич — это одна переменная или один список; у других уровней их нет', new.code;
  end if;
  if l.needs_owner and new.owner_dept_id is null then
    raise exception 'Элементу % уровня «%» нужен отдел-владелец', new.code, l.name;
  end if;
  if new.calc is not null and l.code <> 'operation' then
    raise exception 'Элемент %: формула бывает только у стены', new.code;
  end if;
  return new;
end $$;

create trigger element_check before insert or update on elements
  for each row execute function check_element();

-- Элемент собирается только из элементов уровней ниже: так в сборке не бывает циклов.
-- Входы и результат — только у стены и только кирпичи; результат — расчётная переменная.
create function check_link() returns trigger language plpgsql as $$
declare
  p elements; c elements; pl levels; cl levels; src text;
begin
  select * into p from elements where id = new.parent_id;
  select * into c from elements where id = new.child_id;
  select * into pl from levels where id = p.level_id;
  select * into cl from levels where id = c.level_id;
  if cl.id >= pl.id then
    raise exception '% («%») не может входить в % («%»): часть должна быть уровнем ниже', c.code, cl.name, p.code, pl.name;
  end if;
  if new.role <> 'part' and not (pl.code = 'operation' and cl.code = 'atom') then
    raise exception 'Связь % → %: вход и результат бывают только у стены и только кирпичи', p.code, c.code;
  end if;
  if new.role = 'output' then
    select source into src from variables where id = c.variable_id;
    if src is distinct from 'calc' then                     -- список или вводимая переменная
      raise exception 'Кирпич % вводится вручную: стена не может его считать', c.code;
    end if;
  end if;
  return new;
end $$;

create trigger element_link_check before insert or update on element_links
  for each row execute function check_link();

-- Из каких кирпичей (переменных) собран каждый элемент, на всю глубину.
-- Обратное чтение отвечает «что затронет изменение переменной»: изменения идут вверх.
-- Цепочка расчётов учитывается: если вход стены — расчётный кирпич, дальше идут входы стены, которая его считает
-- (прибыль ← сроки продаж ← старт графика).
create view v_element_atoms as
with recursive edges (parent_id, child_id) as (
  select parent_id, child_id from element_links
  union all
  select child_id, parent_id from element_links where role = 'output'   -- расчётный кирпич → его стена
), down (element_id, child_id) as (
  select parent_id, child_id from edges
  union
  select d.element_id, e.child_id from down d join edges e on e.parent_id = d.child_id
)
select distinct d.element_id, a.variable_id, a.list_id
from down d join elements a on a.id = d.child_id
where a.level_id = 1;

-- Готовность элемента по проекту: готов, когда все вводимые кирпичи внутри готовы — переменная утверждена,
-- список заполнен (есть строки). Расчётные кирпичи не утверждают — они следуют за входами. Если входы не размечены, готовность пустая (null):
-- считать её не из чего, и «готово» было бы неправдой.
create view v_element_status as
select p.id as project_id, e.id as element_id, e.code, lv.name as level,
       count(*) filter (where v.source = 'input' or ea.list_id is not null) as inputs,
       count(*) filter (where (v.source = 'input' and vv.status = 'approved') or lr.n > 0) as approved,
       case when count(*) filter (where v.source = 'input' or ea.list_id is not null) > 0 then
         count(*) filter (where (v.source = 'input' and vv.status = 'approved') or lr.n > 0)
           = count(*) filter (where v.source = 'input' or ea.list_id is not null) end as ready
from projects p
cross join elements e
join levels lv on lv.id = e.level_id
left join v_element_atoms ea on ea.element_id = e.id                  -- элемент без кирпичей тоже виден: готовность пустая
left join variables v on v.id = ea.variable_id
left join variable_values vv on vv.project_id = p.id and vv.variable_id = v.id
left join (select project_id, list_id, count(*) as n from list_rows group by project_id, list_id) lr
  on lr.project_id = p.id and lr.list_id = ea.list_id
group by p.id, e.id, e.code, lv.name;
