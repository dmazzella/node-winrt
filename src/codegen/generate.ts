import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WinMdStore, WinRTClassDef, WinRTEnumDef, WinRTInterfaceDef, WinRTMethod, WinRTParam, WinRTStructDef, WinRTTypeRef } from "../metadata/winmd.ts";
import { asyncActionWithProgressCompletedHandlerPiid, asyncOperationCompletedHandlerPiid, asyncOperationWithProgressCompletedHandlerPiid, eventHandlerPiid, mapIterablePiid, typedEventHandlerPiid } from "../runtime/piid.ts";

export interface GenerateOptions {
  /** Import specifier for `@node-ctypes/winrt` (default `"@node-ctypes/winrt"`). */
  readonly importFrom?: string;
  /** Set of sibling namespaces being generated in the same directory, for cross-file imports. */
  readonly siblingNamespaces?: ReadonlySet<string>;
  /**
   * Optional per-namespace allowlist of class/interface names to emit (tree-shaking
   * large namespaces like `Microsoft.UI.Xaml.Controls`). All interfaces required by
   * the selected classes are retained automatically.
   */
  readonly includeTypes?: Readonly<Record<string, readonly string[]>>;
}

const JS_RESERVED = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "arguments",
  "eval",
]);

function safeIdent(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_$]/g, "_");
  if (!clean) return "_arg";
  const prefixed = /^\d/.test(clean) ? `_${clean}` : clean;
  return JS_RESERVED.has(prefixed) ? `${prefixed}_` : prefixed;
}

function toCamelCase(name: string): string {
  if (!name) return name;
  // Preserve leading acronyms nicely: "GUID" -> "guid", "PixelWidth" -> "pixelWidth", "DpiX" -> "dpiX".
  let i = 0;
  while (i < name.length && name[i] >= "A" && name[i] <= "Z") i++;
  if (i === 0) return safeIdent(name);
  if (i === 1 || i === name.length) return safeIdent(name.slice(0, i).toLowerCase() + name.slice(i));
  return safeIdent(name.slice(0, i - 1).toLowerCase() + name.slice(i - 1));
}

function stripArity(name: string): string {
  const tick = name.indexOf("`");
  return tick >= 0 ? name.slice(0, tick) : name;
}

function shortNameOf(fullName: string): string {
  const dot = fullName.lastIndexOf(".");
  return stripArity(dot >= 0 ? fullName.slice(dot + 1) : fullName);
}

function namespaceOf(fullName: string): string {
  const dot = fullName.lastIndexOf(".");
  return dot >= 0 ? fullName.slice(0, dot) : "";
}

/** Map a WinRT primitive to its `node-ctypes` type expression. */
function primitiveCType(name: string): string {
  switch (name) {
    case "Boolean":
      return "winrt$.ctypes.c_uint8";
    case "Int8":
      return "winrt$.ctypes.c_int8";
    case "UInt8":
      return "winrt$.ctypes.c_uint8";
    case "Int16":
      return "winrt$.ctypes.c_int16";
    case "UInt16":
    case "Char":
      return "winrt$.ctypes.c_uint16";
    case "Int32":
      return "winrt$.ctypes.c_int32";
    case "UInt32":
      return "winrt$.ctypes.c_uint32";
    case "Int64":
      return "winrt$.ctypes.c_int64";
    case "UInt64":
      return "winrt$.ctypes.c_uint64";
    case "Single":
      return "winrt$.ctypes.c_float";
    case "Double":
      return "winrt$.ctypes.c_double";
    case "IntPtr":
    case "UIntPtr":
    case "String":
    case "Object":
      return "winrt$.ctypes.c_void_p";
    case "Guid":
      return "winrt$.comtypes.GUID";
    default:
      return "winrt$.ctypes.c_void_p";
  }
}

function primitiveTsType(name: string): string {
  switch (name) {
    case "Boolean":
      return "boolean";
    case "String":
      return "string";
    case "Int64":
    case "UInt64":
    case "IntPtr":
    case "UIntPtr":
      return "bigint";
    case "Guid":
      return "winrt$.comtypes.GUIDLike";
    case "Object":
      return "winrt$.WinRTObject | winrt$.comtypes.COMPointer | bigint | null";
    default:
      return "number";
  }
}

function primitiveReturnTsType(name: string): string {
  switch (name) {
    case "Boolean":
      return "boolean";
    case "String":
      return "string";
    case "Int64":
    case "UInt64":
    case "IntPtr":
    case "UIntPtr":
      return "bigint";
    case "Guid":
      return "winrt$.comtypes.GUID";
    case "Object":
      return "winrt$.WinRTObject | null";
    default:
      return "number";
  }
}

interface GenerationContext {
  readonly store: WinMdStore;
  readonly targetNamespace: string;
  readonly siblingNamespaces: ReadonlySet<string>;
  readonly siblingEmittedClasses: ReadonlyMap<string, ReadonlySet<string>>;
  readonly siblingEmittedInterfaces: ReadonlyMap<string, ReadonlySet<string>>;
  /** Local struct/enum names inlined because they come from external namespaces not in `siblingNamespaces`. */
  readonly inlinedStructs: Map<string, WinRTStructDef>;
  readonly inlinedEnums: Map<string, WinRTEnumDef>;
  /** Cross-namespace imports from sibling files: `namespace -> alias`. */
  readonly siblingImports: Map<string, string>;
  /** All local class names defined in this file (for return wrapping). */
  readonly localClasses: ReadonlySet<string>;
  readonly localStructs: ReadonlySet<string>;
  readonly localEnums: ReadonlySet<string>;
  readonly localInterfaces: ReadonlySet<string>;
}

function aliasForNamespace(ns: string): string {
  return `ns_${ns.replace(/\./g, "_")}$`;
}

function ensureStructAvailable(ctx: GenerationContext, fullName: string): string {
  const ns = namespaceOf(fullName);
  const short = shortNameOf(fullName);
  if (ns === ctx.targetNamespace && ctx.localStructs.has(short)) return short;
  if (fullName === "Windows.Foundation.EventRegistrationToken") return "winrt$.EventRegistrationToken";
  const def = ctx.store.getType(fullName);
  if (def && def.kind === "struct") {
    // Always inline cross-namespace structs locally so `COMInterface` definitions
    // never depend on sibling-module top-level exports during circular ESM evaluation.
    if (!ctx.inlinedStructs.has(fullName)) {
      for (const f of def.fields) {
        if (f.type.kind === "named") {
          const fDef = ctx.store.getType(f.type.fullName);
          if (fDef?.kind === "struct") ensureStructAvailable(ctx, fDef.fullName);
          else if (fDef?.kind === "enum") ensureEnumAvailable(ctx, fDef.fullName);
        }
      }
      ctx.inlinedStructs.set(fullName, def);
    }
    return `${fullName.replace(/\./g, "_")}$`;
  }
  return "winrt$.ctypes.c_void_p";
}

function ensureEnumAvailable(ctx: GenerationContext, fullName: string): { readonly ref: string; readonly underlying: "Int32" | "UInt32" } {
  const def = ctx.store.getType(fullName);
  const underlying = def && def.kind === "enum" ? def.underlying : "Int32";
  const ns = namespaceOf(fullName);
  const short = shortNameOf(fullName);
  if (ns === ctx.targetNamespace && ctx.localEnums.has(short)) return { ref: short, underlying };
  if (ctx.siblingNamespaces.has(ns)) {
    let alias = ctx.siblingImports.get(ns);
    if (!alias) {
      alias = aliasForNamespace(ns);
      ctx.siblingImports.set(ns, alias);
    }
    return { ref: `${alias}.${short}`, underlying };
  }
  if (def && def.kind === "enum") {
    if (!ctx.inlinedEnums.has(fullName)) ctx.inlinedEnums.set(fullName, def);
    return { ref: `${fullName.replace(/\./g, "_")}$`, underlying };
  }
  return { ref: "number", underlying };
}

