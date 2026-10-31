import { expect, it } from "vitest";
import { APP_VERSION } from "@forma/shared";
import {
  parseChangelog,
  changelogEntries,
  devblogEntries,
  DEV_BLOG_LIMIT,
} from "../apps/web/src/changelog";

it("parses changelog headings into versions, titles and bullet items", () => {
  const entries = parseChangelog(
    [
      "# Changelog",
      "",
      "## 0.2.0-alpha.4 — окружность C",
      "",
      "- Центр/радиус мышью; [отчёт](docs/0.2/CIRCLES.md).",
      "- Undo/Redo и файлы.",
      "",
      "## Unreleased — объёмное моделирование",
      "",
      "- Extrude-face: настоящие рёбра/грани.",
    ].join("\n"),
  );
  expect(entries).toEqual([
    {
      version: "0.2.0-alpha.4",
      title: "окружность C",
      items: ["Центр/радиус мышью; отчёт.", "Undo/Redo и файлы."],
    },
    {
      version: "Unreleased",
      title: "объёмное моделирование",
      items: ["Extrude-face: настоящие рёбра/грани."],
    },
  ]);
});

it("keeps the devblog automatically in sync with the shipped version", () => {
  // A version bump without a matching CHANGELOG.md heading fails here, so the
  // «О программе» devblog can never silently lag behind the release.
  expect(changelogEntries.length).toBeGreaterThan(0);
  expect(devblogEntries[0].version).toBe(APP_VERSION);
  expect(devblogEntries[0].items.length).toBeGreaterThan(0);
});

it("shows only recent devblog entries without the pre-rebrand history", () => {
  expect(devblogEntries).toHaveLength(DEV_BLOG_LIMIT);
  expect(devblogEntries).toEqual(
    changelogEntries.slice(0, DEV_BLOG_LIMIT),
  );
  // The welcome and help screens assert that the legacy brand never reaches
  // the visible UI; older changelog notes mentioning it must stay hidden.
  for (const entry of devblogEntries) {
    expect(entry.version).not.toMatch(/FORMA/);
    expect(entry.title).not.toMatch(/FORMA/);
    for (const item of entry.items) expect(item).not.toMatch(/FORMA/);
  }
});
