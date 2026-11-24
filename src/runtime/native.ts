import { byref, c_int32, c_int64, c_uint32, c_void_p, Structure, WinDLL, wstring_at } from "node-ctypes";
import { checkHRESULT, COMInterface, COMPointer, HRESULT, IUnknown, STDMETHOD, sync } from "@node-ctypes/comtypes";
import type { InterfaceDef, InterfacePointer } from "@node-ctypes/comtypes";

export const RO_INIT_SINGLETHREADED = 0;
export const RO_INIT_MULTITHREADED = 1;
const RPC_E_CHANGED_MODE = -2147417850; // 0x80010106

export const AsyncStatus = Object.freeze({
  Started: 0,
  Completed: 1,
  Canceled: 2,
  Error: 3,
} as const);

export type AsyncStatusValue = (typeof AsyncStatus)[keyof typeof AsyncStatus];

/** Shared WinRT `Windows.Foundation.EventRegistrationToken` struct (`{ Value: int64 }`). */
export class EventRegistrationToken extends Structure {
  static _fields_ = [["Value", c_int64]] as const;
  declare Value: bigint;
}

export interface EventRegistrationTokenFields {
  Value: bigint;
}

// ── Core WinRT COM interfaces ──────────────────────────────────────────

export const IInspectable = COMInterface({
  name: "IInspectable",
  iid: "{AF86E2E0-B12D-4C6A-9C5A-D7AA65101E90}",
  extends: IUnknown,
  methods: [STDMETHOD(HRESULT, "GetIids", [c_void_p, c_void_p]), STDMETHOD(HRESULT, "GetRuntimeClassName", [c_void_p]), STDMETHOD(HRESULT, "GetTrustLevel", [c_void_p])],
});

export const IAgileObject = COMInterface({
  name: "IAgileObject",
  iid: "{94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90}",
  extends: IUnknown,
  methods: [],
});

export const IClosable = COMInterface({
  name: "IClosable",
  iid: "{30D5A829-7FA4-4026-83BB-D75BAE4EA99E}",
  extends: IInspectable,
  methods: [STDMETHOD(HRESULT, "Close", [])],
});

export const IAsyncInfo = COMInterface({
  name: "IAsyncInfo",
  iid: "{00000036-0000-0000-C000-000000000046}",
  extends: IInspectable,
  methods: [STDMETHOD(HRESULT, "get_Id", [c_void_p]), STDMETHOD(HRESULT, "get_Status", [c_void_p]), STDMETHOD(HRESULT, "get_ErrorCode", [c_void_p]), STDMETHOD(HRESULT, "Cancel", []), STDMETHOD(HRESULT, "Close", [])],
});

export const IAsyncActionCompletedHandler = COMInterface({
  name: "IAsyncActionCompletedHandler",
  iid: "{A4ED5C81-76C9-40BD-8BE6-B1D90FB20AE7}",
  extends: IUnknown,
  methods: [STDMETHOD(HRESULT, "onCompleted", [c_void_p, c_int32])],
});

export const IAsyncAction = COMInterface({
  name: "IAsyncAction",
  iid: "{5A648006-843A-4DA9-865B-9D26E5DFAD7B}",
  extends: IInspectable,
  methods: [STDMETHOD(HRESULT, "put_Completed", [c_void_p]), STDMETHOD(HRESULT, "get_Completed", [c_void_p]), STDMETHOD(HRESULT, "GetResults", [])],
});

/** Raw vtable layout shared by every `IAsyncOperation<T>` (slots 6..8). */
export const IAsyncOperationRaw = COMInterface({
  name: "IAsyncOperation",
  iid: "{9FC2B0BB-E446-44E2-AA61-9CAB8F636AF2}",
  extends: IInspectable,
  methods: [STDMETHOD(HRESULT, "put_Completed", [c_void_p]), STDMETHOD(HRESULT, "get_Completed", [c_void_p]), STDMETHOD(HRESULT, "GetResults", [c_void_p])],
});

/** Raw vtable layout shared by every `IVectorView<T>` (slots 6..9). */
export const IVectorViewRaw = COMInterface({
  name: "IVectorView",
  iid: "{BBE1FA4C-B0E3-4583-BAEF-1F1B2E483E56}",
  extends: IInspectable,
  methods: [STDMETHOD(HRESULT, "GetAt", [c_uint32, c_void_p]), STDMETHOD(HRESULT, "get_Size", [c_void_p]), STDMETHOD(HRESULT, "IndexOf", [c_void_p, c_void_p, c_void_p]), STDMETHOD(HRESULT, "GetMany", [c_uint32, c_uint32, c_void_p, c_void_p])],
});

