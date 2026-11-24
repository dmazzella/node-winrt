import { byref, c_int, c_int32, c_ssize_t, c_uint, c_uint32, c_uint64, c_void_p, c_wchar_p, Structure, WinDLL, wstring_at } from "node-ctypes";
import { checkHRESULT } from "@node-ctypes/comtypes";
import { roInitialize } from "./native.ts";

/** Flags for `MddBootstrapInitialize2` (`MddBootstrapInitializeOptions`). */
export const WindowsAppSdkOptions = Object.freeze({
  None: 0x0000,
  OnError_DebugBreak: 0x0001,
  OnError_DebugBreak_IfDebuggerAttached: 0x0002,
  OnError_FailFast: 0x0004,
  OnNoMatch_ShowUI: 0x0008,
  OnPackageIdentity_NOOP: 0x0010,
} as const);

export interface WindowsAppSdkInitOptions {
  /**
   * Major.Minor Windows App SDK release encoded as `(major << 16) | minor`
   * (e.g. `0x00010006` for Windows App SDK 1.6, `0x00010007` for 1.7),
   * or a `"major.minor"` string like `"1.6"`.
   */
  readonly majorMinorVersion: number | string;
  /** Optional prerelease version tag (e.g. `"preview1"`, default `""` for stable). */
  readonly versionTag?: string;
  /** Minimum framework package version as 64-bit `PACKAGE_VERSION` (`0n` = any matching major.minor). */
  readonly minVersion?: bigint;
  /** `MddBootstrapInitializeOptions` flags (default `OnPackageIdentity_NOOP`). */
  readonly options?: number;
  /** Path to `Microsoft.WindowsAppRuntime.Bootstrap.dll` (default searches PATH / app dir). */
  readonly dllPath?: string;
}

function encodeMajorMinor(version: number | string): number {
  if (typeof version === "number") return version >>> 0;
  const match = /^(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) throw new RangeError(`Invalid Windows App SDK version "${version}": expected "major.minor" (e.g. "1.6") or 0xMMMMmmmm`);
  return ((Number(match[1]) << 16) | (Number(match[2]) & 0xffff)) >>> 0;
}

/** Pack a 4-part version `major.minor.build.revision` into a 64-bit WinRT `PACKAGE_VERSION`. */
export function packPackageVersion(major: number, minor: number, build = 0, revision = 0): bigint {
  return (BigInt(major & 0xffff) << 48n) | (BigInt(minor & 0xffff) << 32n) | (BigInt(build & 0xffff) << 16n) | BigInt(revision & 0xffff);
}

interface BootstrapApi {
  readonly MddBootstrapInitialize2: (majorMinor: number, versionTag: string | null, minVersion: bigint, options: number) => number;
  readonly MddBootstrapShutdown: () => void;
}

let bootstrapApi: BootstrapApi | null = null;
let bootstrapDllPath: string | null = null;
let bootstrapRefCount = 0;

function loadBootstrap(dllPath: string): BootstrapApi {
  if (process.platform !== "win32") throw new Error("Windows App SDK bootstrapper requires Windows");
  if (bootstrapApi && bootstrapDllPath === dllPath) return bootstrapApi;
  const dll = new WinDLL(dllPath);
  bootstrapApi = {
    MddBootstrapInitialize2: dll.func("MddBootstrapInitialize2", c_int32, [c_uint32, c_wchar_p, c_uint64, c_uint32]) as BootstrapApi["MddBootstrapInitialize2"],
    MddBootstrapShutdown: dll.func("MddBootstrapShutdown", null, []) as BootstrapApi["MddBootstrapShutdown"],
  };
  bootstrapDllPath = dllPath;
  return bootstrapApi;
}

/**
 * Initialize the Windows App SDK Dynamic Dependency Bootstrapper
 * (`MddBootstrapInitialize2`) so unpackaged Node.js / Electron apps can activate
 * `Microsoft.Windows.*` WinRT classes (App Notifications, Windows AI, WinUI, etc.).
 */
