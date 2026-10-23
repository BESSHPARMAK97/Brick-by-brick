const {q, kv, ceil, nf} = BB;

/* ---------- траншея ---------- */
BB.mount({
  id: "trench",
  title: "Траншея под трубу или ленточный фундамент",
  inputs: [
    {id: "L", label: "Длина траншеи L", unit: "м", value: 50, step: 1, min: 0},
    {id: "b", label: "Ширина по дну b", unit: "м", value: 0.8, step: 0.05, min: 0},
    {id: "H1", label: "Глубина в начале H₁", unit: "м", value: 1.8, step: 0.05, min: 0},
    {id: "H2", label: "Глубина в конце H₂", unit: "м", value: 2.4, step: 0.05, min: 0},
    {id: "m", label: "Откос 1 : m", value: 0.5, step: 0.05, min: 0, wide: true,
     hint: "По таблице крутизны откосов (см. страницу котлована). 0 — вертикальные стенки."},
    {id: "D", label: "Наружный диаметр трубы D", unit: "м", value: 0.315, step: 0.005, min: 0, hint: "0 — траншея без трубы"},
    {id: "t", label: "Песчаная подушка", unit: "м", value: 0.1, step: 0.05, min: 0},
    {id: "s", label: "Присыпка над трубой", unit: "м", value: 0.3, step: 0.05, min: 0, show: v => v.D > 0},
    {id: "ksand", label: "Kупл песка", value: 1.15, step: 0.01, min: 1},
    {id: "kp", label: "Kр грунта", value: 1.2, step: 0.01, min: 1},
    {id: "kor", label: "Kор грунта", value: 1.05, step: 0.01, min: 1},
  ],
  compute(v) {
    const F = h => (v.b + v.m * h) * h;
    const Hm = (v.H1 + v.H2) / 2;
    const F1 = F(v.H1), F2 = F(v.H2), Fm = F(Hm);
    const V = v.L / 6 * (F1 + 4 * Fm + F2);
    const hz = v.D > 0 ? v.t + v.D + v.s : v.t;          // высота песчаной зоны от дна
    const Vzone = Math.min(F(hz) * v.L, V);
    const Vpipe = Math.PI * v.D * v.D / 4 * v.L;
    const Vsand = Math.max(Vzone - Vpipe, 0) * v.ksand;
    const Vback = Math.max(V - Vzone, 0);
    const Vkeep = Vback / v.kor;
    const Vexp = Math.max(V - Vkeep, 0) * v.kp;

    const alerts = [];
    const Hmax = Math.max(v.H1, v.H2);
    if (v.m === 0 && Hmax > 1)
      alerts.push("<strong>Вертикальные стенки без крепления</strong> допустимы не глубже 1 м в насыпных и песчаных грунтах, 1,25 м в супесях, 1,5 м в суглинках и глинах. Глубже — откосы или крепление.");
    if (hz > Math.min(v.H1, v.H2)) alerts.push("<strong>Песчаная зона выше бровки.</strong> Проверьте глубину, диаметр трубы и толщину присыпки.");
    if (v.D > 0 && v.b < v.D + 0.3) alerts.push("<strong>Узкое дно.</strong> Для укладки трубы ширина по дну обычно не меньше D + 0,3…0,5 м.");

    return {
      alerts,
      kpis: [["Выемка", kv(V, "м³")], ["Вывоз (рыхлый)", kv(Vexp, "м³")], ["Песок завезти", kv(Vsand, "м³", 1)], ["Обратная засыпка", kv(Vback, "м³")]],
      svg: trenchSvg(v, Hmax, hz),
      rows: [
        ["Сечение в начале F₁", "(b + m·H₁)·H₁", q(F1, "м²", 3)],
        ["Сечение посередине F_ср", "при H = (H₁+H₂)/2", q(Fm, "м²", 3)],
        ["Сечение в конце F₂", "(b + m·H₂)·H₂", q(F2, "м²", 3)],
        ["Объём выемки", "L/6·(F₁ + 4F_ср + F₂)", q(V, "м³"), "total"],
        ["Зона песка (подушка + присыпка)", v.D > 0 ? "F(t + D + s)·L" : "F(t)·L", q(Vzone, "м³")],
        ["Объём трубы", "π·D²/4·L", q(Vpipe, "м³", 2)],
        ["Песок с уплотнением", "(V_зоны − V_трубы)·Kупл", q(Vsand, "м³")],
        ["Обратная засыпка местным грунтом", "V − V_зоны", q(Vback, "м³")],
        ["Оставить грунта у траншеи", "V_засыпки / Kор", q(Vkeep, "м³")],
        ["Вывоз (рыхлый)", "(V − V_ост)·Kр", q(Vexp, "м³"), "total"],
      ],
    };
  },
});