function classRefExpr(ctx: GenerationContext, fullName: string): string | null {
  const ns = namespaceOf(fullName);
  const short = shortNameOf(fullName);
  if (ns === ctx.targetNamespace) return ctx.localClasses.has(short) ? short : null;
  if (ctx.siblingNamespaces.has(ns)) {
    const allowed = ctx.siblingEmittedClasses.get(ns);
    if (allowed && !allowed.has(short)) return null;
    const def = ctx.store.getType(fullName);
    if (def && def.kind === "class") {
      let alias = ctx.siblingImports.get(ns);
      if (!alias) {
        alias = aliasForNamespace(ns);
        ctx.siblingImports.set(ns, alias);
      }
      return `${alias}.${short}`;
    }
  }
  return null;
}

/** Return the `node-ctypes` FFI type expression for a WinRT value passed by value in an ABI slot. */
function abiCTypeFor(ctx: GenerationContext, type: WinRTTypeRef): string {
  switch (type.kind) {
    case "primitive":
      return primitiveCType(type.name);
    case "named": {
      const def = ctx.store.getType(type.fullName);
      if (!def) return "winrt$.ctypes.c_void_p";
      if (def.kind === "enum") return def.underlying === "UInt32" ? "winrt$.ctypes.c_uint32" : "winrt$.ctypes.c_int32";
      if (def.kind === "struct") return ensureStructAvailable(ctx, def.fullName);
      return "winrt$.ctypes.c_void_p";
    }
    default:
      return "winrt$.ctypes.c_void_p";
  }
}

/** Return the list of `STDMETHOD` argtypes for a WinRT interface method (exact WinRT ABI). */
function abiMethodArgTypes(ctx: GenerationContext, method: WinRTMethod): string[] {
  const args: string[] = [];
  for (const p of method.params) {
    if (p.isArray) {
      if (p.isOut) {
        args.push("winrt$.ctypes.c_void_p", "winrt$.ctypes.c_void_p");
      } else {
        args.push("winrt$.ctypes.c_uint32", "winrt$.ctypes.c_void_p");
      }
    } else if (p.isOut || p.isByRef) {
      args.push("winrt$.ctypes.c_void_p");
    } else {
      args.push(abiCTypeFor(ctx, p.type));
    }
  }
  if (method.returnType.kind !== "void") {
    if (method.returnType.kind === "array") {
      args.push("winrt$.ctypes.c_void_p", "winrt$.ctypes.c_void_p");
    } else {
      args.push("winrt$.ctypes.c_void_p");
    }
  }
  return args;
}

function isByteArrayType(type: WinRTTypeRef): boolean {
  return type.kind === "array" && type.element.kind === "primitive" && type.element.name === "UInt8";
}

function isReceiveByteArrayParam(p: WinRTParam): boolean {
  return p.isOut && p.isByRef && p.isArray && isByteArrayType(p.type);
}

function isPassOrFillByteArrayParam(p: WinRTParam): boolean {
  return !p.isByRef && p.isArray && isByteArrayType(p.type);
}

/** Whether `method` uses WinRT's `void Foo(..., out ref byte[] value)` receive-array pattern. */
function getTrailingReceiveByteArrayParam(method: WinRTMethod): WinRTParam | null {
  if (method.returnType.kind !== "void" || method.params.length === 0) return null;
  const last = method.params[method.params.length - 1];
  return isReceiveByteArrayParam(last) ? last : null;
}

/** Whether a method's parameters + return type are supported by the high-level wrapper generator. */
function isWrappableMethod(ctx: GenerationContext, method: WinRTMethod): boolean {
  const receiveParam = getTrailingReceiveByteArrayParam(method);
  const effectiveParams = receiveParam ? method.params.slice(0, -1) : method.params;

  for (const p of effectiveParams) {
    if (isPassOrFillByteArrayParam(p)) continue;
    if (p.isArray || p.isOut || p.isByRef) return false;
    if (p.type.kind === "genericParam") return false;
  }

  if (method.returnType.kind === "genericParam") return false;
  if (method.returnType.kind === "array") {
    return isByteArrayType(method.returnType);
  }
  if (method.returnType.kind === "genericInst") {
    const fn = method.returnType.fullName;
    if (fn === "Windows.Foundation.IAsyncOperation`1") {
      const inner = method.returnType.args[0];
      if (!inner || inner.kind === "array" || inner.kind === "genericParam") return false;
      try {
        ctx.store.typeSignature(inner);
      } catch {
        return false;
      }
      return true;
    }
    if (fn === "Windows.Foundation.IAsyncOperationWithProgress`2") {
      const [res, prog] = method.returnType.args;
      if (!res || !prog || res.kind === "array" || res.kind === "genericParam" || prog.kind === "genericParam") return false;
      try {
        ctx.store.typeSignature(res);
        ctx.store.typeSignature(prog);
      } catch {
        return false;
      }
      return true;
    }
    if (fn === "Windows.Foundation.IAsyncActionWithProgress`1") {
      const [prog] = method.returnType.args;
      if (!prog || prog.kind === "genericParam") return false;
      try {
        ctx.store.typeSignature(prog);
      } catch {
        return false;
      }
      return true;
    }
    if (fn === "Windows.Foundation.IReference`1") {
      const inner = method.returnType.args[0];
      return Boolean(inner && inner.kind !== "array" && inner.kind !== "genericParam" && inner.kind !== "genericInst");
    }
    if (fn === "Windows.Foundation.Collections.IVectorView`1" || fn === "Windows.Foundation.Collections.IVector`1" || fn === "Windows.Foundation.Collections.IIterable`1") {
      const inner = method.returnType.args[0];
      return Boolean(inner && inner.kind !== "array" && inner.kind !== "genericParam" && inner.kind !== "genericInst");
    }
    if (fn === "Windows.Foundation.Collections.IMapView`2" || fn === "Windows.Foundation.Collections.IMap`2") {
      const [k, v] = method.returnType.args;
      if (!k || !v || k.kind === "array" || k.kind === "genericParam" || k.kind === "genericInst" || v.kind === "array" || v.kind === "genericParam" || v.kind === "genericInst") return false;
      try {
        ctx.store.typeSignature(k);
        ctx.store.typeSignature(v);
      } catch {
        return false;
      }
      return true;
    }
    return true;
  }
  return true;
}

function tsParamType(ctx: GenerationContext, type: WinRTTypeRef): string {
  if (isByteArrayType(type)) return "Uint8Array";
  switch (type.kind) {
    case "primitive":
      return primitiveTsType(type.name);
    case "named": {
      const def = ctx.store.getType(type.fullName);
      if (!def) return "winrt$.WinRTObject | winrt$.comtypes.COMPointer | bigint | null";
      if (def.kind === "enum") return ensureEnumAvailable(ctx, def.fullName).ref;
      if (def.kind === "struct") {
        const sRef = ensureStructAvailable(ctx, def.fullName);
        return `${sRef} | Partial<${sRef}Fields>`;
      }
      if (def.kind === "delegate" && def.guid && def.invoke) {
        const n = def.invoke.params.length;
        if (n === 0) return `(() => void) | winrt$.WinRTObject | winrt$.comtypes.COMPointer | bigint | null`;
        if (n === 1) return `((argAddr: bigint) => void) | winrt$.WinRTObject | winrt$.comtypes.COMPointer | bigint | null`;
        if (n === 2) return `((senderAddr: bigint, argsAddr: bigint) => void) | winrt$.WinRTObject | winrt$.comtypes.COMPointer | bigint | null`;
      }
      const cRef = classRefExpr(ctx, def.fullName);
      if (cRef) return `${cRef} | winrt$.WinRTObject | winrt$.comtypes.COMPointer | bigint | null`;
      return "winrt$.WinRTObject | winrt$.comtypes.COMPointer | bigint | null";
    }
    default:
      return "winrt$.WinRTObject | winrt$.comtypes.COMPointer | bigint | null";
  }
}

