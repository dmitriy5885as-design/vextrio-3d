import { useEditor, usePrecision } from "@forma/editor";
import { definitionAtPath } from "@forma/document";
export function EditContext() {
  const s = useEditor(),
    precision = usePrecision(),
    p = s.project;
  if (p.schemaVersion !== 2 || !precision.path.length) return null;
  try {
    definitionAtPath(p, precision.path);
  } catch {
    return null;
  }
  return (
    <div className="edit-context" data-testid="edit-context">
      <strong>
        Редактирование:{" "}
        {precision.path.map((id) => p.nodes[id].name).join(" / ")}
      </strong>
      <button
        onClick={() => {
          s.setTool("select");
          s.selectEntity(null);
          precision.configure({
            path: precision.path.slice(0, -1),
            sharedEditConfirmed: false,
          });
        }}
      >
        Закрыть группу · Esc
      </button>
    </div>
  );
}
