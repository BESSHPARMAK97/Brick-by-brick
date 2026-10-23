const {q, kv, ceil, nf} = BB;

/* ---------- кирпичная кладка ---------- */
const BRICKS = {s: {h: 0.065, name: "одинарный"}, m: {h: 0.088, name: "полуторный"}, d: {h: 0.138, name: "двойной"}};
const THICK = {"0.5": 0.12, "1": 0.25, "1.5": 0.38, "2": 0.51, "2.5": 0.64};
const perM2 = (fmt, k, jv, jh) => 2 * k / ((0.25 + jv) * (BRICKS[fmt].h + jh));

document.getElementById("brickTable").innerHTML = Object.entries(BRICKS).map(([k, b]) =>
  `<tr><td>${b.name[0].toUpperCase() + b.name.slice(1)}, 250×120×${b.h * 1000}</td>${["0.5", "1", "1.5", "2"].map(t =>
    `<td>${nf(perM2(k, +t, 0.01, 0.01), 0)}</td>`).join("")}</tr>`).join("");

BB.mount({
  id: "brick",
  title: "Кирпичная кладка",
  inputs: [
    {id: "L", label: "Длина стен", unit: "м", value: 30, step: 0.1, min: 0},
    {id: "H", label: "Высота", unit: "м", value: 3, step: 0.05, min: 0},
    {id: "open", label: "Проёмы", unit: "м²", value: 12, step: 0.1, min: 0, hint: "По наружному обводу коробок"},
    {id: "k", label: "Толщина стены", type: "select", value: "1",
     options: Object.entries(THICK).map(([k, t]) => [k, `${k.replace(".", ",")} кирп. (${t * 1000} мм)`])},
    {id: "fmt", label: "Кирпич", type: "select", value: "s", wide: true,
     options: Object.entries(BRICKS).map(([k, b]) => [k, `${b.name}, 250×120×${b.h * 1000}`])},
    {id: "jv", label: "Вертикальный шов", unit: "мм", value: 10, step: 1, min: 0},
    {id: "jh", label: "Горизонтальный шов", unit: "мм", value: 10, step: 1, min: 0, hint: "Обычно 10–12 мм"},
    {id: "waste", label: "Запас на бой", unit: "%", value: 5, step: 0.5, min: 0},
    {id: "pallet", label: "Кирпичей на поддоне", unit: "шт", value: 300, step: 10, min: 1, hint: "Уточните у завода"},
  ],
  compute(v) {
    const A = v.L * v.H - v.open, k = +v.k, t = THICK[v.k], b = BRICKS[v.fmt];
    const n1 = perM2(v.fmt, k, v.jv / 1000, v.jh / 1000);
    const N = A * n1, Nw = N * (1 + v.waste / 100);
    const Vm = A * t, Vb = N * 0.25 * 0.12 * b.h, Vr = Math.max(Vm - Vb, 0) * (1 + v.waste / 100);
    const alerts = A <= 0 ? ["<strong>Площадь стен не больше проёмов.</strong> Проверьте размеры."] : [];
    return {
      alerts,
      kpis: [["Кирпич", kv(ceil(Nw), "шт")], ["Поддонов", kv(ceil(Nw / v.pallet), "")], ["Раствор", kv(Vr, "м³", 2)], ["Кладка", kv(Vm, "м³", 1)]],
      rows: [
        ["Площадь стен за вычетом проёмов", "L·H − A_пр", q(A, "м²", 2)],
        ["Кирпичей на 1 м²", "2k / ((l + δв)(h + δг))", nf(n1, 1)],
        ["Кирпич по расчёту", "A·n₁", q(N, "шт", 0)],
        ["Кирпич с запасом", `+${nf(v.waste, 1)} %`, q(ceil(Nw), "шт", 0), "total"],
        ["Поддонов", `⌈N / ${nf(v.pallet, 0)}⌉`, String(ceil(Nw / v.pallet))],
        ["Объём кладки", "A·t", q(Vm, "м³", 2)],
        ["Раствор", "(V_кл − V_кирп)·(1 + запас)", q(Vr, "м³", 2), "total"],
        ["Раствор на 1 м³ кладки", "", q(Vr / Vm, "м³", 3)],
      ],
    };
  },
});

