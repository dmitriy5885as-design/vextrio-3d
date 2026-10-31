import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import ts from "typescript";
const builtins = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(path.join(directory, entry.name))
      : /\.(?:[cm]?[jt]sx?)$/.test(entry.name)
        ? [path.join(directory, entry.name)]
        : [],
  );
}
function imports(file) {
  const result = [];
  const ast = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function add(node) {
    if (node && ts.isStringLiteralLike(node)) result.push(node.text);
    else throw Error(`Nonliteral module import cannot be verified: ${file}`);
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      add(node.moduleReference.expression);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    )
      add(node.arguments[0]);
    else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL" &&
      node.arguments?.length === 2 &&
      node.arguments[1].getText(ast) === "import.meta.url"
    )
      add(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}
const packageName = (specifier) =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
export function checkDependencies(root) {
  const workspaces = [];
  for (const folder of ["packages", "apps"]) {
    const base = path.join(root, folder);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const directory = path.join(base, entry.name),
        manifest = path.join(directory, "package.json");
      if (entry.isDirectory() && existsSync(manifest))
        workspaces.push({
          directory,
          manifest: JSON.parse(readFileSync(manifest, "utf8")),
        });
    }
  }
  const byName = new Map(workspaces.map((w) => [w.manifest.name, w]));
  if (byName.size !== workspaces.length)
    throw Error("Duplicate workspace package names");
  const graph = new Map(workspaces.map((w) => [w.manifest.name, new Set()]));
  const configPath = path.join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
    );
  const options = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    root,
  ).options;
  const errors = [];
  for (const workspace of workspaces) {
    const declared = {
      ...workspace.manifest.dependencies,
      ...workspace.manifest.devDependencies,
      ...workspace.manifest.peerDependencies,
      ...workspace.manifest.optionalDependencies,
    };
    for (const dep of Object.keys(declared)) {
      if (byName.has(dep)) graph.get(workspace.manifest.name).add(dep);
      else if (dep.startsWith("@forma/"))
        errors.push(`${workspace.manifest.name}: unknown workspace ${dep}`);
    }
    const directory = path.join(workspace.directory, "src");
    if (!existsSync(directory)) continue;
    for (const file of sources(directory))
      for (const specifier of imports(file)) {
        if (builtins.has(specifier)) continue;
        const isPath = specifier.startsWith(".") || path.isAbsolute(specifier);
        let dependency;
        if (isPath || specifier.startsWith("@forma/")) {
          const resolved = ts.resolveModuleName(
            specifier,
            file,
            options,
            ts.sys,
          ).resolvedModule;
          // Vite asset imports may carry an inline query such as "?raw".
          const asset = path.resolve(
            path.dirname(file),
            specifier.replace(/\?.*$/, ""),
          );
          const assetExists =
            isPath &&
            /\.(css|svg|png|ico|wasm|json|md)$/.test(asset) &&
            existsSync(asset);
          if (!resolved && !assetExists) {
            errors.push(`${file}: unresolved module ${specifier}`);
            continue;
          }
          // Plain asset files (for example the root CHANGELOG.md loaded via
          // "?raw") introduce no package dependency; they only must stay
          // inside the repository.
          if (assetExists && !resolved) {
            const rel = path.relative(realpathSync(root), realpathSync(asset));
            if (rel.startsWith("..") || path.isAbsolute(rel))
              errors.push(
                `${file}: module outside the repository: ${specifier}`,
              );
            continue;
          }
          const resolvedPath = realpathSync(
            resolved?.resolvedFileName ?? asset,
          );
          dependency = workspaces.find((w) => {
            const rel = path.relative(w.directory, resolvedPath);
            return !rel.startsWith("..") && !path.isAbsolute(rel);
          })?.manifest.name;
          if (!dependency) {
            errors.push(
              `${file}: module outside a declared workspace: ${specifier}`,
            );
            continue;
          }
        } else dependency = packageName(specifier);
        if (dependency === workspace.manifest.name) continue;
        if (!Object.hasOwn(declared, dependency))
          errors.push(
            `${workspace.manifest.name}: undeclared dependency ${dependency} in ${path.relative(root, file)}`,
          );
        if (byName.has(dependency))
          graph.get(workspace.manifest.name).add(dependency);
      }
  }
  const visiting = new Set(),
    done = new Set();
  function walk(name, trail = []) {
    if (visiting.has(name))
      throw Error(`Dependency cycle: ${[...trail, name].join(" -> ")}`);
    if (done.has(name)) return;
    visiting.add(name);
    for (const next of graph.get(name)) walk(next, [...trail, name]);
    visiting.delete(name);
    done.add(name);
  }
  if (errors.length) throw Error(errors.join("\n"));
  for (const name of graph.keys()) walk(name);
  return { workspaceCount: workspaces.length };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = checkDependencies(
      fileURLToPath(new URL("..", import.meta.url)),
    );
    console.log(
      `Dependencies verified: ${result.workspaceCount} workspaces; recursive imports, declarations and cycles`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
