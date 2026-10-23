-- Проверка правил схемы на примере: применить после schema.sql на пустой базе.
-- psql -v ON_ERROR_STOP=1 -f schema.sql -f check.sql
\set ON_ERROR_STOP 1
begin;

insert into organizations (id, name) values ('00000000-0000-0000-0000-000000000001', 'ТОО «Пример Строй»');
insert into users (id, phone, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', '+77010000001', 'Прораб'),
  ('00000000-0000-0000-0000-0000000000a2', '+77010000002', 'Технадзор');
insert into projects (id, org_id, name, city) values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'ЖК «Кереге»', 'Астана');
insert into blocks (id, project_id, name) values ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'Блок A');
insert into floors (id, block_id, number) values ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000020', 7);
insert into units (id, floor_id, kind, number, rooms, area_m2) values ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000030', 'apartment', '145', 2, 61.4);
insert into work_sections (id, org_id, code, name) values ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000001', 'Отделка', 'Отделочные работы');
insert into work_types (id, org_id, section_id, name, unit) values ('00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000050', 'Штукатурка стен', 'm2');
insert into works (id, project_id, unit_id, work_type_id, plan_qty) values
  ('00000000-0000-0000-0000-000000000070', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000060', 150);

create temp table expect (step text, ok bool);
create function pg_temp.st() returns text language sql as $$ select status || ' ' || fact_qty || '/' || accepted_qty || '/' || plan_qty from works where id = '00000000-0000-0000-0000-000000000070' $$;
create function pg_temp.fails(sql text) returns bool language plpgsql as $$ begin execute sql; return false; exception when others then return true; end $$;

-- факт частями
insert into work_entries (work_id, type, qty, author_id) values ('00000000-0000-0000-0000-000000000070', 'fact', 60, '00000000-0000-0000-0000-0000000000a1');
insert into expect values ('факт 60 → в работе', pg_temp.st() = 'in_progress 60.00/0.00/150.00');
-- приёмка части
insert into work_entries (work_id, type, qty, author_id) values ('00000000-0000-0000-0000-000000000070', 'accept', 40, '00000000-0000-0000-0000-0000000000a2');
insert into expect values ('принято 40 из 60', pg_temp.st() = 'in_progress 60.00/40.00/150.00');
-- нельзя принять больше выполненного
insert into expect values ('приёмка 30 > к приёмке 20 отклонена', pg_temp.fails($$insert into work_entries (work_id, type, qty, author_id) values ('00000000-0000-0000-0000-000000000070', 'accept', 30, '00000000-0000-0000-0000-0000000000a2')$$));
-- превышение плана без комментария
insert into expect values ('факт сверх плана без причины отклонён', pg_temp.fails($$insert into work_entries (work_id, type, qty, author_id) values ('00000000-0000-0000-0000-000000000070', 'fact', 100, '00000000-0000-0000-0000-0000000000a1')$$));
-- добиваем до плана
insert into work_entries (work_id, type, qty, author_id) values ('00000000-0000-0000-0000-000000000070', 'fact', 90, '00000000-0000-0000-0000-0000000000a1');
insert into expect values ('факт = план → ждёт приёмки', pg_temp.st() = 'done 150.00/40.00/150.00');
-- исправление ошибки ниже принятого запрещено
insert into expect values ('факт ниже принятого отклонён', pg_temp.fails($$insert into work_entries (work_id, type, qty, comment, author_id) values ('00000000-0000-0000-0000-000000000070', 'fact', -120, 'ошибка', '00000000-0000-0000-0000-0000000000a1')$$));
-- замечание блокирует приёмку
insert into work_entries (id, work_id, type, comment, author_id) values ('00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-000000000070', 'remark', 'Трещина у окна', '00000000-0000-0000-0000-0000000000a2');
insert into expect values ('замечание → статус remark', pg_temp.st() = 'remark 150.00/40.00/150.00');
insert into expect values ('приёмка при замечании отклонена', pg_temp.fails($$insert into work_entries (work_id, type, qty, author_id) values ('00000000-0000-0000-0000-000000000070', 'accept', 10, '00000000-0000-0000-0000-0000000000a2')$$));
insert into work_entries (work_id, type, remark_id, author_id) values ('00000000-0000-0000-0000-000000000070', 'remark_fixed', '00000000-0000-0000-0000-000000000081', '00000000-0000-0000-0000-0000000000a1');
insert into expect values ('замечание устранено → ждёт приёмки', pg_temp.st() = 'done 150.00/40.00/150.00');
-- принимаем остаток
insert into work_entries (work_id, type, qty, author_id) values ('00000000-0000-0000-0000-000000000070', 'accept', 110, '00000000-0000-0000-0000-0000000000a2');
insert into expect values ('принято всё → accepted', pg_temp.st() = 'accepted 150.00/150.00/150.00');
-- ПТО увеличил план — работа снова в работе
insert into work_entries (work_id, type, qty, author_id) values ('00000000-0000-0000-0000-000000000070', 'plan_change', 160, '00000000-0000-0000-0000-0000000000a1');
insert into expect values ('план 160 → снова в работе', pg_temp.st() = 'in_progress 150.00/150.00/160.00');
insert into expect values ('prev_qty записан', (select prev_qty = 150 from work_entries where type = 'plan_change'));
-- журнал неизменяемый
insert into expect values ('изменение журнала запрещено', pg_temp.fails($$update work_entries set qty = 1 where type = 'fact'$$));
-- шахматка
insert into expect values ('клетка шахматки', (select round(progress, 3) = 0.938 and remarks_open = 0 from v_unit_cells));

select step, case when ok then 'OK' else 'FAIL' end as result from expect;
do $$ begin if exists (select 1 from expect where not ok) then raise exception 'есть проваленные проверки'; end if; end $$;
rollback;
