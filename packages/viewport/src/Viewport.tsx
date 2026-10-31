import { TopologyBridge } from "./TopologyBridge";
import {
  getLegacyObjects,
  occurrenceMatrix,
  geometryContext,
  definitionAtPath,
} from "@forma/document";
import {
  affinePlane,
  dot,
  subtract,
  extrusionStop,
  offsetReference,
  classifyBody,
} from "@forma/geometry";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  useEditor,
  isObjectLocked,
  usePrecision,
  precisionFrame,
  sketchController,
  sketchPlane,
  useVolumePreview,
  usePushPull,
  useOffset,
  isGeometryLocked,
} from "@forma/editor";
import { SnapEngine, frameMatrix, normalize } from "@forma/snapping";
import { PrimitiveAdapter } from "./PrimitiveAdapter";
import type { Vec3 } from "@forma/shared";

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const el = host.current;
    let disposed = false,
      frame = 0,
      dragging = false,
      contextLost = false;
    const adapter = new PrimitiveAdapter();
    const scene = new THREE.Scene();
    const perspective = new THREE.PerspectiveCamera(45, 1, 0.05, 10000);
    const ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.05, 10000);
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera =
      perspective;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      useEditor
        .getState()
        .notify("WebGL недоступен. Включите аппаратное ускорение браузера.");
      el.dataset.error = "WebGL недоступен";
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.append(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "Рабочая 3D-сцена");
    renderer.domElement.setAttribute("data-testid", "viewport");
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.minDistance = 0.2;
    controls.maxDistance = 2000;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.85);
    scene.add(transform.getHelper());
    const meshes = new Map<
      string,
      THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    >();
    let topology: TopologyBridge | null = null;
    let volumeBridge: TopologyBridge | null = null;
    let renderedVolumeDocument: import("@forma/document").ProjectV2 | null =
      null;
    const refreshVolume = () => {
      const preview = useVolumePreview.getState(),
        state = useEditor.getState(),
        wanted =
          preview.document &&
          preview.owner === state.tool &&
          (state.tool === "extrude" || state.tool === "offset") &&
          preview.revision === state.revision
            ? preview.document
            : null;
      if (wanted === renderedVolumeDocument) {
        if (topology) topology.root.visible = !volumeBridge;
        return;
      }
      if (volumeBridge) {
        scene.remove(volumeBridge.root);
        volumeBridge.dispose();
        volumeBridge = null;
      }
      if (wanted) {
        volumeBridge = new TopologyBridge(wanted, state.revision);
        volumeBridge.editingContext(usePrecision.getState().path);
        scene.add(volumeBridge.root);
      }
      renderedVolumeDocument = wanted;
      if (topology) topology.root.visible = !volumeBridge;
      requestRender();
    };
    let snapEngine: SnapEngine | null = null;
    let snapDocument: import("@forma/document").ProjectV2 | null = null;
    let outline: THREE.BoxHelper | null = null;
    scene.add(new THREE.HemisphereLight(0xc6dfff, 0x252a38, 2.7));
    const light = new THREE.DirectionalLight(0xffffff, 3.4);
    light.position.set(7, 14, 8);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, {
      left: -30,
      right: 30,
      top: 30,
      bottom: -30,
    });
    light.shadow.bias = -0.0004;
    scene.add(light);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.16, depthWrite: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.015;
    ground.receiveShadow = true;
    scene.add(ground);
    // Short segments avoid near-plane clipping artifacts on software WebGL drivers.
    const gridPoints: number[] = [];
    for (let x = -30; x < 30; x++)
      for (let z = -30; z < 30; z++) {
        gridPoints.push(x, 0, z, x + 1, 0, z, x, 0, z, x, 0, z + 1);
      }
    const grid = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(gridPoints, 3),
      ),
      new THREE.LineBasicMaterial({
        color: 0x35445b,
        transparent: true,
        opacity: 0.7,
      }),
    );
    grid.position.y = -0.002;
    grid.renderOrder = 1;
    scene.add(grid);
    const axis = new THREE.AxesHelper(4);
    scene.add(axis);
    const origin = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    scene.add(origin);
    function requestRender() {
      if (!disposed && !contextLost && !frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          renderer.render(scene, camera);
        });
    }
    function resize() {
      const w = el.clientWidth,
        h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h);
      perspective.aspect = w / h;
      perspective.updateProjectionMatrix();
      ortho.left = (-10 * w) / h;
      ortho.right = (10 * w) / h;
      ortho.top = 10;
      ortho.bottom = -10;
      ortho.updateProjectionMatrix();
      requestRender();
    }
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    function switchCamera(projection: string) {
      const next = projection === "orthographic" ? ortho : perspective;
      if (next === camera) return;
      const distance = camera.position.distanceTo(controls.target),
        height =
          camera === ortho
            ? 20 / camera.zoom
            : (2 *
                distance *
                Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2))) /
              camera.zoom;
      next.position.copy(camera.position);
      next.quaternion.copy(camera.quaternion);
      next.zoom = next === ortho ? 20 / height : 1;
      if (next === perspective)
        next.position
          .copy(camera.position)
          .sub(controls.target)
          .normalize()
          .multiplyScalar(
            height /
              (2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2))),
          )
          .add(controls.target);
      next.updateProjectionMatrix();
      camera = next;
      controls.object = camera;
      transform.camera = camera;
      controls.update();
      resize();
    }
    function restore() {
      const c = useEditor.getState().project.camera;
      switchCamera(c.projection);
      camera.position.fromArray(c.position);
      camera.zoom = c.zoom;
      camera.updateProjectionMatrix();
      controls.target.fromArray(c.target);
      controls.update();
    }
    function sync() {
      const s = useEditor.getState();
      scene.background = new THREE.Color(
        s.theme === "dark" ? "#1b2433" : "#e7edf5",
      );
      grid.visible = s.grid;
      axis.visible = s.grid;
      origin.visible = s.grid;
      controls.rotateSpeed = s.sensitivity;
      controls.panSpeed = s.sensitivity;
      controls.zoomSpeed = s.sensitivity;
      if (s.project.schemaVersion === 2) {
        if (!topology || !topology.sameContent(s.project)) {
          try {
            const next = new TopologyBridge(s.project, s.revision);
            scene.add(next.root);
            if (topology) {
              scene.remove(topology.root);
              topology.dispose();
            }
            topology = next;
            el.dataset.topologyEdges = String(
              Object.values(s.project.geometries).reduce(
                (n, g) => n + Object.keys(g.edges).length,
                0,
              ),
            );
            el.dataset.topologyFaces = String(
              Object.values(s.project.geometries).reduce(
                (n, g) => n + Object.keys(g.faces).length,
                0,
              ),
            );
          } catch (error) {
            s.notify(
              error instanceof Error
                ? error.message
                : "Ошибка отображения топологии",
            );
            return;
          }
        }
        topology.selection(
          s.topologySelection,
          s.selected,
          s.selectedPath,
          s.topologySelections,
          s.topologyHover,
        );
      } else if (topology) {
        scene.remove(topology.root);
        topology.dispose();
        topology = null;
        delete el.dataset.topologyFaces;
        delete el.dataset.topologyEdges;
      }
      const objects =
        s.project.schemaVersion === 1 ? getLegacyObjects(s.project) : [];
      const ids = new Set(objects.map((o) => o.id));
      for (const [id, mesh] of meshes)
        if (!ids.has(id)) {
          scene.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
          meshes.delete(id);
        }
      for (const obj of objects) {
        let mesh = meshes.get(obj.id);
        const signature = JSON.stringify(obj.geometry);
        if (!mesh) {
          mesh = new THREE.Mesh(
            adapter.create(obj.geometry, obj.id).geometry,
            new THREE.MeshStandardMaterial(),
          );
          mesh.userData = { id: obj.id, signature };
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          meshes.set(obj.id, mesh);
          scene.add(mesh);
        } else if (mesh.userData.signature !== signature) {
          mesh.geometry.dispose();
          mesh.geometry = adapter.create(obj.geometry, obj.id).geometry;
          mesh.userData.signature = signature;
        }
        mesh.visible = obj.visible;
        mesh.material.color.set(obj.material.color);
        mesh.material.roughness = obj.material.roughness;
        mesh.material.metalness = obj.material.metalness;
        mesh.material.side = THREE.DoubleSide;
        if (!dragging) {
          mesh.position.fromArray(obj.transform.position);
          mesh.rotation.set(
            ...(obj.transform.rotation.map((n) =>
              THREE.MathUtils.degToRad(n),
            ) as Vec3),
          );
          mesh.scale.fromArray(obj.transform.scale);
        }
        mesh.material.emissive.set(
          obj.id === s.selected ? "#123971" : "#000000",
        );
        mesh.material.emissiveIntensity = 0.2;
      }
      const selected = getLegacyObjects(s.project).find(
        (o) => o.id === s.selected,
      );
      const nativePath = s.topologySelection?.occurrencePath;
      // TransformControls is reliable for placements directly under the scene.
      // Nested affine editing remains available through numeric properties.
      const native =
        nativePath?.length === 1
          ? topology?.findPlacement(nativePath)
          : undefined;
      const mesh =
        native ??
        (s.selected
          ? (topology?.findLegacy(s.selected, s.selectedPath) ??
            meshes.get(s.selected))
          : undefined);
      if (outline) {
        scene.remove(outline);
        outline.geometry.dispose();
        (outline.material as THREE.Material).dispose();
        outline = null;
      }
      if (mesh && selected?.visible) {
        outline = new THREE.BoxHelper(mesh, 0x4d94ff);
        scene.add(outline);
      }
      if (
        mesh &&
        ((native &&
          !isObjectLocked(s.project, native.userData.nativeNodeId) &&
          native.visible) ||
          (selected &&
            !isObjectLocked(s.project, selected.id) &&
            selected.visible)) &&
        (s.tool === "translate" || s.tool === "rotate" || s.tool === "scale")
      ) {
        if (transform.object !== mesh) transform.attach(mesh);
        transform.setMode(s.tool);
      } else transform.detach();
      transform.setTranslationSnap(s.snap ? 0.25 : null);
      transform.setRotationSnap(s.snap ? Math.PI / 12 : null);
      transform.setScaleSnap(s.snap ? 0.1 : null);
      refreshVolume();
      topology?.editingContext(usePrecision.getState().path);
      requestRender();
    }
    const saveCamera = () => {
      if (disposed) return;
      const state = useEditor.getState();
      const data = {
        position: camera.position.toArray() as Vec3,
        target: controls.target.toArray() as Vec3,
        projection:
          camera === ortho
            ? ("orthographic" as const)
            : ("perspective" as const),
        zoom: camera.zoom,
      };
      const old = state.project.camera;
      const differs =
        old.projection !== data.projection ||
        Math.abs(old.zoom - data.zoom) > 1e-8 ||
        old.position.some((n, i) => Math.abs(n - data.position[i]) > 1e-8) ||
        old.target.some((n, i) => Math.abs(n - data.target[i]) > 1e-8);
      if (differs) state.setCamera(data);
      requestRender();
    };
    controls.addEventListener("change", saveCamera);
    transform.addEventListener("dragging-changed", (event) => {
      dragging = Boolean(event.value);
      controls.enabled = !dragging;
      if (!dragging) {
        const mesh = transform.object;
        if (mesh) {
          const s = useEditor.getState();
          const result = mesh.userData.nativeNodeId
            ? s.patchNode(mesh.userData.nativeNodeId, {
                transform: {
                  translation: mesh.position.toArray() as Vec3,
                  rotation: mesh.quaternion.toArray(),
                  scale: mesh.scale.toArray() as Vec3,
                },
              })
            : s.patch(mesh.userData.id, {
                transform: {
                  position: mesh.position.toArray() as Vec3,
                  rotation: [
                    mesh.rotation.x,
                    mesh.rotation.y,
                    mesh.rotation.z,
                  ].map(THREE.MathUtils.radToDeg) as Vec3,
                  scale: mesh.scale.toArray() as Vec3,
                },
              });
          if (result.status === "rejected") {
            topology?.resetPlacements();
            sync();
          }
        }
      }
    });
    transform.addEventListener("objectChange", () => {
      outline?.update();
      requestRender();
    });
    let down = { x: 0, y: 0 },
      downTool = sketchController.state.tool,
      downEditorTool = useEditor.getState().tool,
      downOffsetGeneration = useOffset.getState().generation,
      downGeneration = sketchController.generation;
    const pointerDown = (e: PointerEvent) => {
      inferDrawingPlane(e.clientX, e.clientY);
      down = { x: e.clientX, y: e.clientY };
      downTool = sketchController.state.tool;
      downEditorTool = useEditor.getState().tool;
      downOffsetGeneration = useOffset.getState().generation;
      downGeneration = sketchController.generation;
    };
    const pointerUp = (e: PointerEvent) => {
      if (
        useEditor.getState().tool === "orbit" ||
        useEditor.getState().tool === "pan"
      )
        return;
      if (useEditor.getState().tool === "offset") {
        if (
          downEditorTool !== "offset" ||
          downGeneration !== sketchController.generation ||
          downOffsetGeneration !== useOffset.getState().generation
        )
          return;
        if (
          e.button !== 0 ||
          dragging ||
          Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
        )
          return;
        const operation = useOffset.getState();
        if (operation.gesture) {
          operation.confirm();
          return;
        }
        const state = useEditor.getState(),
          p = state.project;
        if (p.schemaVersion !== 2 || !topology) return;
        const rect = renderer.domElement.getBoundingClientRect(),
          threshold =
            camera instanceof THREE.PerspectiveCamera
              ? (camera.position.distanceTo(controls.target) *
                  Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
                  12) /
                rect.height
              : (((ortho.top - ortho.bottom) / camera.zoom) * 6) / rect.height,
          ray = cursorRay(e.clientX, e.clientY),
          ref = topology.drawingFace(
            ray,
            threshold,
            usePrecision.getState().path,
            true,
          );
        if (!ref) {
          state.notify(
            "Выберите грань в активном контексте. В группу войдите двойным щелчком.",
          );
          return;
        }
        try {
          if (isGeometryLocked(p, ref))
            throw Error("Геометрический контекст заблокирован.");
          const plane = affinePlane(
              p.geometries[ref.geometryId].faces[ref.entityId].plane,
              occurrenceMatrix(p, ref.occurrencePath),
            ),
            point = ray.ray.intersectPlane(
              new THREE.Plane().setFromNormalAndCoplanarPoint(
                new THREE.Vector3(...plane.normal),
                new THREE.Vector3(...plane.origin),
              ),
              new THREE.Vector3(),
            );
          if (!point) throw Error("Рабочая плоскость параллельна лучу камеры.");
          const reference = offsetReference(
            p.geometries[ref.geometryId],
            ref.entityId,
            point.toArray() as Vec3,
            geometryContext(p, ref.geometryId, true, ref.occurrencePath),
          );
          state.selectEntity(ref);
          operation.begin({
            ref,
            ...reference,
            revision: state.revision,
            distance: 0,
          });
        } catch (error) {
          state.notify(
            error instanceof Error
              ? error.message
              : "Не удалось начать Offset.",
          );
        }
        return;
      }
      if (useEditor.getState().tool === "extrude") {
        if (
          e.button !== 0 ||
          dragging ||
          Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
        )
          return;
        const g = usePushPull.getState().gesture;
        if (g) {
          usePushPull.getState().confirm();
          return;
        }
        const s = useEditor.getState(),
          p = s.project;
        if (p.schemaVersion !== 2 || !topology) return;
        const ray = cursorRay(e.clientX, e.clientY),
          // Numeric preview hides only the render root. A new pointer gesture
          // still picks the original canonical face, never preview geometry.
          hit = topology.pickFace(ray, usePrecision.getState().path, true);
        if (!hit) {
          s.notify(
            "Щёлкните грань в активном контексте. Для группы сначала войдите двойным щелчком.",
          );
          return;
        }
        const model = p.geometries[hit.ref.geometryId],
          face = model.faces[hit.ref.entityId],
          plane = affinePlane(
            face.plane,
            occurrenceMatrix(p, hit.ref.occurrencePath),
          ),
          body = Object.values(model.bodies).find((b) =>
            b.faceIds.includes(face.id),
          );
        const side =
          body && classifyBody(model, body.id) === "closed-shell"
            ? (body.shellIds
                .flatMap((id) => model.shells[id].faces)
                .find((u) => u.faceId === face.id)?.orientation ?? 1)
            : dot(subtract(p.camera.position, plane.origin), plane.normal) >= 0
              ? 1
              : -1;
        s.selectEntity(hit.ref);
        usePushPull.getState().begin({
          ref: hit.ref,
          anchor: hit.point,
          normal: plane.normal.map((n) => n * side) as Vec3,
          side,
          revision: s.revision,
          limit:
            extrusionStop(
              model,
              face,
              side,
              geometryContext(p, model.id, true, hit.ref.occurrencePath),
            )?.distance ?? null,
          distance: 0,
        });
        return;
      }
      if (useEditor.getState().tool === "extrude" && volumeBridge) return;
      if (downTool !== sketchController.state.tool) return;
      if (sketchController.state.tool) return;
      if (
        e.button !== 0 ||
        dragging ||
        transform.axis ||
        Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
      )
        return;
      if (usePrecision.getState().enabled) {
        updatePrecision(e.clientX, e.clientY);
        const p = usePrecision.getState();
        if (p.target) usePrecision.setState({ exact: true });
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      // File opening / navigation can precede the next render frame. Picking
      // must use the current camera rather than the last rendered matrix.
      camera.updateMatrixWorld(true);
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      if (topology) {
        const distance = camera.position.distanceTo(controls.target),
          threshold =
            camera instanceof THREE.PerspectiveCamera
              ? (distance *
                  Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
                  12) /
                rect.height
              : (((ortho.top - ortho.bottom) / camera.zoom) * 6) / rect.height;
        const result = topology.pick(ray, threshold);
        if (result && "ref" in result)
          useEditor.getState().selectEntity(result.ref, e.shiftKey);
        else if (result && "legacyId" in result)
          useEditor.getState().selectOccurrence(result.legacyId, result.path);
        else {
          useEditor.getState().selectEntity(null, e.shiftKey);
          const path = usePrecision.getState().path;
          if (path.length)
            usePrecision.getState().configure({
              path: path.slice(0, -1),
              sharedEditConfirmed: false,
            });
        }
        return;
      }
      const hit = ray.intersectObjects(
        [...meshes.values()].filter((m) => m.visible),
        false,
      )[0];
      useEditor.getState().select(hit ? hit.object.userData.id : null);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    const enterGroup = (e: MouseEvent) => {
      const s = useEditor.getState(),
        p = s.project;
      if (s.tool !== "select" || p.schemaVersion !== 2 || !topology) return;
      const hit = topology.pickFace(cursorRay(e.clientX, e.clientY)),
        path = usePrecision.getState().path;
      if (
        !hit ||
        hit.ref.occurrencePath.length <= path.length ||
        !path.every((id, i) => hit.ref.occurrencePath[i] === id)
      )
        return;
      const next = hit.ref.occurrencePath.slice(0, path.length + 1),
        node = p.nodes[next.at(-1)!];
      if (isObjectLocked(p, node.id)) return;
      definitionAtPath(p, next);
      usePrecision.getState().configure({
        path: next,
        sharedEditConfirmed: node.kind === "component",
      });
      topology.editingContext(next);
      s.notify("Редактирование: " + node.name + " · Esc — выйти");
    };
    renderer.domElement.addEventListener("dblclick", enterGroup);
    const drawingClick = (e: MouseEvent) => {
      if (
        downTool !== sketchController.state.tool ||
        downGeneration !== sketchController.generation
      )
        return;
      if (
        !sketchController.state.tool ||
        e.button !== 0 ||
        e.detail > 1 ||
        Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
      )
        return;
      inferDrawingPlane(e.clientX, e.clientY);
      updatePrecision(e.clientX, e.clientY);
      void sketchController.click(
        usePrecision.getState().target,
        sketchPlane(),
        "pointer/" + e.timeStamp,
      );
    };
    renderer.domElement.addEventListener("click", drawingClick);
    const marker = document.createElement("div");
    marker.className = "snap-marker";
    marker.dataset.testid = "snap-marker";
    marker.hidden = true;
    el.append(marker);
    const previewGeometry = new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array(129 * 3), 3).setUsage(
          THREE.DynamicDrawUsage,
        ),
      ),
      previewMaterial = new THREE.LineBasicMaterial({
        color: 0x4dd5c0,
        depthTest: false,
      });
    const preview = new THREE.Line(previewGeometry, previewMaterial);
    preview.frustumCulled = false;
    preview.renderOrder = 20;
    scene.add(preview);
    const planeGeometry = new THREE.BufferGeometry(),
      planeMaterial = new THREE.LineBasicMaterial({
        color: 0x3478f6,
        transparent: true,
        opacity: 0.5,
      });
    const planeGuide = new THREE.Line(planeGeometry, planeMaterial);
    scene.add(planeGuide);
    const precisionAxes = new THREE.AxesHelper(1);
    scene.add(precisionAxes);
    let lastCursor: [number, number] | null = null,
      hoverFrame = 0;
    function projectPoint(
      point: Vec3,
      rect = renderer.domElement.getBoundingClientRect(),
    ) {
      const view = new THREE.Vector3(...point).applyMatrix4(
        camera.matrixWorldInverse,
      );
      const p = new THREE.Vector3(...point).project(camera);
      const clip = new THREE.Vector4(view.x, view.y, view.z, 1).applyMatrix4(
        camera.projectionMatrix,
      );
      return {
        x: ((p.x + 1) * rect.width) / 2,
        y: ((1 - p.y) * rect.height) / 2,
        depth: -view.z,
        w: camera instanceof THREE.PerspectiveCamera ? -view.z : 1,
        clipZ: p.z,
        nearPlane: clip.z + clip.w,
        farPlane: clip.w - clip.z,
        visible: view.z < 0 && p.z >= -1 - 2e-12 && p.z <= 1 + 2e-12,
      };
    }
    function renderPrecision() {
      const p = usePrecision.getState(),
        document = useEditor.getState().project;
      const enabled = p.enabled && document.schemaVersion === 2;
      preview.visible = !!(enabled && p.target);
      planeGuide.visible = enabled;
      precisionAxes.visible = enabled;
      controls.mouseButtons.LEFT = ["extrude", "offset"].includes(
        useEditor.getState().tool,
      )
        ? (null as unknown as THREE.MOUSE)
        : useEditor.getState().tool === "pan"
          ? THREE.MOUSE.PAN
          : enabled
            ? (null as unknown as THREE.MOUSE)
            : THREE.MOUSE.ROTATE;
      transform.enabled = !enabled && useEditor.getState().tool !== "offset";
      if (enabled) {
        try {
          const { matrix } = precisionFrame(document, p),
            plane = sketchController.state.tool
              ? sketchPlane()
              : precisionFrame(document, p).plane;
          const frame = frameMatrix(p.system, matrix, plane);
          precisionAxes.matrixAutoUpdate = false;
          precisionAxes.matrix.fromArray(frame);
          const points = [
            [-2, -2],
            [2, -2],
            [2, 2],
            [-2, 2],
            [-2, -2],
          ].map(([u, v]) =>
            new THREE.Vector3()
              .addScaledVector(new THREE.Vector3(...plane.u), u)
              .addScaledVector(new THREE.Vector3(...plane.v), v),
          );
          planeGeometry.setFromPoints(points);
          planeGuide.position.fromArray(plane.origin);
          planeGuide.userData.plane = p.planeName;
          if (p.target) {
            const segments = sketchController.state.segments;
            const points =
                sketchController.state.tool && segments.length
                  ? [segments[0][0], ...segments.map((s) => s[1])]
                  : (p.rectangle?.corners ?? [p.anchor, p.target]),
              positions = previewGeometry.getAttribute("position");
            points.forEach((v, i) =>
              positions.setXYZ(
                i,
                v[0] - p.anchor[0],
                v[1] - p.anchor[1],
                v[2] - p.anchor[2],
              ),
            );
            positions.needsUpdate = true;
            previewGeometry.setDrawRange(0, points.length);
            preview.position.fromArray(p.anchor);
            el.dataset.precisionPreviewPoints = String(points.length);
            const projected = projectPoint(p.target);
            marker.hidden = !projected.visible;
            marker.style.left = projected.x + "px";
            marker.style.top = projected.y + "px";
            marker.dataset.kind = p.exact
              ? "exact"
              : (p.hover?.kind ?? "plane");
            marker.textContent = p.exact
              ? "Точная точка"
              : (p.hover?.label ??
                (p.planeOverride
                  ? "Плоскость грани"
                  : `Плоскость ${p.planeName}`));
          } else marker.hidden = true;
        } catch {
          marker.hidden = true;
          preview.visible = false;
          planeGuide.visible = false;
          precisionAxes.visible = false;
        }
      } else marker.hidden = true;
      requestRender();
    }
    function updatePrecision(clientX: number, clientY: number, flush = false) {
      const p = usePrecision.getState(),
        s = useEditor.getState(),
        document = s.project;
      if (!p.enabled || document.schemaVersion !== 2) return;
      if (p.exact || (p.editing && !flush)) {
        renderPrecision();
        return;
      }
      try {
        if (
          !snapDocument ||
          snapDocument.nodes !== document.nodes ||
          snapDocument.geometries !== document.geometries ||
          snapDocument.definitions !== document.definitions ||
          snapDocument.geometryPolicy !== document.geometryPolicy
        ) {
          snapEngine = new SnapEngine(document);
          snapDocument = document;
        }
        camera.updateMatrixWorld();
        const rect = renderer.domElement.getBoundingClientRect(),
          cursor: [number, number] = [clientX - rect.left, clientY - rect.top];
        const ray = new THREE.Raycaster();
        ray.setFromCamera(
          new THREE.Vector2(
            (cursor[0] / rect.width) * 2 - 1,
            1 - (cursor[1] / rect.height) * 2,
          ),
          camera,
        );
        const { matrix } = precisionFrame(document, p),
          plane = sketchController.state.tool
            ? sketchPlane()
            : precisionFrame(document, p).plane,
          frame = frameMatrix(p.system, matrix, plane);
        const result = snapEngine!.query({
          cursor,
          project: (point) => projectPoint(point, rect),
          ray: {
            origin: ray.ray.origin.toArray() as Vec3,
            direction: ray.ray.direction.toArray() as Vec3,
          },
          plane,
          anchor: p.anchor,
          axes: [0, 1, 2].map((i) =>
            normalize(frame.slice(i * 4, i * 4 + 3) as Vec3),
          ),
          gridStep: p.gridStep,
          enabled: s.snap,
          perspective: camera instanceof THREE.PerspectiveCamera,
          contextPath: p.path,
          contextOnly: p.contextOnly,
          axis: p.axis ? { X: 0, Y: 1, Z: 2 }[p.axis] : null,
        });
        if (flush)
          usePrecision.setState({
            target: result.candidate?.point ?? result.raw,
            hover: result.candidate,
          });
        else
          p.hoverPoint(
            result.candidate?.point ?? result.raw,
            result.candidate,
            null,
          );
        if (sketchController.state.tool)
          sketchController.move(usePrecision.getState().target, plane);
        el.dataset.snapTested = String(snapEngine!.stats.tested);
        el.dataset.snapSources = String(snapEngine!.sourceCount);
        el.dataset.snapTruncated = String(snapEngine!.stats.truncated);
        const warning = snapEngine!.stats.truncated
          ? "Плотная область: достигнут бюджет поиска. Приблизьте вид или включите только активный контекст."
          : "";
        if (usePrecision.getState().warning !== warning)
          usePrecision.setState({ warning });
        renderPrecision();
      } catch (e) {
        usePrecision.setState({
          error: e instanceof Error ? e.message : "Ошибка привязки",
        });
      }
    }
    function cursorRay(x: number, y: number) {
      const rect = renderer.domElement.getBoundingClientRect(),
        ray = new THREE.Raycaster();
      camera.updateMatrixWorld(true);
      ray.setFromCamera(
        new THREE.Vector2(
          ((x - rect.left) / rect.width) * 2 - 1,
          1 - ((y - rect.top) / rect.height) * 2,
        ),
        camera,
      );
      return ray;
    }
    let inferredPlane: import("@forma/geometry").PlaneFrame | null = null;
    function inferDrawingPlane(x: number, y: number) {
      if (
        !sketchController.state.tool ||
        sketchController.state.start ||
        !topology
      )
        return;
      const p = useEditor.getState().project;
      if (p.schemaVersion !== 2) return;
      const rect = renderer.domElement.getBoundingClientRect(),
        threshold =
          camera instanceof THREE.PerspectiveCamera
            ? (camera.position.distanceTo(controls.target) *
                Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
                12) /
              rect.height
            : (((ortho.top - ortho.bottom) / camera.zoom) * 6) / rect.height;
      const faceRef = topology.drawingFace(
        cursorRay(x, y),
        threshold,
        usePrecision.getState().contextOnly
          ? usePrecision.getState().path
          : undefined,
      );
      if (!faceRef) {
        if (
          inferredPlane &&
          usePrecision.getState().planeOverride === inferredPlane
        ) {
          inferredPlane = null;
          usePrecision.getState().configure({ planeOverride: null });
        }
        return;
      }
      const plane = affinePlane(
          p.geometries[faceRef.geometryId].faces[faceRef.entityId].plane,
          occurrenceMatrix(p, faceRef.occurrencePath),
        ),
        old = usePrecision.getState().planeOverride;
      if (!old || JSON.stringify(old) !== JSON.stringify(plane)) {
        inferredPlane = plane;
        usePrecision.getState().configure({ planeOverride: plane });
      }
    }
    const pointerMove = (event: PointerEvent) => {
      lastCursor = [event.clientX, event.clientY];
      if (!hoverFrame)
        hoverFrame = requestAnimationFrame(() => {
          hoverFrame = 0;
          if (lastCursor) {
            const offset = useOffset.getState().gesture;
            if (useEditor.getState().tool === "offset" && offset) {
              const ray = cursorRay(...lastCursor),
                point = ray.ray.intersectPlane(
                  new THREE.Plane().setFromNormalAndCoplanarPoint(
                    new THREE.Vector3(...offset.plane.normal),
                    new THREE.Vector3(...offset.plane.origin),
                  ),
                  new THREE.Vector3(),
                );
              if (point)
                useOffset
                  .getState()
                  .move(
                    dot(
                      subtract(point.toArray() as Vec3, offset.anchor),
                      offset.inward,
                    ),
                  );
              return;
            }
            const gesture = usePushPull.getState().gesture;
            if (useEditor.getState().tool === "extrude" && gesture) {
              if (gesture.revision !== useEditor.getState().revision) {
                usePushPull.getState().cancel();
                return;
              }
              const ray = cursorRay(...lastCursor),
                n = new THREE.Vector3(...gesture.normal),
                d = ray.ray.origin
                  .clone()
                  .sub(new THREE.Vector3(...gesture.anchor)),
                c = n.dot(ray.ray.direction),
                den = 1 - c * c;
              const value =
                den > 1e-4
                  ? (d.dot(n) - d.dot(ray.ray.direction) * c) / den
                  : (projectPoint(gesture.anchor).y -
                      (lastCursor[1] -
                        renderer.domElement.getBoundingClientRect().top)) *
                    (camera instanceof THREE.PerspectiveCamera
                      ? (2 *
                          camera.position.distanceTo(
                            new THREE.Vector3(...gesture.anchor),
                          ) *
                          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
                        renderer.domElement.clientHeight
                      : 20 / camera.zoom / renderer.domElement.clientHeight);
              usePushPull.getState().move(value);
              return;
            }
            inferDrawingPlane(...lastCursor);
            if (usePrecision.getState().enabled) updatePrecision(...lastCursor);
            else if (useEditor.getState().tool === "select" && topology) {
              const rect = renderer.domElement.getBoundingClientRect(),
                ray = new THREE.Raycaster();
              camera.updateMatrixWorld();
              ray.setFromCamera(
                new THREE.Vector2(
                  ((lastCursor[0] - rect.left) / rect.width) * 2 - 1,
                  1 - ((lastCursor[1] - rect.top) / rect.height) * 2,
                ),
                camera,
              );
              const threshold =
                camera instanceof THREE.PerspectiveCamera
                  ? (camera.position.distanceTo(controls.target) *
                      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
                      12) /
                    rect.height
                  : (((ortho.top - ortho.bottom) / camera.zoom) * 6) /
                    rect.height;
              const hit = topology.pick(ray, threshold);
              useEditor
                .getState()
                .setTopologyHover(hit && "ref" in hit ? hit.ref : null);
            }
          }
        });
    };
    const pointerLeave = (event?: PointerEvent) => {
      if (
        event?.relatedTarget instanceof HTMLElement &&
        event.relatedTarget.closest(".sketch-panel,.precision-panel")
      )
        return;
      useEditor.getState().setTopologyHover(null);
      if (!usePrecision.getState().exact)
        usePrecision.getState().hoverPoint(null, null, null);
      if (
        sketchController.state.tool &&
        !usePrecision.getState().editing &&
        !usePrecision.getState().exact
      )
        sketchController.move(null, sketchPlane());
    };
    const cancelPrecision = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if ((event.target as HTMLElement).matches("input,select,textarea"))
          return;
        const activeTool = useEditor.getState().tool;
        const path = usePrecision.getState().path;
        if (activeTool === "extrude" || activeTool === "offset")
          useEditor.getState().setTool("select");
        else if (
          !sketchController.state.start &&
          activeTool === "select" &&
          path.length
        )
          usePrecision
            .getState()
            .configure({ path: path.slice(0, -1), sharedEditConfirmed: false });
        usePushPull.getState().cancel();
        useOffset.getState().cancel();
        sketchController.cancel();
        usePrecision.getState().clear();
        snapEngine?.reset();
      }
    };
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerleave", pointerLeave);
    renderer.domElement.addEventListener("pointercancel", pointerLeave);
    window.addEventListener("keydown", cancelPrecision);
    const cancelDrawing = () => {
      // A confirmed command is no longer a preview. Changing window focus
      // (including a save/download) must not discard its queued geometry.
      if (
        usePushPull.getState().committing ||
        useOffset.getState().committing ||
        sketchController.state.phase === "Commit"
      )
        return;
      usePushPull.getState().cancel();
      useOffset.getState().cancel();
      if (useEditor.getState().tool === "offset")
        useEditor.getState().selectEntity(null);
      if (sketchController.state.tool) sketchController.cancel();
      usePrecision.getState().clear();
    };
    window.addEventListener("blur", cancelDrawing);
    renderer.domElement.addEventListener("pointercancel", cancelDrawing);
    const unsubscribeSketch = sketchController.subscribe(() =>
      renderPrecision(),
    );
    const refreshPrecision = () => {
      if (lastCursor) updatePrecision(...lastCursor);
      renderPrecision();
    };
    controls.addEventListener("change", refreshPrecision);
    const unsubscribePrecision = usePrecision.subscribe((state, previous) => {
      topology?.editingContext(state.path);
      volumeBridge?.editingContext(state.path);
      if (
        state.editing &&
        !previous.editing &&
        sketchController.state.tool &&
        lastCursor
      )
        updatePrecision(...lastCursor, true);
      if (
        state.path !== previous.path ||
        state.system !== previous.system ||
        state.planeName !== previous.planeName ||
        state.planeOverride !== previous.planeOverride ||
        state.enabled !== previous.enabled ||
        state.axis !== previous.axis ||
        state.contextOnly !== previous.contextOnly
      )
        snapEngine?.reset();
      renderPrecision();
    });
    const lost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      useEditor
        .getState()
        .notify("Контекст WebGL потерян. Ожидание восстановления…");
    };
    const recovered = () => {
      contextLost = false;
      useEditor.getState().notify("3D-сцена восстановлена");
      requestRender();
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    renderer.domElement.addEventListener("webglcontextrestored", recovered);
    restore();
    resize();
    sync();
    const unsubscribe = useEditor.subscribe((state, prev) => {
      if (
        state.topologyHover !== prev.topologyHover &&
        state.project === prev.project
      ) {
        topology?.selection(
          state.topologySelection,
          state.selected,
          state.selectedPath,
          state.topologySelections,
          state.topologyHover,
        );
        requestRender();
      }
      if (state.revision !== prev.revision) {
        const a = state.project,
          b = prev.project;
        const changed =
          a.schemaVersion !== 2 ||
          b.schemaVersion !== 2 ||
          JSON.stringify([a.nodes, a.definitions, a.geometries]) !==
            JSON.stringify([b.nodes, b.definitions, b.geometries]);
        if (changed) {
          snapEngine = null;
          snapDocument = null;
          usePrecision.getState().clear();
          if (a.schemaVersion !== 2)
            usePrecision.getState().configure({ enabled: false, path: [] });
          else {
            try {
              precisionFrame(a, usePrecision.getState());
            } catch {
              usePrecision.getState().configure({ path: [] });
            }
          }
        }
      }
      if (state.snap !== prev.snap) {
        snapEngine?.reset();
        usePrecision.getState().clear();
      }
      if (state.cameraRequest !== prev.cameraRequest && state.cameraRequest) {
        const view = state.cameraRequest.view;
        if (view === "restore") restore();
        else if (view === "projection") {
          switchCamera(camera === ortho ? "perspective" : "orthographic");
          saveCamera();
        } else {
          let target = controls.target.clone();
          let distance = camera.position.distanceTo(target);
          if (view === "focus" || view === "reset") {
            const mesh = state.selected
              ? (topology?.findLegacy(state.selected, state.selectedPath) ??
                meshes.get(state.selected))
              : state.topologySelection
                ? (topology?.findPlacement(
                    state.topologySelection.occurrencePath,
                  ) ?? topology?.root)
                : null;
            const box = new THREE.Box3();
            if (view === "reset") {
              if (topology) box.expandByObject(topology.root);
              for (const m of meshes.values())
                if (m.visible) box.expandByObject(m);
            } else if (mesh) box.setFromObject(mesh);
            if (!box.isEmpty()) {
              box.getCenter(target);
              distance = Math.max(
                3,
                box.getSize(new THREE.Vector3()).length() * 1.7,
              );
              if (camera === ortho)
                camera.zoom =
                  20 /
                  Math.max(1, box.getSize(new THREE.Vector3()).length() * 1.25);
            } else {
              target.set(0, 0, 0);
              distance = 14;
            }
          }
          const directions: Record<string, Vec3> = {
            top: [0, 1, 0.0001],
            front: [0, 0, 1],
            right: [1, 0, 0],
            left: [-1, 0, 0],
            back: [0, 0, -1],
            bottom: [0, -1, 0.0001],
            iso: [1, 0.8, 1],
            reset: [1, 0.8, 1],
            focus: [1, 0.8, 1],
          };
          camera.position.copy(
            new THREE.Vector3(
              ...(state.cameraRequest.direction ??
                directions[view] ??
                directions.iso),
            )
              .normalize()
              .multiplyScalar(distance)
              .add(target),
          );
          camera.updateProjectionMatrix();
          controls.target.copy(target);
          controls.update();
          saveCamera();
        }
      }
      if (
        state.project !== prev.project ||
        state.selected !== prev.selected ||
        state.selectedPath !== prev.selectedPath ||
        state.topologySelection !== prev.topologySelection ||
        state.tool !== prev.tool ||
        state.grid !== prev.grid ||
        state.snap !== prev.snap ||
        state.theme !== prev.theme ||
        state.sensitivity !== prev.sensitivity
      )
        sync();
    });
    const unsubscribeVolume = useVolumePreview.subscribe(() => refreshVolume());
    return () => {
      disposed = true;
      unsubscribe();
      unsubscribeVolume();
      volumeBridge?.dispose();
      unsubscribePrecision();
      unsubscribeSketch();
      window.removeEventListener("blur", cancelDrawing);
      renderer.domElement.removeEventListener("click", drawingClick);
      renderer.domElement.removeEventListener("dblclick", enterGroup);
      cancelAnimationFrame(hoverFrame);
      window.removeEventListener("keydown", cancelPrecision);
      controls.removeEventListener("change", refreshPrecision);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      previewGeometry.dispose();
      previewMaterial.dispose();
      planeGeometry.dispose();
      planeMaterial.dispose();
      precisionAxes.geometry.dispose();
      (precisionAxes.material as THREE.Material).dispose();
      marker.remove();
      observer.disconnect();
      topology?.dispose();
      cancelAnimationFrame(frame);
      controls.dispose();
      transform.dispose();
      for (const mesh of meshes.values()) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      if (outline) {
        outline.geometry.dispose();
        (outline.material as THREE.Material).dispose();
      }
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      axis.geometry.dispose();
      (Array.isArray(axis.material) ? axis.material : [axis.material]).forEach(
        (m) => m.dispose(),
      );
      ground.geometry.dispose();
      ground.material.dispose();
      origin.geometry.dispose();
      origin.material.dispose();
      light.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return <div className="viewport-canvas" ref={host} />;
}
