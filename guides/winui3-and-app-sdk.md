---
title: WinUI 3 and Windows App SDK
---

# WinUI 3 and Windows App SDK

## Attaching Windows App Runtime without `Bootstrap.dll`

On Windows 11, `bootstrapWindowsAppRuntime()` attaches any installed `Microsoft.WindowsAppRuntime.*` framework package directly to an unpackaged `node.exe` process using Windows 11's built-in `kernelbase.dll` Dynamic Dependencies API (`TryCreatePackageDependency` + `AddPackageDependency`):

```typescript
import { bootstrapWindowsAppRuntime, enablePerMonitorDpiAwareness, roInitialize, RO_INIT_SINGLETHREADED, startWin32MessageLoop } from "@node-ctypes/winrt";

enablePerMonitorDpiAwareness();
roInitialize(RO_INIT_SINGLETHREADED);

using runtime = bootstrapWindowsAppRuntime(); // auto-detects 1.8 -> 1.4
console.log("Attached:", runtime.packageFullName);
console.log("WinMD path:", runtime.packagePath);
```

- Zero external `Microsoft.WindowsAppRuntime.Bootstrap.dll` required.
- Automatically unlocks `RoActivateInstance` / `RoGetActivationFactory` for `Microsoft.UI.Xaml.*` (WinUI 3), `Microsoft.UI.Windowing` (`AppWindow`), `Microsoft.Windows.AI.*`, and other Windows App SDK namespaces.
- On Windows 10 (or when targeting a bundled `Microsoft.WindowsAppRuntime.Bootstrap.dll`), use `windowsAppSdk({ majorMinorVersion: "1.6" })` (`MddBootstrapInitialize2` / `MddBootstrapShutdown`).

## DPI awareness and Win32 message loop

WinUI 3 requires an STA thread (`RO_INIT_SINGLETHREADED`) and a Win32 message pump:

- Call `enablePerMonitorDpiAwareness()` **before** creating any window or `WindowsXamlManager` so WinUI 3 renders crisp HiDPI visuals instead of 96 DPI bitmap scaling. Query a window's scale factor with `getWindowDpiScale(hwnd)`.
- `pumpWin32Messages()` drains queued Win32 messages safely (re-entrant safe with pooled `MSG` buffers).
- `waitAndPumpWin32Messages(timeoutMs?)` sleeps in the Windows kernel via `MsgWaitForMultipleObjectsEx` at ~0% CPU and wakes in microseconds on input/UI messages.
- `startWin32MessageLoop(idleYieldMs?)` interleaves `waitAndPumpWin32Messages` with Node.js's libuv loop via `setImmediate` so UI input, promises, timers and `SIGINT` all stay responsive.

## Subclassing `[Composable]` WinRT classes (`class App extends Application`)

WinUI 3 classes such as `Application`, `Window`, `Page` and `UserControl` use COM aggregation (`[Composable]`). Generated composable classes support direct ES6 `extends` inheritance with typed `override` methods (generated from `[OverridableAttribute]` interfaces in `.winmd`) and `super({ delegates, onError })`:

```typescript
import { bootstrapWindowsAppRuntime, enablePerMonitorDpiAwareness, roInitialize, RO_INIT_SINGLETHREADED } from "@node-ctypes/winrt";
import { Application, FrameworkElement, Window } from "./winrt/Microsoft.UI.Xaml.ts";
import { Button, XamlControlsResources } from "./winrt/Microsoft.UI.Xaml.Controls.ts";
import { IXamlMetadataProvider, XamlReader } from "./winrt/Microsoft.UI.Xaml.Markup.ts";
import { XamlControlsXamlMetaDataProvider } from "./winrt/Microsoft.UI.Xaml.XamlTypeInfo.ts";

class App extends Application {
  constructor() {
    using provider = new XamlControlsXamlMetaDataProvider();
    super({ delegates: [{ iface: IXamlMetadataProvider, target: provider }] });
  }

  override onLaunched(): void {
    using resources = new XamlControlsResources();
    this.resources?.mergedDictionaries?.append(resources);

    const window = XamlReader.load(XAML)!.as(Window);
    using content = window.content!.as(FrameworkElement);
    content
      .findName("click")!
      .as(Button)
      .onClick(() => console.log("Hello, world!"));
    content
      .findName("exit")!
      .as(Button)
      .onClick(() => this.exit());
    window.activate();
  }
}

enablePerMonitorDpiAwareness();
roInitialize(RO_INIT_SINGLETHREADED);
using _ = bootstrapWindowsAppRuntime();
Application.start(() => new App());
```

See [examples/hello-winui3/index.ts](../examples/hello-winui3/index.ts) for this minimal app (direct counterpart to `pywinrt/samples/winui3/hello_app.py`), and [examples/winui3-gallery/index.ts](../examples/winui3-gallery/index.ts) for a full Fluent v2 Controls Gallery with `MicaBackdrop`, `NavigationView` and 30 interactive controls. Lower-level `composeWinRTClass` and `createWinRTAggregate` are also exported for custom scenarios.

> **Using `async`/`await` inside WinUI 3 event handlers:** `Application.start()` runs WinUI 3's synchronous blocking message loop on the main thread, so Node.js's libuv event loop is paused until `Application.exit()`. When you want `onClick(async () => ...)` handlers that `await` timers, `fetch()`, `fs/promises`, or WinRT `*Async()` APIs while keeping the UI responsive, host XAML via `AppWindow` + `DesktopWindowXamlSource` + `startWin32MessageLoop()` — see [examples/async-winui3/index.ts](../examples/async-winui3/index.ts).

## Registration-free WinRT DLLs

For custom or unregistered C++/WinRT DLLs, register a class name or namespace prefix with `registerActivationDll(classNameOrPrefix, dllPath)` so `getActivationFactory` and `activateInstance` invoke the DLL's exported `DllGetActivationFactory` directly without OS registry entries or an SxS manifest.
