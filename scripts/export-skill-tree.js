// Генерирует docs/templates/*.md(.csv) и docs/checklists.md из данных docs/skill-tree/index.html
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "docs/skill-tree/index.html"), "utf8");
const src = html.match(/<script id="tree-data">([\s\S]*?)<\/script>/)[1];
const ctx = { window: {} };
vm.runInNewContext(src, ctx);
const T = ctx.window.TREE;

const outDir = path.join(root, "docs/templates");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const disclaimer = "> Образец для ознакомления. Перед использованием адаптируйте документ с юристом к действующему законодательству РК.";
const index = ["# Образцы документов", "", disclaimer, ""];
const checklist = ["# Чек-листы перехода между этапами", "", "Этап считается пройденным, когда отмечены все пункты. Следующий этап открывается, когда пройдены все этапы из строки «Требует».", "", "Интерактивная версия: [skill-tree/index.html](skill-tree/index.html).", ""];

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
    const file = `${n.code}-${d}.${t.ext === "csv" ? "csv" : "md"}`;
    if (t.ext === "csv") fs.writeFileSync(path.join(outDir, file), "﻿" + t.body + "\n");
    else fs.writeFileSync(path.join(outDir, file), `# ${t.title}\n\n${disclaimer}\n\n\`\`\`text\n${t.body}\n\`\`\`\n`);
    index.push(`- [${t.title}](${file})`);
    docLinks.push(`[${t.title}](templates/${file})`);
  });
  index.push("");
  checklist.push(`**Документы:** ${docLinks.join(" · ")}`, "");
  if (n.tip) checklist.push(`> **Совет.** ${n.tip}`, "");
});

fs.writeFileSync(path.join(outDir, "README.md"), index.join("\n"));
fs.writeFileSync(path.join(root, "docs/checklists.md"), checklist.join("\n"));
console.log(`templates: ${Object.keys(T.templates).length}, stages: ${T.nodes.length}`);
