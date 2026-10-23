const {q, kv, ceil, nf} = BB;

const DIAMS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40];
const massOf = d => 0.0061654 * d * d;               // кг/м, ρ = 7850 кг/м³
const dOpts = DIAMS.map(d => [String(d), `Ø${d}`]);

document.getElementById("massTable").innerHTML = DIAMS.map(d =>
  `<tr><td>Ø${d}</td><td>${nf(Math.PI * d * d / 400, 3)}</td><td>${nf(massOf(d), 3)}</td><td>${nf(1000 / massOf(d), 0)}</td></tr>`).join("");

// длина стержня с учётом стыков внахлёст, если он длиннее хлыста
function spliced(len, stock, lap) {
  if (len <= stock) return {pieces: 1, total: len};
  const pieces = ceil((len - lap) / (stock - lap));
  return {pieces, total: len + (pieces - 1) * lap};
}

/* ---------- масса и раскрой стержней ---------- */
BB.mount({
  id: "rebarMass",
  title: "Масса арматуры и раскрой хлыстов",
  inputs: [
    {id: "d", label: "Диаметр", type: "select", options: dOpts, value: "12"},
    {id: "n", label: "Количество стержней", unit: "шт", value: 120, step: 1, min: 1},
    {id: "len", label: "Длина стержня", unit: "м", value: 5.8, step: 0.05, min: 0},
    {id: "stock", label: "Длина хлыста", unit: "м", value: 11.7, step: 0.1, min: 1, hint: "Обычная мерная длина — 11,7 м"},
  ],
  compute(v) {
    const d = +v.d, m = massOf(d), total = v.n * v.len, mass = total * m;
    const alerts = [];
    let rows = [
      ["Масса 1 м", "0,00617·d²", q(m, "кг/м", 3)],
      ["Общая длина", "n·l", q(total, "м", 1)],
      ["Масса", "Σl·m", q(mass, "кг", 1), "total"],
    ];
    let stocks = NaN;
    if (v.len > v.stock) {
      alerts.push("<strong>Стержень длиннее хлыста.</strong> Нужен стык внахлёст или сварка. Для таких стержней считайте раскрой в калькуляторе сеток.");
    } else if (v.len > 0) {
      const per = Math.floor(v.stock / v.len + 1e-9);
      stocks = ceil(v.n / per);
      const waste = stocks * v.stock - total;
      rows.push(
        ["Стержней из одного хлыста", `⌊${nf(v.stock, 1)} / l⌋`, String(per)],
        ["Хлыстов", "⌈n / стержней из хлыста⌉", String(stocks), "total"],
        ["Обрезки", "хлысты·L_хл − Σl", `${q(waste, "м", 1)} · ${nf(waste / (stocks * v.stock) * 100, 1)} %`],
        ["Закупка по массе", "хлысты·L_хл·m", q(stocks * v.stock * m, "кг", 1)],
      );
    }
    return {alerts, kpis: [["Масса", kv(mass, "кг")], ["Хлыстов", kv(stocks, "шт")], ["Длина", kv(total, "м")]], rows};
  },
});