/** Raw vtable layout shared by every `IReference<T>` (slot 6: `get_Value(T*)`). */
export const IReferenceRaw = COMInterface({
  name: "IReference",
  iid: "{61C17706-2D65-11E0-9AE8-D48564015472}",
  extends: IInspectable,
  methods: [STDMETHOD(HRESULT, "get_Value", [c_void_p])],
});

/** Raw vtable layout shared by every `IAsyncOperationWithProgress<T, P>` (slots 6..10). */
export const IAsyncOperationWithProgressRaw = COMInterface({
  name: "IAsyncOperationWithProgress",
  iid: "{B5D036D7-E297-498F-BA60-0289E76E23DD}",
  extends: IInspectable,
  methods: [
    STDMETHOD(HRESULT, "put_Progress", [c_void_p]),
    STDMETHOD(HRESULT, "get_Progress", [c_void_p]),
    STDMETHOD(HRESULT, "put_Completed", [c_void_p]),
    STDMETHOD(HRESULT, "get_Completed", [c_void_p]),
    STDMETHOD(HRESULT, "GetResults", [c_void_p]),
  ],
});

/** Raw vtable layout shared by every `IAsyncActionWithProgress<P>` (slots 6..10). */
export const IAsyncActionWithProgressRaw = COMInterface({
  name: "IAsyncActionWithProgress",
  iid: "{1F6DB258-E803-48A1-9546-EB7353398884}",
  extends: IInspectable,
  methods: [STDMETHOD(HRESULT, "put_Progress", [c_void_p]), STDMETHOD(HRESULT, "get_Progress", [c_void_p]), STDMETHOD(HRESULT, "put_Completed", [c_void_p]), STDMETHOD(HRESULT, "get_Completed", [c_void_p]), STDMETHOD(HRESULT, "GetResults", [])],
});

/** Raw vtable layout shared by every `IIterable<T>` (slot 6: `First()`). */
export const IIterableRaw = COMInterface({
  name: "IIterable",
  iid: "{FAA585EA-6214-4217-AFDA-7F46DE5869B3}",
  extends: IInspectable,
  methods: [STDMETHOD(HRESULT, "First", [c_void_p])],
});

/** Raw vtable layout shared by every `IIterator<T>` (slots 6..9). */
export const IIteratorRaw = COMInterface({
  name: "IIterator",
  iid: "{6A79E863-4300-459A-9966-CBB660963EE1}",
  extends: IInspectable,
  methods: [STDMETHOD(HRESULT, "get_Current", [c_void_p]), STDMETHOD(HRESULT, "get_HasCurrent", [c_void_p]), STDMETHOD(HRESULT, "MoveNext", [c_void_p]), STDMETHOD(HRESULT, "GetMany", [c_uint32, c_void_p, c_void_p])],
});

/** Raw vtable layout shared by every `IKeyValuePair<K, V>` (slots 6..7). */
export const IKeyValuePairRaw = COMInterface({
  name: "IKeyValuePair",
  iid: "{02B51929-C1C4-4A7E-8940-0312B5C18500}",
  extends: IInspectable,
  methods: [STDMETHOD(HRESULT, "get_Key", [c_void_p]), STDMETHOD(HRESULT, "get_Value", [c_void_p])],
});

/** WinRT `IActivationFactory` ({00000035-0000-0000-C000-000000000046}). */
export const IActivationFactory = COMInterface({
  name: "IActivationFactory",
  iid: "{00000035-0000-0000-C000-000000000046}",
  extends: IInspectable,
  methods: [STDMETHOD(HRESULT, "ActivateInstance", [c_void_p])],
});

// ── combase.dll / ole32.dll bindings ───────────────────────────────────

function bindCombase() {
  const combase = new WinDLL("combase.dll");
  const ole32 = new WinDLL("ole32.dll");
  return {
    RoInitialize: combase.func("RoInitialize", c_int32, [c_int32]),
    RoUninitialize: combase.func("RoUninitialize", null, []),
    RoGetActivationFactory: combase.func("RoGetActivationFactory", c_int32, [c_void_p, c_void_p, c_void_p]),
    RoActivateInstance: combase.func("RoActivateInstance", c_int32, [c_void_p, c_void_p]),
    WindowsCreateString: combase.func("WindowsCreateString", c_int32, [c_void_p, c_uint32, c_void_p]),
    WindowsDeleteString: combase.func("WindowsDeleteString", c_int32, [c_void_p]),
    WindowsDuplicateString: combase.func("WindowsDuplicateString", c_int32, [c_void_p, c_void_p]),
    WindowsGetStringRawBuffer: combase.func("WindowsGetStringRawBuffer", c_void_p, [c_void_p, c_void_p]),
    CoTaskMemFree: ole32.func("CoTaskMemFree", null, [c_void_p]),
  };
}

