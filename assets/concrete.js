const {q, kv, ceil, nf} = BB;

/* ---------- объём монолитных конструкций и опалубка ---------- */
const KINDS = [
  ["slab", "Плита, ростверк, стяжка"],
  ["strip", "Ленточный фундамент"],
  ["wall", "Стена"],
  ["col", "Колонны, столбы прямоугольные"],
  ["round", "Сваи, столбы круглые"],
];
const is = (...k) => v => k.includes(v.kind);

BB.mount({
  id: "concVol",
  title: "Объём бетона и площадь опалубки",
  inputs: [
    {id: "kind", label: "Конструкция", type: "select", options: KINDS, value: "slab", wide: true},
    {id: "L", label: "Длина L", unit: "м", value: 24, step: 0.1, min: 0, show: is("slab", "strip", "wall"),
     hint: ""},
    {id: "B", label: "Ширина B", unit: "м", value: 12, step: 0.1, min: 0, show: is("slab", "strip")},
    {id: "h", label: "Толщина / высота h", unit: "м", value: 0.25, step: 0.01, min: 0, show: is("slab", "strip")},
    {id: "Hw", label: "Высота стены", unit: "м", value: 3, step: 0.05, min: 0, show: is("wall")},
    {id: "tw", label: "Толщина стены", unit: "м", value: 0.2, step: 0.01, min: 0, show: is("wall")},
    {id: "a", label: "Сечение a", unit: "м", value: 0.4, step: 0.01, min: 0, show: is("col")},
    {id: "b", label: "Сечение b", unit: "м", value: 0.4, step: 0.01, min: 0, show: is("col")},
    {id: "d", label: "Диаметр d", unit: "м", value: 0.5, step: 0.01, min: 0, show: is("round")},
    {id: "Hc", label: "Высота / длина", unit: "м", value: 3, step: 0.05, min: 0, show: is("col", "round")},
    {id: "n", label: "Количество", unit: "шт", value: 24, step: 1, min: 1, show: is("col", "round")},
    {id: "open", label: "Проёмы и отверстия", unit: "м²", value: 2, step: 0.1, min: 0, show: is("slab", "wall"),
     hint: "Площадь в плане для плиты, площадь в стене для стены"},
    {id: "floor", label: "Плита перекрытия: считать опалубку днища", type: "check", value: false, show: is("slab")},
    {id: "reserve", label: "Запас на потери", unit: "%", value: 2, step: 0.5, min: 0},
    {id: "mixer", label: "Объём миксера", unit: "м³", value: 9, step: 1, min: 1},
  ],
  compute(v) {
    let V = 0, S = 0, f = "", fs = "";
    if (v.kind === "slab") {
      const A = v.L * v.B - v.open;
      V = A * v.h; f = "(L·B − A_пр)·h";
      S = 2 * (v.L + v.B) * v.h + (v.floor ? A : 0); fs = v.floor ? "2(L+B)·h + днище" : "2(L+B)·h";
    } else if (v.kind === "strip") {
      V = v.L * v.B * v.h; f = "L·b·h";
      S = 2 * v.L * v.h; fs = "2·L·h";
    } else if (v.kind === "wall") {
      const A = v.L * v.Hw - v.open;
      V = A * v.tw; f = "(L·H − A_пр)·t";
      S = 2 * A; fs = "2·(L·H − A_пр)";
    } else if (v.kind === "col") {
      V = v.a * v.b * v.Hc * v.n; f = "a·b·H·n";
      S = 2 * (v.a + v.b) * v.Hc * v.n; fs = "2(a+b)·H·n";
    } else {
      V = Math.PI * v.d * v.d / 4 * v.Hc * v.n; f = "π·d²/4·H·n";
      S = Math.PI * v.d * v.Hc * v.n; fs = "π·d·H·n";
    }
    const Vo = V * (1 + v.reserve / 100);
    const trucks = ceil(Vo / v.mixer);
    const last = Vo - (trucks - 1) * v.mixer;
    const alerts = [];
    if (v.reserve > 5) alerts.push("<strong>Запас больше 5 %.</strong> Обычные потери бетона при укладке — 1–2 %. Проверьте, не заложен ли запас дважды.");
    if (V <= 0) alerts.push("<strong>Объём не получился.</strong> Проверьте размеры и площадь проёмов.");
    return {
      alerts,
      kpis: [["Бетон в заказ", kv(Vo, "м³", 1)], ["Миксеров", kv(trucks, "")], ["Опалубка", kv(S, "м²", 1)], ["Масса бетона", kv(V * 2.4, "т", 1)]],
      rows: [
        ["Объём по чертежу", f, q(V, "м³", 2), "total"],
        ["Запас на потери", `${nf(v.reserve, 1)} %`, q(Vo - V, "м³", 2)],
        ["Объём в заказ", "V·(1 + запас)", q(Vo, "м³", 2), "total"],
        ["Миксеров", `⌈V_заказа / ${nf(v.mixer, 0)}⌉`, String(trucks)],
        ["В последнем миксере", "", q(last, "м³", 2)],
        ["Площадь опалубки", fs, q(S, "м²", 1)],
        ["Масса бетона", "V·2,4 т/м³", q(V * 2.4, "т", 1)],
      ],
    };
  },
});

