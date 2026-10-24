import { describe, expect, it } from "vitest";
import { CommandHistory, SnapshotCommand, type Command } from "@forma/commands";
import { createObject, emptyProject } from "@forma/document";
describe("atomic history boundaries", () => {
  it("never mutates its caller or redo branch when execute throws", () => {
    const h = new CommandHistory(),
      p = emptyProject(),
      after = structuredClone(p);
    after.name = "second";
    h.run(new SnapshotCommand("name", p, after), p);
    h.undo(after);
    const bad: Command = {
      label: "bad",
      execute(value) {
        value.name = "leak";
        throw Error("failed");
      },
      undo: (value) => value,
    };
    expect(() => h.run(bad, p)).toThrow("failed");
    expect(p.name).toBe("Без названия");
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(h.redo(p).name).toBe("second");
  });
  it("validates execute output before recording it", () => {
    const h = new CommandHistory(),
      p = emptyProject();
    const bad: Command = {
      label: "bad",
      execute(value) {
        value.objects = [createObject("cube")];
        value.objects[0].transform.scale[0] = 0;
        return value;
      },
      undo: (value) => value,
    };
    expect(() => h.run(bad, p)).toThrow();
    expect(p.objects).toHaveLength(0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
  it("does not pop undo when the inverse throws or becomes invalid", () => {
    const h = new CommandHistory(),
      p = emptyProject();
    let invalid = true;
    const command: Command = {
      label: "rename",
      execute: (value) => ({ ...value, name: "new" }),
      undo(value) {
        if (invalid) {
          value.name = "leak";
          value.camera.zoom = 0;
          return value;
        }
        return structuredClone(p);
      },
    };
    const after = h.run(command, p);
    expect(() => h.undo(after)).toThrow();
    expect(after.camera.zoom).toBe(1);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
    invalid = false;
    expect(h.undo(after)).toEqual(p);
  });
  it("does not consume redo when execute throws on replay", () => {
    const h = new CommandHistory(),
      p = emptyProject();
    let fail = false;
    const command: Command = {
      label: "rename",
      execute(value) {
        if (fail) throw Error("redo failed");
        return { ...value, name: "new" };
      },
      undo: () => structuredClone(p),
    };
    h.undo(h.run(command, p));
    fail = true;
    expect(() => h.redo(p)).toThrow("redo failed");
    expect(h.canRedo).toBe(true);
    expect(h.canUndo).toBe(false);
    fail = false;
    expect(h.redo(p).name).toBe("new");
  });
  it("snapshots are isolated from later caller mutations", () => {
    const p = emptyProject(),
      after = structuredClone(p);
    after.name = "accepted";
    const command = new SnapshotCommand("rename", p, after);
    p.name = "mutated before";
    after.name = "mutated after";
    const h = new CommandHistory(),
      result = h.run(command, emptyProject());
    expect(result.name).toBe("accepted");
    expect(h.undo(result).name).toBe("Без названия");
  });
});

it("a successful no-op does not clear redo", () => {
  const p = emptyProject(),
    h = new CommandHistory(),
    after = { ...p, name: "next" };
  h.undo(h.run(new SnapshotCommand("edit", p, after), p));
  h.run(new SnapshotCommand("noop", p, p), p);
  expect(h.canRedo).toBe(true);
  expect(h.canUndo).toBe(false);
});