/* ---------- газоблок ---------- */
BB.mount({
  id: "aac",
  title: "Кладка из газоблока",
  inputs: [
    {id: "L", label: "Длина стен", unit: "м", value: 40, step: 0.1, min: 0},
    {id: "H", label: "Высота", unit: "м", value: 3, step: 0.05, min: 0},
    {id: "open", label: "Проёмы", unit: "м²", value: 14, step: 0.1, min: 0},
    {id: "bl", label: "Длина блока", unit: "мм", value: 600, step: 10, min: 1},
    {id: "bh", label: "Высота блока", unit: "мм", value: 200, step: 10, min: 1},
    {id: "bt", label: "Толщина блока", unit: "мм", value: 300, step: 10, min: 1},
    {id: "glue", label: "Клей", unit: "кг/м³", value: 25, step: 1, min: 0, hint: "При шве 2–3 мм обычно 25–30 кг/м³"},
    {id: "bag", label: "Мешок клея", unit: "кг", value: 25, step: 1, min: 1},
    {id: "waste", label: "Запас на подрезку", unit: "%", value: 5, step: 0.5, min: 0},
  ],
  compute(v) {
    const A = v.L * v.H - v.open, l = v.bl / 1000, h = v.bh / 1000, t = v.bt / 1000;
    const N = A / (l * h), Nw = N * (1 + v.waste / 100), V = A * t, Vw = V * (1 + v.waste / 100);
    const glue = V * v.glue;
    const rows = Math.floor(v.H / h + 1e-9), rr = rows > 0 ? 1 + Math.floor((rows - 1) / 4) : 0;
    return {
      kpis: [["Блоков", kv(ceil(Nw), "шт")], ["Объём", kv(Vw, "м³", 1)], ["Клей", kv(ceil(glue / v.bag), "меш.")]],
      rows: [
        ["Площадь стен за вычетом проёмов", "L·H − A_пр", q(A, "м²", 2)],
        ["Блоков по расчёту", "A / (l·h)", q(N, "шт", 0)],
        ["Блоков с запасом", `+${nf(v.waste, 1)} %`, q(ceil(Nw), "шт", 0), "total"],
        ["Объём кладки", "A·t", q(V, "м³", 2)],
        ["Объём к заказу", `+${nf(v.waste, 1)} %`, q(Vw, "м³", 2), "total"],
        ["Клей", `V·${nf(v.glue, 0)} кг/м³`, `${q(glue, "кг", 0)} · ${ceil(glue / v.bag)} меш.`],
        ["Рядов кладки", "⌊H / h⌋", String(rows)],
        ["Армируемых рядов", "первый и каждый 4-й", String(rr)],
        ["Арматура Ø8 в штрабах", "2 прутка × L × ряды", q(2 * v.L * rr, "м", 0)],
      ],
    };
  },
});

/* ---------- штукатурка ---------- */
const PLASTER = {gyp: [0.9, "гипсовая"], cem: [1.7, "цементно-песчаная"], lime: [1.5, "цементно-известковая"]};
BB.mount({
  id: "plaster",
  title: "Штукатурка",
  inputs: [
    {id: "A", label: "Площадь стен", unit: "м²", value: 120, step: 1, min: 0},
    {id: "t", label: "Средняя толщина", unit: "мм", value: 15, step: 1, min: 0, hint: "По замерам отклонений плюс слой над маяком"},
    {id: "type", label: "Смесь", type: "select", value: "gyp", options: Object.entries(PLASTER).map(([k, [r, n]]) => [k, `${n}, ${nf(r, 1)} кг/м² на 1 мм`])},
    {id: "rate", label: "Свой расход", unit: "кг/м²·мм", value: 0, step: 0.1, min: 0, hint: "0 — по выбранной смеси; иначе с мешка"},
    {id: "bag", label: "Мешок", unit: "кг", value: 30, step: 1, min: 1},
    {id: "waste", label: "Запас", unit: "%", value: 5, step: 0.5, min: 0},
  ],
  compute(v) {
    const r = v.rate > 0 ? v.rate : PLASTER[v.type][0];
    const kg = v.A * v.t * r * (1 + v.waste / 100);
    const alerts = [];
    if (v.type === "gyp" && v.t > 50) alerts.push("<strong>Гипсовый слой толще 50 мм</strong> обычно не наносят за один раз. Выровняйте основание или наносите по сетке в несколько слоёв.");
    return {
      alerts,
      kpis: [["Смесь", kv(kg, "кг")], ["Мешков", kv(ceil(kg / v.bag), "")]],
      rows: [
        ["Расход", v.rate > 0 ? "задан" : PLASTER[v.type][1], q(r, "кг/м² на 1 мм", 2)],
        ["Смесь с запасом", "A·t·q·(1 + запас)", q(kg, "кг", 0), "total"],
        ["Мешков", `⌈M / ${nf(v.bag, 0)}⌉`, String(ceil(kg / v.bag))],
        ["Расход на 1 м²", "t·q", q(v.t * r, "кг", 1)],
      ],
    };
  },
});

