import { setTimeout as sleep } from "node:timers/promises";
import { byref, c_int32, c_uint32, c_uint8, c_void_p, memmove } from "node-ctypes";
import { checkHRESULT, COMInterface, COMObject, COMPointer, HRESULT, IUnknown, S_OK, STDMETHOD, sync } from "@node-ctypes/comtypes";
import type { InterfaceDef, InterfacePointer } from "@node-ctypes/comtypes";
import {
  AsyncStatus,
  coTaskMemFree,
  IAgileObject,
  IAsyncAction,
  IAsyncActionCompletedHandler,
  IAsyncActionWithProgressRaw,
  IAsyncInfo,
  IAsyncOperationRaw,
  IAsyncOperationWithProgressRaw,
  IInspectable,
  IIterableRaw,
  IIteratorRaw,
  IKeyValuePairRaw,
  IReferenceRaw,
  IVectorViewRaw,
} from "./native.ts";

const completedHandlerInterfaces = new Map<string, InterfaceDef<any>>();

function getCompletedHandlerInterface(iid: string): InterfaceDef<any> {
  const key = iid.toUpperCase();
  let iface = completedHandlerInterfaces.get(key);
  if (!iface) {
    iface = COMInterface({
      name: `IAsyncOperationCompletedHandler_${key.slice(1, 9)}`,
      iid: key,
      extends: IUnknown,
      methods: [STDMETHOD(HRESULT, "onCompleted", [c_void_p, c_int32])],
    });
    completedHandlerInterfaces.set(key, iface);
  }
  return iface;
}

/**
 * Await a WinRT `IAsyncAction` using `IAsyncActionCompletedHandler` (zero polling).
 * Takes ownership of `actionAddr` and closes/releases it when settled.
 */
