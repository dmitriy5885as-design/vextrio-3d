import { readFileSync, readdirSync } from "node:fs";
const root = new URL("../packages/", import.meta.url);
const names = readdirSync(root);
const graph = new Map(
  names.map((n) => {
    const files = readdirSync(new URL(`${n}/src/`, root)).filter((f) =>
      /\.tsx?$/.test(f),
    );
    const deps = new Set(
      files.flatMap((f) =>
        [
          ...readFileSync(new URL(`${n}/src/${f}`, root), "utf8").matchAll(
            /from\s+['"]@forma\/([^'"]+)/g,
          ),
        ].map((m) => m[1]),
      ),
    );
    return [n, [...deps]];
  }),
);
function walk(n, path = []) {
  if (path.includes(n))
    throw Error(`Dependency cycle: ${[...path, n].join(" → ")}`);
  for (const d of graph.get(n) ?? []) walk(d, [...path, n]);
}
for (const n of names) walk(n);
console.log("Package dependency graph: no cycles");
