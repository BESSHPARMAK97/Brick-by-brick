-- Brick by brick — схема базы данных MVP (PostgreSQL 16)
--
-- Иерархия: организация → проект (ЖК) → блок → этаж → помещение → работа → журнал записей.
-- Главный принцип: объёмы и статусы не редактируются напрямую. Каждое действие
-- (факт, приёмка, замечание, изменение плана) — это неизменяемая запись в work_entries,
-- а итоговые цифры и статус работы пересчитываются триггером.

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Справочные типы
-- ---------------------------------------------------------------------------

create type project_role as enum (
  'admin',            -- настраивает проект и участников
  'pto',              -- инженер ПТО: плановые объёмы, шаблоны
  'foreman',          -- прораб: факт выполнения, устранение замечаний
  'tech_supervisor',  -- технадзор: приёмка, замечания
  'contractor',       -- субподрядчик: видит и отмечает только свои работы
  'viewer'            -- руководитель: только просмотр
);

create type floor_kind as enum ('underground', 'residential', 'commercial', 'technical', 'roof');

create type unit_kind as enum (
  'apartment',   -- квартира
  'commercial',  -- коммерческое помещение
  'technical',   -- ИТП, электрощитовая, насосная и т. п.
  'common'       -- МОП: лестнично-лифтовой узел, коридор
);

create type measure_unit as enum ('m2', 'm3', 'pm', 'pcs', 'kg', 't');  -- м², м³, п.м., шт., кг, т

create type work_status as enum (
  'not_started',  -- факт = 0
  'in_progress',  -- 0 < факт < план
  'done',         -- факт ≥ план, ждёт приёмки
  'accepted',     -- принято ≥ план
  'remark'        -- есть открытое замечание технадзора
);

create type entry_type as enum (
  'fact',          -- прораб внёс выполненный объём (отрицательный объём = исправление ошибки)
  'accept',        -- технадзор принял объём (можно частями)
  'remark',        -- технадзор выставил замечание
  'remark_fixed',  -- прораб отметил замечание устранённым
  'plan_change'    -- ПТО изменил плановый объём
);

-- ---------------------------------------------------------------------------
-- Организации и пользователи
-- ---------------------------------------------------------------------------

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  bin         char(12) unique check (bin ~ '^[0-9]{12}$'),  -- БИН
  created_at  timestamptz not null default now()
);

create table users (
  id             uuid primary key default gen_random_uuid(),
  phone          text unique check (phone ~ '^\+7[0-9]{10}$'),  -- вход по номеру телефона (+7 7XX …)
  email          text unique,
  full_name      text not null,
  password_hash  text,
  locale         text not null default 'ru' check (locale in ('ru', 'kk')),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  check (phone is not null or email is not null)
);

create table org_members (
  org_id    uuid not null references organizations on delete cascade,
  user_id   uuid not null references users on delete cascade,
  is_admin  boolean not null default false,
  primary key (org_id, user_id)
);

-- Субподрядчики и собственные бригады
create table contractors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations on delete cascade,
  name        text not null,
  bin         char(12) check (bin ~ '^[0-9]{12}$'),
  is_own_crew boolean not null default false,  -- своя бригада, а не сторонний субподрядчик
  phone       text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Структура объекта
-- ---------------------------------------------------------------------------

create table projects (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations on delete cascade,
  name                text not null,                -- ЖК «…»
  city                text not null,
  address             text,
  developer_name      text,                         -- застройщик
  general_contractor  text,                         -- генподрядчик
  housing_class       text,                         -- эконом / комфорт / бизнес
  finish_type         text,                         -- черновая / предчистовая / чистовая
  planned_completion  date,
  is_archived         boolean not null default false,
  created_at          timestamptz not null default now()
);

create table project_members (
  project_id     uuid not null references projects on delete cascade,
  user_id        uuid not null references users on delete cascade,
  role           project_role not null,
  contractor_id  uuid references contractors,     -- обязателен для роли contractor
  added_at       timestamptz not null default now(),
  primary key (project_id, user_id, role),
  check (role <> 'contractor' or contractor_id is not null)
);

create table blocks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects on delete cascade,
  name        text not null,          -- «Блок A», «Секция 2»
  sort_order  int not null default 0,
  unique (project_id, name)
);

create table floors (
  id        uuid primary key default gen_random_uuid(),
  block_id  uuid not null references blocks on delete cascade,
  number    int not null,             -- −1 подвал, 0 цоколь, 1…N
  kind      floor_kind not null default 'residential',
  unique (block_id, number)
);

-- Типовая планировка: «2-комн. тип А, 61 м²». Через неё задаются плановые объёмы для всех однотипных квартир.
create table unit_layouts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects on delete cascade,
  name        text not null,
  kind        unit_kind not null default 'apartment',
  rooms       smallint check (rooms between 0 and 10),
  area_m2     numeric(8, 2) check (area_m2 > 0),
  unique (project_id, name)
);

