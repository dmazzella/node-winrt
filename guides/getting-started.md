---
title: Getting started
---

# Getting started

## Installation

```sh
npm install @node-ctypes/winrt
```

`@node-ctypes/winrt` is a pure TypeScript / ESM package powered by [`@node-ctypes/comtypes`](https://www.npmjs.com/package/@node-ctypes/comtypes) and [`node-ctypes`](https://www.npmjs.com/package/node-ctypes) — no C++ compiler or Windows SDK installation is required.

## Requirements

- **Node.js 24+** (ESM).
- **Windows 10 / 11** (x64 or ARM64) at runtime (`combase.dll`, `ole32.dll`, and `C:\Windows\System32\WinMetadata\*.winmd`).
- The ECMA-335 `.winmd` reader, PIID calculator and TypeScript code generator are pure JavaScript and also run on macOS and Linux (pass `--winmd <path>` to generate projections in cross-platform CI).

## Generating your first projection

Use the `node-winrt` CLI to inspect available namespaces and emit strictly-typed TypeScript modules directly from the `.winmd` files already installed on Windows:

```sh
# Discover WinRT namespaces
npx node-winrt namespaces --filter Media

# Inspect types, interfaces and IIDs in a namespace
npx node-winrt info Windows.Media.Ocr

# Generate TypeScript projections
npx node-winrt generate Windows.Media.Ocr Windows.Globalization Windows.Graphics.Imaging Windows.Storage.Streams --out src/winrt

# Or emit compiled .js + .d.ts directly (requires typescript)
npx node-winrt generate Windows.Media.Ocr Windows.Globalization --out src/winrt --js
```

Then import and use the generated WinRT classes:

```typescript
import { Language } from "./winrt/Windows.Globalization.ts";
import { OcrEngine } from "./winrt/Windows.Media.Ocr.ts";
import { UserConsentVerifier } from "./winrt/Windows.Security.Credentials.UI.ts";

// Event-driven IAsyncOperation<T> -> Promise<T>
const availability = await UserConsentVerifier.checkAvailabilityAsync();
console.log("Windows Hello availability:", availability);

// Disposable WinRT runtime classes (`IClosable::Close()` + `Release()`)
using lang = Language.createLanguage("en-US");
console.log(lang?.languageTag, lang?.displayName);

using engine = OcrEngine.tryCreateFromUserProfileLanguages();
console.log("OCR max dimension:", OcrEngine.maxImageDimension);
```

## Entry points

| Subpath                       | Exports                                                                                                                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@node-ctypes/winrt`          | Full runtime (`WinRTObject`, `HSTRING`, `roInitialize`, `activateInstance`, `getActivationFactory`, async/event/collection helpers, `bootstrapWindowsAppRuntime`, `composeWinRTClass`, PIID helpers), metadata, codegen, plus re-exported `ctypes` and `comtypes` namespaces |
| `@node-ctypes/winrt/metadata` | Zero-dependency ECMA-335 `.winmd` parser (`Ecma335File`, `WinMdStore`, `defaultWinMdPaths`) and metadata model types                                                                                                                                                         |
| `@node-ctypes/winrt/codegen`  | Programmatic TypeScript generator (`generateNamespaceModule`, `writeNamespaceModules`)                                                                                                                                                                                       |

Re-exporting `ctypes` and `comtypes` from `@node-ctypes/winrt` ensures generated projections always share a single `COMPointer` / `Structure` identity across monorepos and linked packages.

## Building from source

```sh
npm install
npm run build
npm test
```

See [Building, testing and internals](contributing.md) for mirror-mode tests, demos and docs generation.
