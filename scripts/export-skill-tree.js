// Генерирует docs/templates/*.md/.docx/.csv и docs/checklists.md из данных prototype/index.html
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "prototype/index.html"), "utf8");
const pick = id => html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'))[1];
const ctx = { window: {}, TextEncoder };
vm.runInNewContext(pick("tree-data") + "\n" + pick("tree-data-kk") + "\n" + pick("regions") + "\n" + pick("docx-lib"), ctx);
const T = ctx.window.TREE;
const label = Object.fromEntries(T.fields.map(f => [f.id, f.blank || f.label]));
// Поля карточки проекта в выгрузке остаются пустыми: [Название ЖК], [Город] и т.д.
const blank = body => body.replace(/\{\{(\w+)\}\}/g, (m, id) => "[" + label[id] + "]");

const outDir = path.join(root, "docs/templates");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const disclaimer = "> Образец для ознакомления. Перед использованием адаптируйте документ с юристом к действующему законодательству РК.";
const index = ["# Образцы документов", "", disclaimer, ""];
const checklist = ["# Чек-листы перехода между этапами", "", "Этап считается пройденным, когда отмечены все пункты. Следующий этап открывается, когда пройдены все этапы из строки «Требует».", "", "Интерактивная версия: раздел «Дорожная карта» портала, [prototype/index.html](../prototype/index.html).", ""];

T.nodes.forEach(n => {
  index.push(`## ${n.code}. ${n.name}`, "");
  checklist.push(`## ${n.code}. ${n.name} (LVL ${n.lvl}, ${n.phase})`, "");
  checklist.push(`**Срок:** ${n.dur}  `);
  checklist.push(`**Требует:** ${n.req.length ? n.req.map(r => T.nodes.find(x => x.id === r).name).join(", ") : "стартовый этап"}`, "");
  checklist.push(n.desc, "");
  n.tasks.forEach(t => checklist.push(`- [ ] ${t}`));
  checklist.push("");
  const docLinks = [];
  n.docs.forEach(d => {
    const t = T.templates[d];
    const base = `${n.code}-${d}`;
    const file = base + (t.ext === "csv" ? ".csv" : ".md");
    if (t.ext === "csv") {
      fs.writeFileSync(path.join(outDir, file), "\uFEFF" + t.body + "\n");
      index.push(`- [${t.title}](${file})`);
    } else {
      const body = blank(t.body);
      fs.writeFileSync(path.join(outDir, file), `# ${t.title}\n\n${disclaimer}\n\n\`\`\`text\n${body}\n\`\`\`\n`);
      const docxText = "ОБРАЗЕЦ ДЛЯ ОЗНАКОМЛЕНИЯ. Перед использованием адаптируйте документ с юристом к действующему законодательству РК.\n\n" + body;
      fs.writeFileSync(path.join(outDir, base + ".docx"), Buffer.from(ctx.window.buildDocx(docxText)));
      index.push(`- [${t.title}](${file}) · [Word](${base}.docx)`);
    }
    docLinks.push(`[${t.title}](templates/${file})`);
  });
  index.push("");
  checklist.push(`**Документы:** ${docLinks.join(" · ")}`, "");
  if ((T.refs || {})[n.id]) checklist.push(`**Нормы:** ${T.refs[n.id].join("; ")} (перечень на ${T.refsDate})`, "");
  if (n.tip) checklist.push(`> **Совет.** ${n.tip}`, "");
});

const REG = ctx.window.REGIONS;
checklist.push("## Региональные пункты", "", "Добавляются к этапам, когда в дереве выбран регион проекта.", "");
Object.keys(REG).forEach(rid => {
  const r = REG[rid];
  checklist.push(`### ${r.ru.name}`, "", r.ru.hint, "");
  Object.keys(r.tasks).forEach(sid => {
    const n = T.nodes.find(x => x.id === sid);
    r.tasks[sid].forEach(t => checklist.push(`- [ ] **${n.code}. ${n.name}:** ${t.ru}`));
  });
  checklist.push("", `> **Совет.** ${r.ru.tip}`, "");
});

fs.writeFileSync(path.join(outDir, "README.md"), index.join("\n"));

