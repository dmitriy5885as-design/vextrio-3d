import { create } from "zustand";
import type { EntityRef } from "@forma/document";
import type { Vec3 } from "@forma/geometry";
export interface MoveGesture {
  refs: EntityRef[];
  anchor: Vec3;
  target: Vec3;
  revision: number;
}
export const useMove = create<{
  gesture: MoveGesture | null;
  generation: number;
  committing: boolean;
  commitId: number;
  copy: boolean;
  begin: (g: MoveGesture) => void;
  move: (p: Vec3) => void;
  confirm: () => void;
  cancel: () => void;
}>((set, get) => ({
  gesture: null,
  generation: 0,
  committing: false,
  commitId: 0,
  copy: false,
  begin: (gesture) =>
    set({ gesture, generation: get().generation + 1, committing: false }),
  move: (target) => {
    const s = get();
    if (s.gesture && !s.committing)
      set({ gesture: { ...s.gesture, target: [...target] } });
  },
  confirm: () => {
    if (get().gesture && !get().committing)
      set({ committing: true, commitId: get().commitId + 1 });
  },
  cancel: () =>
    set({ gesture: null, committing: false, generation: get().generation + 1 }),
}));
