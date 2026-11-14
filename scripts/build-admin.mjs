// Compile the operator module too: distro Node builds may omit TypeScript support.
import ts from "typescript";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
const destination = new URL("../dist/standalone/admin/", import.meta.url);
await mkdir(new URL("lib/", destination), { recursive: true });
await mkdir(new URL("scripts/", destination), { recursive: true });
const source = await readFile(
  new URL("../lib/local-auth.ts", import.meta.url),
  "utf8",
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
await writeFile(new URL("lib/local-auth.mjs", destination), output);
await copyFile(
  new URL("collaborator.mjs", import.meta.url),
  new URL("scripts/collaborator.mjs", destination),
);
await writeFile(
  new URL("package.json", destination),
  '{"type":"module","private":true}\n',
);
console.log("Packaged plain JavaScript collaborator CLI");
