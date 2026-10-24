import type { Vec3 } from "@forma/shared";
export function snapPosition(position: Vec3, step: number): Vec3 {
  return step > 0
    ? (position.map((n) => Math.round(n / step) * step) as Vec3)
    : [...position];
}
