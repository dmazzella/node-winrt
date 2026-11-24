import { addressof, array, c_int32, c_uint32, c_void_p, memmove, WINFUNCTYPE, writeValue } from "node-ctypes";
import { COMInterface, COMPointer, E_FAIL, E_NOINTERFACE, HRESULT, S_OK, STDMETHOD, sync } from "@node-ctypes/comtypes";
import type { InterfaceDef } from "@node-ctypes/comtypes";
import { createHString } from "./native.ts";
import { WinRTObject } from "./object.ts";

const IID_IUnknown = "{00000000-0000-0000-C000-000000000046}";
const IID_IInspectable = "{AF86E2E0-B12D-4C6A-9C5A-D7AA65101E90}";
const guidScratch = Buffer.allocUnsafe(16);
const zero4 = Buffer.alloc(4);

const IUnknownRaw = COMInterface({
  name: "IUnknownRaw",
  iid: IID_IUnknown,
  methods: [STDMETHOD(HRESULT, "QI", [c_void_p, c_void_p]), STDMETHOD(c_uint32, "AR", []), STDMETHOD(c_uint32, "Rel", [])],
});

function readGuidUpper(riidAddr: bigint): string {
  memmove(guidScratch, riidAddr, 16);
  const a = guidScratch.readUInt32LE(0).toString(16).padStart(8, "0");
  const b = guidScratch.readUInt16LE(4).toString(16).padStart(4, "0");
  const c = guidScratch.readUInt16LE(6).toString(16).padStart(4, "0");
  const d = guidScratch.subarray(8, 10).toString("hex");
  const e = guidScratch.subarray(10, 16).toString("hex");
  return `{${a}-${b}-${c}-${d}-${e}}`.toUpperCase();
}

function writeOutPointer(outAddr: bigint, value: bigint): void {
  writeValue(outAddr, c_void_p, value);
}

export interface WinRTOverrideSpec {
  /** Generated WinRT overrides interface (e.g. `IApplicationOverrides`). */
  readonly iface: InterfaceDef<any>;
  /** Method implementations keyed by vtable method name (e.g. `{ OnLaunched(args) { ... } }`). */
  readonly impl: Readonly<Record<string, (...args: any[]) => number | void>>;
}

export interface WinRTDelegateSpec {
  /** Interface IID to expose on the aggregated outer object (e.g. `IXamlMetadataProvider`). */
  readonly iface: InterfaceDef<any>;
  /** Backing WinRT/COM object whose `QueryInterface(iface)` pointer will be handed out. */
  readonly target: WinRTObject | COMPointer;
}

export interface WinRTAggregateOptions {
  /** Runtime class name returned by `IInspectable::GetRuntimeClassName`. */
  readonly className: string;
  /** Override interfaces implemented by the outer object (dispatched via their generated vtable layout). */
  readonly overrides?: readonly WinRTOverrideSpec[];
  /** Additional interfaces delegated directly to existing WinRT/COM objects. */
  readonly delegates?: readonly WinRTDelegateSpec[];
  /** Optional error hook invoked if an override implementation throws. */
  readonly onError?: (error: unknown, methodName: string) => void;
}

export interface WinRTAggregate extends Disposable {
  /** Outer `IInspectable*` address to pass as `baseInterface` to `Class.createComposed(agg.outerAddress, ...)`. */
  readonly outerAddress: bigint;
  /** Attach the inner non-delegating `IInspectable*` returned by `Class.createComposed(...)`. */
  attachInner(innerAddress: bigint): void;
  /** Release the attached inner object and cached delegate references. */
  dispose(): void;
}

/**
 * Create a generic COM-aggregating outer `IInspectable` for subclassing any
 * WinRT `[Composable]` runtime class (e.g. `Application`, `Page`, `UserControl`,
 * or custom C++/WinRT composable classes) using generated `.winmd` interfaces.
 *
 * Works in both normal and Electron mirror (`NODE_CTYPES_NO_EXTERNAL_BUFFERS=1`) modes.
 */
