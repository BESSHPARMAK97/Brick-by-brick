import { lazy, Suspense, useState } from 'react';
import { formatRu } from '../engine/dates';
import type { ScheduledOperation } from '../engine/types';
import { CONFIDENCE_CLS, CONFIDENCE_RU, Drawer } from './components/common';
import { Explain } from './Explain';
import { useApp, type AppApi } from './state';
import { CalendarView } from './screens/CalendarView';
import { CriticalPath } from './screens/CriticalPath';
import { Gantt } from './screens/Gantt';
import { Operations } from './screens/Operations';
import { Resources } from './screens/Resources';
import { Risks } from './screens/Risks';
import { Scenarios } from './screens/Scenarios';
import { Templates } from './screens/Templates';
import { Wizard } from './screens/Wizard';

const SCREENS = [
  { id: 'wizard', label: 'Создание ГПР' },
  { id: 'ops', label: 'Операции' },
  { id: 'gantt', label: 'Диаграмма Ганта' },
  { id: 'calendar', label: 'Календарь ограничений' },
  { id: 'critical', label: 'Критический путь' },
  { id: 'resources', label: 'Ресурсы' },
  { id: 'risks', label: 'Риски' },
  { id: 'templates', label: 'Шаблоны и параметры' },
  { id: 'scenarios', label: 'Сценарии и версии' },
] as const;

export type ScreenId = (typeof SCREENS)[number]['id'];

export interface ScreenProps {
  app: AppApi;
  openOp: (op: ScheduledOperation) => void;
  go: (s: ScreenId) => void;
}

const ExportMenu = lazy(() => import('./ExportMenu'));

export function App() {
  const app = useApp();
  const [screen, setScreen] = useState<ScreenId>('wizard');
  const [opened, setOpened] = useState<ScheduledOperation | null>(null);
  const { calc, input, scenario, project } = app;
  const props: ScreenProps = { app, openOp: setOpened, go: setScreen };
  const r = calc.result;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          ГПР-движок
          <small>Universal Construction Schedule Engine</small>
        </div>
        <nav className="nav">
          {SCREENS.map((s, i) => (
            <button key={s.id} className={screen === s.id ? 'active' : ''} onClick={() => setScreen(s.id)}>
              <span className="num">{i + 1}</span>
              {s.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        <div className="topbar">
          <div className="title">
            <h1>{input.name}</h1>
            <div className="meta">
              {project.scenarios.length > 1 && <>Сценарий: <b>{scenario.name}</b> · </>}
              {r ? (
                <>
                  {formatRu(r.projectStart)} → <b>{formatRu(r.projectFinish)}</b> · {r.durationCalendarDays} кал. дн. · достоверность{' '}
                  <span className={`badge ${CONFIDENCE_CLS[r.confidence.level]}`}>{CONFIDENCE_RU[r.confidence.level]}</span>
                </>
              ) : (
                <span className="badge critical">расчёт невозможен</span>
              )}
            </div>
          </div>
          <div className="actions">
            {r && (
              <Suspense fallback={<button className="btn" disabled>Экспорт…</button>}>
                <ExportMenu result={r} input={input} />
              </Suspense>
            )}
          </div>
        </div>

        {calc.error && (
          <div className="alert error">
            <b>{calc.error.message}</b>
            {calc.error.details.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {calc.error.details.map((d) => <li key={d}>{d}</li>)}
              </ul>
            )}
          </div>
        )}

        {screen === 'wizard' && <Wizard {...props} />}
        {screen === 'ops' && <Operations {...props} />}
        {screen === 'gantt' && <Gantt {...props} />}
        {screen === 'calendar' && <CalendarView {...props} />}
        {screen === 'critical' && <CriticalPath {...props} />}
        {screen === 'resources' && <Resources {...props} />}
        {screen === 'risks' && <Risks {...props} />}
        {screen === 'templates' && <Templates {...props} />}
        {screen === 'scenarios' && <Scenarios {...props} />}
      </main>
      <Drawer open={!!opened} onClose={() => setOpened(null)} title="Почему рассчитана эта дата?">
        {opened && r && <Explain op={r.operations.find((o) => o.id === opened.id) ?? opened} result={r} onOpen={setOpened} />}
      </Drawer>
    </div>
  );
}
