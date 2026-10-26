import { it, expect } from "vitest";
import { useEditor } from "@forma/editor";
import {
  validateProject,
  serializeProject,
  parseProject,
  type ProjectV2,
} from "@forma/document";
import { topologyProject, firstRef } from "./fixtures/v2-project";
import { TopologyBridge } from "../packages/viewport/src/TopologyBridge";
const project = () => useEditor.getState().project as ProjectV2;
it("groups real scene geometry with stable IDs; shares, detaches and transforms instances through history", () => {
  const p = topologyProject();
  useEditor.getState().replace(p);
  useEditor.getState().selectEntity(firstRef(p, "face"));
  expect(useEditor.getState().groupScene().status).toBe("applied");
  const grouped = project(),
    ref = useEditor.getState().topologySelection!;
  expect(ref.entityId).toBe(firstRef(p, "face").entityId);
  expect(ref.occurrencePath).toHaveLength(1);
  validateProject(grouped);
  const original = ref.occurrencePath[0];
  expect(useEditor.getState().copyInstance(original).status).toBe("applied");
  const copy = useEditor.getState().topologySelection!.occurrencePath[0];
  expect(copy).not.toBe(original);
  expect(useEditor.getState().makeUnique(copy).status).toBe("applied");
  const unique = project();
  validateProject(unique);
  expect(Object.keys(unique.geometries)).toHaveLength(2);
  const n = unique.nodes[copy];
  if (n.kind === "legacy-primitive") throw Error("fixture");
  const t = structuredClone(n.transform);
  t.translation = [4, 5, 6];
  expect(useEditor.getState().patchNode(copy, { transform: t }).status).toBe(
    "applied",
  );
  expect(useEditor.getState().topologySelection!.occurrencePath).toEqual([
    copy,
  ]);
  expect(project().nodes[original].transform).toEqual(
    grouped.nodes[original].transform,
  );
  expect(parseProject(serializeProject(project()))).toEqual(
    JSON.parse(JSON.stringify(project())),
  );
  useEditor.getState().undo();
  expect(project()).toEqual(unique);
  useEditor.getState().undo();
  expect(Object.keys(project().geometries)).toHaveLength(1);
  useEditor.getState().undo();
  expect(project()).toEqual(grouped);
  useEditor.getState().undo();
  expect(project()).toEqual(p);
});
it("native transform preview changes only derived placements and can reset after rejection", () => {
  const p = topologyProject();
  useEditor.getState().replace(p);
  useEditor.getState().selectEntity(firstRef(p, "face"));
  useEditor.getState().groupScene();
  const doc = project(),
    path = useEditor.getState().topologySelection!.occurrencePath,
    bridge = new TopologyBridge(doc, 1),
    before = serializeProject(doc),
    group = bridge.findPlacement(path)!;
  group.position.set(4, 5, 6);
  expect(serializeProject(doc)).toBe(before);
  bridge.resetPlacements();
  expect(group.position.toArray()).toEqual([0, 0, 0]);
  bridge.dispose();
});
it("deleting one shared instance preserves the other and is reversible", () => {
  const p = topologyProject();
  useEditor.getState().replace(p);
  useEditor.getState().selectEntity(firstRef(p, "face"));
  useEditor.getState().groupScene();
  const first = useEditor.getState().topologySelection!.occurrencePath[0];
  useEditor.getState().copyInstance(first);
  const second = useEditor.getState().topologySelection!.occurrencePath[0],
    before = project();
  expect(useEditor.getState().removeInstance(second).status).toBe("applied");
  validateProject(project());
  expect(Object.keys(project().geometries)).toHaveLength(1);
  expect(project().nodes[first]).toEqual(before.nodes[first]);
  useEditor.getState().undo();
  expect(project()).toEqual(before);
});
it("locked groups reject copying and transform without changing document or history", () => {
  const p = topologyProject();
  useEditor.getState().replace(p);
  useEditor.getState().selectEntity(firstRef(p, "face"));
  useEditor.getState().groupScene();
  const key = useEditor.getState().topologySelection!.occurrencePath[0];
  useEditor.getState().setNodeLocked(key, true);
  const before = project(),
    revision = useEditor.getState().revision;
  expect(useEditor.getState().copyInstance(key).status).toBe("rejected");
  expect(useEditor.getState().patchNode(key, { name: "bypass" }).status).toBe(
    "rejected",
  );
  expect(project()).toBe(before);
  expect(useEditor.getState().revision).toBe(revision);
});
