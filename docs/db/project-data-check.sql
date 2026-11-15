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

-- 9. Ответственный за риск — роль из команды проекта; уровень риска только из списка
insert into project_team (project_id, role, zone) select id, 'Сметчик', 'Сметная номенклатура' from projects;
insert into project_risks (project_id, level, title, measure, owner_id)
  select p.id, 'high', 'Рост цен на арматуру', 'Фиксированная цена в договоре', t.id from projects p, project_team t;
do $$ begin
  begin
    insert into project_risks (project_id, level, title) select id, 'очень', 'Неверный уровень' from projects;
    raise exception '9: неверный уровень риска записался';
  exception when check_violation then null;
  end;
  if (select t.role from project_risks r join project_team t on t.id = r.owner_id) <> 'Сметчик' then raise exception '9: нет ответственного'; end if;
end $$;

-- Структура «от кирпича до ЖК»: кирпичи smr, area_total, fin_net → стена «Расчёт прибыли»
-- → комната «Финмодель» → квартира «Финансы» → этаж «ПК Start»
insert into variables (code, name, unit, section, value_type, owner_dept_id, source)
  select 'area_total', 'Общая площадь здания', 'м²', 'Паспорт и ТЭП', 'num', id, 'input' from departments where name = 'Команда проекта';
insert into elements (level_id, code, name, variable_id)
  select 1, 'atom_' || code, name, id from variables;
insert into elements (level_id, code, name, calc) values (2, 'op_profit', 'Расчёт прибыли', 'выручка − затраты');
insert into elements (level_id, code, name, tool_id) select 3, 'proc_finmodel', 'Финмодель', id from tools where name = 'Финмодель';
insert into elements (level_id, code, name) values (3, 'proc_pk', 'Презентация ПК Start');
insert into elements (level_id, code, name, owner_dept_id) select 4, 'area_finance', 'Финансы', id from departments where name = 'Финансы';
insert into elements (level_id, code, name, sort) values (5, 'stage_pk_start', 'ПК Start', 1);
insert into element_links (parent_id, child_id, role)
  select o.id, a.id, case when a.code = 'atom_fin_net' then 'output' else 'input' end
  from elements o, elements a where o.code = 'op_profit' and a.level_id = 1;
insert into element_links (parent_id, child_id)
  select p.id, c.id from elements p, elements c
  where (p.code, c.code) in (('proc_finmodel', 'op_profit'), ('proc_pk', 'op_profit'), ('area_finance', 'proc_finmodel'));
insert into element_links (parent_id, child_id, ord)
  select p.id, c.id, row_number() over (order by c.code desc) from elements p, elements c
  where p.code = 'stage_pk_start' and c.code in ('proc_finmodel', 'proc_pk');

-- 10. Элемент собирается только из уровней ниже: комнату нельзя вставить в стену
do $$ begin
  begin
    insert into element_links (parent_id, child_id) select o.id, p.id from elements o, elements p
      where o.code = 'op_profit' and p.code = 'proc_finmodel';
    raise exception '10: комната вошла в стену';
  exception when raise_exception then
    if sqlerrm like '10:%' then raise; end if;
  end;
end $$;

-- 11. Расчётную переменную считает одна стена; ручную переменную стена не считает
insert into elements (level_id, code, name) values (2, 'op_other', 'Другой расчёт');
do $$ begin
  begin
    insert into element_links (parent_id, child_id, role) select o.id, a.id, 'output' from elements o, elements a
      where o.code = 'op_other' and a.code = 'atom_fin_net';
    raise exception '11: у переменной две стены-расчёта';
  exception when unique_violation then null;
  end;
  begin
    insert into element_links (parent_id, child_id, role) select o.id, a.id, 'output' from elements o, elements a
      where o.code = 'op_other' and a.code = 'atom_smr';
    raise exception '11: стена считает вводимую переменную';
  exception when raise_exception then
    if sqlerrm like '11:%' then raise; end if;
  end;
end $$;

-- 12. У квартиры (направления) есть владелец; переменная — только у кирпича; Дом — таблица projects
do $$ begin
  begin
    insert into elements (level_id, code, name) values (4, 'area_nobody', 'Без владельца');
    raise exception '12: квартира без владельца';
  exception when raise_exception then
    if sqlerrm like '12:%' then raise; end if;
  end;
  begin
    insert into elements (level_id, code, name, variable_id) select 2, 'op_bad', 'Стена-переменная', id from variables where code = 'smr';
    raise exception '12: у стены переменная';
  exception when raise_exception then
    if sqlerrm like '12:%' then raise; end if;
  end;
  begin
    insert into elements (level_id, code, name) values (6, 'house', 'Дом');
    raise exception '12: проект записан в elements';
  exception when raise_exception then
    if sqlerrm like '12:%' then raise; end if;
  end;