type CombaseApi = ReturnType<typeof bindCombase>;
let combaseCache: CombaseApi | null = null;
let roInitialized = false;

function combase(): CombaseApi {
  if (process.platform !== "win32") throw new Error(`WinRT requires Windows (current platform: ${process.platform})`);
  return (combaseCache ??= bindCombase());
}

/** Initialize the Windows Runtime on the current thread (idempotent, MTA by default). */
export function roInitialize(initType: number = RO_INIT_MULTITHREADED): void {
  if (roInitialized) return;
  const hr = combase().RoInitialize(initType);
  if (hr < 0 && hr !== RPC_E_CHANGED_MODE) checkHRESULT(hr, "RoInitialize");
  roInitialized = true;
}

/** Allocate a WinRT `HSTRING` from a JavaScript string. Free with {@link deleteHString}. */
export function createHString(text: string): bigint {
  roInitialize();
  if (text.length === 0) return 0n;
  const utf16 = Buffer.from(`${text}\0`, "utf16le");
  const out = new c_void_p(0n);
  checkHRESULT(combase().WindowsCreateString(utf16, text.length, byref(out)), "WindowsCreateString");
  return BigInt(out.value ?? 0n);
}

/** Free a WinRT `HSTRING` handle (`0n` is a no-op). */
export function deleteHString(handle: bigint | null): void {
  if (!handle || handle === 0n) return;
  combase().WindowsDeleteString(handle);
}

/** Run `fn` with a temporary `HSTRING` that is guaranteed to be freed on exit. */
export function withHString<T>(text: string, fn: (handle: bigint) => T): T {
  const handle = createHString(text);
  try {
    return fn(handle);
  } finally {
    deleteHString(handle);
  }
}

/** Read a WinRT `HSTRING` into a JavaScript string without freeing it. */
export function readHString(handle: bigint | null): string {
  if (!handle || handle === 0n) return "";
  const len = new c_uint32(0);
  const ptr = combase().WindowsGetStringRawBuffer(handle, byref(len));
  const count = Number(len.value);
  if (!ptr || count <= 0) return "";
  return wstring_at(BigInt(ptr), count) ?? "";
}

/** Read a WinRT `HSTRING` and immediately free it. */
export function readAndDeleteHString(handle: bigint | null): string {
  if (!handle || handle === 0n) return "";
  try {
    return readHString(handle);
  } finally {
    deleteHString(handle);
  }
}

/** Free memory allocated by WinRT via `CoTaskMemAlloc` (e.g. `ReceiveArray` buffers). */
export function coTaskMemFree(pointer: bigint | null): void {
  if (!pointer || pointer === 0n) return;
  combase().CoTaskMemFree(pointer);
}

// ── Registration-Free WinRT DLL activation registry ────────────────────

type DllGetActivationFactoryFn = (hClassName: bigint, outFactory: unknown) => number;
const loadedActivationDlls = new Map<string, DllGetActivationFactoryFn>();
const classDllRegistry = new Map<string, string>();

/**
 * Register a WinRT implementation DLL for registration-free activation of
 * `classNameOrPrefix` (exact class name such as `"Microsoft.Windows.AppNotifications.AppNotificationManager"`,
 * or namespace prefix ending with `"."` such as `"Microsoft.Windows.AppNotifications."`).
 *
 * Calls the DLL's exported `DllGetActivationFactory` directly without requiring
 * OS registry entries or an SxS application manifest.
 */
export function registerActivationDll(classNameOrPrefix: string, dllPath: string): void {
  classDllRegistry.set(classNameOrPrefix, dllPath);
}

/** Remove a registration-free DLL mapping previously added with {@link registerActivationDll}. */
export function unregisterActivationDll(classNameOrPrefix: string): void {
  classDllRegistry.delete(classNameOrPrefix);
}

function resolveRegisteredDll(className: string): string | null {
  const exact = classDllRegistry.get(className);
  if (exact) return exact;
  let bestPrefix = "";
  let bestDll: string | null = null;
  for (const [key, dll] of classDllRegistry) {
    if (key.endsWith(".") && className.startsWith(key) && key.length > bestPrefix.length) {
      bestPrefix = key;
      bestDll = dll;
    }
  }
  return bestDll;
}

