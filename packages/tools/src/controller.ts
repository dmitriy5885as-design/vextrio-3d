import type { Vec3 } from "@forma/shared";
import {
  add,
  subtract,
  multiply,
  dot,
  length,
  assertVector,
  cross,
  validatePlane,
  arcChordFrame,
  arcProfile,
} from "@forma/geometry";
import type { WorkPlane } from "@forma/snapping";
export type SketchTool = "line" | "rectangle" | "circle" | "arc";
export type ToolPhase =
  "Idle" | "Hover" | "Start" | "Preview" | "Commit" | "Continue" | "Finish";
export interface SketchStats {
  vertices: number;
  edges: number;
  faces: number;
  areas: number[];
}
export interface ToolState {
  tool: SketchTool | null;
  phase: ToolPhase;
  start: Vec3 | null;
  target: Vec3 | null;
  segments: [Vec3, Vec3][];
  error: string;
  preview: "pending" | "valid" | "invalid" | null;
  stats: SketchStats | null;
  circleSides: number;
  arcSides: number;
  arcEnd: Vec3 | null;
}
export type SketchReply =
  | { status: "applied" | "noop" | "preview"; stats?: SketchStats }
  | { status: "rejected"; error: string };
export interface ToolHost {
  preview: (
    segments: [Vec3, Vec3][],
    accept: () => boolean,
  ) => Promise<SketchReply>;
  commit: (
    segments: [Vec3, Vec3][],
    accept: () => boolean,
  ) => Promise<SketchReply>;
}
export function sketchSegments(
  tool: Exclude<SketchTool, "arc">,
  start: Vec3,
  target: Vec3,
  plane: WorkPlane,
  tolerance = 1e-7,
  circleSides = 24,
): [Vec3, Vec3][] {
  assertVector(start);
  assertVector(target);
  if (tool === "line") {
    if (length(subtract(target, start)) <= tolerance)
      throw Error("Начало и конец отрезка совпадают.");
    return [[[...start], [...target]]];
  }
  const delta = subtract(target, start),
    u = dot(delta, plane.u),
    v = dot(delta, plane.v);
  if (
    Math.abs(dot(delta, plane.normal)) >
    Math.max(tolerance, length(delta) * 1e-12)
  )
    throw Error("Точка должна лежать в рабочей плоскости.");
  if (tool === "circle") {
    validatePlane(plane);
    if (!Number.isInteger(circleSides) || circleSides < 3 || circleSides > 128)
      throw Error("Число сегментов должно быть целым от 3 до 128.");
    const radius = Math.hypot(u, v);
    if (radius <= tolerance)
      throw Error("Радиус должен быть больше геометрического допуска.");
    const radial = multiply(
        add(multiply(plane.u, u), multiply(plane.v, v)),
        1 / radius,
      ),
      tangent = cross(plane.normal, radial);
    const points = Array.from({ length: circleSides }, (_, i) => {
      const angle = (2 * Math.PI * i) / circleSides;
      const p = add(
        start,
        add(
          multiply(radial, radius * Math.cos(angle)),
          multiply(tangent, radius * Math.sin(angle)),
        ),
      );
      assertVector(p);
      return p;
    });
    return points.map((p, i) => [p, points[(i + 1) % points.length]]);
  }
  if (Math.abs(u) <= tolerance || Math.abs(v) <= tolerance)
    throw Error("Ширина и высота должны быть больше геометрического допуска.");
  const a = add(start, multiply(plane.u, u)),
    b = add(a, multiply(plane.v, v)),
    c = add(start, multiply(plane.v, v));
  return [
    [start, a],
    [a, b],
    [b, c],
    [c, start],
  ].map(([a, b]) => [[...a], [...b]]) as [Vec3, Vec3][];
}
export class ToolController {
  state: ToolState = {
    tool: null,
    phase: "Idle",
    start: null,
    target: null,
    segments: [],
    error: "",
    preview: null,
    stats: null,
    circleSides: 24,
    arcSides: 12,
    arcEnd: null,
  };
  private listeners = new Set<(s: ToolState) => void>();
  private epoch = 0;
  get generation() {
    return this.epoch;
  }
  private sequence = 0;
  private origin: Vec3 | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private events = new Set<string>();
  constructor(
    private host: ToolHost,
    private delay = 100,
  ) {}
  subscribe(fn: (s: ToolState) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private publish(patch: Partial<ToolState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }
  activate(tool: SketchTool | null) {
    this.cancel();
    this.publish({ tool });
  }
  setCircleSides(count: number, plane: WorkPlane) {
    if (this.state.phase === "Commit") return false;
    if (!Number.isInteger(count) || count < 3 || count > 128) {
      this.publish({ error: "Число сегментов должно быть целым от 3 до 128." });
      return false;
    }
    this.publish({ circleSides: count, error: "" });
    if (this.state.tool === "circle" && this.state.start && this.state.target)
      this.move(this.state.target, plane);
    return true;
  }
  setArcSides(count: number, plane: WorkPlane) {
    if (this.state.phase === "Commit") return false;
    if (!Number.isInteger(count) || count < 2 || count > 128) {
      this.publish({
        error: "Число сегментов дуги должно быть целым от 2 до 128.",
      });
      return false;
    }
    this.publish({ arcSides: count, error: "" });
    if (
      this.state.tool === "arc" &&
      this.state.start &&
      this.state.arcEnd &&
      this.state.target
    )
      this.move(this.state.target, plane);
    return true;
  }
  private buildSegments(target: Vec3, plane: WorkPlane): [Vec3, Vec3][] {
    const { tool, start, arcEnd, arcSides, circleSides } = this.state;
    if (!tool || !start) throw Error("Задайте начальную точку.");
    if (tool === "arc") {
      if (!arcEnd) throw Error("Сначала задайте второй конец дуги.");
      return arcProfile(start, arcEnd, target, plane, arcSides).segments;
    }
    return sketchSegments(tool, start, target, plane, 1e-7, circleSides);
  }
  cancel() {
    this.epoch++;
    this.sequence++;
    clearTimeout(this.timer);
    this.origin = null;
    this.events.clear();
    this.publish({
      phase: "Idle",
      start: null,
      arcEnd: null,
      target: null,
      segments: [],
      preview: null,
      stats: null,
      error: "",
    });
  }
  move(target: Vec3 | null, plane: WorkPlane) {
    if (!this.state.tool || this.state.phase === "Commit") return;
    clearTimeout(this.timer);
    const seq = ++this.sequence,
      epoch = this.epoch;
    if (!target) {
      this.publish({ target: null, segments: [], preview: null, stats: null });
      return;
    }
    if (!this.state.start) {
      this.publish({
        phase: "Hover",
        target: [...target],
        segments: [],
        error: "",
      });
      return;
    }
    try {
      if (this.state.tool === "arc" && !this.state.arcEnd) {
        arcChordFrame(this.state.start, target, plane);
        this.publish({
          phase: "Preview",
          target: [...target],
          segments: [[[...this.state.start], [...target]]],
          error: "",
          preview: null,
          stats: null,
        });
        return;
      }
      const segments = this.buildSegments(target, plane);
      this.publish({
        phase: "Preview",
        target: [...target],
        segments,
        error: "",
        preview: "pending",
        stats: null,
      });
      const accept = () =>
        seq === this.sequence &&
        epoch === this.epoch &&
        this.state.phase !== "Commit";
      this.timer = setTimeout(async () => {
        try {
          const result = await this.host.preview(segments, accept);
          if (!accept()) return;
          this.publish(
            result.status === "rejected"
              ? { preview: "invalid", error: result.error }
              : { preview: "valid", stats: result.stats ?? null, error: "" },
          );
        } catch (e) {
          if (accept())
            this.publish({
              preview: "invalid",
              error: e instanceof Error ? e.message : "Ошибка предпросмотра",
            });
        }
      }, this.delay);
    } catch (e) {
      this.publish({
        phase: "Preview",
        target: [...target],
        segments: [],
        preview: "invalid",
        stats: null,
        error: e instanceof Error ? e.message : "Ошибка построения",
      });
    }
  }
  async click(
    target: Vec3 | null,
    plane: WorkPlane,
    eventId: string,
  ): Promise<void> {
    if (
      !this.state.tool ||
      this.state.phase === "Commit" ||
      this.events.has(eventId)
    )
      return;
    this.events.add(eventId);
    if (this.events.size > 64)
      this.events.delete(this.events.values().next().value!);
    if (!target) {
      this.publish({
        error: "Нет допустимой точки. Выберите плоскость или привязку.",
      });
      return;
    }
    try {
      assertVector(target);
    } catch (e) {
      this.publish({
        error: e instanceof Error ? e.message : "Недопустимая точка.",
      });
      return;
    }
    if (!this.state.start) {
      this.epoch++;
      this.origin = [...target];
      this.publish({
        phase: "Start",
        start: [...target],
        arcEnd: null,
        target: null,
        segments: [],
        preview: null,
        stats: null,
        error: "",
      });
      return;
    }
    clearTimeout(this.timer);
    this.sequence++;
    const epoch = this.epoch,
      tool = this.state.tool;
    let segments: [Vec3, Vec3][];
    try {
      if (tool === "arc" && !this.state.arcEnd) {
        arcChordFrame(this.state.start, target, plane);
        this.publish({
          phase: "Start",
          arcEnd: [...target],
          target: null,
          segments: [],
          preview: null,
          stats: null,
          error: "",
        });
        return;
      }
      segments = this.buildSegments(target, plane);
    } catch (e) {
      this.publish({
        error: e instanceof Error ? e.message : "Ошибка построения",
      });
      return;
    }
    this.publish({ phase: "Commit", segments, error: "" });
    const accept = () =>
      epoch === this.epoch &&
      this.state.tool === tool &&
      this.state.phase === "Commit";
    try {
      const result = await this.host.commit(segments, accept);
      if (!accept()) return;
      if (result.status === "rejected") {
        this.publish({
          phase: "Preview",
          preview: "invalid",
          error: result.error,
        });
        return;
      }
      const finish =
        tool !== "line" ||
        (this.origin && length(subtract(target, this.origin)) <= 1e-7);
      this.publish({
        phase: finish ? "Finish" : "Continue",
        start: finish ? null : [...target],
        arcEnd: null,
        target: null,
        segments: [],
        error: "",
        preview: null,
        stats: result.stats ?? null,
      });
      if (finish) this.origin = null;
    } catch (e) {
      if (accept())
        this.publish({
          phase: "Preview",
          preview: "invalid",
          error: e instanceof Error ? e.message : "Ошибка построения",
        });
    }
  }
}