/* ---------- стяжка ---------- */
BB.mount({
  id: "screed",
  title: "Стяжка пола",
  inputs: [
    {id: "A", label: "Площадь", unit: "м²", value: 85, step: 1, min: 0},
    {id: "t", label: "Толщина", unit: "мм", value: 50, step: 5, min: 0},
    {id: "mode", label: "Материал", type: "select", value: "ready", wide: true,
     options: [["ready", "готовая сухая смесь (ЦПС)"], ["mix", "самозамес цемент : песок 1 : 3"]]},
    {id: "rate", label: "Расход смеси", unit: "кг/м²·мм", value: 1.9, step: 0.05, min: 0, show: v => v.mode === "ready", hint: "С мешка, обычно 1,8–2,0"},
    {id: "bag", label: "Мешок смеси", unit: "кг", value: 40, step: 1, min: 1, show: v => v.mode === "ready"},
    {id: "cbag", label: "Мешок цемента", unit: "кг", value: 50, step: 1, min: 1, show: v => v.mode === "mix"},
    {id: "waste", label: "Запас", unit: "%", value: 5, step: 0.5, min: 0},
  ],
  compute(v) {
    const V = v.A * v.t / 1000, w = 1 + v.waste / 100;
    const alerts = [];
    if (v.t < 40) alerts.push("<strong>Тоньше 40 мм</strong> «плавающую» стяжку по звукоизоляции или утеплителю не делают: она треснет.");
    if (v.mode === "ready") {
      const kg = v.A * v.t * v.rate * w;
      return {
        alerts,
        kpis: [["Смесь", kv(kg / 1000, "т", 2)], ["Мешков", kv(ceil(kg / v.bag), "")], ["Объём", kv(V, "м³", 2)]],
        rows: [
          ["Объём стяжки", "A·t", q(V, "м³", 2)],
          ["Смесь с запасом", "A·t·q·(1 + запас)", q(kg, "кг", 0), "total"],
          ["Мешков", `⌈M / ${nf(v.bag, 0)}⌉`, String(ceil(kg / v.bag))],
        ],
      };
    }
    const dry = V * 1900 * w, C = dry / 4, S = dry * 3 / 4;
    return {
      alerts,
      kpis: [["Цемент", kv(ceil(C / v.cbag), "меш.")], ["Песок", kv(S / 1500, "м³", 2)], ["Фибра", kv(V * 0.8, "кг", 1)]],
      rows: [
        ["Объём стяжки", "A·t", q(V, "м³", 2)],
        ["Сухая смесь с запасом", "V·1900 кг/м³·(1 + запас)", q(dry, "кг", 0)],
        ["Цемент М400", "1/4 сухой смеси", `${q(C, "кг", 0)} · ${ceil(C / v.cbag)} меш.`, "total"],
        ["Песок", "3/4 сухой смеси", `${q(S / 1000, "т", 2)} · ${q(S / 1500, "м³", 2)}`, "total"],
        ["Фибра полипропиленовая", "0,8 кг/м³", q(V * 0.8, "кг", 1)],
      ],
    };
  },
});

