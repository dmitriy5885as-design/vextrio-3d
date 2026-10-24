import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { useEditor } from "@forma/editor";
import { PrimitiveAdapter } from "@forma/geometry";
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
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.85);
    scene.add(transform.getHelper());
    const meshes = new Map<
      string,
      THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    >();
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
    grid.position.y = 0.002;
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
      next.position.copy(camera.position);
      next.quaternion.copy(camera.quaternion);
      next.zoom = 1;
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
      const ids = new Set(s.project.objects.map((o) => o.id));
      for (const [id, mesh] of meshes)
        if (!ids.has(id)) {
          scene.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
          meshes.delete(id);
        }
      for (const obj of s.project.objects) {
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
      const selected = s.project.objects.find((o) => o.id === s.selected);
      const mesh = s.selected ? meshes.get(s.selected) : undefined;
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
        selected &&
        !selected.locked &&
        selected.visible &&
        s.tool !== "select"
      ) {
        if (transform.object !== mesh) transform.attach(mesh);
        transform.setMode(s.tool);
      } else transform.detach();
      transform.setTranslationSnap(s.snap ? 0.25 : null);
      transform.setRotationSnap(s.snap ? Math.PI / 12 : null);
      transform.setScaleSnap(s.snap ? 0.1 : null);
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
          s.patch(mesh.userData.id, {
            transform: {
              position: mesh.position.toArray() as Vec3,
              rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z].map(
                THREE.MathUtils.radToDeg,
              ) as Vec3,
              scale: mesh.scale.toArray() as Vec3,
            },
          });
        }
      }
    });
    transform.addEventListener("objectChange", () => {
      outline?.update();
      requestRender();
    });
    let down = { x: 0, y: 0 };
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const pointerUp = (e: PointerEvent) => {
      if (
        e.button !== 0 ||
        dragging ||
        transform.axis ||
        Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
      )
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = ray.intersectObjects(
        [...meshes.values()].filter((m) => m.visible),
        false,
      )[0];
      useEditor.getState().select(hit ? hit.object.userData.id : null);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
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
      if (state.cameraRequest !== prev.cameraRequest && state.cameraRequest) {
        const view = state.cameraRequest.view;
        if (view === "restore") restore();
        else if (view === "projection") {
          switchCamera(camera === ortho ? "perspective" : "orthographic");
          saveCamera();
        } else {
          let target = new THREE.Vector3();
          let distance = 14;
          if (view === "focus") {
            const mesh = state.selected ? meshes.get(state.selected) : null;
            if (mesh) {
              const box = new THREE.Box3().setFromObject(mesh);
              box.getCenter(target);
              distance = Math.max(
                3,
                box.getSize(new THREE.Vector3()).length() * 1.7,
              );
            }
          }
          const directions: Record<string, Vec3> = {
            top: [0, 1, 0.0001],
            front: [0, 0, 1],
            right: [1, 0, 0],
            iso: [1, 0.8, 1],
            reset: [1, 0.8, 1],
            focus: [1, 0.8, 1],
          };
          camera.position.copy(
            new THREE.Vector3(...(directions[view] ?? directions.iso))
              .normalize()
              .multiplyScalar(distance)
              .add(target),
          );
          camera.zoom = 1;
          camera.updateProjectionMatrix();
          controls.target.copy(target);
          controls.update();
          saveCamera();
        }
      }
      if (
        state.project.objects !== prev.project.objects ||
        state.selected !== prev.selected ||
        state.tool !== prev.tool ||
        state.grid !== prev.grid ||
        state.snap !== prev.snap ||
        state.theme !== prev.theme ||
        state.sensitivity !== prev.sensitivity
      )
        sync();
    });
    return () => {
      disposed = true;
      unsubscribe();
      observer.disconnect();
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
