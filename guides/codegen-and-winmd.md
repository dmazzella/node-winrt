---
title: Code generation and WinMD metadata
---

# Code generation and WinMD metadata

## Zero-dependency ECMA-335 `.winmd` reader

`WinMdStore` parses PE/COFF ECMA-335 metadata tables directly in JavaScript (`Ecma335File`) with zero native dependencies:

- By default on Windows, `defaultWinMdPaths()` loads `C:\Windows\System32\WinMetadata\*.winmd`, which is present on every Windows 10 and Windows 11 installation without needing the Windows SDK.
- Pass `--winmd <file-or-dir>` (repeatable) to load the unified `Windows.winmd` or third-party `.winmd` files.
- Pass `--winapp` to automatically attach the installed Windows App Runtime (`Microsoft.WindowsAppRuntime.*`) via `bootstrapWindowsAppRuntime()` and include its `.winmd` directory (`Microsoft.UI.Xaml.winmd`, `Microsoft.UI.winmd`, `Microsoft.Windows.AI.*.winmd`, ...).

```typescript
import { WinMdStore, generateNamespaceModule } from "@node-ctypes/winrt";

const store = new WinMdStore();
console.log(store.listNamespaces().filter((ns) => ns.startsWith("Windows.Media")));
const tsSource = generateNamespaceModule(store, "Windows.Media.Ocr");
```

## Exact WinRT PIID computation

WinRT identifies parameterized generic interfaces and delegates (`IAsyncOperation<T>`, `IAsyncOperationCompletedHandler<T>`, `IVectorView<T>`, `TypedEventHandler<TSender, TArgs>`, `IIterable<IKeyValuePair<K, V>>`, ...) by computing a deterministic **UUIDv5 (SHA-1)** over the canonical WinRT signature string under Microsoft's fixed WinRT namespace UUID (`{11f47ad5-7b73-42c0-abae-878b1e16adee}`).

`computePiid(signature)` (memoized) and convenience helpers (`asyncOperationPiid`, `asyncOperationCompletedHandlerPiid`, `vectorViewPiid`, `typedEventHandlerPiid`, `eventHandlerPiid`, `mapIterablePiid`, ...) implement this specification identically to `windows-rs` and `PyWinRT`.

## Tree-shaking large namespaces

Large namespaces such as `Microsoft.UI.Xaml.Controls` contain hundreds of classes. Use `--only <Namespace:Type1,Type2,...>` (repeatable in CLI, or `includeTypes` in `GenerateOptions`) to emit only the classes and interfaces you actually need — all required base, static, factory and composable interfaces are retained automatically:

```sh
npx node-winrt generate Microsoft.UI.Xaml Microsoft.UI.Xaml.Controls \
  --winapp \
  --only Microsoft.UI.Xaml:Application,Window,UIElement,FrameworkElement \
  --only Microsoft.UI.Xaml.Controls:Button,TextBlock,Slider \
  --out src/winrt
```

## Generated TypeScript mappings

| WinRT construct                                       | Generated TypeScript                                                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enum`                                                | Frozen const object + union type (`export const Foo = Object.freeze(...); export type Foo = ...`)                                                                                                  |
| `struct`                                              | `node-ctypes` `Structure` subclass + `FooFields` plain-object interface                                                                                                                            |
| `interface`                                           | `COMInterface` declaration extending `IInspectable` with exact WinRT ABI `STDMETHOD`s                                                                                                              |
| `runtimeclass`                                        | `WinRTObject` subclass with `new MyClass()` / `create()`, static factories, static/instance getters/setters/methods, inherited base-class interfaces, and typed `on<Event>((sender, args) => ...)` |
| `[Composable(IFactory, Public)]`                      | Direct ES6 subclassing (`class MyApp extends Application { override onLaunched() { ... } }`), `new MyClass()`, plus static `create(...)` and `createComposed(outer, ...)`                          |
| `IAsyncAction` / `IAsyncOperation<T>` / `*Progress`   | `Promise<void>` / `Promise<T>` via free-threaded `CompletedHandler`                                                                                                                                |
| `IReference<T>`                                       | `T \| null`                                                                                                                                                                                        |
| `IVectorView<T>` / `IIterable<T>`                     | `T[]`                                                                                                                                                                                              |
| `IVector<T>`                                          | Mutable `WinRTVector<T, TIn> \| null`                                                                                                                                                              |
| `IMapView<K, V>` / `IMap<K, V>`                       | `Map<K, V>`                                                                                                                                                                                        |
| `byte[]` (`PassArray` / `FillArray` / `ReceiveArray`) | `Uint8Array` input / `Buffer` output (with automatic `CoTaskMemFree`)                                                                                                                              |
| Polymorphic interface / base-class arguments          | Automatic `queryWinRTArgPointer` (`QueryInterface` when IIDs differ, fast-pathed when equal)                                                                                                       |
| Casting (`as` / `tryAs`)                              | `element.as(Button)` / `element.tryAs(Button)` (zero-throw `tryQueryInterface`)                                                                                                                    |
