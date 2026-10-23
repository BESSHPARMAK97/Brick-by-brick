/* Общий движок калькуляторов: форма из описания полей, пересчёт на лету,
   ведомость, копирование отчёта, запоминание введённых значений в браузере. */
const BB = (() => {
  const nf = (x, d = 1) => Number.isFinite(x)
    ? x.toLocaleString("ru-RU", {minimumFractionDigits: d, maximumFractionDigits: d}) : "—";
  // число с единицей для ведомости
  const q = (x, unit = "", d = 1) => Number.isFinite(x) ? `${nf(x, d)}${unit ? " " + unit : ""}` : "—";
  const ceil = x => Number.isFinite(x) ? Math.ceil(x - 1e-9) : NaN;

  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || "null");
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }

  function mount(cfg) {
    const host = document.querySelector(`[data-calc="${cfg.id}"]`);
    if (!host) return;
    host.classList.add("calc");
    const pid = id => `${cfg.id}-${id}`;

    const field = f => {
      if (f.type === "check")
        return `<label class="check wide" data-f="${f.id}"><input type="checkbox" id="${pid(f.id)}"> ${f.label}</label>`;
      let ctl;
      if (f.type === "select")
        ctl = `<select id="${pid(f.id)}">${f.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`;
      else if (f.type === "textarea")
        ctl = `<textarea id="${pid(f.id)}" rows="${f.rows || 6}" spellcheck="false"></textarea>`;
      else
        ctl = `<input type="number" id="${pid(f.id)}" step="${f.step ?? "any"}"${f.min !== undefined ? ` min="${f.min}"` : ""} inputmode="decimal">`;
      const wide = f.wide || f.type === "textarea" ? "wide" : "";
      return `<label class="${wide}" data-f="${f.id}"><b>${f.label}${f.unit ? ", " + f.unit : ""}</b>${ctl}${f.hint ? `<small>${f.hint}</small>` : ""}</label>`;
    };

    host.innerHTML = `
      <div class="calc-head"><span class="tag">Калькулятор</span><h3>${cfg.title}</h3></div>
      <div class="calc-body">
        <form class="calc-form" autocomplete="off">${cfg.inputs.map(field).join("")}</form>
        <div class="calc-out" aria-live="polite">
          <div class="alerts"></div>
          <div class="headline"></div>
          <div class="svgbox" hidden></div>
          <div class="tbl"><table>
            <thead><tr><th>Позиция</th><th>Формула</th><th class="r">Значение</th></tr></thead>
            <tbody></tbody>
          </table></div>
          <div class="actions">
            <button type="button" data-a="copy">Скопировать отчёт</button>
            <button type="button" class="ghost" data-a="reset">Сбросить к примеру</button>
            <span class="copy-state" role="status"></span>
          </div>
          <textarea class="report" readonly hidden aria-label="Текст отчёта"></textarea>
        </div>
      </div>`;

    const form = host.querySelector("form");
    const el = id => host.querySelector("#" + pid(id));
    const key = "bb-" + cfg.id;
    const defaults = Object.fromEntries(cfg.inputs.map(f => [f.id, f.value]));

    function set(vals) {
      cfg.inputs.forEach(f => {
        const v = vals[f.id];
        if (v === undefined) return;
        if (f.type === "check") el(f.id).checked = !!v; else el(f.id).value = v;
      });
    }
    function raw() {
      const o = {};
      cfg.inputs.forEach(f => o[f.id] = f.type === "check" ? el(f.id).checked : el(f.id).value);
      return o;
    }
    function values() {
      const o = {};
      cfg.inputs.forEach(f => {
        const e = el(f.id);
        if (f.type === "check") o[f.id] = e.checked;
        else if (f.type === "select" || f.type === "textarea") o[f.id] = e.value;
        else { const x = parseFloat(String(e.value).replace(",", ".")); o[f.id] = Number.isFinite(x) ? x : 0; }
      });
      return o;
    }

    let report = "";
    function render() {
      const v = values();
      cfg.inputs.forEach(f => { if (f.show) host.querySelector(`[data-f="${f.id}"]`).hidden = !f.show(v); });
      let r;
      try { r = cfg.compute(v) || {}; }
      catch (e) { r = {alerts: ["<strong>Не удалось посчитать.</strong> Проверьте исходные данные."]}; }
      const rows = r.rows || [];
      host.querySelector(".alerts").innerHTML = (r.alerts || []).map(t => `<div class="alert">${t}</div>`).join("");
      host.querySelector(".headline").innerHTML = (r.kpis || []).map(([k, val], i) =>
        `<div class="kpi${i === 0 ? " main" : ""}"><span class="k">${k}</span><span class="v">${val}</span></div>`).join("");
      host.querySelector(".headline").hidden = !(r.kpis || []).length;
      const box = host.querySelector(".svgbox");
      box.hidden = !r.svg; box.innerHTML = r.svg || "";
      host.querySelector("tbody").innerHTML = rows.map(([n, f, val, cls]) =>
        `<tr class="${cls || ""}"><td>${n}</td><td class="f">${f || ""}</td><td class="n">${val}</td></tr>`).join("");
      host.querySelector(".tbl").hidden = !rows.length;
      report = cfg.title + "\n" + rows.map(([n, f, val]) =>
        `${String(n).replace(/<[^>]+>/g, "").trim()}${f ? " (" + f + ")" : ""}: ${val}`).join("\n");
      store(key, raw());
    }

    form.addEventListener("input", render);
    form.addEventListener("change", render);
    form.addEventListener("submit", e => e.preventDefault());
    host.querySelector('[data-a="reset"]').addEventListener("click", () => {
      set(defaults); render(); host.querySelector(".copy-state").textContent = "";
    });
    host.querySelector('[data-a="copy"]').addEventListener("click", () => {
      const ta = host.querySelector(".report"), st = host.querySelector(".copy-state");
      ta.value = report;
      const fallback = () => { ta.hidden = false; ta.focus(); ta.select(); st.textContent = "Выделите текст и скопируйте вручную"; };
      try { navigator.clipboard.writeText(report).then(() => { st.textContent = "Отчёт скопирован"; }, fallback); }
      catch (e) { fallback(); }
    });

    set(defaults);
    set(store(key) || {});
    render();
  }

  // значение для плитки сводки
  const kv = (x, unit, d = 0) => Number.isFinite(x) ? `${nf(x, d)}${unit ? ` <small>${unit}</small>` : ""}` : "—";

  return {nf, q, kv, ceil, mount};
})();
