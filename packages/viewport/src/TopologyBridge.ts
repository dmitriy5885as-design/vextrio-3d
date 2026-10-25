import * as THREE from "three";
import { tessellateFace, type Vec3 } from "@forma/geometry";
import {
  type ProjectV2,
  type EntityRef,
  type LegacyNode,
} from "@forma/document";
import { PrimitiveAdapter } from "./PrimitiveAdapter";
export class TopologyBridge {
  readonly root = new THREE.Group();
  readonly pickables: THREE.Object3D[] = [];
  readonly legacy = new Map<
    string,
    THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[]
  >();
  private resources = new Set<THREE.BufferGeometry | THREE.Material>();
  constructor(
    readonly document: ProjectV2,
    readonly revision: number,
  ) {
    try {
      this.build(document.rootDefinitionId, this.root, []);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  private own<T extends THREE.BufferGeometry | THREE.Material>(resource: T): T {
    this.resources.add(resource);
    return resource;
  }
  private build(definitionId: string, parent: THREE.Group, path: string[]) {
    const p = this.document,
      d = p.definitions[definitionId];
    if (d.geometryId) {
      const m = p.geometries[d.geometryId],
        origin = Object.values(m.vertices)[0]?.position ?? [0, 0, 0],
        local = new THREE.Group();
      local.position.fromArray(origin);
      parent.add(local);
      const relative = (v: Vec3) => v.map((n, i) => n - origin[i]);
      const ref = (kind: EntityRef["kind"], entityId: string): EntityRef => ({
        definitionId,
        geometryId: m.id,
        kind,
        entityId,
        occurrencePath: [...path],
      });
      for (const face of Object.values(m.faces)) {
        const dto = tessellateFace(m, face),
          geometry = this.own(new THREE.BufferGeometry());
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(dto.positions.flatMap(relative), 3),
        );
        geometry.setIndex(dto.indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        for (const [materialId, side] of [
          [face.frontMaterialId, THREE.FrontSide],
          [face.backMaterialId, THREE.BackSide],
        ] as const) {
          const data = p.materials[materialId],
            material = this.own(
              new THREE.MeshStandardMaterial({
                color: data.color,
                roughness: data.roughness,
                metalness: data.metalness,
                side,
              }),
            ),
            mesh = new THREE.Mesh(geometry, material);
          mesh.userData = {
            entityRef: ref("face", face.id),
            renderRevision: this.revision,
          };
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          local.add(mesh);
          this.pickables.push(mesh);
        }
      }
      const edges = Object.values(m.edges),
        edgeGeometry = this.own(new THREE.BufferGeometry());
      edgeGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          edges.flatMap((e) => [
            ...relative(m.vertices[e.start].position),
            ...relative(m.vertices[e.end].position),
          ]),
          3,
        ),
      );
      edgeGeometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(
          edges.flatMap(() => [0.25, 0.65, 0.8, 0.25, 0.65, 0.8]),
          3,
        ),
      );
      const lines = new THREE.LineSegments(
        edgeGeometry,
        this.own(new THREE.LineBasicMaterial({ vertexColors: true })),
      );
      lines.userData = {
        baseRef: ref("edge", ""),
        ids: edges.map((e) => e.id),
        renderRevision: this.revision,
      };
      local.add(lines);
      this.pickables.push(lines);
      const vertices = Object.values(m.vertices),
        vertexGeometry = this.own(new THREE.BufferGeometry());
      vertexGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          vertices.flatMap((v) => relative(v.position)),
          3,
        ),
      );
      vertexGeometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(
          vertices.flatMap(() => [0.3, 0.8, 0.75]),
          3,
        ),
      );
      const points = new THREE.Points(
        vertexGeometry,
        this.own(
          new THREE.PointsMaterial({
            size: 5,
            sizeAttenuation: false,
            vertexColors: true,
          }),
        ),
      );
      points.userData = {
        baseRef: ref("vertex", ""),
        ids: vertices.map((v) => v.id),
        renderRevision: this.revision,
      };
      local.add(points);
      this.pickables.push(points);
    }
    for (const key of d.childNodeIds) {
      const n = p.nodes[key];
      if (n.kind === "legacy-primitive") {
        this.primitive(n, parent, path);
        continue;
      }
      const group = new THREE.Group();
      group.position.fromArray(n.transform.translation);
      group.quaternion.fromArray(n.transform.rotation);
      group.scale.fromArray(n.transform.scale);
      group.visible = n.visible;
      parent.add(group);
      this.build(n.definitionId, group, [...path, key]);
    }
  }
  private primitive(n: LegacyNode, parent: THREE.Group, path: string[]) {
    const data = this.document.materials[n.materialId],
      geometry = this.own(
        new PrimitiveAdapter().create(n.primitive, n.id).geometry,
      ),
      material = this.own(
        new THREE.MeshStandardMaterial({
          color: data.color,
          roughness: data.roughness,
          metalness: data.metalness,
          side: THREE.DoubleSide,
        }),
      ),
      mesh = new THREE.Mesh(geometry, material);
    mesh.position.fromArray(n.transform.position);
    mesh.rotation.set(
      ...(n.transform.rotation.map(THREE.MathUtils.degToRad) as Vec3),
    );
    mesh.scale.fromArray(n.transform.scale);
    mesh.visible = n.visible;
    mesh.userData = {
      id: n.id,
      occurrencePath: [...path],
      renderRevision: this.revision,
    };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    this.pickables.push(mesh);
    const list = this.legacy.get(n.id) ?? [];
    list.push(mesh);
    this.legacy.set(n.id, list);
  }
  findLegacy(key: string, path: string[] | null) {
    const list = this.legacy.get(key) ?? [];
    return path
      ? list.find(
          (m) =>
            JSON.stringify(m.userData.occurrencePath) === JSON.stringify(path),
        )
      : list[0];
  }
  sameContent(p: ProjectV2) {
    return (
      this.document.nodes === p.nodes &&
      this.document.definitions === p.definitions &&
      this.document.geometries === p.geometries &&
      this.document.materials === p.materials
    );
  }
  selection(
    selected: EntityRef | null,
    legacyId: string | null,
    path: string[] | null,
  ) {
    const same = (ref: EntityRef) =>
      selected &&
      ref.definitionId === selected.definitionId &&
      ref.geometryId === selected.geometryId &&
      JSON.stringify(ref.occurrencePath) ===
        JSON.stringify(selected.occurrencePath);
    for (const object of this.pickables) {
      if (object instanceof THREE.Mesh) {
        const ref = object.userData.entityRef as EntityRef | undefined,
          active = ref
            ? same(ref) &&
              ref.entityId === selected?.entityId &&
              ref.kind === selected?.kind
            : object === this.findLegacy(legacyId ?? "", path);
        (object.material as THREE.MeshStandardMaterial).emissive.set(
          active ? "#164f9c" : "#000000",
        );
      } else if (
        object instanceof THREE.LineSegments ||
        object instanceof THREE.Points
      ) {
        const ref = object.userData.baseRef as EntityRef,
          colors = object.geometry.getAttribute(
            "color",
          ) as THREE.BufferAttribute,
          ids = object.userData.ids as string[],
          stride = object instanceof THREE.LineSegments ? 2 : 1;
        for (let i = 0; i < ids.length; i++) {
          const active =
            same(ref) &&
            selected?.kind === ref.kind &&
            selected.entityId === ids[i];
          for (let j = 0; j < stride; j++)
            colors.setXYZ(
              i * stride + j,
              active ? 1 : 0.25,
              active ? 0.85 : 0.7,
              active ? 0.3 : 0.8,
            );
        }
        colors.needsUpdate = true;
      }
    }
  }
  pick(
    ray: THREE.Raycaster,
    threshold: number,
  ): { ref: EntityRef } | { legacyId: string; path: string[] } | null {
    ray.params.Line.threshold = threshold;
    ray.params.Points.threshold = threshold;
    const visible = (o: THREE.Object3D) => {
      for (let n: THREE.Object3D | null = o; n; n = n.parent)
        if (!n.visible) return false;
      return true;
    };
    const hits = ray.intersectObjects(this.pickables.filter(visible), false),
      surface =
        hits.find((h) => h.object instanceof THREE.Mesh)?.distance ?? Infinity;
    const candidates = hits
      .filter((h) => h.distance <= surface + threshold * 2)
      .sort((a, b) => {
        const priority = (o: THREE.Object3D) =>
          o instanceof THREE.Points
            ? 0
            : o instanceof THREE.LineSegments
              ? 1
              : 2;
        return (
          priority(a.object) - priority(b.object) || a.distance - b.distance
        );
      });
    for (const hit of candidates) {
      const data = hit.object.userData;
      if (data.renderRevision !== this.revision) continue;
      if (data.entityRef) return { ref: structuredClone(data.entityRef) };
      if (data.baseRef) {
        const index =
            hit.object instanceof THREE.LineSegments
              ? Math.floor((hit.index ?? -2) / 2)
              : (hit.index ?? -1),
          key = data.ids[index];
        if (key)
          return { ref: { ...structuredClone(data.baseRef), entityId: key } };
      }
      if (data.id)
        return {
          legacyId: data.id,
          path: structuredClone(data.occurrencePath),
        };
    }
    return null;
  }
  dispose() {
    for (const r of this.resources) r.dispose();
    this.resources.clear();
    this.root.clear();
    this.pickables.length = 0;
    this.legacy.clear();
  }
}
