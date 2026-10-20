import { useState } from 'react';
import { GROUP_NAMES, WORK_LIBRARY, findTemplate } from '../../engine/catalog/library';
import { ASTANA_NORMALS } from '../../engine/climate/climate';
import { formatRu, MONTH_RU, toDayNum, monthOf, yearOf } from '../../engine/dates';
import { ALL_GROUPS } from '../../engine/defaults';
import { KZ_HOLIDAYS } from '../../engine/calendar/holidays';
import type { CalendarRegime, ProjectInput, WorkGroupId } from '../../engine/types';
import type { ScreenProps } from '../App';
import { CAL_STATUS_RU, CONFIDENCE_CLS, CONFIDENCE_RU, Field, Kpi, NumberInput, StatusBadge } from '../components/common';

const STEPS = ['Исходные данные', 'Автоопределение', 'Уточнения', 'Расчёт', 'Корректировка'];

export function Wizard(props: ScreenProps) {
  const [step, setStep] = useState(0);
  return (
    <div>
      <div className="steps">
        {STEPS.map((s, i) => (
          <button key={s} className={i === step ? 'active' : i < step ? 'done' : ''} onClick={() => setStep(i)}>
            {i + 1}. {s}
          </button>
        ))}
      </div>
      {step === 0 && <StepInput {...props} />}
      {step === 1 && <StepAuto {...props} />}
      {step === 2 && <StepQuestions {...props} />}
      {step === 3 && <StepResult {...props} />}
      {step === 4 && <StepAdjust {...props} />}
      <div className="row" style={{ marginTop: 12 }}>
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>← Назад</button>}
        <div className="spacer" />
        {step < STEPS.length - 1 && <button className="btn primary" onClick={() => setStep(step + 1)}>Далее →</button>}
        {step === STEPS.length - 1 && <button className="btn primary" onClick={() => props.go('gantt')}>Открыть диаграмму Ганта →</button>}
      </div>
    </div>
  );
}

