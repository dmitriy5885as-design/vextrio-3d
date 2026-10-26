import type { Vec3 } from "@forma/shared";
import {
  add,
  subtract,
  multiply,
  dot,
  length,
  assertVector,
} from "@forma/geometry";
import type { WorkPlane } from "@forma/snapping";
export type SketchTool = "line" | "rectangle";
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
  tool: SketchTool,
  start: Vec3,
  target: Vec3,
  plane: WorkPlane,
  tolerance = 1e-7,
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
    throw Error("Угол прямоугольника должен лежать в рабочей плоскости.");
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
  cancel() {
    this.epoch++;
    this.sequence++;
    clearTimeout(this.timer);
    this.origin = null;
    this.events.clear();
    this.publish({
      phase: "Idle",
      start: null,
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
      const segments = sketchSegments(
        this.state.tool,
        this.state.start,
        target,
        plane,
      );
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
    if (!this.state.start) {
      this.epoch++;
      this.origin = [...target];
      this.publish({
        phase: "Start",
        start: [...target],
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
      segments = sketchSegments(tool, this.state.start, target, plane);
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
        tool === "rectangle" ||
        (this.origin && length(subtract(target, this.origin)) <= 1e-7);
      this.publish({
        phase: finish ? "Finish" : "Continue",
        start: finish ? null : [...target],
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
