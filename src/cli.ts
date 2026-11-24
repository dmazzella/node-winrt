#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generateNamespaceModule } from "./codegen/generate.ts";
import { defaultWinMdPaths, WinMdStore } from "./metadata/winmd.ts";
import { bootstrapWindowsAppRuntime } from "./runtime/bootstrap.ts";

const USAGE = `Usage:
  node-winrt namespaces [--winmd <path>] [--winapp] [--filter <substring>]
  node-winrt info <namespace> [--winmd <path>] [--winapp]
  node-winrt generate <namespace...> [--out <dir>] [--winmd <path>] [--winapp] [--only <Ns:T1,T2>] [--import <specifier>] [--js]

Reads Windows Runtime (.winmd, ECMA-335) metadata — defaulting to
C:\\Windows\\System32\\WinMetadata\\*.winmd — and generates strictly-typed
TypeScript WinRT projections powered by @node-ctypes/winrt.

Options:
  --winapp               Also load .winmd files from the installed Windows App Runtime (WinUI 3, Windows AI)
  --only <Ns:T1,T2,...>  Tree-shake a namespace to only the listed classes/interfaces (repeatable)
  --js                   Compile generated .ts files to .js + .d.ts via TypeScript

Examples:
  node-winrt namespaces --filter Media
  node-winrt info Windows.Media.Ocr
  node-winrt generate Windows.Media.Ocr Windows.Globalization --out src/winrt
  node-winrt generate Microsoft.UI.Xaml Microsoft.UI.Xaml.Controls --winapp --only Microsoft.UI.Xaml.Controls:Button,Slider --out src/winrt`;

function typePaths(specifier: string): Record<string, string[]> {
  const paths: Record<string, string[]> = {};
  if (specifier === "@node-ctypes/winrt") paths["@node-ctypes/winrt"] = [fileURLToPath(new URL("./index.d.ts", import.meta.url))];
  for (const pkg of ["@node-ctypes/comtypes", "node-ctypes"]) {
    try {
      paths[pkg] = [fileURLToPath(import.meta.resolve(pkg)).replace(/\.js$/, ".d.ts")];
    } catch {
      // Resolved normally from output directory.
    }
  }
  return paths;
}

async function emitJavaScript(directory: string, files: readonly string[], specifier: string): Promise<string[]> {
  let ts: typeof import("typescript");
  try {
    ts = (await import("typescript")).default as typeof import("typescript");
  } catch {
    throw new Error("--js requires the typescript package (npm install --save-dev typescript)");
  }
  const program = ts.createProgram([...files], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2022.d.ts", "lib.esnext.disposable.d.ts"],
    declaration: true,
    rewriteRelativeImportExtensions: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    strict: true,
    outDir: directory,
    rootDir: directory,
    paths: typePaths(specifier),
  });
  const result = program.emit();
  const errors = ts
    .getPreEmitDiagnostics(program)
    .concat(result.diagnostics)
    .filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    throw new Error(ts.formatDiagnostics(errors, { getCanonicalFileName: (n) => n, getCurrentDirectory: () => directory, getNewLine: () => "\n" }));
  }
  const outputs: string[] = [];
  for (const file of files) {
    rmSync(file);
    const stem = basename(file, ".ts");
    outputs.push(join(directory, `${stem}.js`), join(directory, `${stem}.d.ts`));
  }
  return outputs;
}

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      winmd: { type: "string", multiple: true },
      only: { type: "string", multiple: true },
      winapp: { type: "boolean", default: false },
      import: { type: "string" },
      filter: { type: "string", short: "f" },
      js: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const [command, ...targets] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }

  let winAppRuntime: (Disposable & { readonly packagePath: string }) | null = null;
  const winmdPaths = values.winmd ? [...values.winmd] : defaultWinMdPaths();
  if (values.winapp) {
    winAppRuntime = bootstrapWindowsAppRuntime();
    if (winAppRuntime.packagePath) winmdPaths.push(winAppRuntime.packagePath);
  }

  try {
    const store = new WinMdStore(winmdPaths);

    if (command === "namespaces") {
      const filter = values.filter?.toLowerCase();
      const list = store.listNamespaces().filter((ns) => !filter || ns.toLowerCase().includes(filter));
      for (const ns of list) console.log(`${ns} (${store.getNamespace(ns).length} types)`);
      return 0;
    }

    if (command === "info") {
      const ns = targets[0];
      if (!ns) {
        console.error(USAGE);
        return 1;
      }
      const types = store.getNamespace(ns);
      if (types.length === 0) {
        console.error(`Namespace not found: ${ns}`);
        return 1;
      }
      console.log(`${ns} (${types.length} types)`);
      for (const t of types) {
        const extra =
          t.kind === "interface" || t.kind === "delegate"
            ? t.guid
              ? ` ${t.guid}`
              : ""
            : t.kind === "class"
              ? ` (${t.staticInterfaces.length} static, ${t.interfaces.length} interfaces)`
              : t.kind === "enum"
                ? ` (${t.members.length} values)`
                : ` (${t.fields.length} fields)`;
        console.log(`  ${t.kind.padEnd(10)} ${t.name}${extra}`);
      }
      return 0;
    }

    if (command === "generate") {
      if (targets.length === 0) {
        console.error(USAGE);
        return 1;
      }
      const includeTypes: Record<string, string[]> = {};
      for (const spec of values.only ?? []) {
        const sep = spec.indexOf(":");
        if (sep <= 0) throw new Error(`Invalid --only syntax "${spec}": expected Namespace:Type1,Type2`);
        const ns = spec.slice(0, sep);
        const list = spec
          .slice(sep + 1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        includeTypes[ns] = [...(includeTypes[ns] ?? []), ...list];
      }

      const directory = resolve(values.out ?? ".");
      mkdirSync(directory, { recursive: true });
      const siblingNamespaces = new Set(targets);
      const tsFiles: string[] = [];
      for (const ns of targets) {
        const code = generateNamespaceModule(store, ns, {
          importFrom: values.import,
          siblingNamespaces,
          includeTypes: Object.keys(includeTypes).length > 0 ? includeTypes : undefined,
        });
        const filePath = join(directory, `${ns}.ts`);
        writeFileSync(filePath, code, "utf8");
        tsFiles.push(filePath);
      }
      const written = values.js ? await emitJavaScript(directory, tsFiles, values.import ?? "@node-ctypes/winrt") : tsFiles;
      for (const path of written) console.log(path);
      return 0;
    }

    console.error(USAGE);
    return 1;
  } finally {
    winAppRuntime?.[Symbol.dispose]();
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