export function initializeWindowsAppSdk(init: WindowsAppSdkInitOptions): void {
  roInitialize();
  const api = loadBootstrap(init.dllPath ?? "Microsoft.WindowsAppRuntime.Bootstrap.dll");
  const version = encodeMajorMinor(init.majorMinorVersion);
  const tag = init.versionTag ?? "";
  const minVer = init.minVersion ?? 0n;
  const flags = init.options ?? WindowsAppSdkOptions.OnPackageIdentity_NOOP;
  checkHRESULT(api.MddBootstrapInitialize2(version, tag, minVer, flags), "MddBootstrapInitialize2");
  bootstrapRefCount++;
}

/** Shut down one initialization of the Windows App SDK Bootstrapper (`MddBootstrapShutdown`). */
export function shutdownWindowsAppSdk(): void {
  if (bootstrapRefCount <= 0 || !bootstrapApi) return;
  bootstrapRefCount--;
  bootstrapApi.MddBootstrapShutdown();
}

/** Scoped `Disposable` guard (`using _ = windowsAppSdk({ majorMinorVersion: "1.6" })`). */
export function windowsAppSdk(init: WindowsAppSdkInitOptions): Disposable {
  initializeWindowsAppSdk(init);
  let closed = false;
  return {
    [Symbol.dispose]() {
      if (closed) return;
      closed = true;
      shutdownWindowsAppSdk();
    },
  };
}

const DEFAULT_WINAPP_RUNTIME_FAMILIES = [
  "Microsoft.WindowsAppRuntime.1.8_8wekyb3d8bbwe",
  "Microsoft.WindowsAppRuntime.1.7_8wekyb3d8bbwe",
  "Microsoft.WindowsAppRuntime.1.6_8wekyb3d8bbwe",
  "Microsoft.WindowsAppRuntime.1.5_8wekyb3d8bbwe",
  "Microsoft.WindowsAppRuntime.1.4_8wekyb3d8bbwe",
] as const;

export interface WindowsAppRuntimeBootstrapOptions {
  /** Explicit package family name (e.g. `"Microsoft.WindowsAppRuntime.1.8_8wekyb3d8bbwe"`). */
  readonly packageFamilyName?: string;
  /** Optional `"major.minor"` release (e.g. `"1.8"`). Ignored when `packageFamilyName` is set. */
  readonly majorMinorVersion?: string;
  /** Minimum framework package version as 64-bit `PACKAGE_VERSION` (default `0n`). */
  readonly minVersion?: bigint;
}

export interface WindowsAppRuntimeHandle extends Disposable {
  /** Attached package family name (e.g. `"Microsoft.WindowsAppRuntime.1.8_8wekyb3d8bbwe"`). */
  readonly packageFamilyName: string;
  /** Full installed package name (e.g. `"Microsoft.WindowsAppRuntime.1.8_8000.994.2142.0_x64__8wekyb3d8bbwe"`). */
  readonly packageFullName: string;
  /** Installation directory containing the runtime DLLs and `.winmd` files (`Microsoft.UI.Xaml.winmd`, etc.). */
  readonly packagePath: string;
  /** Detach the dynamic package dependency from the current process. */
  dispose(): void;
}

interface DynamicDepApi {
  readonly TryCreatePackageDependency: (user: bigint | null, family: string, minVer: bigint, arch: number, lifetime: number, artifact: string | null, opts: number, outDepId: unknown) => number;
  readonly AddPackageDependency: (depId: bigint, rank: number, opts: number, outCtx: unknown, outFullName: unknown) => number;
  readonly RemovePackageDependency: (ctx: bigint) => number;
  readonly DeletePackageDependency: (depId: bigint) => number;
  readonly GetPackagePathByFullName: (fullName: string, pathLen: unknown, pathBuf: Buffer | null) => number;
  readonly GetProcessHeap: () => bigint;
  readonly HeapFree: (heap: bigint, flags: number, mem: bigint) => number;
}

let dynDepApi: DynamicDepApi | null = null;

