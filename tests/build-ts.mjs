import fs from 'node:fs';
import ts from 'typescript';

/**
 * Transpiles the dependency-free TypeScript modules under test (shared/*, pure lib/*) to ES modules in `outDir`, rewriting their relative
 * imports to the generated .mjs files. Output directories are git-ignored build products: never hand-edit them.
 * Modules that need the Workers runtime (lib/server.ts, lib/resident-auth.ts, ...) are exercised by the API smoke tests instead.
 */
export function buildModules(modules, outDir) {
 fs.mkdirSync(outDir, {recursive: true});
 const base = name => name.split('/').at(-1);
 for (const src of modules) {
  let code = fs.readFileSync(src + '.ts', 'utf8');
  for (const name of modules) code = code.replaceAll(`'../${name}'`, `'./${base(name)}.mjs'`).replaceAll(`'./${base(name)}'`, `'./${base(name)}.mjs'`);
  const out = ts.transpileModule(code, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022}}).outputText;
  fs.writeFileSync(`${outDir}/${base(src)}.mjs`, out);
 }
}