export async function awaitWinRTAction(actionAddr: bigint, timeoutMs = 30000): Promise<void> {
  if (!actionAddr) throw new Error("WinRT IAsyncAction pointer is NULL");
  const action = COMPointer.fromAddress(actionAddr, IAsyncAction);
  const info = action.QueryInterface(IAsyncInfo);

  const finalize = () => {
    try {
      sync(info).Close();
    } catch {
      // Best-effort close.
    }
    if (!info.released) info.Release();
    if (!action.released) action.Release();
  };

  try {
    const statusBox = new c_int32(0);
    sync(info).get_Status(byref(statusBox));
    let status = Number(statusBox.value);

    if (status === AsyncStatus.Started) {
      status = await new Promise<number>((resolve, reject) => {
        let settled = false;
        let handlerPtr: InterfacePointer<typeof IAsyncActionCompletedHandler> | null = null;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            sync(info).Cancel();
          } catch {
            // Ignore cancel failure.
          }
          handlerPtr?.Release();
          reject(new Error(`WinRT IAsyncAction timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        class ActionCompletedDelegate extends COMObject {
          static _com_interfaces_ = [IAsyncActionCompletedHandler, IAgileObject];
          static _threading_ = "free" as const;

          onCompleted(_asyncInfo: unknown, asyncStatus: number): number {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              setImmediate(() => {
                handlerPtr?.Release();
                resolve(asyncStatus);
              });
            }
            return S_OK;
          }
        }

        const delegate = new ActionCompletedDelegate();
        handlerPtr = delegate.QueryInterface(IAsyncActionCompletedHandler);
        try {
          sync(action).put_Completed(handlerPtr.address);
        } catch (error) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            handlerPtr.Release();
            reject(error);
          }
        }
      });
    }

    if (status === AsyncStatus.Canceled) throw new Error("WinRT IAsyncAction was canceled");
    if (status === AsyncStatus.Error) {
      const errBox = new c_int32(0);
      sync(info).get_ErrorCode(byref(errBox));
      checkHRESULT(Number(errBox.value), "WinRT IAsyncAction");
      throw new Error("WinRT IAsyncAction failed");
    }
    sync(action).GetResults();
  } finally {
    finalize();
  }
}

export interface AwaitAsyncOptions {
  /** PIID of `IAsyncOperationCompletedHandler<T>` for zero-polling event completion. */
  readonly completedHandlerIid?: string;
  readonly timeoutMs?: number;
}

/**
 * Await any WinRT `IAsyncOperation<T>` and convert the raw result buffer/pointer
 * via `readResult(op)`.
 *
 * When `options.completedHandlerIid` is provided, attaches a free-threaded
 * `IAsyncOperationCompletedHandler<T>` (`put_Completed`, zero polling); otherwise
 * falls back to lightweight `IAsyncInfo::get_Status` polling.
 *
 * Takes ownership of `opAddr` and closes/releases it after reading results.
 */
export async function awaitWinRTAsync<T>(opAddr: bigint, readResult: (op: InterfacePointer<typeof IAsyncOperationRaw>) => T, options: AwaitAsyncOptions = {}): Promise<T> {
  if (!opAddr) throw new Error("WinRT IAsyncOperation pointer is NULL");
  const timeoutMs = options.timeoutMs ?? 30000;
  const op = COMPointer.fromAddress(opAddr, IAsyncOperationRaw);
  const info = op.QueryInterface(IAsyncInfo);

  const finalize = () => {
    try {
      sync(info).Close();
    } catch {
      // Best-effort close.
    }
    if (!info.released) info.Release();
    if (!op.released) op.Release();
  };

  try {
    const statusBox = new c_int32(0);
    sync(info).get_Status(byref(statusBox));
    let status = Number(statusBox.value);

    if (status === AsyncStatus.Started) {
      if (options.completedHandlerIid) {
        const handlerIface = getCompletedHandlerInterface(options.completedHandlerIid);
        status = await new Promise<number>((resolve, reject) => {
          let settled = false;
          let handlerPtr: InterfacePointer<any> | null = null;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try {
              sync(info).Cancel();
            } catch {
              // Ignore cancel failure.
            }
            handlerPtr?.Release();
            reject(new Error(`WinRT IAsyncOperation timed out after ${timeoutMs}ms`));
          }, timeoutMs);

          class OpCompletedDelegate extends COMObject {
            static _com_interfaces_ = [handlerIface, IAgileObject];
            static _threading_ = "free" as const;

            onCompleted(_asyncInfo: unknown, asyncStatus: number): number {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                setImmediate(() => {
                  handlerPtr?.Release();
                  resolve(asyncStatus);
                });
              }
              return S_OK;
            }
          }

          const delegate = new OpCompletedDelegate();
          handlerPtr = delegate.QueryInterface(handlerIface);
          try {
            sync(op).put_Completed(handlerPtr.address);
          } catch (error) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              handlerPtr.Release();
              reject(error);
            }
          }
        });
      } else {
        const deadline = Date.now() + timeoutMs;
        while (status === AsyncStatus.Started) {
          if (Date.now() >= deadline) {
            try {
              sync(info).Cancel();
            } catch {
              // Ignore cancel failure.
            }
            throw new Error(`WinRT IAsyncOperation timed out after ${timeoutMs}ms`);
          }
          await sleep(5);
          sync(info).get_Status(byref(statusBox));
          status = Number(statusBox.value);
        }
      }
    }

    if (status === AsyncStatus.Canceled) throw new Error("WinRT IAsyncOperation was canceled");
    if (status === AsyncStatus.Error) {
      const errBox = new c_int32(0);
      sync(info).get_ErrorCode(byref(errBox));
      checkHRESULT(Number(errBox.value), "WinRT IAsyncOperation");
      throw new Error("WinRT IAsyncOperation failed");
    }

    return readResult(op);
  } finally {
    finalize();
  }
}

/**
 * Await a WinRT `IAsyncOperationWithProgress<TResult, TProgress>` (slots 8/10 for
 * `put_Completed` / `GetResults`), taking ownership of `opAddr`.
 */
export async function awaitWinRTAsyncWithProgress<T>(opAddr: bigint, readResult: (op: InterfacePointer<typeof IAsyncOperationWithProgressRaw>) => T, options: AwaitAsyncOptions = {}): Promise<T> {
  if (!opAddr) throw new Error("WinRT IAsyncOperationWithProgress pointer is NULL");
  const timeoutMs = options.timeoutMs ?? 30000;
  const op = COMPointer.fromAddress(opAddr, IAsyncOperationWithProgressRaw);
  const info = op.QueryInterface(IAsyncInfo);

  const finalize = () => {
    try {
      sync(info).Close();
    } catch {
      // Best-effort close.
    }
    if (!info.released) info.Release();
    if (!op.released) op.Release();
  };

  try {
    const statusBox = new c_int32(0);
    sync(info).get_Status(byref(statusBox));
    let status = Number(statusBox.value);

    if (status === AsyncStatus.Started) {
      if (options.completedHandlerIid) {
        const handlerIface = getCompletedHandlerInterface(options.completedHandlerIid);
        status = await new Promise<number>((resolve, reject) => {
          let settled = false;
          let handlerPtr: InterfacePointer<any> | null = null;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try {
              sync(info).Cancel();
            } catch {
              // Ignore cancel failure.
            }
            handlerPtr?.Release();
            reject(new Error(`WinRT IAsyncOperationWithProgress timed out after ${timeoutMs}ms`));
          }, timeoutMs);

          class OpProgressCompletedDelegate extends COMObject {
            static _com_interfaces_ = [handlerIface, IAgileObject];
            static _threading_ = "free" as const;

            onCompleted(_asyncInfo: unknown, asyncStatus: number): number {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                setImmediate(() => {
                  handlerPtr?.Release();
                  resolve(asyncStatus);
                });
              }
              return S_OK;
            }
          }

          const delegate = new OpProgressCompletedDelegate();
          handlerPtr = delegate.QueryInterface(handlerIface);
          try {
            sync(op).put_Completed(handlerPtr.address);
          } catch (error) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              handlerPtr.Release();
              reject(error);
            }
          }
        });
      } else {
        const deadline = Date.now() + timeoutMs;
        while (status === AsyncStatus.Started) {
          if (Date.now() >= deadline) {
            try {
              sync(info).Cancel();
            } catch {
              // Ignore cancel failure.
            }
            throw new Error(`WinRT IAsyncOperationWithProgress timed out after ${timeoutMs}ms`);
          }
          await sleep(5);
          sync(info).get_Status(byref(statusBox));
          status = Number(statusBox.value);
        }
      }
    }

    if (status === AsyncStatus.Canceled) throw new Error("WinRT IAsyncOperationWithProgress was canceled");
    if (status === AsyncStatus.Error) {
      const errBox = new c_int32(0);
      sync(info).get_ErrorCode(byref(errBox));
      checkHRESULT(Number(errBox.value), "WinRT IAsyncOperationWithProgress");
      throw new Error("WinRT IAsyncOperationWithProgress failed");
    }

    return readResult(op);
  } finally {
    finalize();
  }
}

/**
 * Await a WinRT `IAsyncActionWithProgress<TProgress>`, taking ownership of `actionAddr`.
 */
export async function awaitWinRTActionWithProgress(actionAddr: bigint, options: AwaitAsyncOptions = {}): Promise<void> {
  if (!actionAddr) throw new Error("WinRT IAsyncActionWithProgress pointer is NULL");
  const timeoutMs = options.timeoutMs ?? 30000;
  const action = COMPointer.fromAddress(actionAddr, IAsyncActionWithProgressRaw);
  const info = action.QueryInterface(IAsyncInfo);

  const finalize = () => {
    try {
      sync(info).Close();
    } catch {
      // Best-effort close.
    }
    if (!info.released) info.Release();
    if (!action.released) action.Release();
  };

  try {
    const statusBox = new c_int32(0);
    sync(info).get_Status(byref(statusBox));
    let status = Number(statusBox.value);

    if (status === AsyncStatus.Started) {
      if (options.completedHandlerIid) {
        const handlerIface = getCompletedHandlerInterface(options.completedHandlerIid);
        status = await new Promise<number>((resolve, reject) => {
          let settled = false;
          let handlerPtr: InterfacePointer<any> | null = null;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try {
              sync(info).Cancel();
            } catch {
              // Ignore cancel failure.
            }
            handlerPtr?.Release();
            reject(new Error(`WinRT IAsyncActionWithProgress timed out after ${timeoutMs}ms`));
          }, timeoutMs);

          class ActionProgressCompletedDelegate extends COMObject {
            static _com_interfaces_ = [handlerIface, IAgileObject];
            static _threading_ = "free" as const;

            onCompleted(_asyncInfo: unknown, asyncStatus: number): number {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                setImmediate(() => {
                  handlerPtr?.Release();
                  resolve(asyncStatus);
                });
              }
              return S_OK;
            }
          }

          const delegate = new ActionProgressCompletedDelegate();
          handlerPtr = delegate.QueryInterface(handlerIface);
          try {
            sync(action).put_Completed(handlerPtr.address);
          } catch (error) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              handlerPtr.Release();
              reject(error);
            }
          }
        });
      } else {
        const deadline = Date.now() + timeoutMs;
        while (status === AsyncStatus.Started) {
          if (Date.now() >= deadline) {
            try {
              sync(info).Cancel();
            } catch {
              // Ignore cancel failure.
            }
            throw new Error(`WinRT IAsyncActionWithProgress timed out after ${timeoutMs}ms`);
          }
          await sleep(5);
          sync(info).get_Status(byref(statusBox));
          status = Number(statusBox.value);
        }
      }
    }

    if (status === AsyncStatus.Canceled) throw new Error("WinRT IAsyncActionWithProgress was canceled");
    if (status === AsyncStatus.Error) {
      const errBox = new c_int32(0);
      sync(info).get_ErrorCode(byref(errBox));
      checkHRESULT(Number(errBox.value), "WinRT IAsyncActionWithProgress");
      throw new Error("WinRT IAsyncActionWithProgress failed");
    }

    sync(action).GetResults();
  } finally {
    finalize();
  }
}

/**
 * Unwrap a nullable WinRT `IReference<T>` (`0n` -> `null`), releasing the
 * `IReference` COM pointer after reading its value.
 */
export function readReference<T>(refAddr: bigint, readValue: (ref: InterfacePointer<typeof IReferenceRaw>) => T): T | null {
  if (!refAddr || refAddr === 0n) return null;
  using ref = COMPointer.fromAddress(refAddr, IReferenceRaw);
  return readValue(ref);
}

/**
 * Read every element of a WinRT `IVectorView<T>` or `IVector<T>` (both share
 * slots 6 `GetAt` and 7 `get_Size`) into a JavaScript array, releasing the view.
 */
export function readVectorView<T>(viewAddr: bigint, readElement: (view: InterfacePointer<typeof IVectorViewRaw>, index: number) => T): T[] {
  if (!viewAddr) return [];
  using view = COMPointer.fromAddress(viewAddr, IVectorViewRaw);
  const sizeBox = new c_uint32(0);
  sync(view).get_Size(byref(sizeBox));
  const count = Number(sizeBox.value);
  const items: T[] = [];
  for (let index = 0; index < count; index++) {
    items.push(readElement(view, index));
  }
  return items;
}

const vectorInterfaces = new WeakMap<object, InterfaceDef<any>>();
let vectorInterfaceSeq = 0;

function getVectorInterface(elemCType: unknown): InterfaceDef<any> {
  const key = elemCType as object;
  let iface = vectorInterfaces.get(key);
  if (!iface) {
    iface = COMInterface({
      name: `IVectorRaw_${++vectorInterfaceSeq}`,
      iid: "{913337E9-11A1-4345-A3A2-4E7F956E222D}",
      extends: IInspectable,
      methods: [
        STDMETHOD(HRESULT, "GetAt", [c_uint32, c_void_p]),
        STDMETHOD(HRESULT, "get_Size", [c_void_p]),
        STDMETHOD(HRESULT, "GetView", [c_void_p]),
        STDMETHOD(HRESULT, "IndexOf", [elemCType as any, c_void_p, c_void_p]),
        STDMETHOD(HRESULT, "SetAt", [c_uint32, elemCType as any]),
        STDMETHOD(HRESULT, "InsertAt", [c_uint32, elemCType as any]),
        STDMETHOD(HRESULT, "RemoveAt", [c_uint32]),
        STDMETHOD(HRESULT, "Append", [elemCType as any]),
        STDMETHOD(HRESULT, "RemoveAtEnd", []),
        STDMETHOD(HRESULT, "Clear", []),
      ],
    });
    vectorInterfaces.set(key, iface);
  }
  return iface;
}

/**
 * Typed mutable wrapper for a WinRT `Windows.Foundation.Collections.IVector<T>`.
 * Supports `size`, `getAt`, `toArray`, iteration, `setAt`, `insertAt`, `append`,
 * `removeAt`, `removeAtEnd`, `clear`, and `Disposable` (`using`).
 */
export class WinRTVector<T, TIn = T> implements Disposable, Iterable<T> {
  readonly raw: InterfacePointer<any>;
  readonly #readElement: (vec: InterfacePointer<typeof IVectorViewRaw>, index: number) => T;
  readonly #writeElement: (value: TIn, invoke: (abiArg: unknown) => void) => void;

  constructor(vectorAddr: bigint, elemCType: unknown, readElement: (vec: InterfacePointer<typeof IVectorViewRaw>, index: number) => T, writeElement: (value: TIn, invoke: (abiArg: unknown) => void) => void) {
    this.raw = COMPointer.fromAddress(vectorAddr, getVectorInterface(elemCType));
    this.#readElement = readElement;
    this.#writeElement = writeElement;
  }

  get address(): bigint {
    return this.raw.address;
  }

  get released(): boolean {
    return this.raw.released;
  }

  #syncRaw(): {
    get_Size(out: unknown): void;
    SetAt(index: number, value: unknown): void;
    InsertAt(index: number, value: unknown): void;
    Append(value: unknown): void;
    RemoveAt(index: number): void;
    RemoveAtEnd(): void;
    Clear(): void;
  } {
    return sync(this.raw) as any;
  }

  get size(): number {
    const sizeBox = new c_uint32(0);
    this.#syncRaw().get_Size(byref(sizeBox));
    return Number(sizeBox.value);
  }

  getAt(index: number): T {
    return this.#readElement(this.raw as unknown as InterfacePointer<typeof IVectorViewRaw>, index);
  }

  toArray(): T[] {
    const count = this.size;
    const view = this.raw as unknown as InterfacePointer<typeof IVectorViewRaw>;
    const items: T[] = [];
    for (let i = 0; i < count; i++) items.push(this.#readElement(view, i));
    return items;
  }

  *[Symbol.iterator](): IterableIterator<T> {
    const count = this.size;
    const view = this.raw as unknown as InterfacePointer<typeof IVectorViewRaw>;
    for (let i = 0; i < count; i++) yield this.#readElement(view, i);
  }

  setAt(index: number, value: TIn): void {
    this.#writeElement(value, (abiArg) => {
      this.#syncRaw().SetAt(index, abiArg);
    });
  }

  insertAt(index: number, value: TIn): void {
    this.#writeElement(value, (abiArg) => {
      this.#syncRaw().InsertAt(index, abiArg);
    });
  }

  append(value: TIn): void {
    this.#writeElement(value, (abiArg) => {
      this.#syncRaw().Append(abiArg);
    });
  }

  removeAt(index: number): void {
    this.#syncRaw().RemoveAt(index);
  }

  removeAtEnd(): void {
    this.#syncRaw().RemoveAtEnd();
  }

  clear(): void {
    this.#syncRaw().Clear();
  }

  dispose(): void {
    if (!this.raw.released) this.raw.Release();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

/** Wrap a raw WinRT `IVector<T>` pointer address in a mutable `WinRTVector<T, TIn>`, or `null` if NULL. */
export function wrapVector<T, TIn = T>(
  vectorAddr: bigint,
  elemCType: unknown,
  readElement: (vec: InterfacePointer<typeof IVectorViewRaw>, index: number) => T,
  writeElement: (value: TIn, invoke: (abiArg: unknown) => void) => void,
): WinRTVector<T, TIn> | null {
  if (!vectorAddr) return null;
  return new WinRTVector(vectorAddr, elemCType, readElement, writeElement);
}

/**
 * Iterate any WinRT `IIterable<T>` into a JavaScript array, releasing both the
 * iterable and its `IIterator<T>`.
 */
export function readIterable<T>(iterableAddr: bigint, readCurrent: (iter: InterfacePointer<typeof IIteratorRaw>) => T): T[] {
  if (!iterableAddr) return [];
  using iterable = COMPointer.fromAddress(iterableAddr, IIterableRaw);
  const iterOut = new c_void_p(0n);
  sync(iterable).First(byref(iterOut));
  const iterAddr = BigInt(iterOut.value ?? 0n);
  if (!iterAddr) return [];
  using iter = COMPointer.fromAddress(iterAddr, IIteratorRaw);

  const items: T[] = [];
  const hasBox = new c_uint8(0);
  sync(iter).get_HasCurrent(byref(hasBox));
  while (hasBox.value !== 0) {
    items.push(readCurrent(iter));
    sync(iter).MoveNext(byref(hasBox));
  }
  return items;
}

const iterableInterfaces = new Map<string, InterfaceDef<any>>();

function getIterableInterface(piid: string): InterfaceDef<any> {
  const key = piid.toUpperCase();
  let iface = iterableInterfaces.get(key);
  if (!iface) {
    iface = COMInterface({
      name: `IIterable_${key.slice(1, 9)}`,
      iid: key,
      extends: IInspectable,
      methods: [STDMETHOD(HRESULT, "First", [c_void_p])],
    });
    iterableInterfaces.set(key, iface);
  }
  return iface;
}

/**
 * Read a WinRT `IMapView<K, V>` or `IMap<K, V>` into a JavaScript `Map<K, V>`
 * by `QueryInterface`ing `IIterable<IKeyValuePair<K, V>>` (`iterablePiid`),
 * releasing all COM pointers afterwards.
 */
export function readMapView<K, V>(mapAddr: bigint, iterablePiid: string, readKey: (pair: InterfacePointer<typeof IKeyValuePairRaw>) => K, readValue: (pair: InterfacePointer<typeof IKeyValuePairRaw>) => V): Map<K, V> {
  const result = new Map<K, V>();
  if (!mapAddr) return result;
  using map = COMPointer.fromAddress(mapAddr, IInspectable);
  const iterableIface = getIterableInterface(iterablePiid);
  using iterable = map.QueryInterface(iterableIface);

  const iterOut = new c_void_p(0n);
  sync(iterable).First(byref(iterOut));
  const iterAddr = BigInt(iterOut.value ?? 0n);
  if (!iterAddr) return result;
  using iter = COMPointer.fromAddress(iterAddr, IIteratorRaw);

  const hasBox = new c_uint8(0);
  const pairOut = new c_void_p(0n);
  sync(iter).get_HasCurrent(byref(hasBox));
  while (hasBox.value !== 0) {
    pairOut.value = 0n;
    sync(iter).get_Current(byref(pairOut));
    const pairAddr = BigInt(pairOut.value ?? 0n);
    if (pairAddr) {
      using pair = COMPointer.fromAddress(pairAddr, IKeyValuePairRaw);
      result.set(readKey(pair), readValue(pair));
    }
    sync(iter).MoveNext(byref(hasBox));
  }
  return result;
}

/**
 * Copy `length` bytes out of a WinRT `ReceiveArray` (`CoTaskMemAlloc`'d buffer)
 * into a Node `Buffer`, freeing `dataPtr` with `CoTaskMemFree`.
 */
export function takeCoTaskMemBytes(dataPtr: bigint, length: number): Buffer {
  if (!dataPtr || dataPtr === 0n || length <= 0) {
    coTaskMemFree(dataPtr);
    return Buffer.alloc(0);
  }
  try {
    const out = Buffer.allocUnsafe(length);
    memmove(out, dataPtr, length);
    return out;
  } finally {
    coTaskMemFree(dataPtr);
  }
}

const eventHandlerInterfaces = new Map<string, InterfaceDef<any>>();

/**
 * Create a free-threaded WinRT `TypedEventHandler<TSender, TArgs>` COM delegate
 * with the computed `piid`. Caller owns the returned COM pointer and must
 * release it after calling `remove_<Event>(token)`.
 */
export function createTypedEventHandler(piid: string, callback: (senderAddr: bigint, argsAddr: bigint) => void): InterfacePointer<any> {
  const key = piid.toUpperCase();
  let iface = eventHandlerInterfaces.get(key);
  if (!iface) {
    iface = COMInterface({
      name: `TypedEventHandler_${key.slice(1, 9)}`,
      iid: key,
      extends: IUnknown,
      methods: [STDMETHOD(HRESULT, "onEvent", [c_void_p, c_void_p])],
    });
    eventHandlerInterfaces.set(key, iface);
  }
  const eventIface = iface;

  class Delegate extends COMObject {
    static _com_interfaces_ = [eventIface, IAgileObject];
    static _threading_ = "free" as const;

    onEvent(sender: bigint | null, args: bigint | null): number {
      const s = sender ? BigInt(sender) : 0n;
      const a = args ? BigInt(args) : 0n;
      try {
        callback(s, a);
      } catch (err) {
        queueMicrotask(() => {
          throw err;
        });
      }
      return S_OK;
    }
  }

  return new Delegate().QueryInterface(eventIface);
}

const singleArgHandlerInterfaces = new Map<string, InterfaceDef<any>>();

/**
 * Create a free-threaded WinRT `EventHandler<T>` or single-argument custom delegate
 * (`Invoke(IInspectable* sender, T args)` — note WinRT `EventHandler<T>` has 2 params `(sender, args)`,
 * whereas custom delegates with 0 or 1 param are supported via `paramCount`).
 */
export function createDelegateHandler(iid: string, paramCount: 0 | 1 | 2, callback: (...args: bigint[]) => void): InterfacePointer<any> {
  if (paramCount === 2) {
    return createTypedEventHandler(iid, (a, b) => callback(a, b));
  }
  const key = `${iid.toUpperCase()}:${paramCount}`;
  let iface = singleArgHandlerInterfaces.get(key);
  if (!iface) {
    const argTypes = paramCount === 1 ? [c_void_p] : [];
    iface = COMInterface({
      name: `WinRTDelegate_${iid.slice(1, 9)}_${paramCount}`,
      iid: iid.toUpperCase(),
      extends: IUnknown,
      methods: [STDMETHOD(HRESULT, "onEvent", argTypes)],
    });
    singleArgHandlerInterfaces.set(key, iface);
  }
  const delegateIface = iface;

  class Delegate extends COMObject {
    static _com_interfaces_ = [delegateIface, IAgileObject];
    static _threading_ = "free" as const;

    onEvent(a?: bigint | null): number {
      const args = paramCount === 1 ? [a ? BigInt(a) : 0n] : [];
      try {
        callback(...args);
      } catch (err) {
        queueMicrotask(() => {
          throw err;
        });
      }
      return S_OK;
    }
  }

  return new Delegate().QueryInterface(delegateIface);
}
