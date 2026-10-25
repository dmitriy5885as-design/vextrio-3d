import { create } from "zustand";
import type { Vec3 } from "@forma/shared";
import { occurrenceMatrix, type ProjectV2 } from "@forma/document";
import { identityMatrix, subtract, transformAffine } from "@forma/geometry";
import {
  workPlane,
  resolvePrecision,
  type WorkPlane,
  type CoordinateSystem,
  type PlaneName,
  type SnapCandidate,
  type PrecisionInput,
  type PrecisionResult,
} from "@forma/snapping";
export interface PrecisionState {
  enabled: boolean;
  path: string[];
  system: CoordinateSystem;
  planeName: PlaneName;
  planeOverride: WorkPlane | null;
  anchor: Vec3;
  target: Vec3 | null;
  hover: SnapCandidate | null;
  rectangle: PrecisionResult["rectangle"] | null;
  axis: "X" | "Y" | "Z" | null;
  gridStep: number;
  contextOnly: boolean;
  exact: boolean;
  editing: boolean;
  error: string;
  warning: string;
  screen: [number, number] | null;
  configure: (
    patch: Partial<
      Pick<
        PrecisionState,
        | "enabled"
        | "path"
        | "system"
        | "planeName"
        | "planeOverride"
        | "axis"
        | "gridStep"
        | "contextOnly"
      >
    >,
  ) => void;
  hoverPoint: (
    target: Vec3 | null,
    hover: SnapCandidate | null,
    screen: [number, number] | null,
  ) => void;
  setAnchor: (point: Vec3) => void;
  clear: () => void;
  submit: (
    project: ProjectV2,
    text: string,
    mode: PrecisionInput["mode"],
    relative: boolean,
  ) => boolean;
}
export function precisionFrame(
  project: ProjectV2,
  state: Pick<PrecisionState, "path" | "system" | "planeName"> &
    Partial<Pick<PrecisionState, "planeOverride">>,
) {
  const matrix = occurrenceMatrix(project, state.path);
  const plane =
    state.planeOverride ??
    workPlane(
      state.planeName,
      state.system === "world" ? identityMatrix() : matrix,
    );
  return { matrix, plane };
}
export const usePrecision = create<PrecisionState>((set, get) => ({
  enabled: false,
  path: [],
  system: "world",
  planeName: "XZ",
  planeOverride: null,
  anchor: [0, 0, 0],
  target: null,
  hover: null,
  rectangle: null,
  axis: null,
  gridStep: 0.25,
  contextOnly: false,
  exact: false,
  editing: false,
  error: "",
  warning: "",
  screen: null,
  configure: (patch) =>
    set({
      ...(patch.path || patch.system || patch.planeName
        ? { planeOverride: null }
        : {}),
      ...patch,
      target: null,
      hover: null,
      rectangle: null,
      exact: false,
      error: "",
      warning: "",
      screen: null,
    }),
  hoverPoint: (target, hover, screen) => {
    if (!get().exact && !get().editing)
      set({ target, hover, screen, error: "" });
  },
  setAnchor: (anchor) =>
    set({
      anchor: [...anchor],
      target: null,
      hover: null,
      rectangle: null,
      exact: false,
      error: "",
      warning: "",
    }),
  clear: () =>
    set({
      target: null,
      hover: null,
      rectangle: null,
      exact: false,
      error: "",
      warning: "",
      screen: null,
      editing: false,
    }),
  submit: (project, text, mode, relative) => {
    const state = get();
    try {
      const { matrix, plane } = precisionFrame(project, state);
      const result = resolvePrecision({
        text,
        mode,
        relative,
        unit: project.units,
        anchor: state.anchor,
        direction: state.target
          ? subtract(state.target, state.anchor)
          : [0, 0, 0],
        matrix,
        plane,
        system: state.system,
        axis: state.axis,
      });
      set({
        target: result.point,
        rectangle: result.rectangle ?? null,
        hover: null,
        exact: true,
        error: "",
        editing: false,
      });
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Ошибка ввода" });
      return false;
    }
  },
}));
export function localPrecisionPoint(
  project: ProjectV2,
  path: string[],
  world: Vec3,
) {
  // Inverse of the entire occurrence matrix; no lossy decomposition into TRS.
  return transformAffine(world, inverse(project, path));
}
import { inverseAffine } from "@forma/geometry";
function inverse(project: ProjectV2, path: string[]) {
  return inverseAffine(occurrenceMatrix(project, path));
}