function StepInput({ app }: ScreenProps) {
  const { input, setInput } = app;
  const set = (fn: (d: ProjectInput) => void) => setInput(fn);
  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>Объект</h2>
        <div className="grid cols-2">
          <Field label="Наименование">
            <input className="input" value={input.name} onChange={(e) => set((d) => (d.name = e.target.value))} />
          </Field>
          <Field label="Дата начала работ">
            <input className="input" type="date" value={input.startDate} onChange={(e) => e.target.value && set((d) => (d.startDate = e.target.value))} />
          </Field>
          <Field label="Тип объекта">
            <select className="input" value={input.objectType} disabled><option value="residential">Многоквартирный ЖК</option></select>
          </Field>
          <Field label="Город" hint="Календарь РК и климатические нормы Астаны">
            <select className="input" value={input.city} disabled><option value="astana">Астана</option></select>
          </Field>
        </div>
        <h2 style={{ marginTop: 14 }}>Виды работ</h2>
        <div className="grid cols-2">
          {ALL_GROUPS.map((g) => (
            <label key={g} className="check">
              <input
                type="checkbox"
                checked={input.workGroups.includes(g)}
                onChange={(e) => set((d) => {
                  d.workGroups = e.target.checked ? ALL_GROUPS.filter((x) => x === g || d.workGroups.includes(x)) : d.workGroups.filter((x) => x !== g);
                })}
              />
              <span>{GROUP_NAMES[g]}</span>
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn small" onClick={() => set((d) => (d.workGroups = ['monolith']))}>Только монолит</button>
          <button className="btn small" onClick={() => set((d) => (d.workGroups = [...ALL_GROUPS]))}>Полный цикл</button>
        </div>
      </div>
      <div className="card">
        <h2>Корпуса и секции</h2>
        {input.buildings.map((b, bi) => (
          <div key={b.id} style={{ marginBottom: 10 }}>
            <div className="row">
              <input className="input" style={{ maxWidth: 220 }} value={b.name} onChange={(e) => set((d) => (d.buildings[bi].name = e.target.value))} aria-label="Название корпуса" />
              {input.buildings.length > 1 && <button className="btn small danger" onClick={() => set((d) => d.buildings.splice(bi, 1))}>Удалить корпус</button>}
            </div>
            {b.sections.map((s, si) => (
              <div key={s.id} className="card" style={{ marginTop: 8, boxShadow: 'none' }}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <input className="input" style={{ maxWidth: 180 }} value={s.name} onChange={(e) => set((d) => (d.buildings[bi].sections[si].name = e.target.value))} aria-label="Название секции" />
                  <div className="spacer" />
                  {(b.sections.length > 1 || input.buildings.length > 1) && (
                    <button className="btn small danger" onClick={() => set((d) => {
                      d.buildings[bi].sections.splice(si, 1);
                      if (!d.buildings[bi].sections.length) d.buildings.splice(bi, 1);
                    })}>Удалить</button>
                  )}
                </div>
                <div className="grid cols-3">
                  <Field label="Этажей (надземных)"><NumberInput value={s.floors} min={1} max={100} step={1} onChange={(v) => v && set((d) => (d.buildings[bi].sections[si].floors = Math.round(v)))} /></Field>
                  <Field label="Подземных этажей"><NumberInput value={s.basementFloors} min={0} max={5} step={1} onChange={(v) => v !== null && set((d) => (d.buildings[bi].sections[si].basementFloors = Math.round(v)))} /></Field>
                  <Field label="Площадь этажа, м²"><NumberInput value={s.floorArea} min={1} onChange={(v) => v && set((d) => (d.buildings[bi].sections[si].floorArea = v))} /></Field>
                  <Field label="Захваток на этаж"><NumberInput value={s.zonesPerFloor} min={1} max={8} step={1} onChange={(v) => v && set((d) => (d.buildings[bi].sections[si].zonesPerFloor = Math.round(v)))} /></Field>
                  <Field label="Пролёт перекрытий, м" hint="≤ 6 м → 70 %, > 6 м → 80 %"><NumberInput value={s.slabSpanM} min={1} onChange={(v) => v && set((d) => (d.buildings[bi].sections[si].slabSpanM = v))} /></Field>
                </div>
              </div>
            ))}
            <button className="btn small" style={{ marginTop: 6 }} onClick={() => set((d) => {
              const id = nextId(d, 'S');
              d.buildings[bi].sections.push({ ...d.buildings[bi].sections[d.buildings[bi].sections.length - 1], id, name: `Секция ${d.buildings[bi].sections.length + 1}` });
            })}>+ Секция</button>
          </div>
        ))}
        <button className="btn small" onClick={() => set((d) => {
          const last = d.buildings[d.buildings.length - 1].sections[0];
          d.buildings.push({ id: nextId(d, 'B'), name: `Корпус ${d.buildings.length + 1}`, sections: [{ ...last, id: nextId(d, 'S'), name: 'Секция 1' }] });
        })}>+ Корпус</button>
        <p className="muted small" style={{ marginTop: 10 }}>
          Объёмы работ определяются по удельным показателям на 1 м² (сценарий). Точные объёмы из ВОР вводятся в «Шаблонах».
        </p>
      </div>
    </div>
  );
}

function nextId(d: ProjectInput, prefix: 'S' | 'B'): string {
  const used = new Set(prefix === 'B' ? d.buildings.map((b) => b.id) : d.buildings.flatMap((b) => b.sections.map((s) => s.id)));
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function StepAuto({ app }: ScreenProps) {
  const { input, setInput, calc } = app;
  const r = calc.result;
  const start = toDayNum(input.startDate);
  const end = r ? toDayNum(r.projectFinish) : start + 365;
  const months: { y: number; m: number }[] = [];
  for (let y = yearOf(start), m = monthOf(start); y < yearOf(end) || (y === yearOf(end) && m <= monthOf(end)); m === 11 ? (y++, (m = 0)) : m++) months.push({ y, m });
  const years = [...new Set(months.map((x) => x.y))];
  const groups = WORK_LIBRARY.filter((g) => input.workGroups.includes(g.id));
  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>Шаблон работ</h2>
        <p className="muted small">Технологические шаблоны подобраны по выбранным видам работ. Последовательность настраивается в «Шаблонах».</p>
        <table className="t">
          <thead><tr><th>Вид работ</th><th className="num">Операций в шаблоне</th><th className="num">Связей</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}><td>{g.name}</td><td className="num">{g.operations.length}</td><td className="num">{g.links.length}</td></tr>
            ))}
          </tbody>
        </table>
        {r && <p className="small" style={{ marginTop: 8 }}>Сгенерировано операций: <b>{r.operations.length}</b>, связей: <b>{r.links.length}</b> (в т.ч. оборачиваемость опалубки и ресурсные).</p>}
      </div>
      <div className="card">
        <h2>Календарь</h2>
        <div className="grid cols-3">
          <Field label="Режим недели">
            <select className="input" value={input.calendar.regime} onChange={(e) => setInput((d) => (d.calendar.regime = e.target.value as CalendarRegime))}>
              <option value="5/2">5/2</option><option value="6/1">6/1</option><option value="7/0">7/0 (непрерывный)</option>
            </select>
          </Field>
          <Field label="Смен в сутки">
            <select className="input" value={input.calendar.shiftsPerDay} onChange={(e) => setInput((d) => (d.calendar.shiftsPerDay = Number(e.target.value)))}>
              <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
            </select>
          </Field>
          <Field label="Смена, ч"><NumberInput value={input.calendar.shiftHours} min={1} max={12} onChange={(v) => v && setInput((d) => (d.calendar.shiftHours = v))} /></Field>
        </div>
        <h3 style={{ marginTop: 10 }}>Данные праздничного календаря РК</h3>
        {years.map((y) => {
          const i = KZ_HOLIDAYS.yearInfo(y);
          const cls = i.status === 'confirmed' || i.status === 'secondary' ? 'ok' : 'warn';
          const label = CAL_STATUS_RU[i.status];
          return <div key={y} className="small" style={{ marginBottom: 4 }}><b>{y}</b> <span className={`badge ${cls}`}>{label}</span> {i.note && <span className="muted">{i.note}</span>}</div>;
        })}
      </div>
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Сезонные условия (климатическая норма {ASTANA_NORMALS.period})</h2>
        <p className="muted small">{ASTANA_NORMALS.note} Зимние условия бетонирования — ожидаемая t ср &lt; +5 °C и t мин &lt; 0 °C (СП 70.13330.2012).</p>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Месяц</th><th className="num">t ср, °C</th><th className="num">t мин, °C</th><th>Бетонирование</th><th>Наружные «мокрые» работы (t ≥ +5)</th></tr></thead>
            <tbody>
              {months.map(({ y, m }) => {
                const n = ASTANA_NORMALS.monthly[m];
                const winter = n.tMean < 5 && n.tMin < 0;
                return (
                  <tr key={`${y}-${m}`}>
                    <td>{MONTH_RU[m]} {y}</td>
                    <td className="num">{n.tMean}</td>
                    <td className="num">{n.tMin}</td>
                    <td>{winter ? <span className="badge accent">зимние мероприятия</span> : <span className="badge ok">обычные условия</span>}</td>
                    <td>{n.tMean >= 5 ? <span className="badge ok">допустимо</span> : <span className="badge warn">ограничено</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StepQuestions({ app }: ScreenProps) {
  const { input, setInput, calc } = app;
  const r = calc.result;
  if (!r) return <div className="empty">Исправьте исходные данные, чтобы получить вопросы.</div>;
  const confirm = (key: string) => setInput((d) => { if (!d.confirmedParams.includes(key)) d.confirmedParams.push(key); });
  return (
    <div className="card">
      <h2>Критичные уточнения</h2>
      <p className="muted small">Только вопросы, существенно влияющие на расчёт. После подтверждения вопрос исчезает, а уровень достоверности растёт.</p>
      {r.questions.length === 0 && <div className="empty">Все критичные параметры подтверждены.</div>}
      {r.questions.map((q) => (
        <div key={q.key} className="card" style={{ boxShadow: 'none' }}>
          <div style={{ fontWeight: 600 }}>{q.text}</div>
          <div className="muted small" style={{ marginBottom: 8 }}>{q.reason}</div>
          <QuestionControl qkey={q.key} input={input} setInput={setInput} confirm={confirm} />
        </div>
      ))}
    </div>
  );
}

function QuestionControl({ qkey, input, setInput, confirm }: { qkey: string; input: ProjectInput; setInput: ScreenProps['app']['setInput']; confirm: (k: string) => void }) {
  if (qkey.startsWith('resources.crews.')) {
    const g = qkey.split('.')[2] as WorkGroupId;
    return (
      <div className="row">
        <div style={{ width: 120 }}><NumberInput value={input.resources.crews[g]} min={1} step={1} onChange={(v) => v && setInput((d) => (d.resources.crews[g] = Math.round(v)))} /></div>
        <label className="check small"><input type="checkbox" checked={(input.resources.crewsPerOperation[g] ?? 1) > 1} onChange={(e) => setInput((d) => (d.resources.crewsPerOperation[g] = e.target.checked ? 2 : 1))} />Разрешить 2 бригады на одном фронте</label>
        <button className="btn small primary" onClick={() => confirm(qkey)}>Подтвердить</button>
        <div className="muted small" style={{ width: '100%' }}>Дополнительная бригада ускоряет работу, только если есть фронт: несколько захваток на этаже, несколько секций или разрешение ставить 2 бригады на одну операцию.</div>
      </div>
    );
  }
  if (qkey.startsWith('op:')) {
    const key = qkey.slice(3);
    const t = findTemplate(key);
    const cur = input.overrides[key]?.productivity ?? t?.productivity?.value ?? null;
    return (
      <div className="row">
        <div style={{ width: 140 }}><NumberInput value={cur} min={0.01} onChange={(v) => v && setInput((d) => (d.overrides[key] = { ...d.overrides[key], productivity: v, productivityStatus: 'assumption' }))} /></div>
        <span className="muted small">{t?.productivity?.unit}</span>
        <button className="btn small primary" onClick={() => setInput((d) => (d.overrides[key] = { ...d.overrides[key], productivity: cur, productivityStatus: 'confirmed' }))}>Подтвердить как фактическую</button>
      </div>
    );
  }
  if (qkey === 'resources.slabFormworkSets') {
    return (
      <div className="row">
        <div style={{ width: 120 }}><NumberInput value={input.resources.slabFormworkSets} min={1} step={1} onChange={(v) => v && setInput((d) => (d.resources.slabFormworkSets = Math.round(v)))} /></div>
        <span className="muted small">комплектов перекрытий; стен:</span>
        <div style={{ width: 100 }}><NumberInput value={input.resources.wallFormworkSets} min={1} step={1} onChange={(v) => v && setInput((d) => (d.resources.wallFormworkSets = Math.round(v)))} /></div>
        <button className="btn small primary" onClick={() => { confirm(qkey); confirm('resources.wallFormworkSets'); }}>Подтвердить</button>
      </div>
    );
  }
  if (qkey === 'technology.winterCuringTempC') {
    return (
      <div className="row">
        <span className="small">Температура бетона, °C</span>
        <div style={{ width: 100 }}><NumberInput value={input.technology.winterCuringTempC} min={1} max={60} onChange={(v) => v && setInput((d) => (d.technology.winterCuringTempC = v))} /></div>
        <label className="check small"><input type="checkbox" checked={input.technology.winterMeasuresIncludedInRates} onChange={(e) => setInput((d) => (d.technology.winterMeasuresIncludedInRates = e.target.checked))} />Зимние мероприятия уже учтены в выработке</label>
        <button className="btn small primary" onClick={() => confirm(qkey)}>Подтвердить</button>
      </div>
    );
  }
  if (qkey === 'calendar.shiftsPerDay') {
    return (
      <div className="row">
        <select className="input" style={{ width: 160 }} value={input.calendar.shiftsPerDay} onChange={(e) => setInput((d) => (d.calendar.shiftsPerDay = Number(e.target.value)))}>
          <option value={1}>1 смена</option><option value={2}>2 смены</option><option value={3}>3 смены</option>
        </select>
        <button className="btn small primary" onClick={() => confirm(qkey)}>Подтвердить</button>
      </div>
    );
  }
  if (qkey === 'technology.concreteClassMPa') {
    return (
      <div className="row">
        <span className="small">Класс B</span>
        <div style={{ width: 90 }}><NumberInput value={input.technology.concreteClassMPa} min={7.5} max={100} onChange={(v) => v && setInput((d) => (d.technology.concreteClassMPa = v))} /></div>
        <select className="input" style={{ width: 260 }} value={input.technology.cementS} onChange={(e) => setInput((d) => (d.technology.cementS = Number(e.target.value)))}>
          <option value={0.2}>Быстротвердеющий (CEM 42,5R / 52,5), s = 0,20</option>
          <option value={0.25}>Нормальный (CEM 42,5N / 32,5R), s = 0,25</option>
          <option value={0.38}>Медленный (CEM 32,5N), s = 0,38</option>
        </select>
        <button className="btn small primary" onClick={() => { confirm(qkey); confirm('technology.cementS'); }}>Подтвердить</button>
      </div>
    );
  }
  return null;
}

function StepResult({ app, go }: ScreenProps) {
  const r = app.calc.result;
  if (!r) return <div className="empty">Расчёт невозможен — см. ошибки выше.</div>;
  const crit = r.operations.filter((o) => o.critical).length;
  const unconfirmed = r.assumptions.filter((a) => a.status === 'assumption' || a.status === 'missing');
  return (
    <div>
      <div className="grid cols-4">
        <Kpi label="Начало" value={formatRu(r.projectStart)} />
        <Kpi label="Окончание" value={formatRu(r.projectFinish)} sub={r.projectFinishWithBuffer !== r.projectFinish ? `с резервом: ${formatRu(r.projectFinishWithBuffer)}` : 'без резерва на риски'} />
        <Kpi label="Продолжительность" value={`${r.durationCalendarDays} кал. дн.`} sub={`${r.operations.length} операций, ${crit} критических`} />
        <Kpi label="Достоверность" value={<span className={`badge ${CONFIDENCE_CLS[r.confidence.level]}`} style={{ fontSize: 14 }}>{CONFIDENCE_RU[r.confidence.level]}</span>} sub={r.confidence.explanation} />
      </div>
      <div className="card">
        <div className="row"><h2 style={{ margin: 0 }}>Исходные предположения</h2><div className="spacer" /><button className="btn small" onClick={() => go('templates')}>Изменить параметры</button></div>
        <p className="muted small">Требуют подтверждения: {unconfirmed.length}. Сценарные значения — не нормативы.</p>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Параметр</th><th>Значение</th><th>Статус</th><th className="num">Смен на крит. пути</th></tr></thead>
            <tbody>
              {r.assumptions.slice(0, 15).map((a) => (
                <tr key={a.key}><td>{a.label}</td><td>{a.value}</td><td><StatusBadge status={a.status} /></td><td className="num">{a.impactShifts || ''}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="row"><h2 style={{ margin: 0 }}>Предупреждения</h2><div className="spacer" /><button className="btn small" onClick={() => go('risks')}>Все риски</button></div>
        {r.warnings.filter((w) => w.severity !== 'info').slice(0, 6).map((w) => <div key={w.code + w.text} className={`alert ${w.severity}`}>{w.text}</div>)}
      </div>
    </div>
  );
}

function StepAdjust({ app, go }: ScreenProps) {
  const { input, setInput, store, project, scenario } = app;
  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>Быстрая корректировка</h2>
        <p className="muted small">Любое изменение мгновенно пересчитывает график; версия сохраняется в журнал.</p>
        <div className="grid cols-2">
          <Field label="Дата начала"><input className="input" type="date" value={input.startDate} onChange={(e) => e.target.value && setInput((d) => (d.startDate = e.target.value))} /></Field>
          <Field label="Режим">
            <select className="input" value={input.calendar.regime} onChange={(e) => setInput((d) => (d.calendar.regime = e.target.value as CalendarRegime))}>
              <option value="5/2">5/2</option><option value="6/1">6/1</option><option value="7/0">7/0</option>
            </select>
          </Field>
          <Field label="Смен в сутки">
            <select className="input" value={input.calendar.shiftsPerDay} onChange={(e) => setInput((d) => (d.calendar.shiftsPerDay = Number(e.target.value)))}>
              <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
            </select>
          </Field>
          <Field label="Бригад монолитчиков (каждого профиля)"><NumberInput value={input.resources.crews.monolith} min={1} step={1} onChange={(v) => v && setInput((d) => (d.resources.crews.monolith = Math.round(v)))} /></Field>
          <Field label="Комплектов опалубки перекрытий"><NumberInput value={input.resources.slabFormworkSets} min={1} step={1} onChange={(v) => v && setInput((d) => (d.resources.slabFormworkSets = Math.round(v)))} /></Field>
          <Field label="Резерв на риски, раб. дн." hint="Не размазывается по операциям — отдельный буфер"><NumberInput value={input.technology.projectBufferDays} min={0} step={1} onChange={(v) => v !== null && setInput((d) => (d.technology.projectBufferDays = Math.round(v)))} /></Field>
          <Field label="Директивный срок"><input className="input" type="date" value={input.deadline ?? ''} onChange={(e) => setInput((d) => (d.deadline = e.target.value || null))} /></Field>
        </div>
      </div>
      <div className="card">
        <h2>Сценарии</h2>
        <p className="muted small">Создайте альтернативный сценарий (копия текущего) и сравните его с базовым без повторного ввода данных.</p>
        <button className="btn primary" onClick={() => { store.addScenario(project.id, scenario.id, `Сценарий ${project.scenarios.length + 1}`); app.refresh(); go('scenarios'); }}>
          + Альтернативный сценарий
        </button>
        <div style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => go('scenarios')}>Сравнение и журнал версий</button>
        </div>
      </div>
    </div>
  );
}