create table units (
  id          uuid primary key default gen_random_uuid(),
  floor_id    uuid not null references floors on delete cascade,
  kind        unit_kind not null,
  number      text not null,          -- «145», «К-1.2», «ИТП», «МОП»
  layout_id   uuid references unit_layouts on delete set null,
  rooms       smallint check (rooms between 0 and 10),
  area_m2     numeric(8, 2) check (area_m2 > 0),
  sort_order  int not null default 0, -- порядок клеток в шахматке слева направо
  unique (floor_id, number)
);

-- ---------------------------------------------------------------------------
-- Справочник работ и шаблоны объёмов
-- ---------------------------------------------------------------------------

create table work_sections (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references organizations on delete cascade,
  code    text not null,   -- АР, ВК, ОВ, ЭОМ, Отделка
  name    text not null,
  unique (org_id, code)
);

create table work_types (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations on delete cascade,
  section_id      uuid not null references work_sections,
  name            text not null,           -- «Штукатурка стен»
  unit            measure_unit not null,
  is_hidden_work  boolean not null default false,  -- скрытые работы: нужен акт освидетельствования
  sort_order      int not null default 0,  -- технологический порядок
  is_archived     boolean not null default false,
  unique (org_id, name)
);

-- Плановый объём работы на типовую планировку
create table layout_work_plans (
  layout_id     uuid not null references unit_layouts on delete cascade,
  work_type_id  uuid not null references work_types,
  plan_qty      numeric(12, 2) not null check (plan_qty > 0),
  primary key (layout_id, work_type_id)
);

-- ---------------------------------------------------------------------------
-- Работы и журнал
-- ---------------------------------------------------------------------------

-- Конкретная работа в конкретном месте. Привязана к помещению, этажу, блоку
-- или ко всему проекту (фасад блока, благоустройство и т. п.).
create table works (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects on delete cascade,
  block_id         uuid references blocks on delete cascade,
  floor_id         uuid references floors on delete cascade,
  unit_id          uuid references units on delete cascade,
  work_type_id     uuid not null references work_types,
  contractor_id    uuid references contractors,
  plan_qty         numeric(12, 2) not null check (plan_qty > 0),
  plan_overridden  boolean not null default false,  -- план изменён вручную, шаблон его не перезаписывает
  planned_start    date,
  planned_finish   date,
  -- кэш, пересчитывается триггером из work_entries; руками не менять
  fact_qty         numeric(12, 2) not null default 0,
  accepted_qty     numeric(12, 2) not null default 0,
  open_remark_id   uuid,
  status           work_status not null default 'not_started',
  last_entry_at    timestamptz,
  created_at       timestamptz not null default now(),
  -- работа привязана максимум к одному уровню ниже проекта
  check (num_nonnulls(block_id, floor_id, unit_id) <= 1),
  check (planned_finish is null or planned_start is null or planned_finish >= planned_start)
);

create unique index works_unit_type_uq  on works (unit_id, work_type_id)  where unit_id is not null;
create unique index works_floor_type_uq on works (floor_id, work_type_id) where floor_id is not null;
create unique index works_block_type_uq on works (block_id, work_type_id) where block_id is not null;
create index works_project_type_idx on works (project_id, work_type_id);
create index works_project_status_idx on works (project_id, status);
create index works_contractor_idx on works (contractor_id) where contractor_id is not null;

-- Журнал: только вставка. Исправление ошибки — новая запись (например, факт с отрицательным объёмом).
create table work_entries (
  id            uuid primary key default gen_random_uuid(),
  work_id       uuid not null references works on delete cascade,
  type          entry_type not null,
  qty           numeric(12, 2),            -- fact/accept: объём; plan_change: новый план
  prev_qty      numeric(12, 2),            -- plan_change: старый план (заполняет триггер)
  entry_date    date not null default current_date,  -- дата выполнения, указанная человеком
  comment       text,
  remark_id     uuid references work_entries,       -- remark_fixed: какое замечание устранено
  author_id     uuid not null references users,
  client_id     uuid unique,               -- id с телефона: повторная отправка из офлайна не создаёт дубль
  created_at    timestamptz not null default now(),
  check (
    case type
      when 'fact'         then qty is not null and qty <> 0 and (qty > 0 or nullif(trim(comment), '') is not null)
      when 'accept'       then qty is not null and qty > 0
      when 'plan_change'  then qty is not null and qty > 0
      when 'remark'       then qty is null and nullif(trim(comment), '') is not null
      when 'remark_fixed' then qty is null and remark_id is not null
    end
  )
);

create index work_entries_work_idx on work_entries (work_id, created_at);
create index work_entries_created_idx on work_entries (created_at);              -- отчёты за период
create index work_entries_author_idx on work_entries (author_id, created_at);

alter table works add constraint works_open_remark_fk foreign key (open_remark_id) references work_entries;

-- Фото и файлы к записям журнала (необязательно). Сами файлы — в S3-совместимом хранилище.
create table attachments (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references work_entries on delete cascade,
  storage_key  text not null unique,
  mime_type    text not null,
  size_bytes   int not null check (size_bytes > 0),
  width        int,
  height       int,
  taken_at     timestamptz,
  uploaded_by  uuid not null references users,
  created_at   timestamptz not null default now()
);

