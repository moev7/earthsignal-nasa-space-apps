import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../lib/area-result.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
if (!compiled.includes("export function checkedAreaResult(") || /\bimport\b/.test(compiled)) throw Error("Display validator must remain standalone");
const script = compiled.replace("export function checkedAreaResult(", "function checkedAreaResult(");
writeFileSync(new URL("../lib/area-result.generated.ts", import.meta.url), "// Generated from area-result.ts by scripts/build-sampling-lab.mjs.\nexport const AREA_RESULT_SCRIPT = " + JSON.stringify(script) + ";\n");
