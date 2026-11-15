// Разделы портала: ключ → название из const VIEWS основного скрипта prototype/index.html.
// Общий для export-skill-tree.js, export-structure.js и check-skill-tree.js.
module.exports = html => {
  const src = (html.match(/const VIEWS = \{\n([\s\S]*?)\n\};/) || [])[1];
  if (!src) throw new Error("portal-views: не найден const VIEWS в prototype/index.html");
  const T = {};
  src.split("\n").forEach(l => { const m = l.match(/^\s+(\w+): \{.*?\bt: "([^"]+)"/); if (m) T[m[1]] = m[2]; });
  return T;
};