end $$;

-- 13. Изменения идут вверх: СМР затрагивает расчётную прибыль, стену, обе комнаты (общая стена), квартиру и этаж
do $$ begin
  if (select string_agg(e.code, ',' order by e.code) from v_element_atoms ea
        join elements e on e.id = ea.element_id join variables v on v.id = ea.variable_id where v.code = 'smr')
     <> 'area_finance,atom_fin_net,op_profit,proc_finmodel,proc_pk,stage_pk_start' then
    raise exception '13: неверный список затронутых элементов';
  end if;
end $$;

-- 14. Готовность собирается снизу: площади нет и СМР в черновике — этаж не готов
do $$ begin
  if (select ready from v_element_status where code = 'stage_pk_start') then raise exception '14: этаж готов без данных'; end if;
  if (select inputs from v_element_status where code = 'stage_pk_start') <> 2 then raise exception '14: неверное число входов'; end if;
end $$;

-- 15. Все вводимые кирпичи утверждены — этаж готов; расчётный fin_net утверждать не нужно
insert into variable_values (project_id, variable_id, value, status)
  select p.id, v.id, '16806.95', 'approved' from projects p, variables v where v.code = 'area_total';
update variable_values set status = 'approved' where variable_id = (select id from variables where code = 'smr');
do $$ begin
  if not (select ready from v_element_status where code = 'stage_pk_start') then raise exception '15: этаж не готов'; end if;
end $$;

-- 16. Поменяли кирпич — элемент снова не готов: утверждали другое число
update variable_values set value = '310000' where variable_id = (select id from variables where code = 'smr');
do $$ begin
  if (select ready from v_element_status where code = 'proc_pk') then raise exception '16: комната осталась готовой'; end if;
end $$;

-- 17. Цепочка расчётов: старт графика → срок продаж (расчёт) → прибыль. Изменение старта доходит до прибыли и этапа
insert into variables (code, name, unit, section, value_type, owner_dept_id, source)
  select 'sched_start', 'Старт проекта', null, 'Сроки', 'month', id, 'input' from departments where name = 'Команда проекта';
insert into variables (code, name, unit, section, value_type, owner_dept_id, source)
  select 'sales_start', 'Начало продаж', 'мес.', 'Продажи', 'num', id, 'calc' from departments where name = 'Команда проекта';
insert into elements (level_id, code, name, variable_id) select 1, 'atom_' || code, name, id from variables where code in ('sched_start', 'sales_start');
insert into elements (level_id, code, name) values (2, 'op_sales_start', 'Расчёт начала продаж');
insert into element_links (parent_id, child_id, role)
  select o.id, a.id, case a.code when 'atom_sales_start' then 'output' else 'input' end
  from elements o, elements a where o.code = 'op_sales_start' and a.code in ('atom_sched_start', 'atom_sales_start');
insert into element_links (parent_id, child_id, role)
  select o.id, a.id, 'input' from elements o, elements a where o.code = 'op_profit' and a.code = 'atom_sales_start';
do $$ begin
  if not exists (select 1 from v_element_atoms ea join elements e on e.id = ea.element_id join variables v on v.id = ea.variable_id
                 where e.code = 'atom_fin_net' and v.code = 'sched_start') then
    raise exception '17: старт графика не доходит до прибыли';
  end if;
  if (select inputs from v_element_status where code = 'stage_pk_start') <> 3 then raise exception '17: этап не видит вход через цепочку'; end if;
end $$;

-- 18. Список — тоже кирпич: число блоков считается из списка блоков; готов, когда в списке есть строки
insert into lists (code, name, owner_dept_id) select 'blocks', 'Блоки проекта', id from departments where name = 'Команда проекта';
insert into variables (code, name, unit, section, value_type, owner_dept_id, source)
  select 'blocks_n', 'Количество блоков', 'шт', 'Паспорт и ТЭП', 'num', id, 'calc' from departments where name = 'Команда проекта';
