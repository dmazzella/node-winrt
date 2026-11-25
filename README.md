# node-winrt (`@node-ctypes/winrt`)

[![npm version](https://img.shields.io/npm/v/@node-ctypes/winrt.svg)](https://www.npmjs.com/package/@node-ctypes/winrt)
[![npm downloads](https://img.shields.io/npm/dm/@node-ctypes/winrt.svg)](https://www.npmjs.com/package/@node-ctypes/winrt)
[![CI](https://github.com/dmazzella/node-winrt/actions/workflows/ci.yml/badge.svg)](https://github.com/dmazzella/node-winrt/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Typed Windows Runtime (WinRT) projections and `.winmd` (ECMA-335) TypeScript code generator for Node.js**, powered by
[`@node-ctypes/comtypes`](https://www.npmjs.com/package/@node-ctypes/comtypes) and
[`node-ctypes`](https://www.npmjs.com/package/node-ctypes).
Think of it as **`PyWinRT` / `windows-rs` for Node.js** — pure TypeScript, zero C++ compilation.

- **Node.js 24+**, ESM, TypeScript declarations.
- **Zero-dependency `.winmd` reader & codegen**: reads `C:\Windows\System32\WinMetadata\*.winmd` or Windows App SDK `.winmd` files (`--winapp`) with exact WinRT UUIDv5 PIIDs and `--only` tree-shaking.
- **Event-driven WinRT async, events, collections & WinUI 3**: `IAsyncAction`/`IAsyncOperation<T>` via free-threaded `CompletedHandler`, `on<Event>()`, `WinRTVector`, `bootstrapWindowsAppRuntime()` (zero `Bootstrap.dll`), and COM aggregation (`composeWinRTClass`).

---

## Quick start

```sh
npm install @node-ctypes/winrt
npx node-winrt generate Windows.Media.Ocr Windows.Globalization Windows.Security.Credentials.UI --out src/winrt
```

```typescript
import { Language } from "./winrt/Windows.Globalization.ts";
import { OcrEngine } from "./winrt/Windows.Media.Ocr.ts";
import { UserConsentVerifier } from "./winrt/Windows.Security.Credentials.UI.ts";

// Event-driven WinRT async -> Promise
const availability = await UserConsentVerifier.checkAvailabilityAsync();
console.log("Windows Hello availability:", availability);

// Disposable WinRT classes (`IClosable::Close()` + `Release()`)
using lang = Language.createLanguage("en-US");
console.log(lang?.languageTag, lang?.displayName);

using engine = OcrEngine.tryCreateFromUserProfileLanguages();
console.log("OCR max dimension:", OcrEngine.maxImageDimension);
```

To build from source, see [Getting started](guides/getting-started.md#building-from-source).

## Supported platforms

| Operating system | x64 | ARM64 | Notes                                                                             |
| ---------------- | --- | ----- | --------------------------------------------------------------------------------- |
| Windows 10 / 11  | ✅  | ✅    | Full WinRT runtime, WinUI 3 (`bootstrapWindowsAppRuntime`) and `.winmd` codegen   |
| macOS / Linux    | ✅  | ✅    | `.winmd` parser, PIID calculator and TypeScript code generator run cross-platform |

Node.js 24 or later. Verified in Electron / mirror mode (`NODE_CTYPES_NO_EXTERNAL_BUFFERS=1`).

---

## Guides

- [Getting started](guides/getting-started.md) — installation, requirements, CLI quick start and entry points
- [Code generation and WinMD metadata](guides/codegen-and-winmd.md) — ECMA-335 `.winmd` reader, PIID computation, tree-shaking (`--only`), `--winapp`, `--js` emit and type mappings
- [Async, events and collections](guides/async-events-and-collections.md) — event-driven WinRT `Promise`s, `on<Event>()` delegates, `WinRTVector`, `IVectorView`, `IMapView`, `IReference` and byte arrays
- [WinUI 3 and Windows App SDK](guides/winui3-and-app-sdk.md) — `bootstrapWindowsAppRuntime()` (zero `Bootstrap.dll`), DPI awareness, Win32 message loop, COM aggregation (`composeWinRTClass`) and registration-free DLLs
- [Building, testing and internals](guides/contributing.md) — scripts, mirror-mode testing, demo regeneration, CI and release workflow

---

## Examples

Generate projections for all examples (`npm run demo:gen:all`), then run any example directly; see the [index](examples/README.md).

- [Hello WinUI 3](examples/hello-winui3/index.ts) — minimal `class App extends Application` + `override onLaunched()` (counterpart to PyWinRT's `hello_app.py`)
- [Async WinUI 3](examples/async-winui3/index.ts) — Fluent v2 WinUI 3 with full `async/await` event handlers (`node:timers/promises`, `fetch()`, WinRT `*Async()`) via `DesktopWindowXamlSource` + `startWin32MessageLoop()`
- [WinUI 3 Controls Gallery](examples/winui3-gallery/index.ts) — native `Application` + `Window` + `MicaBackdrop` + `NavigationView` + 30 Fluent v2 controls
- [Windows Hello](examples/windows-hello/index.ts) — `UserConsentVerifier` biometric / PIN prompt
- [OCR Image](examples/ocr-image/index.ts) — `StorageFile` + `BitmapDecoder` + `OcrEngine` on PNG/JPG images
- [Toast Notification](examples/toast-notification/index.ts) — `ToastNotificationManager` + `XmlDocument`
- [Bluetooth LE Scanner](examples/bluetooth-scan/index.ts) — `BluetoothLEAdvertisementWatcher` live WinRT events

---

## License

[MIT](LICENSE). See [NOTICE](NOTICE) for third-party specification references.