function tsReturnType(ctx: GenerationContext, type: WinRTTypeRef): string {
  if (isByteArrayType(type)) return "NodeBuffer$";
  switch (type.kind) {
    case "void":
      return "void";
    case "primitive":
      return primitiveReturnTsType(type.name);
    case "named": {
      if (type.fullName === "Windows.Foundation.IAsyncAction") return "Promise<void>";
      const def = ctx.store.getType(type.fullName);
      if (!def) return "winrt$.WinRTObject | null";
      if (def.kind === "enum") return ensureEnumAvailable(ctx, def.fullName).ref;
      if (def.kind === "struct") return ensureStructAvailable(ctx, def.fullName);
      const cRef = classRefExpr(ctx, def.fullName);
      if (cRef) return `${cRef} | null`;
      return "winrt$.WinRTObject | null";
    }
    case "genericInst": {
      if (type.fullName === "Windows.Foundation.IAsyncOperation`1" || type.fullName === "Windows.Foundation.IAsyncOperationWithProgress`2") {
        return `Promise<${tsReturnType(ctx, type.args[0])}>`;
      }
      if (type.fullName === "Windows.Foundation.IAsyncActionWithProgress`1") {
        return "Promise<void>";
      }
      if (type.fullName === "Windows.Foundation.IReference`1") {
        const inner = tsReturnType(ctx, type.args[0]);
        return inner.endsWith(" | null") ? inner : `${inner} | null`;
      }
      if (type.fullName === "Windows.Foundation.Collections.IVectorView`1" || type.fullName === "Windows.Foundation.Collections.IIterable`1") {
        const elem = tsReturnType(ctx, type.args[0]).replace(/ \| null$/, "");
        return `${elem}[]`;
      }
      if (type.fullName === "Windows.Foundation.Collections.IVector`1") {
        const elemOut = tsReturnType(ctx, type.args[0]).replace(/ \| null$/, "");
        const elemIn = tsParamType(ctx, type.args[0]);
        return `winrt$.WinRTVector<${elemOut}, ${elemIn}> | null`;
      }
      if (type.fullName === "Windows.Foundation.Collections.IMapView`2" || type.fullName === "Windows.Foundation.Collections.IMap`2") {
        const k = tsReturnType(ctx, type.args[0]).replace(/ \| null$/, "");
        const v = tsReturnType(ctx, type.args[1]);
        return `Map<${k}, ${v}>`;
      }
      return "winrt$.WinRTObject | null";
    }
    default:
      return "winrt$.WinRTObject | null";
  }
}

interface MarshalledArg {
  readonly setup: readonly string[];
  readonly exprs: readonly string[];
  readonly cleanup: readonly string[];
}

function marshalArg(ctx: GenerationContext, param: WinRTParam, argVar: string): MarshalledArg {
  const type = param.type;
  if (isPassOrFillByteArrayParam(param)) {
    const bVar = `b_${argVar}$`;
    return {
      setup: [`const ${bVar} = NodeBuffer$.isBuffer(${argVar}) ? ${argVar} : NodeBuffer$.from(${argVar}.buffer, ${argVar}.byteOffset, ${argVar}.byteLength);`],
      exprs: [`${bVar}.length`, bVar],
      cleanup: [],
    };
  }
  if (type.kind === "primitive") {
    switch (type.name) {
      case "Boolean":
        return { setup: [], exprs: [`${argVar} ? 1 : 0`], cleanup: [] };
      case "String": {
        const hVar = `h_${argVar}$`;
        return {
          setup: [`const ${hVar} = winrt$.createHString(${argVar});`],
          exprs: [hVar],
          cleanup: [`winrt$.deleteHString(${hVar});`],
        };
      }
      case "Guid":
        return { setup: [], exprs: [`winrt$.comtypes.toGUID(${argVar})`], cleanup: [] };
      case "Object":
        return { setup: [], exprs: [`winrt$.unwrapWinRTPointer(${argVar})`], cleanup: [] };
      default:
        return { setup: [], exprs: [argVar], cleanup: [] };
    }
  }
  if (type.kind === "named") {
    const def = ctx.store.getType(type.fullName);
    if (def?.kind === "enum") return { setup: [], exprs: [argVar], cleanup: [] };
    if (def?.kind === "struct") {
      const sRef = ensureStructAvailable(ctx, def.fullName);
      const sVar = `s_${argVar}$`;
      return {
        setup: [`const ${sVar} = ${argVar} instanceof ${sRef} ? ${argVar} : ${argVar} instanceof winrt$.ctypes.Structure ? ${sRef}.from_buffer_copy(${argVar}._buffer) : new ${sRef}(${argVar});`],
        exprs: [sVar],
        cleanup: [],
      };
    }
    if (def?.kind === "delegate" && def.guid && def.invoke) {
      const arity = def.invoke.params.length;
      if (arity === 0 || arity === 1 || arity === 2) {
        const dVar = `d_${argVar}$`;
        return {
          setup: [`const ${dVar} = typeof ${argVar} === "function" ? winrt$.createDelegateHandler(${JSON.stringify(def.guid)}, ${arity}, ${argVar} as (...args: bigint[]) => void) : null;`],
          exprs: [`${dVar} ? ${dVar}.address : winrt$.unwrapWinRTPointer(${argVar} as winrt$.WinRTObject | winrt$.comtypes.COMPointer | bigint | null)`],
          cleanup: [`if (${dVar} && !${dVar}.released) ${dVar}.Release();`],
        };
      }
    }
    let expectedIid: string | null = null;
    if (def?.kind === "interface" && def.guid) {
      expectedIid = def.guid;
    } else if (def?.kind === "class" && def.defaultInterface) {
      expectedIid = ctx.store.interfaceIid(def.defaultInterface);
    }
    if (expectedIid) {
      const qVar = `q_${argVar}$`;
      return {
        setup: [`const ${qVar} = winrt$.queryWinRTArgPointer(${argVar}, ${JSON.stringify(expectedIid)});`],
        exprs: [`${qVar}.ptr`],
        cleanup: [`${qVar}.owned?.Release();`],
      };
    }
  }
  return { setup: [], exprs: [`winrt$.unwrapWinRTPointer(${argVar})`], cleanup: [] };
}

interface OutAllocation {
  readonly allocLines: readonly string[];
  readonly outArgExpr: string;
  readonly readExpr: string;
}

