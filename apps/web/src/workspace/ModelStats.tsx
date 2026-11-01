import { useMemo } from "react";
import { useEditor } from "@forma/editor";
import { definitionOccurrences, getLegacyObjects } from "@forma/document";
import { tessellateFace } from "@forma/geometry";
export function ModelStats() {
  const project = useEditor((s) => s.project);
  const count = useMemo(() => {
    let faces = 0,
      triangles = 0,
      edges = 0;
    const primitive = (kind: string) =>
      kind === "cube"
        ? 12
        : kind === "plane"
          ? 2
          : kind === "sphere"
            ? 1840
            : 160;
    if (project.schemaVersion === 1) {
      triangles = getLegacyObjects(project)
        .filter((o) => o.visible)
        .reduce((n, o) => n + primitive(o.type), 0);
      return { faces, triangles, edges };
    }
    for (const occurrence of definitionOccurrences(project).filter(
      (o) => o.visible,
    )) {
      const d = project.definitions[occurrence.definitionId],
        g = d.geometryId ? project.geometries[d.geometryId] : null;
      if (g) {
        faces += Object.keys(g.faces).length;
        edges += Object.keys(g.edges).length;
        for (const f of Object.values(g.faces))
          triangles += tessellateFace(g, f).indices.length / 3;
      }
      for (const key of d.childNodeIds) {
        const node = project.nodes[key];
        if (node.kind === "legacy-primitive" && node.visible)
          triangles += primitive(node.primitive.kind);
      }
    }
    return { faces, triangles, edges };
  }, [
    project.schemaVersion === 2 ? project.geometries : project.objects,
    project.schemaVersion === 2 ? project.nodes : null,
    project.schemaVersion === 2 ? project.definitions : null,
  ]);
  return (
    <span
      data-testid="model-stats"
      title="Количество видимых экземпляров: топологические грани, рёбра и треугольники отображения"
    >
      Грани: {count.faces} · Рёбра: {count.edges} · Полигоны: {count.triangles}
    </span>
  );
}
