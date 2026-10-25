-- Проверка правил docs/db/project-data.sql на чистой базе:
--   psql -v ON_ERROR_STOP=1 -f docs/db/project-data.sql -f docs/db/project-data-check.sql
-- Каждый блок либо проходит, либо падает с понятным сообщением.

insert into companies (name) values ('BI Group');
insert into projects (company_id, name) select id, 'Северный квартал (пример)' from companies;
insert into departments (name) values ('Команда проекта'), ('ОРС'), ('Финансы');
insert into users (name) values ('Руководитель проекта'), ('Экономист ОРС');
insert into tools (name) values ('Финмодель'), ('Данные проекта');
insert into variables (code, name, unit, section, value_type, owner_dept_id, source, better)
  select 'smr', 'СМР', 'тг/м²', 'Затраты', 'num', id, 'input', 'down' from departments where name = 'ОРС';
insert into variables (code, name, unit, section, value_type, owner_dept_id, source, better)
  select 'fin_net', 'Чистая прибыль', 'тг', 'Результаты финмодели', 'num', id, 'calc', 'up' from departments where name = 'Финансы';
insert into tool_variables
  select t.id, v.id, 'writes' from tools t, variables v where t.name = 'Данные проекта' and v.code = 'smr';
insert into tool_variables
  select t.id, v.id, 'reads' from tools t, variables v where t.name = 'Финмодель' and v.code = 'smr';

-- 1. Первое значение пишется в историю
insert into variable_values (project_id, variable_id, value, updated_by)
  select p.id, v.id, '260000', u.id from projects p, variables v, users u where v.code = 'smr' and u.name = 'Экономист ОРС';
do $$ begin
  if (select count(*) from value_history) <> 1 then raise exception '1: нет записи истории'; end if;
end $$;

-- 2. Согласование и утверждение меняют только статус, история не растёт
update variable_values set status = 'approved', status_by = (select id from users where name = 'Экономист ОРС'), status_at = now();
do $$ begin
  if (select status from variable_values) <> 'approved' then raise exception '2: статус не сохранился'; end if;
  if (select count(*) from value_history) <> 1 then raise exception '2: смена статуса попала в историю'; end if;
end $$;

-- 3. Базовая версия ПК Start
insert into baselines (project_id) select id from projects;
insert into baseline_values select b.id, vv.variable_id, vv.value from baselines b join variable_values vv on vv.project_id = b.project_id;

-- 4. Изменение значения: история +1, статус снова «черновик», отклонение от базовой версии видно
update variable_values set value = '300000';
do $$ begin
  if (select count(*) from value_history) <> 2 then raise exception '4: изменение не попало в историю'; end if;
  if (select status from variable_values) <> 'draft' then raise exception '4: статус не вернулся в черновик'; end if;
  if (select delta from v_baseline_delta where code = 'smr') <> 40000 then raise exception '4: неверное отклонение'; end if;
end $$;

-- 5. У переменной одно место ввода
do $$ begin
  begin
    insert into tool_variables select t.id, v.id, 'writes' from tools t, variables v where t.name = 'Финмодель' and v.code = 'smr';
    raise exception '5: второе место ввода разрешено';
  exception when unique_violation then null;
  end;
end $$;

-- 6. Неверный тип значения отклоняется
do $$ begin
  begin
    update variable_values set value = '"много"';
    raise exception '6: строка записалась в числовую переменную';
  exception when raise_exception then
    if sqlerrm like '6:%' then raise; end if;
  end;
end $$;

-- 7. Расчётную переменную нельзя утвердить
do $$ begin
  begin
    insert into variable_values (project_id, variable_id, value, status)
      select p.id, v.id, '1880000000', 'approved' from projects p, variables v where v.code = 'fin_net';
    raise exception '7: расчётная переменная утверждена';
  exception when raise_exception then
    if sqlerrm like '7:%' then raise; end if;
  end;
end $$;

-- 8. Историю нельзя исправить задним числом
do $$ begin
  begin
    update value_history set new_value = '1';
    raise exception '8: история изменена';
  exception when raise_exception then
    if sqlerrm like '8:%' then raise; end if;
  end;
end $$;

select 'project-data: все проверки пройдены' as result;
