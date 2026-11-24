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

## Subclassing `[Composable]` WinRT classes (`composeWinRTClass`)

WinUI 3 classes such as `Application`, `Window`, `Page` and `UserControl` use COM aggregation (`[Composable]`). `composeWinRTClass` (built on `createWinRTAggregate`) composes any generated composable class with custom override interfaces and delegated interfaces:

```typescript
import { composeWinRTClass } from "@node-ctypes/winrt";
import { Application, IApplicationOverrides } from "./winrt/Microsoft.UI.Xaml.ts";
import { IXamlMetadataProvider } from "./winrt/Microsoft.UI.Xaml.Markup.ts";
import { XamlControlsXamlMetaDataProvider } from "./winrt/Microsoft.UI.Xaml.XamlTypeInfo.ts";

Application.start(() => {
  const provider = XamlControlsXamlMetaDataProvider.create();
  composeWinRTClass(Application, {
    className: "MyNodeWinUIApp.App",
    delegates: [{ iface: IXamlMetadataProvider, target: provider }],
    overrides: [
      {
        iface: IApplicationOverrides,
        impl: {
          OnLaunched(app) {
            // Load Fluent v2 XamlControlsResources and activate your Window here
          },
        },
      },
    ],
  });
});
```

See [examples/winui3-gallery/index.ts](../examples/winui3-gallery/index.ts) for a complete native WinUI 3 desktop app with `MicaBackdrop`, `NavigationView`, Light/Dark `{ThemeResource}` switching and 30 interactive Fluent v2 controls.

## Registration-free WinRT DLLs

For custom or unregistered C++/WinRT DLLs, register a class name or namespace prefix with `registerActivationDll(classNameOrPrefix, dllPath)` so `getActivationFactory` and `activateInstance` invoke the DLL's exported `DllGetActivationFactory` directly without OS registry entries or an SxS manifest.
