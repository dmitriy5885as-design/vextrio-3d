import * as THREE from "three";
import {
  useEditor,
  usePrecision,
  precisionFrame,
  isGeometryLocked,
} from "@forma/editor";
import {
  definitionOccurrences,
  occurrenceMatrix,
  type EntityRef,
} from "@forma/document";
import {
  affinePlane,
  transformAffine,
  subtract,
  dot,
  type Vec3,
} from "@forma/geometry";
import {
  SnapEngine,
  depthSnapKinds,
  type WorkPlane,
  type Projection,
} from "@forma/snapping";
import { freehandSegments, freehandPointLimit } from "@forma/tools";
import type { TopologyBridge } from "./TopologyBridge";
type Gesture = {
  kind: "freehand" | "erase";
  pointer: number;
  revision: number;
  path: string[];
  plane: WorkPlane;
  points: Vec3[];
  refs: EntityRef[];
  last: [number, number];
  committing: boolean;
};
export function installPointerTools(o: {
  element: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: () => THREE.Camera;
  topology: () => TopologyBridge | null;
  project: (p: Vec3) => Projection;
  render: () => void;
}) {
  const { element } = o;
  let gesture: Gesture | null = null;
  const geometry = new THREE.BufferGeometry(),
    material = new THREE.LineBasicMaterial({
      color: 0x4dd5c0,
      depthTest: false,
    }),
    overlay = new THREE.LineSegments(geometry, material);
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(256 * 3), 3),
  );
  geometry.setDrawRange(0, 0);
  overlay.frustumCulled = false;
  overlay.visible = false;
  overlay.renderOrder = 35;
  o.scene.add(overlay);
  element.tabIndex = 0;
  const isTool = () =>
    ["freehand", "erase"].includes(useEditor.getState().tool);
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const rayAt = (x: number, y: number) => {
    const b = element.getBoundingClientRect(),
      ray = new THREE.Raycaster(),
      camera = o.camera();
    camera.updateMatrixWorld(true);
    ray.setFromCamera(
      new THREE.Vector2(
        ((x - b.left) * 2) / b.width - 1,
        1 - ((y - b.top) * 2) / b.height,
      ),
      camera,
    );
    return ray;
  };
  const same = (a: readonly string[], b: readonly string[]) =>
    JSON.stringify(a) === JSON.stringify(b);
  const valid = (g: Gesture) =>
    gesture === g &&
    useEditor.getState().revision === g.revision &&
    same(usePrecision.getState().path, g.path);
  const paint = () => {
    const g = gesture,
      points: THREE.Vector3[] = [];
    if (g?.kind === "freehand")
      for (let i = 1; i < g.points.length; i++)
        points.push(
          new THREE.Vector3(...g.points[i - 1]),
          new THREE.Vector3(...g.points[i]),
        );
    const p = useEditor.getState().project;
    if (g?.kind === "erase" && p.schemaVersion === 2)
      for (const r of g.refs) {
        const model = p.geometries[r.geometryId],
          e = model.edges[r.entityId],
          matrix = occurrenceMatrix(p, r.occurrencePath);
        if (e)
          points.push(
            ...[e.start, e.end].map(
              (v) =>
                new THREE.Vector3(
                  ...transformAffine(model.vertices[v].position, matrix),
                ),
            ),
          );
      }
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    points.forEach((p, i) => position.setXYZ(i, p.x, p.y, p.z));
    position.needsUpdate = true;
    geometry.setDrawRange(0, points.length);
    overlay.visible = points.length > 0;
    material.color.set(g?.kind === "erase" ? 0xff596c : 0x4dd5c0);
    o.render();
  };
  const cancel = () => {
    const g = gesture;
    if (g?.committing) return;
    gesture = null;
    overlay.visible = false;
    useEditor.setState({ topologyHover: null });
    if (g && element.hasPointerCapture(g.pointer))
      element.releasePointerCapture(g.pointer);
    o.render();
  };
  let engine: SnapEngine | null = null,
    indexDocument: ReturnType<typeof useEditor.getState>["project"] | null =
      null;
  const pointAt = (
    x: number,
    y: number,
    plane: WorkPlane,
    snap: boolean,
    anchor: Vec3,
  ) => {
    const ray = rayAt(x, y),
      raw = ray.ray.intersectPlane(
        new THREE.Plane().setFromNormalAndCoplanarPoint(
          new THREE.Vector3(...plane.normal),
          new THREE.Vector3(...plane.origin),
        ),
        new THREE.Vector3(),
      );
    if (!raw) return null;
    const state = useEditor.getState(),
      p = state.project;
    if (!snap || !state.snap || p.schemaVersion !== 2)
      return raw.toArray() as Vec3;
    if (indexDocument !== p) {
      indexDocument = p;
      engine = new SnapEngine(p);
    }
    const b = element.getBoundingClientRect();
    const result = engine!.query({
      cursor: [x - b.left, y - b.top],
      project: o.project,
      ray: {
        origin: ray.ray.origin.toArray() as Vec3,
        direction: ray.ray.direction.toArray() as Vec3,
      },
      plane,
      anchor,
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      gridStep: 0,
      enabled: true,
      kinds: depthSnapKinds,
      perspective: o.camera() instanceof THREE.PerspectiveCamera,
      contextPath: usePrecision.getState().path,
      contextOnly: usePrecision.getState().contextOnly,
    });
    const target = result.candidate?.point;
    return target &&
      Math.abs(dot(subtract(target, plane.origin), plane.normal)) <= 1e-7
      ? target
      : (raw.toArray() as Vec3);
  };
  const edgeAt = (x: number, y: number) => {
    const p = useEditor.getState().project,
      c = o.camera(),
      b = element.getBoundingClientRect();
    const threshold =
      c instanceof THREE.PerspectiveCamera
        ? (c.position.distanceTo(new THREE.Vector3(...p.camera.target)) *
            Math.tan(THREE.MathUtils.degToRad(c.fov / 2)) *
            12) /
          b.height
        : c instanceof THREE.OrthographicCamera
          ? (((c.top - c.bottom) / c.zoom) * 6) / b.height
          : 0.05;
    const hit = o.topology()?.pick(rayAt(x, y), threshold, false, "edge");
    return hit && "ref" in hit ? hit.ref : null;
  };
  const addEdge = (g: Gesture, x: number, y: number) => {
    const ref = edgeAt(x, y),
      state = useEditor.getState(),
      p = state.project;
    if (!ref || p.schemaVersion !== 2) return;
    if (!same(ref.occurrencePath, g.path) || isGeometryLocked(p, ref)) {
      state.notify("Войдите в незаблокированный контекст геометрии.");
      return;
    }
    if (g.refs.length && g.refs[0].geometryId !== ref.geometryId) return;
    if (
      definitionOccurrences(p).filter(
        (n) => n.definitionId === ref.definitionId,
      ).length > 1
    ) {
      state.notify("Общий компонент: сначала сделайте экземпляр независимым.");
      return;
    }
    if (!g.refs.some((r) => r.entityId === ref.entityId)) {
      if (g.refs.length >= 128)
        throw Error("За один жест удаляется не более 128 рёбер.");
      g.refs.push(ref);
      state.notify(
        `Ластик: ${g.refs.length} рёбер · отпустите кнопку для удаления · Esc — отмена`,
      );
    }
    useEditor.setState({ topologyHover: ref });
    paint();
  };
  const sweepEdges = (g: Gesture, x: number, y: number) => {
    const [a, b] = g.last,
      steps = Math.min(
        256,
        Math.max(1, Math.ceil(Math.hypot(x - a, y - b) / 3)),
      );
    for (let i = 1; i <= steps; i++)
      addEdge(g, a + ((x - a) * i) / steps, b + ((y - b) * i) / steps);
    g.last = [x, y];
  };
  const down = (e: PointerEvent) => {
    if (!isTool() || e.button !== 0) return;
    stop(e);
    if (gesture?.committing) return;
    if (
      useEditor.getState().tool === "erase" &&
      (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey)
    ) {
      cancel();
      useEditor
        .getState()
        .notify(
          "Скрытие и смягчение модификаторами пока не поддерживаются. Для удаления используйте E без модификаторов.",
        );
      return;
    }
    cancel();
    const s = useEditor.getState(),
      p = s.project;
    if (p.schemaVersion !== 2) {
      s.notify("Для рисования нужен проект v2.");
      return;
    }
    element.focus({ preventScroll: true });
    const path = [...usePrecision.getState().path],
      hit = o.topology()?.pickFace(rayAt(e.clientX, e.clientY), path),
      plane = hit
        ? affinePlane(
            p.geometries[hit.ref.geometryId].faces[hit.ref.entityId].plane,
            occurrenceMatrix(p, path),
          )
        : precisionFrame(p, usePrecision.getState()).plane;
    const g: Gesture = {
      kind: s.tool as "freehand" | "erase",
      pointer: e.pointerId,
      revision: s.revision,
      path,
      plane,
      points: [],
      refs: [],
      last: [e.clientX, e.clientY],
      committing: false,
    };
    gesture = g;
    try {
      if (g.kind === "freehand") {
        const point = pointAt(e.clientX, e.clientY, plane, true, plane.origin);
        if (!point) {
          cancel();
          return;
        }
        g.points.push([...point]);
        s.notify(
          "Свободное рисование: ведите мышь с зажатой ЛКМ · отпустите для построения · Esc — отмена",
        );
      } else addEdge(g, e.clientX, e.clientY);
      element.setPointerCapture(e.pointerId);
    } catch (error) {
      cancel();
      s.notify(error instanceof Error ? error.message : "Ошибка инструмента");
    }
  };
  const move = (e: PointerEvent) => {
    if (!isTool() || (e.buttons && !(e.buttons & 1))) return;
    const g = gesture;
    if (!g) {
      if (useEditor.getState().tool === "erase")
        useEditor.setState({ topologyHover: edgeAt(e.clientX, e.clientY) });
      return;
    }
    stop(e);
    if (g.committing) return;
    if (
      g.kind === "erase" &&
      (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey)
    ) {
      cancel();
      return;
    }
    if (!valid(g)) {
      cancel();
      return;
    }
    try {
      if (g.kind === "erase") {
        sweepEdges(g, e.clientX, e.clientY);
        return;
      }
      if (Math.hypot(e.clientX - g.last[0], e.clientY - g.last[1]) < 6) return;
      const point = pointAt(e.clientX, e.clientY, g.plane, false, g.points[0]);
      if (point) {
        if (g.points.length >= freehandPointLimit - 1)
          throw Error(
            "Штрих слишком длинный: максимум 128 точек. Разделите рисование.",
          );
        g.points.push(point);
        g.last = [e.clientX, e.clientY];
        paint();
      }
    } catch (error) {
      cancel();
      useEditor
        .getState()
        .notify(error instanceof Error ? error.message : "Ошибка штриха");
    }
  };
  const up = (e: PointerEvent) => {
    if (!isTool() || e.button !== 0) return;
    stop(e);
    const g = gesture;
    if (!g || g.committing || g.pointer !== e.pointerId) return;
    if (!valid(g)) {
      cancel();
      return;
    }
    if (
      g.kind === "erase" &&
      (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey)
    ) {
      cancel();
      return;
    }
    try {
      if (g.kind === "freehand") {
        let end = pointAt(e.clientX, e.clientY, g.plane, true, g.points[0]);
        const b = element.getBoundingClientRect(),
          first = o.project(g.points[0]);
        if (
          useEditor.getState().snap &&
          g.points.length > 2 &&
          Math.hypot(
            first.x - (e.clientX - b.left),
            first.y - (e.clientY - b.top),
          ) <= 8
        )
          end = g.points[0];
        if (end) g.points.push(end);
      }
      if (g.kind === "erase") sweepEdges(g, e.clientX, e.clientY);
      const segments =
        g.kind === "freehand" ? freehandSegments(g.points, g.plane) : [];
      if (
        (g.kind === "freehand" && !segments.length) ||
        (g.kind === "erase" && !g.refs.length)
      ) {
        cancel();
        return;
      }
      g.committing = true;
      if (element.hasPointerCapture(e.pointerId))
        element.releasePointerCapture(e.pointerId);
      const state = useEditor.getState();
      const promise =
        g.kind === "freehand"
          ? state.drawSegments(
              g.path,
              segments,
              false,
              () => valid(g),
              usePrecision.getState().sharedEditConfirmed,
            )
          : state.editGeometry(
              g.refs[0],
              {
                kind: "delete-entities",
                entityIds: g.refs.map((r) => r.entityId),
              },
              () => valid(g),
            );
      void promise
        .then((result) => {
          if (result.status === "rejected" && "error" in result)
            useEditor.getState().notify(String(result.error));
        })
        .catch((error) =>
          useEditor
            .getState()
            .notify(error instanceof Error ? error.message : "Ошибка команды"),
        )
        .finally(() => {
          if (gesture === g) {
            gesture = null;
            overlay.visible = false;
            useEditor.setState({ topologyHover: null });
            o.render();
          }
        });
    } catch (error) {
      cancel();
      useEditor
        .getState()
        .notify(error instanceof Error ? error.message : "Ошибка построения");
    }
  };
  const key = (e: KeyboardEvent) => {
    if (isTool() && gesture && !gesture.committing && e.key === "Escape") {
      stop(e);
      cancel();
    }
  };
  const blur = () => cancel();
  const unsubscribe = useEditor.subscribe((s, prev) => {
    if (s.tool !== prev.tool || s.revision !== prev.revision) cancel();
  });
  const unsubPrecision = usePrecision.subscribe((s, prev) => {
    if (
      !same(s.path, prev.path) ||
      s.planeName !== prev.planeName ||
      s.system !== prev.system ||
      s.planeOverride !== prev.planeOverride
    )
      cancel();
  });
  element.addEventListener("pointerdown", down, true);
  element.addEventListener("pointermove", move, true);
  element.addEventListener("pointerup", up, true);
  element.addEventListener("pointercancel", blur, true);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", blur);
  return () => {
    unsubscribe();
    unsubPrecision();
    element.removeEventListener("pointerdown", down, true);
    element.removeEventListener("pointermove", move, true);
    element.removeEventListener("pointerup", up, true);
    element.removeEventListener("pointercancel", blur, true);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", blur);
    gesture = null;
    o.scene.remove(overlay);
    geometry.dispose();
    material.dispose();
  };
}
