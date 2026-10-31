import changelogMarkdown from "../../../CHANGELOG.md?raw";

export interface ChangelogEntry {
  version: string;
  title: string;
  items: string[];
}

// Markdown links keep the label text so the devblog stays readable without
// resolving repository-relative doc paths inside the app.
const readableItem = (line: string) =>
  line.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const [version, ...rest] = heading[1]
        .split("—")
        .map((part) => part.trim());
      current = { version, title: rest.join("—"), items: [] };
      entries.push(current);
    } else {
      const item = /^[-*]\s+(.+)$/.exec(line);
      if (item && current) current.items.push(readableItem(item[1]));
    }
  }
  return entries;
}

export const changelogEntries = parseChangelog(changelogMarkdown);

// The help dialog shows only the most recent entries: older history (including
// pre-rebrand notes) stays in the repository file, not in the shipped UI.
export const DEV_BLOG_LIMIT = 5;
export const devblogEntries = changelogEntries.slice(0, DEV_BLOG_LIMIT);
