export * as ctypes from "node-ctypes";
export * as comtypes from "@node-ctypes/comtypes";

export {
  activateInstance,
  AsyncStatus,
  coTaskMemFree,
  createHString,
  deleteHString,
  EventRegistrationToken,
  getActivationFactory,
  getActivationFactoryFromDll,
  getRuntimeClassName,
  IActivationFactory,
  IAgileObject,
  IAsyncAction,
  IAsyncActionCompletedHandler,
  IAsyncActionWithProgressRaw,
  IAsyncInfo,
  IAsyncOperationRaw,
  IAsyncOperationWithProgressRaw,
  IClosable,
  IInspectable,
  IIterableRaw,
  IIteratorRaw,
  IKeyValuePairRaw,
  IReferenceRaw,
  IVectorViewRaw,
  readAndDeleteHString,
  readHString,
  registerActivationDll,
  RO_INIT_MULTITHREADED,
  RO_INIT_SINGLETHREADED,
  roInitialize,
  tryClose,
  unregisterActivationDll,
  withHString,
} from "./runtime/native.ts";
export type { AsyncStatusValue, EventRegistrationTokenFields } from "./runtime/native.ts";

export {
  awaitWinRTAction,
  awaitWinRTActionWithProgress,
  awaitWinRTAsync,
  awaitWinRTAsyncWithProgress,
  createDelegateHandler,
  createTypedEventHandler,
  readIterable,
  readMapView,
  readReference,
  readVectorView,
  takeCoTaskMemBytes,
  WinRTVector,
  wrapVector,
} from "./runtime/async.ts";
export type { AwaitAsyncOptions } from "./runtime/async.ts";

export { composeWinRTClass, createWinRTAggregate } from "./runtime/aggregate.ts";
export type { ComposableWinRTClass, ComposedWinRTInstance, WinRTAggregate, WinRTAggregateOptions, WinRTDelegateSpec, WinRTOverrideSpec } from "./runtime/aggregate.ts";

export {
  bootstrapWindowsAppRuntime,
  enablePerMonitorDpiAwareness,
  getWindowDpiScale,
  initializeWindowsAppSdk,
  packPackageVersion,
  pumpWin32Messages,
  shutdownWindowsAppSdk,
  startWin32MessageLoop,
  waitAndPumpWin32Messages,
  windowsAppSdk,
  WindowsAppSdkOptions,
} from "./runtime/bootstrap.ts";
export type { WindowsAppRuntimeBootstrapOptions, WindowsAppRuntimeHandle, WindowsAppSdkInitOptions } from "./runtime/bootstrap.ts";
export { queryWinRTArgPointer, unwrapWinRTPointer, WinRTObject } from "./runtime/object.ts";
export type { MarshalledWinRTPointer } from "./runtime/object.ts";

export {
  asyncActionWithProgressCompletedHandlerPiid,
  asyncOperationCompletedHandlerPiid,
  asyncOperationPiid,
  asyncOperationWithProgressCompletedHandlerPiid,
  asyncOperationWithProgressPiid,
  computePiid,
  delegateSignature,
  enumSignature,
  eventHandlerPiid,
  iterablePiid,
  keyValuePairSignature,
  mapIterablePiid,
  normalizeGuidLower,
  normalizeGuidUpper,
  pinterfaceSignature,
  runtimeClassSignature,
  structSignature,
  typedEventHandlerPiid,
  vectorViewPiid,
  WINRT_GENERIC_GUIDS,
} from "./runtime/piid.ts";

export { defaultWinMdPaths, Ecma335File, WinMdStore } from "./metadata/index.ts";
export type { WinRTClassDef, WinRTDelegateDef, WinRTEnumDef, WinRTInterfaceDef, WinRTMethod, WinRTParam, WinRTStructDef, WinRTStructField, WinRTTypeDef, WinRTTypeRef } from "./metadata/index.ts";

export { generateNamespaceModule, writeNamespaceModules } from "./codegen/generate.ts";
export type { GenerateOptions } from "./codegen/generate.ts";
