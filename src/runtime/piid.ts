import { createHash } from "node:crypto";

/**
 * Fixed WinRT namespace UUID for parameterized interface IIDs (PIIDs):
 * `{11f47ad5-7b73-42c0-abae-878b1e16adee}` in RFC 4122 big-endian wire format.
 * Reference: https://learn.microsoft.com/uwp/winrt-cref/winrt-type-system#parameterized-types
 */
const WINRT_PIID_NAMESPACE = Buffer.from("11f47ad57b7342c0abae878b1e16adee", "hex");

/** Well-known WinRT generic template GUIDs (lowercase, braced). */
export const WINRT_GENERIC_GUIDS = Object.freeze({
  IAsyncOperation: "{9fc2b0bb-e446-44e2-aa61-9cab8f636af2}",
  IAsyncOperationCompletedHandler: "{fcdcf02c-e5d8-4478-915a-4d90b74b83a5}",
  IAsyncOperationWithProgress: "{b5d036d7-e297-498f-ba60-0289e76e23dd}",
  IAsyncOperationWithProgressCompletedHandler: "{e85df41d-6aa7-46e3-a8e2-f009d840c627}",
  IAsyncActionWithProgress: "{1f6db258-e803-48a1-9546-eb7353398884}",
  IAsyncActionWithProgressCompletedHandler: "{9c029f91-cc84-44fd-ac26-0a6c4e555281}",
  IVectorView: "{bbe1fa4c-b0e3-4583-baef-1f1b2e483e56}",
  IVector: "{913337e9-11a1-4345-a3a2-4e7f956e222d}",
  IIterable: "{faa585ea-6214-4217-afda-7f46de5869b3}",
  IIterator: "{6a79e863-4300-459a-9966-cbb660963ee1}",
  IMapView: "{e480ce40-a338-4ada-adcf-272272e48cb9}",
  IMap: "{3c2925fe-8519-45c1-aa79-197b6718c1c1}",
  IKeyValuePair: "{02b51929-c1c4-4a7e-8940-0312b5c18500}",
  IReference: "{61c17706-2d65-11e0-9ae8-d48564015472}",
  TypedEventHandler: "{9de1c534-6ae1-11e0-84e1-18a905bcc53f}",
  EventHandler: "{9de1c535-6ae1-11e0-84e1-18a905bcc53f}",
} as const);

/** Normalize a GUID string into lowercase braced format `{xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}`. */
export function normalizeGuidLower(guid: string): string {
  const clean = guid
    .trim()
    .replace(/^\{|\}$/g, "")
    .toLowerCase();
  return `{${clean}}`;
}

/** Normalize a GUID string into uppercase braced format `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`. */
export function normalizeGuidUpper(guid: string): string {
  return normalizeGuidLower(guid).toUpperCase();
}

const piidCache = new Map<string, string>();

/**
 * Compute the deterministic WinRT Parameterized Interface IID (PIID) using
 * UUIDv5 (SHA-1) over `signature` under the WinRT namespace UUID.
 *
 * Example:
 * ```ts
 * computePiid("pinterface({9fc2b0bb-e446-44e2-aa61-9cab8f636af2};rc(Windows.Media.Ocr.OcrResult;{9bd235b2-175b-3d6a-92e2-388c206e2f63}))")
 * // => "{C7D7118E-AE36-59C0-AC76-7BADEF711666}"
 * ```
 */
export function computePiid(signature: string): string {
  const cached = piidCache.get(signature);
  if (cached !== undefined) return cached;
  const hash = createHash("sha1").update(WINRT_PIID_NAMESPACE).update(signature, "utf8").digest();
  // RFC 4122 version 5 (SHA-1) and variant 1 (10xx).
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex").toUpperCase();
  const piid = `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`;
  piidCache.set(signature, piid);
  return piid;
}

/** Build a `pinterface({guid};arg1;arg2;...)` WinRT type signature. */
export function pinterfaceSignature(templateGuid: string, typeArgSignatures: readonly string[]): string {
  return `pinterface(${normalizeGuidLower(templateGuid)};${typeArgSignatures.join(";")})`;
}

/** Build a `rc(Full.Name;defaultInterfaceSig)` WinRT type signature for a runtime class. */
export function runtimeClassSignature(fullName: string, defaultInterfaceSig: string): string {
  return `rc(${fullName};${defaultInterfaceSig})`;
}

