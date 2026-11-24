---
title: Guides
children:
  - ./getting-started.md
  - ./codegen-and-winmd.md
  - ./async-events-and-collections.md
  - ./winui3-and-app-sdk.md
  - ./contributing.md
---

# Guides

- [Getting started](getting-started.md) — installation, requirements, CLI quick start and entry points
- [Code generation and WinMD metadata](codegen-and-winmd.md) — ECMA-335 `.winmd` reader, PIID computation, tree-shaking (`--only`), `--winapp`, `--js` emit and type mappings
- [Async, events and collections](async-events-and-collections.md) — event-driven WinRT `Promise`s, `on<Event>()` delegates, `WinRTVector`, `IVectorView`, `IMapView`, `IReference` and byte arrays
- [WinUI 3 and Windows App SDK](winui3-and-app-sdk.md) — `bootstrapWindowsAppRuntime()` (zero `Bootstrap.dll`), DPI awareness, Win32 message loop, COM aggregation (`composeWinRTClass`) and registration-free DLLs
- [Building, testing and internals](contributing.md) — scripts, mirror-mode testing, demo regeneration, CI and release workflow

The [examples](../examples/README.md) are runnable WinRT and WinUI 3 applications built on these APIs.
