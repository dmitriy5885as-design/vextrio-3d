import { validateProjectV1 } from "./validation";
import { validateProjectV2, type Document } from "./v2";
export function validateProject(value: unknown): asserts value is Document {
  if (
    value &&
    typeof value === "object" &&
    Object.getOwnPropertyDescriptor(value, "schemaVersion")?.value === 2
  )
    validateProjectV2(value);
  else validateProjectV1(value);
}