/* ---------- сетка плиты ---------- */
BB.mount({
  id: "rebarSlab",
  title: "Армирование плиты сетками",
  inputs: [
    {id: "L", label: "Длина плиты L", unit: "м", value: 24, step: 0.1, min: 0},
    {id: "B", label: "Ширина плиты B", unit: "м", value: 12, step: 0.1, min: 0},
    {id: "dx", label: "Стержни вдоль L", type: "select", options: dOpts, value: "12"},
    {id: "sx", label: "Шаг вдоль L", unit: "м", value: 0.2, step: 0.01, min: 0.05},
    {id: "dy", label: "Стержни вдоль B", type: "select", options: dOpts, value: "12"},
    {id: "sy", label: "Шаг вдоль B", unit: "м", value: 0.2, step: 0.01, min: 0.05},
    {id: "layers", label: "Сеток", type: "select", options: [["1", "1 (только низ)"], ["2", "2 (низ и верх)"]], value: "2"},
    {id: "c", label: "Защитный слой", unit: "м", value: 0.03, step: 0.005, min: 0, hint: "Обрезка стержня от грани"},
    {id: "lapK", label: "Нахлёст", unit: "d", value: 40, step: 5, min: 0, hint: "По проекту, обычно 30–50 диаметров"},
    {id: "stock", label: "Длина хлыста", unit: "м", value: 11.7, step: 0.1, min: 1},
    {id: "waste", label: "Запас на обрезки", unit: "%", value: 3, step: 0.5, min: 0},
    {id: "wire", label: "Вязальная проволока", unit: "% массы", value: 1, step: 0.1, min: 0},
  ],
  compute(v) {
    const layers = +v.layers;
    const dir = (len, across, d, s) => {
      const l = len - 2 * v.c, count = Math.floor((across - 2 * v.c) / s + 1e-9) + 1;
      const sp = spliced(l, v.stock, v.lapK * d / 1000);
      const length = count * sp.total * layers;
      return {l, count, sp, length, mass: length * massOf(d)};
    };
    const X = dir(v.L, v.B, +v.dx, v.sx), Y = dir(v.B, v.L, +v.dy, v.sy);
    const net = X.mass + Y.mass, gross = net * (1 + v.waste / 100), wire = gross * v.wire / 100;
    const nodes = X.count * Y.count * layers;
    const area = v.L * v.B;
    const desc = (D, d) => `${D.count} шт × ${nf(D.l, 2)} м${D.sp.pieces > 1 ? `, ${D.sp.pieces} куска с нахлёстом` : ""}`;
    const alerts = [];
    if (X.sp.pieces > 1 || Y.sp.pieces > 1)
      alerts.push("<strong>Есть стыки внахлёст.</strong> Располагайте их вразбежку: в одном сечении — не больше половины стержней, если проект не требует иного.");
    return {
      alerts,
      kpis: [["Арматура", kv(gross / 1000, "т", 2)], ["Расход", kv(gross / area, "кг/м²", 1)], ["Проволока", kv(wire, "кг")], ["Узлов", kv(nodes, "")]],
      rows: [
        [`Вдоль L, Ø${v.dx}`, desc(X), q(X.length, "м", 0)],
        [`Вдоль L, Ø${v.dx}, масса`, "Σl·m", q(X.mass, "кг", 0)],
        [`Вдоль B, Ø${v.dy}`, desc(Y), q(Y.length, "м", 0)],
        [`Вдоль B, Ø${v.dy}, масса`, "Σl·m", q(Y.mass, "кг", 0)],
        ["Масса по расчёту", `${layers} сетки`, q(net, "кг", 0)],
        ["С запасом на обрезки", `+${nf(v.waste, 1)} %`, q(gross, "кг", 0), "total"],
        ["Расход на 1 м² плиты", "M / (L·B)", q(gross / area, "кг/м²", 1)],
        ["Вязальная проволока", `${nf(v.wire, 1)} % массы`, q(wire, "кг", 0)],
        ["Узлов вязки", "n_L·n_B·сеток", nf(nodes, 0)],
      ],
    };
  },
});

/* ---------- хомуты ---------- */
BB.mount({
  id: "stirrups",
  title: "Хомуты колонн и балок",
  inputs: [
    {id: "b", label: "Сечение b", unit: "м", value: 0.4, step: 0.01, min: 0},
    {id: "h", label: "Сечение h", unit: "м", value: 0.4, step: 0.01, min: 0},
    {id: "c", label: "Защитный слой до хомута", unit: "м", value: 0.03, step: 0.005, min: 0},
    {id: "d", label: "Диаметр хомута", type: "select", options: dOpts.slice(0, 5), value: "8"},
    {id: "hookK", label: "Длина крюка", unit: "d", value: 10, step: 1, min: 0, hint: "Не меньше 75 мм; для сейсмики загиб 135°"},
    {id: "s", label: "Шаг хомутов", unit: "м", value: 0.15, step: 0.01, min: 0.03},
    {id: "Lz", label: "Зона сгущения у каждого конца", unit: "м", value: 0.5, step: 0.05, min: 0, hint: "0 — без сгущения"},
    {id: "sz", label: "Шаг в зоне сгущения", unit: "м", value: 0.1, step: 0.01, min: 0.03, show: v => v.Lz > 0},
    {id: "L", label: "Длина элемента", unit: "м", value: 3, step: 0.05, min: 0},
    {id: "n", label: "Элементов", unit: "шт", value: 10, step: 1, min: 1},
  ],
  compute(v) {
    const d = +v.d, hook = Math.max(v.hookK * d / 1000, 0.075);
    const one = 2 * (v.b - 2 * v.c) + 2 * (v.h - 2 * v.c) + 2 * hook;
    const Lz = Math.min(v.Lz, v.L / 2);
    const per = (Lz > 0 ? 2 * Math.floor(Lz / v.sz + 1e-9) : 0) + Math.floor((v.L - 2 * Lz) / v.s + 1e-9) + 1;
    const cnt = per * v.n, len = cnt * one, mass = len * massOf(d);
    return {
      kpis: [["Хомутов", kv(cnt, "шт")], ["Масса", kv(mass, "кг", 1)], ["Длина хомута", kv(one * 1000, "мм")]],
      rows: [
        ["Крюк", `max(${nf(v.hookK, 0)}d; 75 мм)`, q(hook * 1000, "мм", 0)],
        ["Длина заготовки хомута", "2(b−2a) + 2(h−2a) + 2·l_кр", q(one, "м", 3)],
        ["Хомутов на элемент", Lz > 0 ? "2·⌊L_з/s_з⌋ + ⌊(L−2L_з)/s⌋ + 1" : "⌊L/s⌋ + 1", String(per)],
        ["Хомутов всего", "× n", String(cnt), "total"],
        ["Общая длина", "", q(len, "м", 1)],
        ["Масса", "Σl·m", q(mass, "кг", 1), "total"],
      ],
    };
  },
});