function allocateOutValue(ctx: GenerationContext, type: WinRTTypeRef, prefix = "out$"): OutAllocation {
  if (type.kind === "primitive") {
    switch (type.name) {
      case "Boolean":
        return { allocLines: [`const ${prefix} = new winrt$.ctypes.c_uint8(0);`], outArgExpr: `winrt$.ctypes.byref(${prefix})`, readExpr: `Boolean(${prefix}.value)` };
      case "String":
        return { allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`], outArgExpr: `winrt$.ctypes.byref(${prefix})`, readExpr: `winrt$.readAndDeleteHString(BigInt(${prefix}.value ?? 0n))` };
      case "Int64":
      case "UInt64":
      case "IntPtr":
      case "UIntPtr": {
        const cType = primitiveCType(type.name);
        return { allocLines: [`const ${prefix} = new ${cType}(0n);`], outArgExpr: `winrt$.ctypes.byref(${prefix})`, readExpr: `BigInt(${prefix}.value)` };
      }
      case "Guid":
        return { allocLines: [`const ${prefix} = new winrt$.comtypes.GUID();`], outArgExpr: `${prefix}._buffer`, readExpr: prefix };
      case "Object":
        return {
          allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
          outArgExpr: `winrt$.ctypes.byref(${prefix})`,
          readExpr: `${prefix}.value ? winrt$.WinRTObject.fromAddress(BigInt(${prefix}.value)) : null`,
        };
      default: {
        const cType = primitiveCType(type.name);
        return { allocLines: [`const ${prefix} = new ${cType}(0);`], outArgExpr: `winrt$.ctypes.byref(${prefix})`, readExpr: `Number(${prefix}.value)` };
      }
    }
  }

  if (type.kind === "named") {
    if (type.fullName === "Windows.Foundation.IAsyncAction") {
      return {
        allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
        outArgExpr: `winrt$.ctypes.byref(${prefix})`,
        readExpr: `winrt$.awaitWinRTAction(BigInt(${prefix}.value ?? 0n))`,
      };
    }
    const def = ctx.store.getType(type.fullName);
    if (def?.kind === "enum") {
      const cType = def.underlying === "UInt32" ? "winrt$.ctypes.c_uint32" : "winrt$.ctypes.c_int32";
      const eRef = ensureEnumAvailable(ctx, def.fullName).ref;
      return { allocLines: [`const ${prefix} = new ${cType}(0);`], outArgExpr: `winrt$.ctypes.byref(${prefix})`, readExpr: `Number(${prefix}.value) as ${eRef}` };
    }
    if (def?.kind === "struct") {
      const sRef = ensureStructAvailable(ctx, def.fullName);
      return { allocLines: [`const ${prefix} = new ${sRef}();`], outArgExpr: `${prefix}._buffer`, readExpr: prefix };
    }
    const cRef = classRefExpr(ctx, type.fullName);
    if (cRef) {
      return {
        allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
        outArgExpr: `winrt$.ctypes.byref(${prefix})`,
        readExpr: `${prefix}.value ? ${cRef}.fromAddress(BigInt(${prefix}.value), ${cRef}.defaultInterface) : null`,
      };
    }
    return {
      allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
      outArgExpr: `winrt$.ctypes.byref(${prefix})`,
      readExpr: `${prefix}.value ? winrt$.WinRTObject.fromAddress(BigInt(${prefix}.value)) : null`,
    };
  }

  if (type.kind === "genericInst") {
    if (type.fullName === "Windows.Foundation.IAsyncOperation`1") {
      const inner = type.args[0];
      const innerSig = ctx.store.typeSignature(inner);
      const handlerIid = asyncOperationCompletedHandlerPiid(innerSig);
      const innerOut = allocateOutValue(ctx, inner, "res$");
      const readerBody = `${innerOut.allocLines.join(" ")} winrt$.comtypes.sync(op$).GetResults(${innerOut.outArgExpr}); return ${innerOut.readExpr};`;
      return {
        allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
        outArgExpr: `winrt$.ctypes.byref(${prefix})`,
        readExpr: `winrt$.awaitWinRTAsync(BigInt(${prefix}.value ?? 0n), (op$) => { ${readerBody} }, { completedHandlerIid: ${JSON.stringify(handlerIid)} })`,
      };
    }
    if (type.fullName === "Windows.Foundation.IAsyncOperationWithProgress`2") {
      const [res, prog] = type.args;
      const handlerIid = asyncOperationWithProgressCompletedHandlerPiid(ctx.store.typeSignature(res), ctx.store.typeSignature(prog));
      const innerOut = allocateOutValue(ctx, res, "res$");
      const readerBody = `${innerOut.allocLines.join(" ")} winrt$.comtypes.sync(op$).GetResults(${innerOut.outArgExpr}); return ${innerOut.readExpr};`;
      return {
        allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
        outArgExpr: `winrt$.ctypes.byref(${prefix})`,
        readExpr: `winrt$.awaitWinRTAsyncWithProgress(BigInt(${prefix}.value ?? 0n), (op$) => { ${readerBody} }, { completedHandlerIid: ${JSON.stringify(handlerIid)} })`,
      };
    }
    if (type.fullName === "Windows.Foundation.IAsyncActionWithProgress`1") {
      const handlerIid = asyncActionWithProgressCompletedHandlerPiid(ctx.store.typeSignature(type.args[0]));
      return {
        allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
        outArgExpr: `winrt$.ctypes.byref(${prefix})`,
        readExpr: `winrt$.awaitWinRTActionWithProgress(BigInt(${prefix}.value ?? 0n), { completedHandlerIid: ${JSON.stringify(handlerIid)} })`,
      };
    }
    if (type.fullName === "Windows.Foundation.IReference`1") {
      const inner = type.args[0];
      const innerOut = allocateOutValue(ctx, inner, "val$");
      const readerBody = `${innerOut.allocLines.join(" ")} winrt$.comtypes.sync(ref$).get_Value(${innerOut.outArgExpr}); return ${innerOut.readExpr};`;
      return {
        allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
        outArgExpr: `winrt$.ctypes.byref(${prefix})`,
        readExpr: `winrt$.readReference(BigInt(${prefix}.value ?? 0n), (ref$) => { ${readerBody} })`,
      };
    }
    if (type.fullName === "Windows.Foundation.Collections.IVectorView`1") {
      const elem = type.args[0];
      const elemOut = allocateOutValue(ctx, elem, "el$");
      const elemTs = tsReturnType(ctx, elem).replace(/ \| null$/, "");
      const readerBody = `${elemOut.allocLines.join(" ")} winrt$.comtypes.sync(view$).GetAt(idx$, ${elemOut.outArgExpr}); return (${elemOut.readExpr}) as ${elemTs};`;
      return {
        allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
        outArgExpr: `winrt$.ctypes.byref(${prefix})`,
        readExpr: `winrt$.readVectorView(BigInt(${prefix}.value ?? 0n), (view$, idx$) => { ${readerBody} })`,
      };
    }
    if (type.fullName === "Windows.Foundation.Collections.IVector`1") {
      const elem = type.args[0];
      const elemCType = abiCTypeFor(ctx, elem);
      const elemOut = allocateOutValue(ctx, elem, "el$");
      const elemTs = tsReturnType(ctx, elem).replace(/ \| null$/, "");
      const elemInTs = tsParamType(ctx, elem);
      const readerBody = `${elemOut.allocLines.join(" ")} winrt$.comtypes.sync(vec$).GetAt(idx$, ${elemOut.outArgExpr}); return (${elemOut.readExpr}) as ${elemTs};`;
      const syntheticParam: WinRTParam = { name: "val$", type: elem, isOut: false, isByRef: false, isArray: false };
      const m = marshalArg(ctx, syntheticParam, "val$");
      const writerBody = m.cleanup.length > 0 ? `${m.setup.join(" ")} try { invoke$(${m.exprs[0]}); } finally { ${m.cleanup.join(" ")} }` : `${m.setup.join(" ")} invoke$(${m.exprs[0]});`;
      return {
        allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
        outArgExpr: `winrt$.ctypes.byref(${prefix})`,
        readExpr: `winrt$.wrapVector<${elemTs}, ${elemInTs}>(BigInt(${prefix}.value ?? 0n), ${elemCType}, (vec$, idx$) => { ${readerBody} }, (val$, invoke$) => { ${writerBody} })`,
      };
    }
    if (type.fullName === "Windows.Foundation.Collections.IIterable`1") {
      const elem = type.args[0];
      const elemOut = allocateOutValue(ctx, elem, "el$");
      const elemTs = tsReturnType(ctx, elem).replace(/ \| null$/, "");
      const readerBody = `${elemOut.allocLines.join(" ")} winrt$.comtypes.sync(iter$).get_Current(${elemOut.outArgExpr}); return (${elemOut.readExpr}) as ${elemTs};`;
      return {
        allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
        outArgExpr: `winrt$.ctypes.byref(${prefix})`,
        readExpr: `winrt$.readIterable(BigInt(${prefix}.value ?? 0n), (iter$) => { ${readerBody} })`,
      };
    }
    if (type.fullName === "Windows.Foundation.Collections.IMapView`2" || type.fullName === "Windows.Foundation.Collections.IMap`2") {
      const [keyType, valType] = type.args;
      const iterPiid = mapIterablePiid(ctx.store.typeSignature(keyType), ctx.store.typeSignature(valType));
      const keyOut = allocateOutValue(ctx, keyType, "k$");
      const valOut = allocateOutValue(ctx, valType, "v$");
      const keyTs = tsReturnType(ctx, keyType).replace(/ \| null$/, "");
      const keyReader = `${keyOut.allocLines.join(" ")} winrt$.comtypes.sync(pair$).get_Key(${keyOut.outArgExpr}); return (${keyOut.readExpr}) as ${keyTs};`;
      const valReader = `${valOut.allocLines.join(" ")} winrt$.comtypes.sync(pair$).get_Value(${valOut.outArgExpr}); return ${valOut.readExpr};`;
      return {
        allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
        outArgExpr: `winrt$.ctypes.byref(${prefix})`,
        readExpr: `winrt$.readMapView(BigInt(${prefix}.value ?? 0n), ${JSON.stringify(iterPiid)}, (pair$) => { ${keyReader} }, (pair$) => { ${valReader} })`,
      };
    }
  }

  return {
    allocLines: [`const ${prefix} = new winrt$.ctypes.c_void_p(0n);`],
    outArgExpr: `winrt$.ctypes.byref(${prefix})`,
    readExpr: `${prefix}.value ? winrt$.WinRTObject.fromAddress(BigInt(${prefix}.value)) : null`,
  };
}

function emitStructDef(ctx: GenerationContext, def: WinRTStructDef, exportName: string, exported: boolean): string[] {
  const kw = exported ? "export " : "";
  const lines: string[] = [];
  lines.push(`${kw}interface ${exportName}Fields {`);
  for (const field of def.fields) {
    lines.push(`  ${safeIdent(field.name)}: ${tsReturnType(ctx, field.type)};`);
  }
  lines.push(`}`);
  lines.push(`${kw}class ${exportName} extends winrt$.ctypes.Structure {`);
  lines.push(`  static _fields_ = [`);
  for (const field of def.fields) {
    lines.push(`    [${JSON.stringify(field.name)}, ${abiCTypeFor(ctx, field.type)}],`);
  }
  lines.push(`  ] as const;`);
  for (const field of def.fields) {
    lines.push(`  declare ${safeIdent(field.name)}: ${tsReturnType(ctx, field.type)};`);
  }
  lines.push(`}`);
  return lines;
}

function emitEnumDef(def: WinRTEnumDef, exportName: string, exported: boolean): string[] {
  const kw = exported ? "export " : "";
  const lines: string[] = [];
  lines.push(`${kw}const ${exportName} = Object.freeze({`);
  for (const member of def.members) {
    lines.push(`  ${safeIdent(member.name)}: ${member.value},`);
  }
  lines.push(`} as const);`);
  lines.push(`${kw}type ${exportName} = (typeof ${exportName})[keyof typeof ${exportName}];`);
  return lines;
}

function emitInterfaceDef(ctx: GenerationContext, def: WinRTInterfaceDef): string[] {
  if (!def.guid || def.genericParams.length > 0) return [];
  const lines: string[] = [];
  lines.push(`/** WinRT Interface ${def.fullName} (${def.guid}) */`);
  lines.push(`export const ${safeIdent(def.name)} = winrt$.comtypes.COMInterface({`);
  lines.push(`  name: ${JSON.stringify(def.name)},`);
  lines.push(`  iid: ${JSON.stringify(def.guid)},`);
  lines.push(`  extends: winrt$.IInspectable,`);
  lines.push(`  methods: [`);
  const seenNames = new Set<string>();
  for (const m of def.methods) {
    let slotName = safeIdent(m.abiName);
    let suffix = 2;
    while (seenNames.has(slotName)) slotName = `${safeIdent(m.abiName)}_${suffix++}`;
    seenNames.add(slotName);
    const argTypes = abiMethodArgTypes(ctx, m);
    lines.push(`    winrt$.comtypes.STDMETHOD(winrt$.comtypes.HRESULT, ${JSON.stringify(slotName)}, [${argTypes.join(", ")}]),`);
  }
  lines.push(`  ],`);
  lines.push(`});`);
  return lines;
}

function uniqueSlotNames(methods: readonly WinRTMethod[]): string[] {
  const seen = new Set<string>();
  return methods.map((m) => {
    let slotName = safeIdent(m.abiName);
    let suffix = 2;
    while (seen.has(slotName)) slotName = `${safeIdent(m.abiName)}_${suffix++}`;
    seen.add(slotName);
    return slotName;
  });
}

function emitMemberBody(ctx: GenerationContext, targetExpr: string, slotName: string, method: WinRTMethod, argNames: readonly string[]): string[] {
  const receiveParam = getTrailingReceiveByteArrayParam(method);
  const effectiveParams = receiveParam ? method.params.slice(0, -1) : method.params;
  const lines: string[] = [];
  const marshalled = effectiveParams.map((p, i) => marshalArg(ctx, p, argNames[i]));
  const hasCleanup = marshalled.some((m) => m.cleanup.length > 0);
  const callArgs = marshalled.flatMap((m) => m.exprs);

  for (const m of marshalled) lines.push(...m.setup);

  const invokeAndReturn = (indent: string): string[] => {
    const out: string[] = [];
    if (receiveParam || isByteArrayType(method.returnType)) {
      out.push(`${indent}const len$ = new winrt$.ctypes.c_uint32(0);`);
      out.push(`${indent}const data$ = new winrt$.ctypes.c_void_p(0n);`);
      out.push(`${indent}winrt$.comtypes.sync(${targetExpr}).${slotName}(${[...callArgs, "winrt$.ctypes.byref(len$)", "winrt$.ctypes.byref(data$)"].join(", ")});`);
      out.push(`${indent}return winrt$.takeCoTaskMemBytes(BigInt(data$.value ?? 0n), Number(len$.value));`);
    } else if (method.returnType.kind === "void") {
      out.push(`${indent}winrt$.comtypes.sync(${targetExpr}).${slotName}(${callArgs.join(", ")});`);
    } else {
      const alloc = allocateOutValue(ctx, method.returnType);
      for (const a of alloc.allocLines) out.push(`${indent}${a}`);
      out.push(`${indent}winrt$.comtypes.sync(${targetExpr}).${slotName}(${[...callArgs, alloc.outArgExpr].join(", ")});`);
      out.push(`${indent}return ${alloc.readExpr};`);
    }
    return out;
  };

  if (hasCleanup) {
    lines.push(`try {`);
    lines.push(...invokeAndReturn("  "));
    lines.push(`} finally {`);
    for (const m of marshalled) {
      for (const c of m.cleanup) lines.push(`  ${c}`);
    }
    lines.push(`}`);
  } else {
    lines.push(...invokeAndReturn(""));
  }
  return lines;
}

function methodSignatureParams(ctx: GenerationContext, method: WinRTMethod): { readonly argNames: string[]; readonly paramList: string; readonly returnTs: string } {
  const receiveParam = getTrailingReceiveByteArrayParam(method);
  const effectiveParams = receiveParam ? method.params.slice(0, -1) : method.params;
  const argNames = effectiveParams.map((p, i) => safeIdent(p.name || `arg${i}`));
  const paramList = effectiveParams.map((p, i) => `${argNames[i]}: ${tsParamType(ctx, p.type)}`).join(", ");
  const returnTs = receiveParam ? "NodeBuffer$" : tsReturnType(ctx, method.returnType);
  return { argNames, paramList, returnTs };
}

function resolveInterfaceExpr(ctx: GenerationContext, fullName: string): { readonly def: WinRTInterfaceDef; readonly expr: string } | null {
  const def = ctx.store.getType(fullName);
  if (!def || def.kind !== "interface" || !def.guid || def.genericParams.length > 0) return null;
  const ns = namespaceOf(fullName);
  const short = safeIdent(def.name);
  if (ns === ctx.targetNamespace) return ctx.localInterfaces.has(def.name) ? { def, expr: short } : null;
  if (ctx.siblingNamespaces.has(ns)) {
    const allowed = ctx.siblingEmittedInterfaces.get(ns);
    if (allowed && !allowed.has(def.name)) return null;
    let alias = ctx.siblingImports.get(ns);
    if (!alias) {
      alias = aliasForNamespace(ns);
      ctx.siblingImports.set(ns, alias);
    }
    return { def, expr: `${alias}.${short}` };
  }
  return null;
}

function emitClassDef(ctx: GenerationContext, cls: WinRTClassDef): string[] {
  const defaultIfaceInfo = cls.defaultInterface?.kind === "named" ? resolveInterfaceExpr(ctx, cls.defaultInterface.fullName) : null;
  const defaultIfaceExpr = defaultIfaceInfo ? defaultIfaceInfo.expr : "winrt$.IInspectable";

  const lines: string[] = [];
  lines.push(`/** WinRT RuntimeClass ${cls.fullName} */`);
  lines.push(`export class ${safeIdent(cls.name)} extends winrt$.WinRTObject {`);
  lines.push(`  static readonly className = ${JSON.stringify(cls.fullName)};`);
  lines.push(`  static get defaultInterface() { return ${defaultIfaceExpr}; }`);

  const emittedStatic = new Set<string>(["className", "defaultInterface", "fromAddress", "prototype", "length", "name"]);

  // Default constructor (`RoActivateInstance`).
  if (cls.hasDefaultConstructor && !emittedStatic.has("create")) {
    emittedStatic.add("create");
    lines.push(`  static create(): ${safeIdent(cls.name)} {`);
    lines.push(`    return new ${safeIdent(cls.name)}(winrt$.activateInstance(${safeIdent(cls.name)}.className, ${defaultIfaceExpr}));`);
    lines.push(`  }`);
  }

  // Factory interfaces (`[Activatable(IFactory, ...)]`).
  for (const factoryFullName of cls.factoryInterfaces) {
    const info = resolveInterfaceExpr(ctx, factoryFullName);
    if (!info) continue;
    const slotNames = uniqueSlotNames(info.def.methods);
    info.def.methods.forEach((method, idx) => {
      if (!isWrappableMethod(ctx, method)) return;
      const jsName = toCamelCase(method.abiName);
      if (emittedStatic.has(jsName)) return;
      emittedStatic.add(jsName);
      const { argNames, paramList, returnTs } = methodSignatureParams(ctx, method);
      lines.push(`  static ${jsName}(${paramList}): ${returnTs} {`);
      lines.push(`    using factory$ = winrt$.getActivationFactory(${safeIdent(cls.name)}.className, ${info.expr});`);
      for (const b of emitMemberBody(ctx, "factory$", slotNames[idx], method, argNames)) {
        lines.push(`    ${b}`);
      }
      lines.push(`  }`);
    });
  }

  // Composable factory interfaces (`[Composable(IFactory, Public, ...)]`).
  for (const factoryFullName of cls.composableFactories) {
    const info = resolveInterfaceExpr(ctx, factoryFullName);
    if (!info) continue;
    const slotNames = uniqueSlotNames(info.def.methods);
    info.def.methods.forEach((method, idx) => {
      if (method.params.length < 2 || method.returnType.kind === "void") return;
      const userParams = method.params.slice(0, -2);
      const syntheticMethod: WinRTMethod = { ...method, params: userParams };
      if (!isWrappableMethod(ctx, syntheticMethod)) return;
      const jsName = method.abiName === "CreateInstance" && userParams.length === 0 ? "create" : toCamelCase(method.abiName);
      if (emittedStatic.has(jsName)) return;
      emittedStatic.add(jsName);
      const { argNames, paramList, returnTs } = methodSignatureParams(ctx, syntheticMethod);
      const marshalled = userParams.map((p, i) => marshalArg(ctx, p, argNames[i]));
      const callArgs = [...marshalled.flatMap((m) => m.exprs), "0n", "winrt$.ctypes.byref(inner$)"];
      const alloc = allocateOutValue(ctx, method.returnType);
      lines.push(`  static ${jsName}(${paramList}): ${returnTs} {`);
      lines.push(`    using factory$ = winrt$.getActivationFactory(${safeIdent(cls.name)}.className, ${info.expr});`);
      for (const m of marshalled) {
        for (const s of m.setup) lines.push(`    ${s}`);
      }
      lines.push(`    const inner$ = new winrt$.ctypes.c_void_p(0n);`);
      for (const a of alloc.allocLines) lines.push(`    ${a}`);
      lines.push(`    try {`);
      lines.push(`      winrt$.comtypes.sync(factory$).${slotNames[idx]}(${[...callArgs, alloc.outArgExpr].join(", ")});`);
      lines.push(`      return ${alloc.readExpr};`);
      lines.push(`    } finally {`);
      lines.push(`      if (inner$.value) winrt$.comtypes.COMPointer.fromAddress(BigInt(inner$.value), winrt$.IInspectable).Release();`);
      for (const m of marshalled) {
        for (const c of m.cleanup) lines.push(`      ${c}`);
      }
      lines.push(`    }`);
      lines.push(`  }`);

      const composedName = jsName === "create" ? "createComposed" : `${jsName}Composed`;
      if (!emittedStatic.has(composedName)) {
        emittedStatic.add(composedName);
        const composedParams = paramList ? `outer$: bigint, ${paramList}` : `outer$: bigint`;
        const composedArgs = [...marshalled.flatMap((m) => m.exprs), "outer$", "winrt$.ctypes.byref(inner$)"];
        lines.push(`  static ${composedName}(${composedParams}): { readonly instance: ${returnTs}; readonly inner: bigint } {`);
        lines.push(`    using factory$ = winrt$.getActivationFactory(${safeIdent(cls.name)}.className, ${info.expr});`);
        for (const m of marshalled) {
          for (const s of m.setup) lines.push(`    ${s}`);
        }
        lines.push(`    const inner$ = new winrt$.ctypes.c_void_p(0n);`);
        for (const a of alloc.allocLines) lines.push(`    ${a}`);
        lines.push(`    try {`);
        lines.push(`      winrt$.comtypes.sync(factory$).${slotNames[idx]}(${[...composedArgs, alloc.outArgExpr].join(", ")});`);
        lines.push(`      return { instance: ${alloc.readExpr}, inner: BigInt(inner$.value ?? 0n) };`);
        lines.push(`    } finally {`);
        for (const m of marshalled) {
          for (const c of m.cleanup) lines.push(`      ${c}`);
        }
        lines.push(`    }`);
        lines.push(`  }`);
      }
    });
  }

  // Static interfaces (`[Static(IStatics, ...)]`).
  for (const staticFullName of cls.staticInterfaces) {
    const info = resolveInterfaceExpr(ctx, staticFullName);
    if (!info) continue;
    const slotNames = uniqueSlotNames(info.def.methods);
    info.def.methods.forEach((method, idx) => {
      if (!isWrappableMethod(ctx, method)) return;
      if (method.isGetter && method.params.length === 0) {
        const propName = toCamelCase(method.name.slice(4));
        if (emittedStatic.has(propName)) return;
        emittedStatic.add(propName);
        const retTs = tsReturnType(ctx, method.returnType);
        lines.push(`  static get ${propName}(): ${retTs} {`);
        lines.push(`    using statics$ = winrt$.getActivationFactory(${safeIdent(cls.name)}.className, ${info.expr});`);
        for (const b of emitMemberBody(ctx, "statics$", slotNames[idx], method, [])) {
          lines.push(`    ${b}`);
        }
        lines.push(`  }`);
        return;
      }
      if (method.isSetter || method.isAddEvent || method.isRemoveEvent) return;
      const jsName = toCamelCase(method.abiName);
      if (emittedStatic.has(jsName)) return;
      emittedStatic.add(jsName);
      const { argNames, paramList, returnTs } = methodSignatureParams(ctx, method);
      lines.push(`  static ${jsName}(${paramList}): ${returnTs} {`);
      lines.push(`    using statics$ = winrt$.getActivationFactory(${safeIdent(cls.name)}.className, ${info.expr});`);
      for (const b of emitMemberBody(ctx, "statics$", slotNames[idx], method, argNames)) {
        lines.push(`    ${b}`);
      }
      lines.push(`  }`);
    });
  }

  // Instance members across implemented interfaces (default interface first, plus inherited base class interfaces).
  const orderedIfaces: WinRTTypeRef[] = [];
  const seenIfaceNames = new Set<string>();
  const addIface = (ref: WinRTTypeRef | null) => {
    if (!ref || ref.kind !== "named" || seenIfaceNames.has(ref.fullName)) return;
    seenIfaceNames.add(ref.fullName);
    orderedIfaces.push(ref);
  };
  addIface(cls.defaultInterface);
  for (const iface of cls.interfaces) addIface(iface);
  let ancestorName = cls.baseClass;
  while (ancestorName) {
    const baseDef = ctx.store.getType(ancestorName);
    if (!baseDef || baseDef.kind !== "class") break;
    addIface(baseDef.defaultInterface);
    for (const iface of baseDef.interfaces) addIface(iface);
    ancestorName = baseDef.baseClass;
  }

  const emittedInstance = new Set<string>(["raw", "address", "released", "queryInterface", "tryQueryInterface", "as", "tryAs", "getRuntimeClassName", "dispose", "constructor"]);
  const emittedGetters = new Set<string>();
  const emittedSetters = new Set<string>();

  for (const ifaceRef of orderedIfaces) {
    if (ifaceRef.kind !== "named") continue;
    if (ifaceRef.fullName === "Windows.Foundation.IClosable") continue;
    const info = resolveInterfaceExpr(ctx, ifaceRef.fullName);
    if (!info) continue;
    const isDefault = defaultIfaceInfo !== null && info.def.fullName === defaultIfaceInfo.def.fullName;
    const slotNames = uniqueSlotNames(info.def.methods);

    const wrapTarget = (bodyFn: (targetVar: string) => string[]): string[] => {
      if (isDefault) return bodyFn(`(this.raw as winrt$.comtypes.InterfacePointer<typeof ${info.expr}>)`);
      return [`using iface$ = this.queryInterface(${info.expr});`, ...bodyFn("iface$")];
    };

    // Group events (add_X + remove_X) for TypedEventHandler<S, A>, EventHandler<T>, and non-generic delegates.
    const removeByEvent = new Map<string, string>();
    info.def.methods.forEach((m, idx) => {
      if (m.isRemoveEvent) removeByEvent.set(m.name.slice(7), slotNames[idx]);
    });

    info.def.methods.forEach((method, idx) => {
      if (method.isAddEvent && method.params.length === 1) {
        const eventName = method.name.slice(4);
        const removeSlot = removeByEvent.get(eventName);
        const jsEventMethod = `on${eventName}`;
        if (!removeSlot || emittedInstance.has(jsEventMethod)) return;

        const handlerType = method.params[0].type;
        let handlerIid: string | null = null;
        let arity: 0 | 1 | 2 = 2;

        if (handlerType.kind === "genericInst" && handlerType.fullName === "Windows.Foundation.TypedEventHandler`2") {
          try {
            handlerIid = typedEventHandlerPiid(ctx.store.typeSignature(handlerType.args[0]), ctx.store.typeSignature(handlerType.args[1]));
            arity = 2;
          } catch {
            return;
          }
        } else if (handlerType.kind === "genericInst" && handlerType.fullName === "Windows.Foundation.EventHandler`1") {
          try {
            handlerIid = eventHandlerPiid(ctx.store.typeSignature(handlerType.args[0]));
            arity = 2;
          } catch {
            return;
          }
        } else if (handlerType.kind === "named") {
          const dDef = ctx.store.getType(handlerType.fullName);
          if (dDef?.kind === "delegate" && dDef.guid && dDef.invoke) {
            const pCount = dDef.invoke.params.length;
            if (pCount === 0 || pCount === 1 || pCount === 2) {
              handlerIid = dDef.guid;
              arity = pCount;
            }
          }
        }

        if (!handlerIid) return;
        emittedInstance.add(jsEventMethod);
        const tokenStruct = ensureStructAvailable(ctx, "Windows.Foundation.EventRegistrationToken");
        const cbSig = arity === 0 ? "() => void" : arity === 1 ? "(argAddr: bigint) => void" : "(senderAddr: bigint, argsAddr: bigint) => void";
        const guardedCb =
          arity === 0
            ? `() => { if (!removed$ && !this.released) callback(); }`
            : arity === 1
              ? `(a0$: bigint) => { if (!removed$ && !this.released) callback(a0$); }`
              : `(a0$: bigint, a1$: bigint) => { if (!removed$ && !this.released) callback(a0$, a1$); }`;
        const factoryCall = arity === 2 ? `winrt$.createTypedEventHandler(${JSON.stringify(handlerIid)}, ${guardedCb})` : `winrt$.createDelegateHandler(${JSON.stringify(handlerIid)}, ${arity}, (${guardedCb}) as (...args: bigint[]) => void)`;
        lines.push(`  ${jsEventMethod}(callback: ${cbSig}): Disposable & { readonly token: bigint; remove: () => void } {`);
        lines.push(`    let removed$ = false;`);
        lines.push(`    const handler$ = ${factoryCall};`);
        lines.push(`    const token$ = new ${tokenStruct}();`);
        lines.push(`    try {`);
        for (const l of wrapTarget((t) => [`winrt$.comtypes.sync(${t}).${slotNames[idx]}(handler$.address, token$._buffer);`])) {
          lines.push(`      ${l}`);
        }
        lines.push(`    } catch (err$) {`);
        lines.push(`      if (!handler$.released) handler$.Release();`);
        lines.push(`      throw err$;`);
        lines.push(`    }`);
        lines.push(`    const regToken$ = BigInt(token$.Value);`);
        lines.push(`    const remove = (): void => {`);
        lines.push(`      if (removed$) return;`);
        lines.push(`      removed$ = true;`);
        lines.push(`      try {`);
        lines.push(`        if (!this.released) {`);
        for (const l of wrapTarget((t) => [`winrt$.comtypes.sync(${t}).${removeSlot}(token$);`])) {
          lines.push(`          ${l}`);
        }
        lines.push(`        }`);
        lines.push(`      } finally {`);
        lines.push(`        if (!handler$.released) handler$.Release();`);
        lines.push(`      }`);
        lines.push(`    };`);
        lines.push(`    return { token: regToken$, remove, [globalThis.Symbol.dispose]: remove };`);
        lines.push(`  }`);
        return;
      }

      if (method.isAddEvent || method.isRemoveEvent) return;
      if (!isWrappableMethod(ctx, method)) return;

      if (method.isGetter && method.params.length === 0) {
        const propName = toCamelCase(method.name.slice(4));
        if (emittedGetters.has(propName) || (emittedInstance.has(propName) && !emittedSetters.has(propName))) return;
        emittedGetters.add(propName);
        emittedInstance.add(propName);
        const retTs = tsReturnType(ctx, method.returnType);
        lines.push(`  get ${propName}(): ${retTs} {`);
        for (const l of wrapTarget((t) => emitMemberBody(ctx, t, slotNames[idx], method, []))) {
          lines.push(`    ${l}`);
        }
        lines.push(`  }`);
        return;
      }

      if (method.isSetter && method.params.length === 1) {
        const propName = toCamelCase(method.name.slice(4));
        if (emittedSetters.has(propName) || (emittedInstance.has(propName) && !emittedGetters.has(propName))) return;
        emittedSetters.add(propName);
        emittedInstance.add(propName);
        const pTs = tsParamType(ctx, method.params[0].type);
        lines.push(`  set ${propName}(value: ${pTs}) {`);
        for (const l of wrapTarget((t) => emitMemberBody(ctx, t, slotNames[idx], method, ["value"]))) {
          lines.push(`    ${l}`);
        }
        lines.push(`  }`);
        return;
      }

      const jsName = toCamelCase(method.abiName);
      if (emittedInstance.has(jsName)) return;
      emittedInstance.add(jsName);
      const { argNames, paramList, returnTs } = methodSignatureParams(ctx, method);
      lines.push(`  ${jsName}(${paramList}): ${returnTs} {`);
      for (const l of wrapTarget((t) => emitMemberBody(ctx, t, slotNames[idx], method, argNames))) {
        lines.push(`    ${l}`);
      }
      lines.push(`  }`);
    });
  }

  lines.push(`}`);
  return lines;
}

function selectNamespaceTypes(
  store: WinMdStore,
  namespace: string,
  includeTypes?: Readonly<Record<string, readonly string[]>>,
): {
  readonly enums: readonly WinRTEnumDef[];
  readonly structs: readonly WinRTStructDef[];
  readonly interfaces: readonly WinRTInterfaceDef[];
  readonly classes: readonly WinRTClassDef[];
} {
  const types = store.getNamespace(namespace);
  const enums = types.filter((t): t is WinRTEnumDef => t.kind === "enum");
  const structs = types.filter((t): t is WinRTStructDef => t.kind === "struct");
  const allInterfaces = types.filter((t): t is WinRTInterfaceDef => t.kind === "interface");
  const allClasses = types.filter((t): t is WinRTClassDef => t.kind === "class");

  const allowList = includeTypes?.[namespace];
  if (!allowList) {
    return { enums, structs, interfaces: allInterfaces, classes: allClasses };
  }

  const allowedSet = new Set(allowList);
  const classes = allClasses.filter((c) => allowedSet.has(c.name));
  const neededIfaces = new Set<string>(allowList);

  const collectClassIfaces = (cls: WinRTClassDef): void => {
    const addRef = (ref: WinRTTypeRef | null) => {
      if (ref?.kind === "named" && namespaceOf(ref.fullName) === namespace) neededIfaces.add(shortNameOf(ref.fullName));
    };
    addRef(cls.defaultInterface);
    for (const i of cls.interfaces) addRef(i);
    for (const s of cls.staticInterfaces) if (namespaceOf(s) === namespace) neededIfaces.add(shortNameOf(s));
    for (const f of cls.factoryInterfaces) if (namespaceOf(f) === namespace) neededIfaces.add(shortNameOf(f));
    for (const c of cls.composableFactories) if (namespaceOf(c) === namespace) neededIfaces.add(shortNameOf(c));
    let anc = cls.baseClass;
    while (anc) {
      const b = store.getType(anc);
      if (!b || b.kind !== "class") break;
      addRef(b.defaultInterface);
      for (const i of b.interfaces) addRef(i);
      anc = b.baseClass;
    }
  };
  for (const cls of classes) collectClassIfaces(cls);

  const interfaces = allInterfaces.filter((i) => neededIfaces.has(i.name));
  return { enums, structs, interfaces, classes };
}

/** Generate a strictly-typed TypeScript projection module for a single WinRT namespace. */
export function generateNamespaceModule(store: WinMdStore, namespace: string, options: GenerateOptions = {}): string {
  const types = store.getNamespace(namespace);
  if (types.length === 0) throw new Error(`WinRT namespace not found: "${namespace}"`);

  const importFrom = options.importFrom ?? "@node-ctypes/winrt";
  const siblingNamespaces = options.siblingNamespaces ?? new Set<string>();
  const { enums, structs, interfaces, classes } = selectNamespaceTypes(store, namespace, options.includeTypes);

  const siblingEmittedClasses = new Map<string, ReadonlySet<string>>();
  const siblingEmittedInterfaces = new Map<string, ReadonlySet<string>>();
  if (options.includeTypes) {
    for (const sibNs of siblingNamespaces) {
      if (sibNs === namespace || !options.includeTypes[sibNs]) continue;
      const sel = selectNamespaceTypes(store, sibNs, options.includeTypes);
      siblingEmittedClasses.set(sibNs, new Set(sel.classes.map((c) => c.name)));
      siblingEmittedInterfaces.set(sibNs, new Set(sel.interfaces.map((i) => i.name)));
    }
  }

  const ctx: GenerationContext = {
    store,
    targetNamespace: namespace,
    siblingNamespaces,
    siblingEmittedClasses,
    siblingEmittedInterfaces,
    inlinedStructs: new Map(),
    inlinedEnums: new Map(),
    siblingImports: new Map(),
    localClasses: new Set(classes.map((c) => c.name)),
    localStructs: new Set(structs.map((s) => s.name)),
    localEnums: new Set(enums.map((e) => e.name)),
    localInterfaces: new Set(interfaces.map((i) => i.name)),
  };

  // Emit body sections first so `ctx.inlinedStructs`, `ctx.inlinedEnums`, and `ctx.siblingImports` are populated.
  const bodyBlocks: string[] = [];

  for (const e of enums) {
    bodyBlocks.push(emitEnumDef(e, safeIdent(e.name), true).join("\n"));
  }
  for (const s of structs) {
    bodyBlocks.push(emitStructDef(ctx, s, safeIdent(s.name), true).join("\n"));
  }
  for (const iface of interfaces) {
    const code = emitInterfaceDef(ctx, iface);
    if (code.length) bodyBlocks.push(code.join("\n"));
  }
  for (const cls of classes) {
    bodyBlocks.push(emitClassDef(ctx, cls).join("\n"));
  }

  // Emit any referenced external enums/structs inlined for standalone compilation.
  const inlinedBlocks: string[] = [];
  for (const [fullName, eDef] of ctx.inlinedEnums) {
    inlinedBlocks.push(emitEnumDef(eDef, `${fullName.replace(/\./g, "_")}$`, false).join("\n"));
  }
  // Topological order for nested inlined structs (innermost first).
  const emittedInlined = new Set<string>();
  const emitInlinedStruct = (fullName: string, sDef: WinRTStructDef) => {
    if (emittedInlined.has(fullName)) return;
    for (const f of sDef.fields) {
      if (f.type.kind === "named" && ctx.inlinedStructs.has(f.type.fullName)) {
        emitInlinedStruct(f.type.fullName, ctx.inlinedStructs.get(f.type.fullName)!);
      }
    }
    emittedInlined.add(fullName);
    inlinedBlocks.push(emitStructDef(ctx, sDef, `${fullName.replace(/\./g, "_")}$`, false).join("\n"));
  };
  for (const [fullName, sDef] of ctx.inlinedStructs) {
    emitInlinedStruct(fullName, sDef);
  }

  const header: string[] = [
    `// Generated by @node-ctypes/winrt from WinRT metadata for namespace ${namespace}. Do not edit.`,
    `import { Buffer as NodeBuffer$ } from "node:buffer";`,
    `import * as ctypes$ from "node-ctypes";`,
    `import * as comtypes$ from "@node-ctypes/comtypes";`,
    `import * as winrt$ from ${JSON.stringify(importFrom)};`,
  ];

  for (const [sibNs, alias] of [...ctx.siblingImports.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    header.push(`import * as ${alias} from "./${sibNs}.ts";`);
  }

  return [...header, "", ...inlinedBlocks, ...bodyBlocks, ""].join("\n\n").replace(/\n{3,}/g, "\n\n");
}

/** Generate and write `.ts` projection files for one or more WinRT namespaces into `outDir`. */
export function writeNamespaceModules(store: WinMdStore, namespaces: readonly string[], outDir: string, options: Omit<GenerateOptions, "siblingNamespaces"> = {}): string[] {
  mkdirSync(outDir, { recursive: true });
  const siblingNamespaces = new Set(namespaces);
  const written: string[] = [];
  for (const ns of namespaces) {
    const code = generateNamespaceModule(store, ns, { ...options, siblingNamespaces });
    const filePath = join(outDir, `${ns}.ts`);
    writeFileSync(filePath, code, "utf8");
    written.push(filePath);
  }
  return written;
}
