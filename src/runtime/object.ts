import { COMInterface, COMPointer, IUnknown } from "@node-ctypes/comtypes";
import type { InterfaceDef, InterfacePointer } from "@node-ctypes/comtypes";
import { getRuntimeClassName, IInspectable, tryClose } from "./native.ts";

/**
 * Base wrapper for projected WinRT objects (`runtimeclass` and interface instances).
 *
 * Implements `Disposable` (`using obj = ...`): calls `IClosable::Close()` if
 * supported, then releases the underlying COM reference.
 */
export class WinRTObject implements Disposable {
  readonly raw: COMPointer;

  constructor(pointer: COMPointer) {
    this.raw = pointer;
  }

  /** Adopt a raw native interface pointer address (takes ownership of 1 reference). */
  static fromAddress<T extends WinRTObject>(this: new (pointer: COMPointer) => T, address: bigint, iface: InterfaceDef<any> = IInspectable, addRef = false): T {
    return new this(COMPointer.fromAddress(address, iface, { addRef }));
  }

  get address(): bigint {
    return this.raw.address;
  }

  get released(): boolean {
    return this.raw.released;
  }

  /** Query another WinRT/COM interface (`QueryInterface`), returning a new owned COM pointer. */
  queryInterface<I extends InterfaceDef<any>>(iface: I): InterfacePointer<I> {
    return this.raw.QueryInterface(iface);
  }

  /** Try `QueryInterface`, returning `null` if the interface is not supported. */
  tryQueryInterface<I extends InterfaceDef<any>>(iface: I): InterfacePointer<I> | null {
    return this.raw.tryQueryInterface(iface);
  }

  /**
   * Cast (`QueryInterface`) this WinRT object to a projected runtime class
   * (e.g. `const btn = root.findName("MyBtn")!.as(Button)`), returning a new owned wrapper.
   */
  as<T extends WinRTObject>(TargetClass: (new (pointer: COMPointer) => T) & { readonly defaultInterface: InterfaceDef<any> }): T {
    return new TargetClass(this.raw.QueryInterface(TargetClass.defaultInterface));
  }

  /** Like {@link as}, returning `null` if the object does not implement `TargetClass`. */
  tryAs<T extends WinRTObject>(TargetClass: (new (pointer: COMPointer) => T) & { readonly defaultInterface: InterfaceDef<any> }): T | null {
    const ptr = this.raw.tryQueryInterface(TargetClass.defaultInterface);
    return ptr ? new TargetClass(ptr) : null;
  }

  /** Return the concrete WinRT runtime class name (`IInspectable::GetRuntimeClassName`). */
  getRuntimeClassName(): string {
    return getRuntimeClassName(this.raw);
  }

  /** Close (`IClosable::Close` when supported) and release the COM reference. */
  dispose(): void {
    if (this.raw.released) return;
    tryClose(this.raw);
    this.raw.Release();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

/** Extract a raw pointer address (`bigint`) from a `WinRTObject`, `COMPointer`, or `bigint`. */
export function unwrapWinRTPointer(value: WinRTObject | COMPointer | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  return value.address;
}

const argIfaceCache = new Map<string, InterfaceDef<any>>();

function getArgInterface(iid: string): InterfaceDef<any> {
  const key = iid.toUpperCase();
  let iface = argIfaceCache.get(key);
  if (!iface) {
    iface = COMInterface({ name: `IWinRTArg_${key}`, iid: key, extends: IUnknown, methods: [] });
    argIfaceCache.set(key, iface);
  }
  return iface;
}

export interface MarshalledWinRTPointer {
  readonly ptr: bigint;
  readonly owned: COMPointer | null;
}

/**
 * Resolve a WinRT object / COM pointer argument to the exact COM interface IID
 * expected by the callee's ABI slot. Fast-paths when the pointer already holds
 * the expected IID; otherwise performs `QueryInterface` and returns an `owned`
 * pointer that the caller must release in `finally`.
 */
export function queryWinRTArgPointer(value: WinRTObject | COMPointer | bigint | null | undefined, expectedIid: string): MarshalledWinRTPointer {
  if (value === null || value === undefined) return { ptr: 0n, owned: null };
  if (typeof value === "bigint") return { ptr: value, owned: null };
  const raw = value instanceof WinRTObject ? value.raw : value;
  if (raw.address === 0n) return { ptr: 0n, owned: null };
  const currentIid = raw.interface?.iid?.toString();
  if (currentIid && currentIid.toUpperCase() === expectedIid.toUpperCase()) {
    return { ptr: raw.address, owned: null };
  }
  const qi = raw.QueryInterface(getArgInterface(expectedIid));
  return { ptr: qi.address, owned: qi };
}
