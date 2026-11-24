# @node-ctypes/winrt

Typed **Windows Runtime (WinRT)** projections and **`.winmd` (ECMA-335) TypeScript code generator** for Node.js, powered by [`@node-ctypes/comtypes`](../node-comtypes/README.md) and [`node-ctypes`](../../README.md) — pure TypeScript, zero C++ compilation, native on Windows x64 and ARM64, and compatible with Electron (`NODE_CTYPES_NO_EXTERNAL_BUFFERS=1`).

Think of it as **`PyWinRT` / `windows-rs` for Node.js**.

## Features

- **Zero-dependency ECMA-335 `.winmd` reader**: parses `C:\Windows\System32\WinMetadata\*.winmd` (present on every Windows 10/11 machine without installing the Windows SDK), the unified `Windows.winmd`, or third-party `.winmd` files (e.g. Windows App SDK / WinUI). Runs cross-platform so you can even generate projections on macOS/Linux CI.
- **Exact WinRT PIID (UUIDv5) computation**: computes parameterized interface and delegate IIDs (`IAsyncOperation<T>`, `IAsyncOperationCompletedHandler<T>`, `IVectorView<T>`, `TypedEventHandler<TSender, TArgs>`, …) per Microsoft's WinRT specification.
- **Event-driven WinRT async (`Promise<T>`)**: methods returning `IAsyncAction`, `IAsyncOperation<T>`, `IAsyncOperationWithProgress<T, P>`, or `IAsyncActionWithProgress<P>` attach a free-threaded `CompletedHandler` (`COMObject` + `IAgileObject`) — zero polling, no event-loop blocking.
- **Full WinRT type projections**:
  - Enums (frozen objects + union types) and Structs (`node-ctypes` `Structure` subclasses)
  - `IReference<T>` → `T | null`
  - `IVectorView<T>` / `IVector<T>` / `IIterable<T>` → `T[]` and `IMapView<K, V>` / `IMap<K, V>` → `Map<K, V>`
  - WinRT byte arrays (`PassArray`, `FillArray`, and `ReceiveArray` with `CoTaskMemFree`)
  - Events (`TypedEventHandler<S, A>`, `EventHandler<T>`, and custom delegates) via `on<Event>()`
  - Runtime class inheritance (`baseClass` interfaces), polymorphic COM argument `QueryInterface`, composable factories (`[Composable(IFactory, Public)]` -> `.create()`), and `Disposable` (`using`) via `IClosable` + `Release`.
- **Windows App SDK, WinUI 3 & Registration-Free WinRT**:
  - `bootstrapWindowsAppRuntime()` uses Windows 11's built-in `kernelbase.dll` Dynamic Dependencies API (`TryCreatePackageDependency` + `AddPackageDependency`) — zero external `Bootstrap.dll` required — to attach the installed `Microsoft.WindowsAppRuntime.*` framework package, discover its `.winmd` directory (`packagePath`), and run WinUI 3 (`Microsoft.UI.Xaml.*`, `AppWindow`, `DesktopWindowXamlSource`, `XamlReader`, `RenderTargetBitmap`, `Microsoft.Windows.AI.*`) directly from Node.js (with `pumpWin32Messages()` for STA threads).
  - `initializeWindowsAppSdk` / `windowsAppSdk({ majorMinorVersion: "1.6" })` (`MddBootstrapInitialize2` / `MddBootstrapShutdown`) for Windows 10 or explicit `Microsoft.WindowsAppRuntime.Bootstrap.dll` loading.
  - `registerActivationDll(classNameOrPrefix, dllPath)` / `getActivationFactoryFromDll(...)` to activate unregistered WinRT DLLs directly through `DllGetActivationFactory`.

## CLI

```sh
# List available WinRT namespaces on this Windows machine
npx node-winrt namespaces --filter Media

# Inspect all types, interfaces and IIDs in a namespace
npx node-winrt info Windows.Media.Ocr

# Generate strictly-typed TypeScript projections
npx node-winrt generate Windows.Media.Ocr Windows.Globalization Windows.Graphics.Imaging Windows.Storage.Streams --out src/winrt

# Or emit compiled .js + .d.ts directly (requires typescript)
npx node-winrt generate Windows.Media.Ocr Windows.Globalization --out src/winrt --js
```

## Example (generated WinRT classes)

```ts
import { Language } from "./winrt/Windows.Globalization.ts";
import { OcrEngine } from "./winrt/Windows.Media.Ocr.ts";
import { UserConsentVerifier } from "./winrt/Windows.Security.Credentials.UI.ts";

// Windows Hello availability (event-driven IAsyncOperation -> Promise)
const availability = await UserConsentVerifier.checkAvailabilityAsync();
console.log("Windows Hello availability:", availability);

// WinRT Globalization + OCR
using lang = Language.createLanguage("en-US");
console.log(lang?.languageTag, lang?.displayName);

using engine = OcrEngine.tryCreateFromUserProfileLanguages();
console.log("OCR max dimension:", OcrEngine.maxImageDimension);
```

## Scripts

```sh
npm run build       # compile TypeScript to dist/
npm run typecheck   # strict type checking (src + tests + examples)
npm test            # build, typecheck, unit tests (ECMA-335/PIID) + live Windows WinRT + WinUI 3 tests
```

## Examples

Generate projections for all examples in one command (`npm run demo:gen:all`), then run any example directly with Node.js:

| Example                                                                                                             | Generate                  | Run                                            |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------- |
| **WinUI 3 Controls Gallery** (`Application` + `Window` + `MicaBackdrop` + `NavigationView` + 30 Fluent v2 controls) | `npm run demo:winui3:gen` | `npm run demo:winui3`                          |
| **Windows Hello** (`UserConsentVerifier` biometrics / PIN)                                                          | `npm run demo:hello:gen`  | `npm run demo:hello` (or `-- --verify`)        |
| **Native Windows OCR on PNG/JPG** (`StorageFile` + `BitmapDecoder` + `OcrEngine`)                                   | `npm run demo:ocr:gen`    | `node examples/ocr-image/index.ts <image.png>` |
| **Windows Toast Notifications** (`ToastNotificationManager` + `XmlDocument`)                                        | `npm run demo:toast:gen`  | `npm run demo:toast`                           |
| **Bluetooth LE Scanner** (`BluetoothLEAdvertisementWatcher` live events)                                            | `npm run demo:ble:gen`    | `npm run demo:ble`                             |
