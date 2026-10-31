import { create } from "zustand";
import type { EntityRef } from "@forma/document";
import type { PlaneFrame, Vec3 } from "@forma/geometry";
export interface OffsetGesture {
  ref: EntityRef;
  anchor: Vec3;
  inward: Vec3;
  plane: PlaneFrame;
  revision: number;
  distance: number;
}
export const useOffset = create<{
  gesture: OffsetGesture | null;
  committing: boolean;
  editing: boolean;
  commitId: number;
  generation: number;
  begin: (g: OffsetGesture) => void;
  move: (distance: number) => void;
  confirm: () => void;
  cancel: () => void;
}>((set, get) => ({
  gesture: null,
  committing: false,
  editing: false,
  commitId: 0,
  generation: 0,
  begin: (gesture) =>
    set({
      gesture,
      committing: false,
      editing: false,
      generation: get().generation + 1,
    }),
  move: (distance) => {
    const s = get();
    if (s.gesture && !s.committing && !s.editing && Number.isFinite(distance))
      set({ gesture: { ...s.gesture, distance } });
  },
  confirm: () => {
    if (get().gesture && !get().committing)
      set({ committing: true, commitId: get().commitId + 1 });
  },
  cancel: () =>
    set({
      gesture: null,
      committing: false,
      editing: false,
      generation: get().generation + 1,
    }),
}));