export function createWinRTAggregate(options: WinRTAggregateOptions): WinRTAggregate {
  let refCount = 1;
  let disposed = false;
  let innerUnknown: COMPointer<typeof IUnknownRaw> | null = null;
  const keepAlive: unknown[] = [];
  const callbacks: Array<{ release?: () => void }> = [];

  const makeComBlock = (slotCallbacks: ReadonlyArray<{ readonly pointer: bigint; release?: () => void }>): bigint => {
    const VtableType = array(c_void_p, slotCallbacks.length);
    const vtable = new VtableType();
    for (let i = 0; i < slotCallbacks.length; i++) {
      keepAlive.push(slotCallbacks[i]);
      vtable[i] = slotCallbacks[i].pointer;
    }
    const block = new c_void_p(addressof(vtable));
    keepAlive.push(vtable, block);
    return addressof(block);
  };

  // Pre-resolve delegated interfaces once so hot `QueryInterface` calls only AddRef.
  const delegateMap = new Map<string, COMPointer<typeof IUnknownRaw>>();
  for (const spec of options.delegates ?? []) {
    const raw = spec.target instanceof WinRTObject ? spec.target.raw : spec.target;
    const qi = raw.QueryInterface(spec.iface);
    const cached = COMPointer.fromAddress(qi.address, IUnknownRaw);
    qi.detach();
    delegateMap.set(spec.iface.iid.toString().toUpperCase(), cached);
  }

  let outerInspectableAddr = 0n;
  const overrideBlocks = new Map<string, bigint>();

  const qiCb = WINFUNCTYPE(
    c_int32,
    c_void_p,
    c_void_p,
    c_void_p,
  )((_self, riid, ppv) => {
    const outAddr = BigInt(ppv ?? 0n);
    if (!riid || !outAddr) return E_NOINTERFACE;
    const iid = readGuidUpper(BigInt(riid));

    if (iid === IID_IUnknown || iid === IID_IInspectable) {
      refCount++;
      writeOutPointer(outAddr, outerInspectableAddr);
      return S_OK;
    }

    const overrideAddr = overrideBlocks.get(iid);
    if (overrideAddr !== undefined) {
      refCount++;
      writeOutPointer(outAddr, overrideAddr);
      return S_OK;
    }

    const delegated = delegateMap.get(iid);
    if (delegated && !delegated.released) {
      sync(delegated).AR();
      writeOutPointer(outAddr, delegated.address);
      return S_OK;
    }

    if (innerUnknown && !innerUnknown.released) {
      try {
        return sync(innerUnknown).QI(BigInt(riid), outAddr) as number;
      } catch (err) {
        return (err as { hresult?: number })?.hresult ?? E_NOINTERFACE;
      }
    }

    writeOutPointer(outAddr, 0n);
    return E_NOINTERFACE;
  });

  const addRefCb = WINFUNCTYPE(c_uint32, c_void_p)(() => ++refCount);
  const releaseCb = WINFUNCTYPE(c_uint32, c_void_p)(() => Math.max(0, --refCount));
  const getIidsCb = WINFUNCTYPE(
    c_int32,
    c_void_p,
    c_void_p,
    c_void_p,
  )((_self, countPtr, iidsPtr) => {
    if (countPtr) memmove(BigInt(countPtr), zero4, 4);
    if (iidsPtr) writeOutPointer(BigInt(iidsPtr), 0n);
    return S_OK;
  });
  const getNameCb = WINFUNCTYPE(
    c_int32,
    c_void_p,
    c_void_p,
  )((_self, outPtr) => {
    if (outPtr) writeOutPointer(BigInt(outPtr), createHString(options.className));
    return S_OK;
  });
  const getTrustCb = WINFUNCTYPE(
    c_int32,
    c_void_p,
    c_void_p,
  )((_self, outPtr) => {
    if (outPtr) memmove(BigInt(outPtr), zero4, 4);
    return S_OK;
  });

  const inspectableSlots = [qiCb, addRefCb, releaseCb, getIidsCb, getNameCb, getTrustCb] as const;
  callbacks.push(...inspectableSlots);
  outerInspectableAddr = makeComBlock(inspectableSlots);

  for (const spec of options.overrides ?? []) {
    const methods = spec.iface.allMethods;
    const slots: Array<{ readonly pointer: bigint }> = [...inspectableSlots];
    for (let i = 6; i < methods.length; i++) {
      const m = methods[i];
      const fn = spec.impl[m.name];
      const restype = m.restype === HRESULT ? c_int32 : m.restype;
      const cb = WINFUNCTYPE(
        restype as any,
        c_void_p,
        ...(m.argtypes as any[]),
      )((_self: unknown, ...args: unknown[]) => {
        if (!fn) return S_OK;
        try {
          const res = fn(...args);
          return typeof res === "number" ? res : S_OK;
        } catch (err) {
          if (options.onError) {
            options.onError(err, m.name);
            return E_FAIL;
          }
          queueMicrotask(() => {
            throw err;
          });
          return E_FAIL;
        }
      });
      callbacks.push(cb);
      slots.push(cb);
    }
    overrideBlocks.set(spec.iface.iid.toString().toUpperCase(), makeComBlock(slots));
  }

  const attachInner = (innerAddress: bigint): void => {
    if (innerAddress === 0n) return;
    if (innerUnknown && !innerUnknown.released) innerUnknown.Release();
    innerUnknown = COMPointer.fromAddress(innerAddress, IUnknownRaw);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (innerUnknown && !innerUnknown.released) {
      innerUnknown.Release();
      innerUnknown = null;
    }
    for (const d of delegateMap.values()) {
      if (!d.released) d.Release();
    }
    delegateMap.clear();
    overrideBlocks.clear();
    for (const cb of callbacks.splice(0)) {
      try {
        cb.release?.();
      } catch {
        // Ignore already-released callback.
      }
    }
    keepAlive.length = 0;
  };

  return {
    outerAddress: outerInspectableAddr,
    attachInner,
    dispose,
    [Symbol.dispose]: dispose,
  };
}

