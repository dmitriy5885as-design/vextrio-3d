import { definitionOccurrences } from "@forma/document";
import { useEditor, isObjectLocked } from "@forma/editor";
import { Boxes, Eye, EyeOff, Lock, Unlock } from "lucide-react";
export function TopologyTree() {
  const s = useEditor(),
    p = s.project;
  if (p.schemaVersion !== 2) return null;
  return (
    <>
      {definitionOccurrences(p)
        .filter(
          (o) => o.path.length || p.definitions[o.definitionId].geometryId,
        )
        .map((o) => {
          const d = p.definitions[o.definitionId],
            g = d.geometryId ? p.geometries[d.geometryId] : null,
            node = o.path.length ? p.nodes[o.path.at(-1)!] : null,
            name = node?.name ?? d.name,
            face = g ? Object.keys(g.faces)[0] : undefined,
            edge = g ? Object.keys(g.edges)[0] : undefined,
            vertex = g ? Object.keys(g.vertices)[0] : undefined,
            entityId = face ?? edge ?? vertex;
          return (
            <div
              className="tree-object"
              style={{ paddingLeft: Math.min(24, o.path.length * 8) }}
              key={JSON.stringify(o.path) + "@" + d.id}
            >
              {g && entityId ? (
                <button
                  onClick={() =>
                    s.selectEntity({
                      definitionId: d.id,
                      geometryId: g.id,
                      kind: face ? "face" : edge ? "edge" : "vertex",
                      entityId,
                      occurrencePath: o.path,
                    })
                  }
                >
                  <Boxes size={14} />
                  <span>{name}</span>
                  <small>{Object.keys(g.faces).length} граней</small>
                </button>
              ) : (
                <span>
                  <Boxes size={14} /> {name}
                </span>
              )}
              {node && node.kind !== "legacy-primitive" && (
                <>
                  <button
                    title={`${node.visible ? "Скрыть" : "Показать"} узел ${name}`}
                    disabled={isObjectLocked(p, node.id)}
                    onClick={() =>
                      s.patchNode(node.id, { visible: !node.visible })
                    }
                  >
                    {node.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <button
                    title={`${node.locked ? "Разблокировать" : "Заблокировать"} узел ${name}`}
                    disabled={isObjectLocked(p, node.id, true)}
                    onClick={() => s.setNodeLocked(node.id, !node.locked)}
                  >
                    {node.locked ? <Lock size={12} /> : <Unlock size={12} />}
                  </button>
                </>
              )}
            </div>
          );
        })}
    </>
  );
}
