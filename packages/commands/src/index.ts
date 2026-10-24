import { clone, type Project } from "@forma/shared";
export interface Command {
  label: string;
  execute(project: Project): Project;
  undo(project: Project): Project;
}
export class SnapshotCommand implements Command {
  constructor(
    public label: string,
    private before: Project,
    private after: Project,
  ) {}
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
    const result = command.execute(p);
    this.past.push(command);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
    return result;
  }
  undo(p: Project) {
    const c = this.past.pop();
    if (!c) return p;
    this.future.push(c);
    return c.undo(p);
  }
  redo(p: Project) {
    const c = this.future.pop();
    if (!c) return p;
    this.past.push(c);
    return c.execute(p);
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}