// Казахская версия: docs/kk/checklists.md и docs/kk/templates/
const KK = ctx.window.TREE_KK;
const kkDir = path.join(root, "docs/kk"), kkTpl = path.join(kkDir, "templates");
fs.rmSync(kkDir, { recursive: true, force: true });
fs.mkdirSync(kkTpl, { recursive: true });
const kkLabel = Object.fromEntries(T.fields.map(f => [f.id, f.blank === "___" ? "___" : (KK.fields[f.id] || {}).label || f.label]));
const kkBlank = body => body.replace(/\{\{(\w+)\}\}/g, (m, id) => "[" + kkLabel[id] + "]");
const kkIndex = ["# Құжат үлгілері", "", "> Танысуға арналған үлгі. Пайдаланар алдында құжатты заңгермен бірге ҚР қолданыстағы заңнамасына бейімдеңіз.", ""];
const kkCheck = ["# Кезеңдер арасындағы өту чек-парақтары", "", "Барлық тармақтар белгіленгенде кезең өтті деп саналады. Келесі кезең «Талап етеді» жолындағы барлық кезеңдер өткенде ашылады.", ""];
T.nodes.forEach(n => {
  const k = KK.nodes[n.id];
  const phase = KK.phases[n.phase] || n.phase;
  kkIndex.push(`## ${n.code}. ${k.name}`, "");
  kkCheck.push(`## ${n.code}. ${k.name} (LVL ${n.lvl}, ${phase})`, "", `**Мерзімі:** ${k.dur}  `);
  kkCheck.push(`**Талап етеді:** ${n.req.length ? n.req.map(r => KK.nodes[r].name).join(", ") : "бастапқы кезең"}`, "", k.desc, "");
  k.tasks.forEach(t => kkCheck.push(`- [ ] ${t}`));
  kkCheck.push("");
  const links = [];
  n.docs.forEach(d => {
    const t = T.templates[d], kt = KK.templates[d] || {};
    const title = kt.title || t.title, base = `${n.code}-${d}`;
    if (t.ext === "csv" || !kt.body) {
      links.push(`${title} (орысша үлгі: ../templates/${base}.${t.ext === "csv" ? "csv" : "md"})`);
      kkIndex.push(`- ${title}: [../../templates/${base}.${t.ext === "csv" ? "csv" : "md"}](../../templates/${base}.${t.ext === "csv" ? "csv" : "md"})`);
      return;
    }
    const body = kkBlank(kt.body);
    fs.writeFileSync(path.join(kkTpl, base + ".md"), `# ${title}\n\n> Танысуға арналған үлгі. Пайдаланар алдында құжатты заңгермен бірге ҚР қолданыстағы заңнамасына бейімдеңіз.\n\n\`\`\`text\n${body}\n\`\`\`\n`);
    fs.writeFileSync(path.join(kkTpl, base + ".docx"), Buffer.from(ctx.window.buildDocx(KK.disclaimer + "\n\n" + body)));
    kkIndex.push(`- [${title}](${base}.md) · [Word](${base}.docx)`);
    links.push(`[${title}](templates/${base}.md)`);
  });
  kkIndex.push("");
  kkCheck.push(`**Құжаттар:** ${links.join(" · ")}`, "");
  if ((KK.refs || {})[n.id]) kkCheck.push(`**Нормалар:** ${KK.refs[n.id].join("; ")} (${KK.refsDate} жағдай бойынша)`, "");
  kkCheck.push(`> **Кеңес.** ${k.tip}`, "");
});
kkCheck.push("## Өңірлік тармақтар", "", "Ағашта жоба өңірі таңдалғанда кезеңдерге қосылады.", "");
Object.keys(REG).forEach(rid => {
  const r = REG[rid];
  kkCheck.push(`### ${r.kk.name}`, "", r.kk.hint, "");
  Object.keys(r.tasks).forEach(sid => r.tasks[sid].forEach(t => kkCheck.push(`- [ ] **${T.nodes.find(x => x.id === sid).code}. ${KK.nodes[sid].name}:** ${t.kk}`)));
  kkCheck.push("", `> **Кеңес.** ${r.kk.tip}`, "");
});
fs.writeFileSync(path.join(kkTpl, "README.md"), kkIndex.join("\n"));
fs.writeFileSync(path.join(kkDir, "checklists.md"), kkCheck.join("\n"));
fs.writeFileSync(path.join(root, "docs/checklists.md"), checklist.join("\n"));
console.log(`templates: ${Object.keys(T.templates).length}, stages: ${T.nodes.length}`);