/** Load `dllPath` and call its exported `DllGetActivationFactory` directly for `className`. */
export function getActivationFactoryFromDll<T extends InterfaceDef<any>>(dllPath: string, className: string, iface: T): InterfacePointer<T> {
  roInitialize();
  let getFactory = loadedActivationDlls.get(dllPath);
  if (!getFactory) {
    const dll = new WinDLL(dllPath);
    getFactory = dll.func("DllGetActivationFactory", c_int32, [c_void_p, c_void_p]) as unknown as DllGetActivationFactoryFn;
    loadedActivationDlls.set(dllPath, getFactory);
  }
  const out = new c_void_p(0n);
  withHString(className, (hClass) => {
    checkHRESULT(getFactory(hClass, byref(out)), `DllGetActivationFactory(${className})`);
  });
  const addr = BigInt(out.value ?? 0n);
  if (!addr) throw new Error(`DllGetActivationFactory(${className}) in "${dllPath}" returned NULL`);
  const factory = COMPointer.fromAddress(addr, IActivationFactory);
  if (iface === (IActivationFactory as unknown) || iface === (IInspectable as unknown)) {
    return factory as unknown as InterfacePointer<T>;
  }
  using owned = factory;
  return owned.QueryInterface(iface);
}

/** Obtain a WinRT activation factory (`DllGetActivationFactory` if registered, else `RoGetActivationFactory`). */
export function getActivationFactory<T extends InterfaceDef<any>>(className: string, iface: T): InterfacePointer<T> {
  const registeredDll = resolveRegisteredDll(className);
  if (registeredDll) return getActivationFactoryFromDll(registeredDll, className, iface);
  roInitialize();
  const out = new c_void_p(0n);
  withHString(className, (hClass) => {
    checkHRESULT(combase().RoGetActivationFactory(hClass, iface.iid._buffer, byref(out)), `RoGetActivationFactory(${className})`);
  });
  const addr = BigInt(out.value ?? 0n);
  if (!addr) throw new Error(`RoGetActivationFactory(${className}) returned NULL`);
  return COMPointer.fromAddress(addr, iface);
}

/** Default-construct a WinRT runtime class (`DllGetActivationFactory::ActivateInstance` if registered, else `RoActivateInstance`). */
export function activateInstance<T extends InterfaceDef<any> = typeof IInspectable>(className: string, iface?: T): InterfacePointer<T> {
  const registeredDll = resolveRegisteredDll(className);
  if (registeredDll) {
    using factory = getActivationFactoryFromDll(registeredDll, className, IActivationFactory);
    const out = new c_void_p(0n);
    sync(factory).ActivateInstance(byref(out));
    const addr = BigInt(out.value ?? 0n);
    if (!addr) throw new Error(`IActivationFactory::ActivateInstance(${className}) returned NULL`);
    const inspectable = COMPointer.fromAddress(addr, IInspectable);
    if (!iface || iface === (IInspectable as unknown)) return inspectable as unknown as InterfacePointer<T>;
    using owned = inspectable;
    return owned.QueryInterface(iface);
  }
  roInitialize();
  const out = new c_void_p(0n);
  withHString(className, (hClass) => {
    checkHRESULT(combase().RoActivateInstance(hClass, byref(out)), `RoActivateInstance(${className})`);
  });
  const addr = BigInt(out.value ?? 0n);
  if (!addr) throw new Error(`RoActivateInstance(${className}) returned NULL`);
  const inspectable = COMPointer.fromAddress(addr, IInspectable);
  if (!iface || iface === (IInspectable as unknown)) {
    return inspectable as unknown as InterfacePointer<T>;
  }
  using owned = inspectable;
  return owned.QueryInterface(iface);
}

/** Call `IClosable::Close()` if `pointer` implements `IClosable`. */
export function tryClose(pointer: COMPointer | null): void {
  if (!pointer || pointer.released) return;
  try {
    using closable = pointer.QueryInterface(IClosable);
    sync(closable).Close();
  } catch {
    // Not closable or already closed.
  }
}

/** Return the runtime class name (`IInspectable::GetRuntimeClassName`) of a WinRT pointer. */
export function getRuntimeClassName(pointer: COMPointer): string {
  using insp = pointer.QueryInterface(IInspectable);
  const out = new c_void_p(0n);
  sync(insp).GetRuntimeClassName(byref(out));
  return readAndDeleteHString(BigInt(out.value ?? 0n));
}