function trenchSvg(v, H, hz) {
  const W = 640, Ht = 240, pad = 30;
  const top = v.b + 2 * v.m * H;
  const s = Math.min((W - 2 * pad - 80) / Math.max(top, 0.1), (Ht - 2 * pad) / Math.max(H, 0.1));
  const cx = W / 2 - 30, gy = pad, dy = gy + H * s;
  const X = x => cx + x * s, Y = h => dy - h * s;     // h — высота от дна
  const hb = v.b / 2, ht = top / 2;
  const half = h => hb + v.m * h;
  const zh = Math.min(hz, H);
  const out = [`<defs><pattern id="tr-h" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="var(--soil)"/><line x1="0" y1="0" x2="0" y2="8" stroke="var(--soil-hatch)" stroke-width="1.4"/></pattern></defs>`];
  out.push(`<rect x="0" y="${gy}" width="${W}" height="${Ht - gy}" fill="url(#tr-h)"/>`);
  out.push(`<polygon points="${X(-ht)},${gy} ${X(ht)},${gy} ${X(hb)},${dy} ${X(-hb)},${dy}" fill="var(--panel)"/>`);
  if (zh > 0) out.push(`<polygon points="${X(-hb)},${dy} ${X(hb)},${dy} ${X(half(zh))},${Y(zh)} ${X(-half(zh))},${Y(zh)}" fill="var(--accent-soft)"/>`);
  if (v.D > 0) out.push(`<circle cx="${cx}" cy="${Y(v.t + v.D / 2)}" r="${v.D / 2 * s}" fill="var(--panel)" stroke="var(--fill)" stroke-width="2"/>`);
  out.push(`<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="var(--fg)" stroke-width="1.5"/>`);
  out.push(`<polyline points="${X(-ht)},${gy} ${X(-hb)},${dy} ${X(hb)},${dy} ${X(ht)},${gy}" fill="none" stroke="var(--fg)" stroke-width="2"/>`);
  const t = (x, y, s, a = "middle") => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${a}" font-family="JetBrains Mono, monospace" font-size="12" fill="var(--fg)">${s}</text>`;
  out.push(t(cx, dy + 18, `b = ${nf(v.b, 2)} м`));
  out.push(t(X(ht) + 14, (gy + dy) / 2, `H = ${nf(H, 2)} м`, "start"));
  if (zh > 0) out.push(t(X(ht) + 14, Y(zh / 2) + 4, "песок", "start"));
  return `<svg viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Сечение траншеи на большей глубине">${out.join("")}</svg>`;
}