export interface ComposableWinRTClass<T extends WinRTObject> {
  createComposed(outer: bigint): { readonly instance: T | null; readonly inner: bigint };
}

export interface ComposedWinRTInstance<T extends WinRTObject> extends Disposable {
  /** The composed WinRT runtime class instance (e.g. `Application`). */
  readonly instance: T;
  /** Underlying COM aggregator (disposed automatically by `dispose()`). */
  readonly aggregate: WinRTAggregate;
  dispose(): void;
}

/**
 * Instantiate any WinRT `[Composable]` class (such as `Application`, `Page`, or
 * `UserControl`) with COM-aggregated overrides and/or delegated interfaces in a
 * single call. Override implementations receive `(self, ...args)` where `self`
 * is the typed composed instance `T`.
 */
export function composeWinRTClass<T extends WinRTObject>(
  TargetClass: ComposableWinRTClass<T>,
  options: {
    readonly className: string;
    readonly overrides?: ReadonlyArray<{
      readonly iface: InterfaceDef<any>;
      readonly impl: Readonly<Record<string, (self: T, ...args: any[]) => number | void>>;
    }>;
    readonly delegates?: readonly WinRTDelegateSpec[];
    readonly onError?: (error: unknown, methodName: string) => void;
  },
): ComposedWinRTInstance<T> {
  let instance!: T;
  const boundOverrides = options.overrides?.map((spec) => ({
    iface: spec.iface,
    impl: Object.fromEntries(Object.entries(spec.impl).map(([name, fn]) => [name, (...args: unknown[]) => fn(instance, ...args)])),
  }));
  const aggregate = createWinRTAggregate({
    className: options.className,
    overrides: boundOverrides,
    delegates: options.delegates,
    onError: options.onError,
  });
  let composed: { readonly instance: T | null; readonly inner: bigint };
  try {
    composed = TargetClass.createComposed(aggregate.outerAddress);
  } catch (err) {
    aggregate.dispose();
    throw err;
  }
  if (!composed.instance) {
    aggregate.dispose();
    throw new Error(`createComposed(${options.className}) returned NULL`);
  }
  instance = composed.instance;
  aggregate.attachInner(composed.inner);

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    instance.dispose();
    aggregate.dispose();
  };
  return { instance, aggregate, dispose, [Symbol.dispose]: dispose };
}