/* ---------- состав бетона ---------- */
// пропорции по массе Ц : П : Щ на цементе М400, щебень 5–20 мм; цемент из условия ~2200 кг сухих компонентов в 1 м³
const MIX = {
  "B7.5":  {m: "М100", p: 4.6, g: 7.0},
  "B12.5": {m: "М150", p: 3.5, g: 5.7},
  "B15":   {m: "М200", p: 2.8, g: 4.8},
  "B20":   {m: "М250", p: 2.1, g: 3.9},
  "B22.5": {m: "М300", p: 1.9, g: 3.7},
  "B25":   {m: "М350", p: 1.5, g: 3.2},
  "B30":   {m: "М400", p: 1.2, g: 2.7},
};
const DRY = 2200;
const cementOf = c => Math.round(DRY / (1 + c.p + c.g));

BB.mount({
  id: "concMix",
  title: "Расход материалов на бетон",
  inputs: [
    {id: "V", label: "Объём бетона", unit: "м³", value: 10, step: 0.5, min: 0},
    {id: "cls", label: "Класс бетона", type: "select", value: "B15",
     options: Object.entries(MIX).map(([k, c]) => [k, `${k.replace(".", ",")} (${c.m})`])},
    {id: "W", label: "Вода на 1 м³", unit: "л", value: 185, step: 5, min: 0, hint: "Подвижная смесь, щебень до 20 мм"},
    {id: "bag", label: "Мешок цемента", unit: "кг", value: 50, step: 1, min: 1},
    {id: "rs", label: "Насыпная плотность песка", unit: "кг/м³", value: 1500, step: 10, min: 1},
    {id: "rg", label: "Насыпная плотность щебня", unit: "кг/м³", value: 1400, step: 10, min: 1},
  ],
  compute(v) {
    const c = MIX[v.cls], C = cementOf(c), S = C * c.p, G = C * c.g;
    const tc = C * v.V, ts = S * v.V, tg = G * v.V, tw = v.W * v.V;
    // пропорция по объёму: насыпная плотность цемента ~1300 кг/м³
    const vc = C / 1300, vs = S / v.rs, vg = G / v.rg;
    return {
      alerts: v.V > 15 ? ["<strong>Больше 15 м³ выгоднее заказать на РБУ.</strong> Товарный бетон приходит с паспортом и стабильным качеством."] : [],
      kpis: [["Цемент", kv(ceil(tc / v.bag), "меш.")], ["Песок", kv(ts / v.rs, "м³", 1)], ["Щебень", kv(tg / v.rg, "м³", 1)], ["Вода", kv(tw, "л")]],
      rows: [
        ["Пропорция по массе Ц : П : Щ", c.m + ", цемент М400", `1 : ${nf(c.p, 1)} : ${nf(c.g, 1)}`],
        ["Пропорция по объёму Ц : П : Щ", "по насыпной плотности", `1 : ${nf(vs / vc, 1)} : ${nf(vg / vc, 1)}`],
        ["Цемент на 1 м³", "2200 / (1 + П + Щ)", q(C, "кг", 0)],
        ["Цемент всего", "C·V", `${q(tc, "кг", 0)} · ${ceil(tc / v.bag)} меш.`, "total"],
        ["Песок всего", "C·П·V", `${q(ts / 1000, "т", 2)} · ${q(ts / v.rs, "м³", 2)}`],
        ["Щебень всего", "C·Щ·V", `${q(tg / 1000, "т", 2)} · ${q(tg / v.rg, "м³", 2)}`],
        ["Вода всего", "W·V", q(tw, "л", 0)],
        ["В/Ц", "W / C", nf(v.W / C, 2)],
        ["На замес из 1 мешка", `${nf(v.bag, 0)} кг цемента`, `песок ${q(v.bag * c.p, "кг", 0)}, щебень ${q(v.bag * c.g, "кг", 0)}, вода ${q(v.bag * v.W / C, "л", 0)}`],
      ],
    };
  },
});

document.getElementById("mixTable").innerHTML = Object.entries(MIX).map(([k, c]) => {
  const C = cementOf(c);
  return `<tr><td>${k.replace(".", ",")}</td><td>${c.m}</td><td>1 : ${nf(c.p, 1)} : ${nf(c.g, 1)}</td><td>${C}</td><td>${Math.round(C * c.p)}</td><td>${Math.round(C * c.g)}</td></tr>`;
}).join("");