function getDynamicDepApi(): DynamicDepApi {
  if (process.platform !== "win32") throw new Error("Windows App Runtime dynamic dependencies require Windows 11");
  if (dynDepApi) return dynDepApi;
  const kernelbase = new WinDLL("kernelbase.dll");
  const kernel32 = new WinDLL("kernel32.dll");
  dynDepApi = {
    TryCreatePackageDependency: kernelbase.func("TryCreatePackageDependency", c_int32, [c_void_p, c_wchar_p, c_uint64, c_uint32, c_uint32, c_wchar_p, c_uint32, c_void_p]) as DynamicDepApi["TryCreatePackageDependency"],
    AddPackageDependency: kernelbase.func("AddPackageDependency", c_int32, [c_void_p, c_int32, c_uint32, c_void_p, c_void_p]) as DynamicDepApi["AddPackageDependency"],
    RemovePackageDependency: kernelbase.func("RemovePackageDependency", c_int32, [c_void_p]) as DynamicDepApi["RemovePackageDependency"],
    DeletePackageDependency: kernelbase.func("DeletePackageDependency", c_int32, [c_void_p]) as DynamicDepApi["DeletePackageDependency"],
    GetPackagePathByFullName: kernelbase.func("GetPackagePathByFullName", c_int32, [c_wchar_p, c_void_p, c_void_p]) as DynamicDepApi["GetPackagePathByFullName"],
    GetProcessHeap: kernel32.func("GetProcessHeap", c_void_p, []) as DynamicDepApi["GetProcessHeap"],
    HeapFree: kernel32.func("HeapFree", c_int, [c_void_p, c_uint32, c_void_p]) as DynamicDepApi["HeapFree"],
  };
  return dynDepApi;
}

function resolvePackagePath(api: DynamicDepApi, packageFullName: string): string {
  const lenBox = new c_uint32(0);
  api.GetPackagePathByFullName(packageFullName, byref(lenBox), null);
  const chars = Number(lenBox.value);
  if (chars <= 0) return "";
  const buf = Buffer.alloc(chars * 2);
  const rc = api.GetPackagePathByFullName(packageFullName, byref(lenBox), buf);
  if (rc !== 0) return "";
  return buf.toString("utf16le").replace(/\0+$/, "");
}

/**
 * Attach an installed Windows App Runtime framework package (`Microsoft.WindowsAppRuntime.*`)
 * directly to the current unpackaged Node.js process using Windows 11's built-in
 * `kernelbase.dll` Dynamic Dependencies API (`TryCreatePackageDependency` + `AddPackageDependency`).
 *
 * Requires no external `Microsoft.WindowsAppRuntime.Bootstrap.dll` and automatically
 * exposes WinUI 3 (`Microsoft.UI.Xaml.*`), `Microsoft.UI.Windowing`, `Microsoft.Windows.AI.*`,
 * etc. to `RoGetActivationFactory` / `RoActivateInstance`.
 */
