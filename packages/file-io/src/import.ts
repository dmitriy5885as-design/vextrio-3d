import { type PolygonData, type Vec3, MAX_IMPORT_FACES } from "@forma/geometry";
export interface ImportedPart extends PolygonData {
  name: string;
}
export function parseOBJ(text: string, scale: number): PolygonData {
  if (!Number.isFinite(scale) || scale <= 0)
    throw Error("Некорректные единицы импорта.");
  if (text.length > 20_000_000 || text.includes("\0"))
    throw Error("Некорректный OBJ-файл.");
  const positions: Vec3[] = [],
    polygons: number[][] = [],
    lines: number[][] = [];
  const resolve = (token: string) => {
    const raw = token.split("/")[0];
    if (!/^-?\d+$/.test(raw)) throw Error("Некорректный индекс OBJ.");
    const n = Number(raw),
      i = n > 0 ? n - 1 : positions.length + n;
    if (!n || i < 0 || i >= positions.length)
      throw Error("Индекс OBJ вне диапазона.");
    return i;
  };
  for (const raw of text.split(/\r?\n/)) {
    const [type, ...values] = raw.split("#")[0].trim().split(/\s+/);
    if (!type) continue;
    if (type === "v") {
      if (
        values.length !== 3 ||
        values.some((v) => !v.trim() || !Number.isFinite(Number(v)))
      )
        throw Error("Некорректная вершина OBJ.");
      positions.push(values.map((v) => Number(v) * scale) as Vec3);
    } else if (type === "f") {
      if (values.length < 3 || values.length > 256)
        throw Error("Некорректная грань OBJ.");
      polygons.push(values.map(resolve));
    } else if (type === "l") {
      if (values.length < 2) throw Error("Некорректная линия OBJ.");
      lines.push(values.map(resolve));
    } else if (["curv", "surf", "call", "csh"].includes(type))
      throw Error("OBJ содержит неподдерживаемые поверхности или команды.");
    if (
      positions.length > 15000 ||
      polygons.length > MAX_IMPORT_FACES ||
      lines.length > 10000
    )
      throw Error("OBJ превышает лимит редактируемого импорта.");
  }
  return { positions, polygons, lines };
}
export function parseSTL(buffer: ArrayBuffer, scale: number): PolygonData {
  if (!Number.isFinite(scale) || scale <= 0 || buffer.byteLength > 20_000_000)
    throw Error("Некорректный STL-файл или единицы.");
  const positions: Vec3[] = [],
    polygons: number[][] = [],
    view = new DataView(buffer);
  const triangle = (points: Vec3[]) => {
    if (polygons.length >= MAX_IMPORT_FACES)
      throw Error("STL превышает лимит 3000 граней.");
    polygons.push(
      points.map((p) => {
        const i = positions.length;
        positions.push(p.map((n) => n * scale) as Vec3);
        return i;
      }),
    );
  };
  const count = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  if (buffer.byteLength >= 84 && 84 + count * 50 === buffer.byteLength) {
    if (count > MAX_IMPORT_FACES)
      throw Error("STL превышает лимит 3000 граней.");
    for (let i = 0; i < count; i++) {
      const points: Vec3[] = [];
      for (let j = 0; j < 3; j++) {
        const p = 84 + i * 50 + 12 + j * 12;
        points.push([
          view.getFloat32(p, true),
          view.getFloat32(p + 4, true),
          view.getFloat32(p + 8, true),
        ]);
      }
      triangle(points);
    }
  } else {
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(buffer)
      .trim();
    if (!/^solid(?:\s|$)/i.test(text) || !/^endsolid(?:\s|$)/im.test(text))
      throw Error("Повреждённый STL-файл.");
    const facets = [
      ...text.matchAll(
        /facet\s+normal\s+[^\r\n]+\s+outer\s+loop\s+([\s\S]*?)\s+endloop\s+endfacet/gi,
      ),
    ];
    const residual = text
      .replace(/solid[^\r\n]*|endsolid[^\r\n]*/gi, "")
      .replace(
        /facet\s+normal\s+[^\r\n]+\s+outer\s+loop\s+[\s\S]*?\s+endloop\s+endfacet/gi,
        "",
      )
      .trim();
    if (residual || !facets.length) throw Error("Повреждённый ASCII STL.");
    for (const facet of facets) {
      const rows = facet[1]
        .trim()
        .split(/\r?\n/)
        .map((r) => r.trim().split(/\s+/));
      if (
        rows.length !== 3 ||
        rows.some(
          (r) =>
            r.length !== 4 ||
            r[0].toLowerCase() !== "vertex" ||
            r.slice(1).some((n) => !Number.isFinite(Number(n))),
        )
      )
        throw Error("Некорректная грань STL.");
      triangle(rows.map((r) => r.slice(1).map(Number) as Vec3));
    }
  }
  if (!polygons.length) throw Error("В STL нет граней.");
  return { positions, polygons };
}
