import { clone } from "@forma/shared";
import type { Document as Project } from "@forma/document";
import { validateProject } from "@forma/document";
export interface Command {
  label: string;
  execute(project: Project): Project;
  undo(project: Project): Project;
}
export class SnapshotCommand implements Command {
  private before: Project;
  private after: Project;
  constructor(
    public label: string,
    before: Project,
    after: Project,
  ) {
    this.before = clone(before);
    this.after = clone(after);
  }
  execute() {
    return clone(this.after);
  }
  undo() {
    return clone(this.before);
  }
}
export class CommandHistory {
  private past: Command[] = [];
  private future: Command[] = [];
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get undoLabel() {
    return this.past.at(-1)?.label ?? "";
  }
  run(command: Command, p: Project) {
    const result = command.execute(clone(p));
    validateProject(result);
    if (JSON.stringify(result) === JSON.stringify(p)) return clone(p);
    const accepted = clone(result);
    this.past.push(command);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    return accepted;
  }
  undo(
    p: Project,
    prepare: (candidate: Project) => Project = (candidate) => candidate,
  ) {
    const c = this.past.at(-1);
    if (!c) return p;
    const result = prepare(c.undo(clone(p)));
    validateProject(result);
    const accepted = clone(result);
    this.past.pop();
    this.future.push(c);
    return accepted;
  }
  redo(
    p: Project,
    prepare: (candidate: Project) => Project = (candidate) => candidate,
  ) {
    const c = this.future.at(-1);
    if (!c) return p;
    const result = prepare(c.execute(clone(p)));
    validateProject(result);
    const accepted = clone(result);
    this.future.pop();
    this.past.push(c);
    return accepted;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}