insert into elements (level_id, code, name, list_id) select 1, 'list_blocks', name, id from lists where code = 'blocks';
insert into elements (level_id, code, name, variable_id) select 1, 'atom_blocks_n', name, id from variables where code = 'blocks_n';
insert into elements (level_id, code, name) values (2, 'op_blocks_n', 'Число блоков'), (3, 'proc_blocks', 'Блоки проекта');
insert into element_links (parent_id, child_id, role)
  select o.id, a.id, case a.code when 'list_blocks' then 'input' else 'output' end
  from elements o, elements a where o.code = 'op_blocks_n' and a.code in ('list_blocks', 'atom_blocks_n');
insert into element_links (parent_id, child_id)
  select p.id, c.id from elements p, elements c where p.code = 'proc_blocks' and c.code in ('list_blocks', 'op_blocks_n');
do $$ begin
  begin
    insert into elements (level_id, code, name, variable_id, list_id)
      select 1, 'atom_both', 'Два в одном', v.id, l.id from variables v, lists l where v.code = 'smr' and l.code = 'blocks';
    raise exception '18: кирпич одновременно переменная и список';
  exception when raise_exception then
    if sqlerrm like '18:%' then raise; end if;
  end;
  begin
    insert into element_links (parent_id, child_id, role) select o.id, a.id, 'output' from elements o, elements a
      where o.code = 'op_other' and a.code = 'list_blocks';
    raise exception '18: стена «считает» список';
  exception when raise_exception then
    if sqlerrm like '18:%' then raise; end if;
  end;
  if (select ready from v_element_status where code = 'proc_blocks') then raise exception '18: пустой список готов'; end if;
  if not exists (select 1 from v_element_atoms ea join elements e on e.id = ea.element_id join lists l on l.id = ea.list_id
                 where e.code = 'atom_blocks_n' and l.code = 'blocks') then
    raise exception '18: число блоков не зависит от списка блоков';
  end if;
end $$;
insert into list_rows (project_id, list_id, row_id, data)
  select p.id, l.id, 'b1', '{"name": "Блок 1", "floors": 12}' from projects p, lists l where l.code = 'blocks';
do $$ begin
  if not (select ready from v_element_status where code = 'proc_blocks') then raise exception '18: заполненный список не готов'; end if;
end $$;

-- 19. Чек-лист этапа — список из трёх пунктов: этап готов, когда отмечены все три, а не первый
insert into lists (code, name, owner_dept_id, need_rows)
  select 'checked_pk', 'Чек-лист ПК Start', id, 3 from departments where name = 'Команда проекта';
insert into elements (level_id, code, name, list_id) select 1, 'list_checked_pk', name, id from lists where code = 'checked_pk';
insert into elements (level_id, code, name, sort) values (5, 'stage_check', 'Этап с чек-листом', 2);
insert into element_links (parent_id, child_id) select p.id, c.id from elements p, elements c where p.code = 'stage_check' and c.code = 'list_checked_pk';
insert into list_rows (project_id, list_id, row_id) select p.id, l.id, 'pk.0' from projects p, lists l where l.code = 'checked_pk';
do $$ begin
  if (select ready from v_element_status where code = 'stage_check') then raise exception '19: этап готов с одним пунктом из трёх'; end if;
end $$;
insert into list_rows (project_id, list_id, row_id) select p.id, l.id, x from projects p, lists l, unnest(array['pk.1', 'pk.2']) x where l.code = 'checked_pk';
do $$ begin
  if not (select ready from v_element_status where code = 'stage_check') then raise exception '19: этап не готов, хотя отмечены все пункты'; end if;
end $$;

-- 20. Шаг этапа — где работать, а не состав: раздел-шаг не входит в готовность этапа; шаг ведёт только из этапа в раздел
insert into elements (level_id, code, name, sort) values (5, 'stage_steps_only', 'Этап только с шагом', 3);
insert into element_links (parent_id, child_id, role, ord, task)
  select s.id, p.id, 'step', 1, 'Финмодель' from elements s, elements p where s.code = 'stage_steps_only' and p.code = 'proc_finmodel';
do $$ begin
  if (select inputs from v_element_status where code = 'stage_steps_only') <> 0 then raise exception '20: шаг этапа попал в готовность'; end if;
  begin
    insert into element_links (parent_id, child_id, role) select o.id, a.id, 'step' from elements o, elements a where o.code = 'op_profit' and a.code = 'atom_smr';
    raise exception '20: шаг из стены';
  exception when raise_exception then
    if sqlerrm like '20:%' then raise; end if;
  end;
end $$;

select 'project-data: все проверки пройдены' as result;