/** Build a `struct(Full.Name;field1;field2;...)` WinRT type signature. */
export function structSignature(fullName: string, fieldSignatures: readonly string[]): string {
  return `struct(${fullName};${fieldSignatures.join(";")})`;
}

/** Build an `enum(Full.Name;i4|u4)` WinRT type signature. */
export function enumSignature(fullName: string, signed: boolean): string {
  return `enum(${fullName};${signed ? "i4" : "u4"})`;
}

/** Build a `delegate({guid})` WinRT type signature for a non-generic delegate. */
export function delegateSignature(guid: string): string {
  return `delegate(${normalizeGuidLower(guid)})`;
}

/** Compute the PIID of `IAsyncOperation<T>` given T's WinRT signature. */
export function asyncOperationPiid(resultSignature: string): string {
  return computePiid(pinterfaceSignature(WINRT_GENERIC_GUIDS.IAsyncOperation, [resultSignature]));
}

/** Compute the PIID of `IAsyncOperationCompletedHandler<T>` given T's WinRT signature. */
export function asyncOperationCompletedHandlerPiid(resultSignature: string): string {
  return computePiid(pinterfaceSignature(WINRT_GENERIC_GUIDS.IAsyncOperationCompletedHandler, [resultSignature]));
}

/** Compute the PIID of `IVectorView<T>` given T's WinRT signature. */
export function vectorViewPiid(elementSignature: string): string {
  return computePiid(pinterfaceSignature(WINRT_GENERIC_GUIDS.IVectorView, [elementSignature]));
}

/** Compute the PIID of `TypedEventHandler<TSender, TArgs>`. */
export function typedEventHandlerPiid(senderSignature: string, argsSignature: string): string {
  return computePiid(pinterfaceSignature(WINRT_GENERIC_GUIDS.TypedEventHandler, [senderSignature, argsSignature]));
}

/** Compute the PIID of `EventHandler<T>`. */
export function eventHandlerPiid(argsSignature: string): string {
  return computePiid(pinterfaceSignature(WINRT_GENERIC_GUIDS.EventHandler, [argsSignature]));
}

/** Compute the PIID of `IAsyncOperationWithProgress<TResult, TProgress>`. */
export function asyncOperationWithProgressPiid(resultSignature: string, progressSignature: string): string {
  return computePiid(pinterfaceSignature(WINRT_GENERIC_GUIDS.IAsyncOperationWithProgress, [resultSignature, progressSignature]));
}

/** Compute the PIID of `IAsyncOperationWithProgressCompletedHandler<TResult, TProgress>`. */
export function asyncOperationWithProgressCompletedHandlerPiid(resultSignature: string, progressSignature: string): string {
  return computePiid(pinterfaceSignature(WINRT_GENERIC_GUIDS.IAsyncOperationWithProgressCompletedHandler, [resultSignature, progressSignature]));
}

/** Compute the PIID of `IAsyncActionWithProgressCompletedHandler<TProgress>`. */
export function asyncActionWithProgressCompletedHandlerPiid(progressSignature: string): string {
  return computePiid(pinterfaceSignature(WINRT_GENERIC_GUIDS.IAsyncActionWithProgressCompletedHandler, [progressSignature]));
}

/** Compute the PIID of `IIterable<T>`. */
export function iterablePiid(elementSignature: string): string {
  return computePiid(pinterfaceSignature(WINRT_GENERIC_GUIDS.IIterable, [elementSignature]));
}

/** Compute the WinRT type signature of `IKeyValuePair<K, V>`. */
export function keyValuePairSignature(keySignature: string, valueSignature: string): string {
  return pinterfaceSignature(WINRT_GENERIC_GUIDS.IKeyValuePair, [keySignature, valueSignature]);
}

/** Compute the PIID of `IIterable<IKeyValuePair<K, V>>` (used to iterate `IMapView<K, V>` / `IMap<K, V>`). */
export function mapIterablePiid(keySignature: string, valueSignature: string): string {
  return computePiid(pinterfaceSignature(WINRT_GENERIC_GUIDS.IIterable, [keyValuePairSignature(keySignature, valueSignature)]));
}