create index attachments_entry_idx on attachments (entry_id);

-- ---------------------------------------------------------------------------
-- Правила: проверка записи и пересчёт работы
-- ---------------------------------------------------------------------------

-- BEFORE INSERT: проверяет правила и заполняет prev_qty
create function work_entries_apply() returns trigger language plpgsql as $$
declare
  w works%rowtype;
  new_fact numeric;
  new_accepted numeric;
begin
  -- блокируем строку работы, чтобы параллельные записи не нарушили правила
  select * into w from works where id = new.work_id for update;

  case new.type
    when 'fact' then
      new_fact := w.fact_qty + new.qty;
      if new_fact < w.accepted_qty then
        raise exception 'Факт (%) не может стать меньше принятого объёма (%)', new_fact, w.accepted_qty
          using errcode = 'check_violation';
      end if;
      if new_fact > w.plan_qty * 1.05 and nullif(trim(new.comment), '') is null then
        raise exception 'Факт превышает план более чем на 5%%: укажите причину в комментарии'
          using errcode = 'check_violation';
      end if;

    when 'accept' then
      if w.open_remark_id is not null then
        raise exception 'Есть открытое замечание: принять объём можно после его устранения'
          using errcode = 'check_violation';
      end if;
      new_accepted := w.accepted_qty + new.qty;
      if new_accepted > w.fact_qty then
        raise exception 'Нельзя принять больше выполненного: к приёмке %', w.fact_qty - w.accepted_qty
          using errcode = 'check_violation';
      end if;

    when 'remark' then
      if w.open_remark_id is not null then
        raise exception 'У работы уже есть открытое замечание' using errcode = 'check_violation';
      end if;

    when 'remark_fixed' then
      if w.open_remark_id is distinct from new.remark_id then
        raise exception 'Это замечание не открыто' using errcode = 'check_violation';
      end if;

    when 'plan_change' then
      new.prev_qty := w.plan_qty;
  end case;

  return new;
end $$;

-- AFTER INSERT: пересчитывает кэш и статус работы (запись уже существует, поэтому FK open_remark_id валиден)
create function work_entries_sync() returns trigger language plpgsql as $$
begin
  update works set
    fact_qty       = coalesce((select sum(qty) from work_entries where work_id = new.work_id and type = 'fact'), 0),
    accepted_qty   = coalesce((select sum(qty) from work_entries where work_id = new.work_id and type = 'accept'), 0),
    plan_qty       = case when new.type = 'plan_change' then new.qty else plan_qty end,
    open_remark_id = case new.type when 'remark' then new.id when 'remark_fixed' then null else open_remark_id end,
    last_entry_at  = new.created_at
  where id = new.work_id;

  update works set status = case
    when open_remark_id is not null then 'remark'
    when accepted_qty >= plan_qty   then 'accepted'
    when fact_qty >= plan_qty       then 'done'
    when fact_qty > 0               then 'in_progress'
    else 'not_started'
  end::work_status
  where id = new.work_id;

  return null;
end $$;

create trigger work_entries_check before insert on work_entries
  for each row execute function work_entries_apply();
create trigger work_entries_after after insert on work_entries
  for each row execute function work_entries_sync();

-- журнал неизменяемый
create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'Записи журнала нельзя изменять или удалять — добавьте исправляющую запись';
end $$;

create trigger work_entries_immutable before update or delete on work_entries
  for each row when (pg_trigger_depth() = 0) execute function forbid_change();

-- ---------------------------------------------------------------------------
-- Представления для экранов
-- ---------------------------------------------------------------------------

-- Готовность работы: принятое считается на 100%, выполненное, но не принятое — на 90%
create view v_work_progress as
select w.*,
       w.fact_qty - w.accepted_qty as pending_qty,
       least(1, (w.accepted_qty + 0.9 * (w.fact_qty - w.accepted_qty)) / w.plan_qty) as progress
from works w;

-- Клетка шахматки: готовность помещения, замечания, объём к приёмке
create view v_unit_cells as
select u.id as unit_id, f.block_id, f.id as floor_id, f.number as floor_number,
       u.kind, u.number, u.rooms, u.area_m2, u.sort_order,
       count(p.id)                                         as works_total,
       coalesce(avg(p.progress), 0)                        as progress,
       count(*) filter (where p.status = 'remark')         as remarks_open,
       count(*) filter (where p.pending_qty > 0 and p.status <> 'remark') as works_to_accept
from units u
join floors f on f.id = u.floor_id
left join v_work_progress p on p.unit_id = u.id
group by u.id, f.block_id, f.id, f.number;

-- Отчёт за период: сколько выполнено и принято по виду работы и исполнителю
create view v_entries_by_day as
select w.project_id, w.work_type_id, w.contractor_id, e.type, e.entry_date,
       sum(e.qty) as qty, count(*) as entries
from work_entries e
join works w on w.id = e.work_id
where e.type in ('fact', 'accept')
group by w.project_id, w.work_type_id, w.contractor_id, e.type, e.entry_date;
