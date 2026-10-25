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
