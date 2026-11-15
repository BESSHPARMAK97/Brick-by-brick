-- Проверка структуры из портала (docs/db/structure-seed.sql) на чистой базе:
--   psql -v ON_ERROR_STOP=1 -f docs/db/project-data.sql -f docs/db/structure-seed.sql -f docs/db/structure-seed-check.sql
-- Проверяются правила, а не числа: файл не меняется, когда в портале добавляют переменную или шаг.

-- 1. У каждой переменной и каждого списка есть кирпич
do $$ begin
  if exists (select 1 from variables v left join elements e on e.variable_id = v.id where e.id is null) then
    raise exception '1: у переменной нет кирпича';
  end if;
  if exists (select 1 from lists l left join elements e on e.list_id = l.id where e.id is null) then
    raise exception '1: у списка нет кирпича';
  end if;
end $$;

-- 2. Каждую расчётную переменную считает стена, и эта стена стоит в комнате-разделе
do $$ begin
  if exists (select 1 from variables v join elements a on a.variable_id = v.id
             left join element_links l on l.child_id = a.id and l.role = 'output'
             where v.source = 'calc' and l.parent_id is null) then
    raise exception '2: расчётную переменную не считает ни одна стена';
  end if;
  if exists (select 1 from elements o join levels lv on lv.id = o.level_id and lv.code = 'operation'
             where not exists (select 1 from element_links l join elements p on p.id = l.parent_id
                               where l.child_id = o.id and p.level_id = 3)) then
    raise exception '2: стена не стоит ни в одной комнате';
  end if;
end $$;

-- 3. Этапы идут по порядку, шаги (разделы) каждого этапа пронумерованы 1, 2, 3… без пропусков, у шага есть «что сделать»
do $$ begin
  if (select count(distinct sort) from elements where level_id = 5) <> (select count(*) from elements where level_id = 5) then
    raise exception '3: у двух этапов один порядковый номер';
  end if;
  if exists (select 1 from element_links l join elements s on s.id = l.parent_id and s.level_id = 5
             join elements c on c.id = l.child_id and c.level_id = 3
             group by l.parent_id having max(l.ord) <> count(*) or min(l.ord) <> 1) then
    raise exception '3: шаги этапа пронумерованы с пропуском';
  end if;
  if exists (select 1 from element_links l join elements s on s.id = l.parent_id and s.level_id = 5
             join elements c on c.id = l.child_id and c.level_id = 3
             where coalesce(l.task, '') = '') then
    raise exception '3: у шага этапа нет описания';
  end if;
end $$;

-- 4. Изменения идут вверх: данные, которые нужны этапу, затрагивают этап; шаги этапа (где работать) — не затрагивают
do $$ begin
  if not exists (select 1 from element_links l join elements s on s.id = l.parent_id and s.level_id = 5
                 join elements a on a.id = l.child_id and a.variable_id is not null) then
    raise exception '4: этапам не нужны данные';
  end if;
  if exists (select 1 from element_links l join elements s on s.id = l.parent_id and s.level_id = 5
             join elements a on a.id = l.child_id and a.variable_id is not null
             where not exists (select 1 from v_element_atoms ea where ea.element_id = s.id and ea.variable_id = a.variable_id)) then
    raise exception '4: v_element_atoms не поднимает нужные этапу данные до этапа';
  end if;
  if exists (select 1 from element_links l join elements s on s.id = l.parent_id and s.level_id = 5
             join elements p on p.id = l.child_id and p.level_id = 3 where l.role <> 'step') then
    raise exception '4: раздел входит в этап не шагом';
  end if;
end $$;

-- 5. Цепочка расчётов: если вход стены — расчётный кирпич, элемент видит и входы стены, которая его считает
do $$ begin
  if not exists (select 1 from element_links where role = 'input') then raise exception '5: у стен нет входов'; end if;
  if exists (
    select 1 from element_links i
    join elements a on a.id = i.child_id join variables v on v.id = a.variable_id and v.source = 'calc'
    join element_links o on o.child_id = a.id and o.role = 'output'
    join element_links pi on pi.parent_id = o.parent_id and pi.role = 'input'
    join elements b on b.id = pi.child_id
    where i.role = 'input'
      and not exists (select 1 from v_element_atoms ea where ea.element_id = i.parent_id
                      and (ea.variable_id = b.variable_id or ea.list_id = b.list_id))) then
    raise exception '5: v_element_atoms не идёт по цепочке расчётов';
  end if;
