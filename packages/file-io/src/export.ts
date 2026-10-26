import {
  validateProject,
  definitionOccurrences,
  type Document,
} from "@forma/document";
import {
  classifyBody,
  tessellateFace,
  transformAffine,
  cross,
  subtract,
  length,
} from "@forma/geometry";
// Export is derived from the canonical document, never from a Three.js scene.
// STL convention here is millimetres; OBJ coordinates are metres.
export function exportGeometry(p: Document, format: "obj" | "stl"): string {
  validateProject(p);
  if (p.schemaVersion !== 2)
    throw Error(
      "Сначала создайте геометрию Sketch. Экспорт старых примитивов пока не поддерживается.",
    );
  const occurrences = definitionOccurrences(p).filter((o) => o.visible);
  if (
    occurrences.some((o) =>
      p.definitions[o.definitionId].childNodeIds.some((key) => {
        const n = p.nodes[key];
        return n.kind === "legacy-primitive" && n.visible;
      }),
    )
  )
    throw Error(
      "В проекте есть видимые старые примитивы. Экспорт отменён, чтобы не потерять часть модели.",
    );
  const out: string[] =
    format === "obj" ? ["# VEXTRIO 3D — metres"] : ["solid VEXTRIO_3D"];
  let offset = 0,
    triangles = 0;
  for (const o of occurrences) {
    const gid = p.definitions[o.definitionId].geometryId;
    if (!gid) continue;
    const g = p.geometries[gid];
    const faceEdges = new Set<string>(
      Object.values(g.coedges).map((c) => c.edgeId),
    );
    if (
      format === "stl" &&
      Object.keys(g.edges).some((key) => !faceEdges.has(key))
    )
      throw Error(
        "STL не хранит отдельные линии. Экспорт отменён: используйте OBJ.",
      );
    if (
      format === "stl" &&
      Object.values(g.bodies).some(
        (b) => classifyBody(g, b.id) !== "closed-shell",
      )
    )
      throw Error(
        "Для STL нужны замкнутые тела. Открытые поверхности можно экспортировать в OBJ.",
      );
    const orientations = new Map(
      Object.values(g.shells).flatMap((s) =>
        s.faces.map((f) => [f.faceId, f.orientation] as const),
      ),
    );
    for (const face of Object.values(g.faces)) {
      const t = tessellateFace(g, face),
        positions = t.positions.map((v) =>
          transformAffine(v, o.worldTransform),
        ),
        orientation = orientations.get(face.id) ?? 1;
      if (format === "obj") {
        out.push(`o face_${++offset}`);
        for (const v of positions) out.push(`v ${v.join(" ")}`);
      }
      for (let i = 0; i < t.indices.length; i += 3) {
        if (++triangles > 200000)
          throw Error("Экспорт ограничен 200000 треугольников.");
        const indices = t.indices.slice(i, i + 3);
        if (orientation === -1) indices.reverse();
        if (format === "obj")
          out.push(`f ${indices.map((j) => j - positions.length).join(" ")}`);
        else {
          const [a, b, c] = indices.map((j) => positions[j]),
            normal = cross(subtract(b, a), subtract(c, a)),
            n = length(normal);
          if (!n) throw Error("Вырожденный треугольник при экспорте.");
          out.push(
            `facet normal ${normal.map((x) => x / n).join(" ")}`,
            "outer loop",
            ...[a, b, c].map(
              (v) => `vertex ${v.map((x) => x * 1000).join(" ")}`,
            ),
            "endloop",
            "endfacet",
          );
        }
      }
    }
    if (format === "obj")
      for (const e of Object.values(g.edges)) {
        if (faceEdges.has(e.id)) continue;
        out.push(
          ...[e.start, e.end].map(
            (key) =>
              `v ${transformAffine(g.vertices[key].position, o.worldTransform).join(" ")}`,
          ),
          "l -2 -1",
        );
        offset++;
      }
  }
  if (!triangles && !offset) throw Error("Нет видимой геометрии для экспорта.");
  if (format === "stl") out.push("endsolid VEXTRIO_3D");
  return out.join("\n") + "\n";
}
export function downloadGeometry(p: Document, format: "obj" | "stl") {
  const text = exportGeometry(p, format),
    url = URL.createObjectURL(new Blob([text], { type: "text/plain" })),
    a = document.createElement("a");
  try {
    a.href = url;
    a.download =
      (p.name.replace(/[<>:"/\\|?*]/g, "_") || "VEXTRIO") + "." + format;
    document.body.append(a);
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