export function bootstrapWindowsAppRuntime(options?: WindowsAppRuntimeBootstrapOptions): WindowsAppRuntimeHandle {
  const api = getDynamicDepApi();
  const minVer = options?.minVersion ?? 0n;
  const families: readonly string[] = options?.packageFamilyName ? [options.packageFamilyName] : options?.majorMinorVersion ? [`Microsoft.WindowsAppRuntime.${options.majorMinorVersion}_8wekyb3d8bbwe`] : DEFAULT_WINAPP_RUNTIME_FAMILIES;

  const heap = BigInt(api.GetProcessHeap() ?? 0n);
  let lastHr = 0;

  for (const family of families) {
    const depIdPtr = new c_void_p(0n);
    const hrCreate = api.TryCreatePackageDependency(null, family, minVer, 0, 0, null, 0, byref(depIdPtr));
    if (hrCreate !== 0 || !depIdPtr.value) {
      lastHr = hrCreate;
      continue;
    }
    const depId = BigInt(depIdPtr.value);
    const ctxBox = new c_void_p(0n);
    const fullNamePtr = new c_void_p(0n);
    const hrAdd = api.AddPackageDependency(depId, 0, 0, byref(ctxBox), byref(fullNamePtr));
    if (hrAdd !== 0 || !ctxBox.value) {
      lastHr = hrAdd;
      api.DeletePackageDependency(depId);
      if (heap) api.HeapFree(heap, 0, depId);
      continue;
    }

    const ctx = BigInt(ctxBox.value);
    const fullNameAddr = BigInt(fullNamePtr.value ?? 0n);
    const packageFullName = fullNameAddr !== 0n ? (wstring_at(fullNameAddr) ?? "") : "";
    if (fullNameAddr !== 0n && heap) api.HeapFree(heap, 0, fullNameAddr);
    const packagePath = packageFullName ? resolvePackagePath(api, packageFullName) : "";

    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      api.RemovePackageDependency(ctx);
      api.DeletePackageDependency(depId);
      if (heap) api.HeapFree(heap, 0, depId);
    };
    return {
      packageFamilyName: family,
      packageFullName,
      packagePath,
      dispose,
      [Symbol.dispose]: dispose,
    };
  }

  checkHRESULT(lastHr || 0x80070490, "bootstrapWindowsAppRuntime");
  throw new Error("No installed Microsoft.WindowsAppRuntime framework package found");
}

class Win32Msg extends Structure {
  static _fields_ = [
    ["hwnd", c_void_p],
    ["message", c_uint],
    ["wParam", c_uint64],
    ["lParam", c_uint64],
    ["time", c_uint32],
    ["pt_x", c_int32],
    ["pt_y", c_int32],
  ] as const;
}

interface User32PumpApi {
  readonly PeekMessageW: (msg: Buffer, hwnd: null, min: number, max: number, remove: number) => number;
  readonly TranslateMessage: (msg: Buffer) => number;
  readonly DispatchMessageW: (msg: Buffer) => bigint;
  readonly MsgWaitForMultipleObjectsEx: (count: number, handles: null, timeoutMs: number, wakeMask: number, flags: number) => number;
}

const QS_ALLINPUT = 0x04ff;
const MWMO_INPUTAVAILABLE = 0x0004;

let pumpApi: User32PumpApi | null = null;
const msgPool: Win32Msg[] = [];

function getPumpApi(): User32PumpApi {
  if (!pumpApi) {
    const user32 = new WinDLL("user32.dll");
    pumpApi = {
      PeekMessageW: user32.func("PeekMessageW", c_int, [c_void_p, c_void_p, c_uint, c_uint, c_uint]) as User32PumpApi["PeekMessageW"],
      TranslateMessage: user32.func("TranslateMessage", c_int, [c_void_p]) as User32PumpApi["TranslateMessage"],
      DispatchMessageW: user32.func("DispatchMessageW", c_void_p, [c_void_p]) as User32PumpApi["DispatchMessageW"],
      MsgWaitForMultipleObjectsEx: user32.func("MsgWaitForMultipleObjectsEx", c_uint32, [c_uint32, c_void_p, c_uint32, c_uint32, c_uint32]) as User32PumpApi["MsgWaitForMultipleObjectsEx"],
    };
  }
  return pumpApi;
}

/**
 * Drain all currently queued Win32 messages on the calling STA thread
 * (`PeekMessageW` + `TranslateMessage` + `DispatchMessageW`). Re-entrant safe.
 *
 * Useful when hosting WinUI 3 (`Microsoft.UI.Xaml`) or `AppWindow` on a Node.js
 * STA thread alongside the libuv event loop.
 */
export function pumpWin32Messages(): number {
  if (process.platform !== "win32") return 0;
  const api = getPumpApi();
  // Re-entrant safe: nested pumps during DispatchMessageW borrow their own MSG buffer.
  const msg = msgPool.pop() ?? new Win32Msg();
  let count = 0;
  try {
    while (api.PeekMessageW(msg._buffer, null, 0, 0, 1)) {
      api.TranslateMessage(msg._buffer);
      api.DispatchMessageW(msg._buffer);
      count++;
    }
  } finally {
    if (msgPool.length < 4) msgPool.push(msg);
  }
  return count;
}