/* ---------- планировка методом квадратов ---------- */
BB.mount({
  id: "grid",
  title: "Планировка площадки методом квадратов",
  inputs: [
    {id: "z", label: "Природные отметки в узлах сетки", unit: "м", type: "textarea", rows: 6,
     value: "101.20 101.05 100.85 100.70 100.40\n101.00 100.80 100.60 100.45 100.20\n100.75 100.55 100.40 100.20 99.95\n100.50 100.35 100.15 99.95 99.70",
     hint: "Каждая строка — ряд узлов с севера на юг, отметки через пробел. Можно вставить из Excel."},
    {id: "a", label: "Сторона квадрата a", unit: "м", value: 20, step: 1, min: 1},
    {id: "mode", label: "Проектная отметка", type: "select", options: [["bal", "нулевой баланс"], ["set", "задать вручную"]], value: "bal"},
    {id: "H0", label: "Проектная отметка H₀", unit: "м", value: 100.5, step: 0.01, show: v => v.mode === "set", wide: true},
  ],
  compute(v) {
    const rows = v.z.split("\n").map(l => l.trim()).filter(Boolean)
      .map(l => l.split(/[\s;]+/).map(s => parseFloat(s.replace(",", "."))));
    const nc = rows[0]?.length || 0;
    if (rows.length < 2 || nc < 2 || rows.some(r => r.length !== nc || r.some(x => !Number.isFinite(x))))
      return {alerts: ["<strong>Сетка не прочитана.</strong> Нужно минимум 2 ряда по 2 отметки, в каждом ряду одинаковое число чисел."]};
    const nr = rows.length, n = (nr - 1) * (nc - 1), a2 = v.a * v.a;
    // вес узла — число квадратов, в которые он входит
    let sw = 0;
    rows.forEach((r, i) => r.forEach((z, j) => {
      const w = (i > 0 && i < nr - 1 ? 2 : 1) * (j > 0 && j < nc - 1 ? 2 : 1);
      sw += w * z;
    }));
    const Hbal = sw / (4 * n);
    const H0 = v.mode === "set" ? v.H0 : Hbal;
    const h = rows.map(r => r.map(z => H0 - z));
    let fill = 0, cut = 0;
    const cells = [];
    for (let i = 0; i < nr - 1; i++) for (let j = 0; j < nc - 1; j++) {
      const c = [h[i][j], h[i][j + 1], h[i + 1][j + 1], h[i + 1][j]];
      const pos = c.filter(x => x > 0).reduce((s, x) => s + x, 0);
      const neg = c.filter(x => x < 0).reduce((s, x) => s + x, 0);
      const abs = pos - neg;
      let f = 0, k = 0;
      if (neg === 0) f = a2 * pos / 4;
      else if (pos === 0) k = -a2 * neg / 4;
      else { f = a2 / 4 * pos * pos / abs; k = a2 / 4 * neg * neg / abs; }
      fill += f; cut += k;
      cells.push({i, j, f, k});
    }
    const zs = rows.flat();
    const alerts = [];
    if (v.mode === "set" && (H0 < Math.min(...zs) - 5 || H0 > Math.max(...zs) + 5))
      alerts.push("<strong>Проектная отметка далеко от рельефа.</strong> Проверьте, что отметки введены в той же системе высот.");
    return {
      alerts,
      kpis: [["Выемка", kv(cut, "м³")], ["Насыпь", kv(fill, "м³")], ["Баланс", kv(cut - fill, "м³")], ["H₀", kv(H0, "м", 2)]],
      svg: gridSvg(h, cells, nr, nc),
      rows: [
        ["Сетка", "ряды × узлы", `${nr} × ${nc}, квадратов ${n}`],
        ["Площадь площадки", "n·a²", q(n * a2, "м²", 0)],
        ["Отметка нулевого баланса", "(ΣH₁ + 2ΣH₂ + 4ΣH₄)/(4n)", q(Hbal, "м", 3)],
        ["Принятая проектная отметка H₀", v.mode === "set" ? "задана" : "= нулевой баланс", q(H0, "м", 3)],
        ["Выемка", "Σ по квадратам", q(cut, "м³"), "total"],
        ["Насыпь", "Σ по квадратам", q(fill, "м³"), "total"],
        ["Баланс (+ избыток грунта)", "V_выем − V_нас", q(cut - fill, "м³")],
      ],
    };
  },
});

function gridSvg(h, cells, nr, nc) {
  const pad = 36, s = Math.min(560 / (nc - 1), 320 / (nr - 1), 120);
  const W = (nc - 1) * s + 2 * pad, H = (nr - 1) * s + 2 * pad;
  const X = j => pad + j * s, Y = i => pad + i * s;
  const out = [];
  cells.forEach(c => {
    const net = c.f - c.k;
    out.push(`<rect x="${X(c.j)}" y="${Y(c.i)}" width="${s}" height="${s}" fill="${net >= 0 ? "var(--fill-soft)" : "var(--accent-soft)"}" stroke="var(--line)"/>`);
    if (s >= 56) out.push(`<text x="${X(c.j) + s / 2}" y="${Y(c.i) + s / 2 + 4}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" fill="${net >= 0 ? "var(--fill)" : "var(--accent)"}">${net >= 0 ? "+" : "−"}${nf(Math.abs(net), 0)}</text>`);
  });
  out.push(`<rect x="${pad}" y="${pad}" width="${(nc - 1) * s}" height="${(nr - 1) * s}" fill="none" stroke="var(--fg)" stroke-width="1.5"/>`);
  h.forEach((r, i) => r.forEach((x, j) => {
    out.push(`<circle cx="${X(j)}" cy="${Y(i)}" r="2.5" fill="var(--fg)"/>`);
    out.push(`<text x="${X(j) + 4}" y="${Y(i) - 5}" font-family="JetBrains Mono, monospace" font-size="10" fill="${x >= 0 ? "var(--fill)" : "var(--accent)"}">${x >= 0 ? "+" : "−"}${nf(Math.abs(x), 2)}</text>`);
  }));
  return `<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="Сетка квадратов с рабочими отметками">${out.join("")}</svg>`;
}