end $$;

-- 6. Квартира-направление: есть отдел-владелец и хотя бы один раздел; каждый раздел — ровно у одного отдела
do $$ begin
  if exists (select 1 from elements a where a.level_id = 4
             and (a.owner_dept_id is null or not exists (select 1 from element_links l join elements p on p.id = l.child_id and p.level_id = 3 where l.parent_id = a.id))) then
    raise exception '6: направление без отдела или без разделов';
  end if;
  if exists (select 1 from element_links l join elements a on a.id = l.parent_id and a.level_id = 4
             group by l.child_id having count(*) > 1) then
    raise exception '6: раздел закреплён за двумя отделами';
  end if;
  if exists (select 1 from elements p where p.level_id = 3
             and not exists (select 1 from element_links l join elements a on a.id = l.parent_id and a.level_id = 4 where l.child_id = p.id)) then
    raise exception '6: раздел не закреплён ни за одним отделом';
  end if;
end $$;

-- 7. Один ввод: у каждой вводимой переменной и каждого списка ровно одна комната ввода; у переменной — один writes
do $$ begin
  if exists (select 1 from variables v join elements a on a.variable_id = v.id
             where v.source = 'input'
               and (select count(*) from element_links l join elements p on p.id = l.parent_id and p.level_id = 3 where l.child_id = a.id) <> 1) then
    raise exception '7: у вводимой переменной не одна комната ввода';
  end if;
  if exists (select 1 from elements a where a.list_id is not null
               and (select count(*) from element_links l join elements p on p.id = l.parent_id and p.level_id = 3 where l.child_id = a.id) <> 1) then
    raise exception '7: у списка не одна комната ввода';
  end if;
  if (select count(*) from tool_variables where direction = 'writes') <> (select count(*) from variables where source = 'input') then
    raise exception '7: tool_variables не совпадает с комнатами ввода';
  end if;
  if exists (select 1 from variables v join elements a on a.variable_id = v.id
             join element_links l on l.child_id = a.id join elements p on p.id = l.parent_id and p.level_id = 3
             where v.source = 'calc') then
    raise exception '7: расчётная переменная записана как вводимая в комнате';
  end if;
end $$;

-- 8. Готовность: без значений элементы с входами не готовы; без входов (расчёт из списков, графика, файла) — пусто
insert into companies (name) values ('Проверка');
insert into projects (company_id, name) select id, 'Проверка' from companies;
do $$ begin
  if exists (select 1 from v_element_status where inputs = 0 and ready is not null) then
    raise exception '8: готовность без входов не пустая';
  end if;
  if exists (select 1 from v_element_status where inputs > 0 and ready) then
    raise exception '8: элемент готов без утверждённых значений';
  end if;
  if not exists (select 1 from v_element_status where inputs > 0) then raise exception '8: ни у одного элемента нет входов'; end if;
end $$;

-- 9. Заполненные списки: элемент, все вводимые кирпичи которого — списки, готов, когда в каждом need_rows строк
insert into list_rows (project_id, list_id, row_id) select p.id, l.id, 'r' || i from projects p, lists l, generate_series(1, l.need_rows) i;
do $$ begin
  if not exists (select 1 from element_links l join elements a on a.id = l.child_id and a.list_id is not null where l.role = 'input') then
    raise exception '9: ни одна стена не считается из списка';
  end if;
  if exists (
    select 1 from v_element_status st
    where st.inputs > 0 and not st.ready
      and not exists (select 1 from v_element_atoms ea join variables v on v.id = ea.variable_id and v.source = 'input'
                      where ea.element_id = st.element_id)) then
    raise exception '9: элемент только из заполненных списков не готов';
  end if;
end $$;

-- 10. Чек-лист этапа: у каждого этапа с пунктами свой чек-лист, нужно отметить все пункты (need_rows > 1 бывает)
do $$ begin
  if not exists (select 1 from lists where need_rows > 1) then raise exception '10: нет чек-листа с несколькими пунктами'; end if;
  if exists (select 1 from lists l join elements a on a.list_id = l.id
             where l.code like 'checked.%'
               and not exists (select 1 from element_links x join elements s on s.id = x.parent_id and s.level_id = 5 where x.child_id = a.id)) then
    raise exception '10: чек-лист не входит в свой этап';
  end if;
end $$;

select 'structure-seed: все проверки пройдены' as result;