/**
 * Drain all queued Win32 messages, or if the queue is empty, sleep in the Windows
 * kernel via `MsgWaitForMultipleObjectsEx` (0% CPU) until any input/UI message
 * arrives or `timeoutMs` elapses, then drain immediately.
 */
export function waitAndPumpWin32Messages(timeoutMs = 8): number {
  if (process.platform !== "win32") return 0;
  const api = getPumpApi();
  let count = pumpWin32Messages();
  if (count > 0) return count;
  const wait = api.MsgWaitForMultipleObjectsEx(0, null, timeoutMs >>> 0, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
  if (wait === 0) {
    count += pumpWin32Messages();
  }
  return count;
}

/**
 * Start a low-latency Win32 message loop interleaved with Node.js's libuv event
 * loop via `MsgWaitForMultipleObjectsEx` + `setImmediate`.
 *
 * Unlike `setInterval(..., 8)` (which is quantized to 15.6 ms on Windows), this
 * wakes up in microseconds (< 0.1 ms) whenever mouse/keyboard/WinUI 3 messages
 * arrive, uses ~0% CPU when idle, and yields at least every `idleYieldMs` so
 * libuv timers, promises, and `SIGINT` stay responsive.
 */
export function startWin32MessageLoop(idleYieldMs = 8): Disposable & { stop(): void } {
  let stopped = false;
  let immediateHandle: NodeJS.Immediate | null = null;

  const step = (): void => {
    immediateHandle = null;
    if (stopped) return;
    waitAndPumpWin32Messages(idleYieldMs);
    if (!stopped) {
      immediateHandle = setImmediate(step);
    }
  };

  immediateHandle = setImmediate(step);

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (immediateHandle !== null) {
      clearImmediate(immediateHandle);
      immediateHandle = null;
    }
  };

  return { stop, [Symbol.dispose]: stop };
}

interface User32DpiApi {
  readonly SetProcessDpiAwarenessContext: (ctx: bigint) => number;
  readonly GetDpiForWindow: (hwnd: bigint) => number;
}

let dpiApi: User32DpiApi | null = null;

function getDpiApi(): User32DpiApi {
  if (dpiApi) return dpiApi;
  const user32 = new WinDLL("user32.dll");
  dpiApi = {
    SetProcessDpiAwarenessContext: user32.func("SetProcessDpiAwarenessContext", c_int, [c_ssize_t]) as User32DpiApi["SetProcessDpiAwarenessContext"],
    GetDpiForWindow: user32.func("GetDpiForWindow", c_uint, [c_void_p]) as User32DpiApi["GetDpiForWindow"],
  };
  return dpiApi;
}

/**
 * Enable Per-Monitor V2 DPI awareness for the current process
 * (`SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)`).
 *
 * Call this **before** creating any `AppWindow`, `WindowsXamlManager`, or Win32
 * window so WinUI 3 renders crisp HiDPI visuals instead of bitmap-scaled 96 DPI.
 * Returns `true` if awareness was updated, `false` if already set or unavailable.
 */
export function enablePerMonitorDpiAwareness(): boolean {
  if (process.platform !== "win32") return false;
  const api = getDpiApi();
  // -4 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, -3 = PER_MONITOR_AWARE fallback
  return api.SetProcessDpiAwarenessContext(-4n) !== 0 || api.SetProcessDpiAwarenessContext(-3n) !== 0;
}

/**
 * Return the DPI scale factor for a Win32 `HWND` / WinUI 3 `AppWindow.id.Value`
 * (`GetDpiForWindow(hwnd) / 96`, e.g. `1`, `1.25`, `1.5`, `2`).
 */
export function getWindowDpiScale(hwndOrWindowId: bigint): number {
  if (process.platform !== "win32" || hwndOrWindowId === 0n) return 1;
  const dpi = getDpiApi().GetDpiForWindow(hwndOrWindowId);
  return dpi > 0 ? dpi / 96 : 1;
}
