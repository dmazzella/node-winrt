---
title: Async, events and collections
---

# Async, events and collections

## Event-driven WinRT async

Every generated method returning a WinRT async interface resolves to a standard JavaScript `Promise`:

- `IAsyncAction` → `awaitWinRTAction(addr, timeoutMs?)` → `Promise<void>`
- `IAsyncOperation<T>` → `awaitWinRTAsync(addr, readResult, { completedHandlerIid, timeoutMs })` → `Promise<T>`
- `IAsyncOperationWithProgress<T, P>` → `awaitWinRTAsyncWithProgress(...)` → `Promise<T>`
- `IAsyncActionWithProgress<P>` → `awaitWinRTActionWithProgress(...)` → `Promise<void>`

When `completedHandlerIid` is provided (always emitted by the code generator), `@node-ctypes/winrt` attaches a free-threaded `COMObject` implementing `[CompletedHandler, IAgileObject]` via `put_Completed` — **zero polling**, keeping Node.js's event loop completely idle until WinRT signals completion. Handler classes are cached per `InterfaceDef` (`WeakMap`) so repeated async calls reuse a single native vtable and libffi closure set.

On settlement (success, cancellation, error or timeout), `IAsyncInfo::Close()` and `Release()` run automatically.

## Events and WinRT delegates

Generated runtime classes emit ergonomic, **typed** `on<Event>((sender, args) => ...)` methods for `TypedEventHandler<TSender, TArgs>`, `EventHandler<T>`, and custom 0/1/2-arg WinRT delegates:

```typescript
using watcher = new BluetoothLEAdvertisementWatcher();
using subscription = watcher.onReceived((_sender, args) => {
  if (!args) return;
  console.log(args.bluetoothAddress.toString(16), args.rawSignalStrengthInDBm);
});
// Disposing `subscription` calls `remove_Received(token)` and releases the COM delegate.
```

- `sender` and `args` are automatically wrapped in their projected `WinRTObject` subclasses as borrowed references and released automatically after the callback returns (use `.as(Class)` to retain an owned reference beyond the callback).
- Delegates are free-threaded (`IAgileObject`) and cached per IID so repeated subscriptions do not rebuild vtables.
- If `add_<Event>` fails, the temporary COM delegate is released immediately so it never leaks.
- Methods taking a WinRT delegate parameter directly (such as `Application.start(callback)`) accept a plain JavaScript function directly, automatically wrapped via `createDelegateHandler`.

## Collections, nullable values and byte arrays

- **`IVectorView<T>` / `IIterable<T>`**: decoded eagerly into `T[]` via `readVectorView` / `readIterable`, releasing the COM view/iterator afterwards.
- **`IVector<T>`**: wrapped in a mutable, `Disposable` `WinRTVector<T, TIn>` supporting `.size`, `.getAt(i)`, `.toArray()`, `for...of`, `.setAt(i, v)`, `.insertAt(i, v)`, `.append(v)`, `.removeAt(i)`, `.removeAtEnd()`, `.clear()` (for example `Application.resources.mergedDictionaries.append(xamlControlsResources)`).
- **`IMapView<K, V>` / `IMap<K, V>`**: decoded into a JavaScript `Map<K, V>` via `readMapView` using the computed `IIterable<IKeyValuePair<K, V>>` PIID.
- **`IReference<T>`**: unwrapped to `T | null` via `readReference`.
- **Byte arrays**: `PassArray` / `FillArray` accept any `Uint8Array` / `Buffer`; `ReceiveArray` copies bytes out and frees WinRT's `CoTaskMemAlloc` buffer via `takeCoTaskMemBytes`.

## Disposal and `WinRTObject`

Every projected WinRT runtime class extends `WinRTObject`, which implements `Disposable`:

- `using obj = ...` (or `obj.dispose()`) calls `IClosable::Close()` when supported (via zero-exception `tryQueryInterface(IClosable)`), then releases the COM reference.
- `obj.as(SubClass)` / `obj.tryAs(SubClass)` perform typed `QueryInterface` casts (for example casting `FrameworkElement.findName("MySlider")` to `Slider`).
- `obj.getRuntimeClassName()` calls `IInspectable::GetRuntimeClassName`.