/* ---------- утепление ---------- */
BB.mount({
  id: "insul",
  title: "Утепление фасада плитами",
  inputs: [
    {id: "A", label: "Площадь", unit: "м²", value: 200, step: 1, min: 0},
    {id: "t", label: "Толщина", unit: "мм", value: 100, step: 10, min: 0},
    {id: "pl", label: "Длина плиты", unit: "мм", value: 1200, step: 10, min: 1},
    {id: "pw", label: "Ширина плиты", unit: "мм", value: 600, step: 10, min: 1},
    {id: "pack", label: "Плит в упаковке", unit: "шт", value: 4, step: 1, min: 1},
    {id: "dow", label: "Дюбелей на 1 м²", unit: "шт", value: 6, step: 1, min: 0, hint: "Больше у углов здания"},
    {id: "glue", label: "Клей для приклеивания", unit: "кг/м²", value: 5, step: 0.5, min: 0},
    {id: "base", label: "Базовый армирующий слой", unit: "кг/м²", value: 4, step: 0.5, min: 0},
    {id: "waste", label: "Запас", unit: "%", value: 5, step: 0.5, min: 0},
  ],
  compute(v) {
    const w = 1 + v.waste / 100, plate = v.pl * v.pw / 1e6;
    const N = ceil(v.A / plate * w), V = v.A * v.t / 1000 * w;
    return {
      kpis: [["Плит", kv(N, "шт")], ["Упаковок", kv(ceil(N / v.pack), "")], ["Объём", kv(V, "м³", 1)], ["Дюбелей", kv(ceil(v.A * v.dow * w), "шт")]],
      rows: [
        ["Утеплитель", "A·t·(1 + запас)", q(V, "м³", 2), "total"],
        ["Плит", "A / (l·b)·(1 + запас)", `${N} шт · ${ceil(N / v.pack)} упак.`],
        ["Дюбели-грибки", "A·n·(1 + запас)", q(ceil(v.A * v.dow * w), "шт", 0)],
        ["Длина дюбеля", "не меньше t + 60 мм", q(v.t + 60, "мм", 0)],
        ["Клей для приклеивания", "A·q", q(v.A * v.glue * w, "кг", 0)],
        ["Базовый слой", "A·q", q(v.A * v.base * w, "кг", 0)],
        ["Стеклосетка", "A·1,1 (нахлёст 10 см)", q(v.A * 1.1, "м²", 0)],
      ],
    };
  },
});

/* ---------- гидроизоляция ---------- */
BB.mount({
  id: "wp",
  title: "Гидроизоляция рулонными материалами",
  inputs: [
    {id: "Ah", label: "Горизонтальные поверхности", unit: "м²", value: 300, step: 1, min: 0},
    {id: "Av", label: "Вертикальные поверхности", unit: "м²", value: 180, step: 1, min: 0},
    {id: "layers", label: "Слоёв", type: "select", value: "2", options: [["1", "1"], ["2", "2"], ["3", "3"]]},
    {id: "roll", label: "Площадь рулона", unit: "м²", value: 10, step: 0.5, min: 1},
    {id: "lap", label: "Коэффициент на нахлёсты", value: 1.15, step: 0.01, min: 1, hint: "Продольный и торцевой нахлёст ~10–15 см"},
    {id: "primer", label: "Праймер", unit: "л/м²", value: 0.3, step: 0.05, min: 0},
  ],
  compute(v) {
    const A = v.Ah + v.Av, M = A * +v.layers * v.lap;
    return {
      kpis: [["Рулонов", kv(ceil(M / v.roll), "шт")], ["Материал", kv(M, "м²")], ["Праймер", kv(A * v.primer, "л")]],
      rows: [
        ["Изолируемая площадь", "A_гор + A_верт", q(A, "м²", 0)],
        ["Материал", "A·слоёв·k", q(M, "м²", 0), "total"],
        ["Рулонов", `⌈M / ${nf(v.roll, 1)}⌉`, String(ceil(M / v.roll)), "total"],
        ["Праймер", "A·q", q(A * v.primer, "л", 0)],
      ],
    };
  },
});
