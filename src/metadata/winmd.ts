import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { computePiid, delegateSignature, enumSignature, normalizeGuidUpper, pinterfaceSignature, runtimeClassSignature, structSignature } from "../runtime/piid.ts";
import { BlobReader, decodeFieldSig, decodeMethodSig, Ecma335File, ElementType, readSigType, TableId } from "./ecma335.ts";
import type { CodedIndex, CustomAttributeRow, SigType, TypeDefRow } from "./ecma335.ts";

/** High-level resolved WinRT type reference used by codegen and PIID computation. */
export type WinRTTypeRef =
  | { readonly kind: "void" }
  | { readonly kind: "primitive"; readonly name: "Boolean" | "Char" | "Int8" | "UInt8" | "Int16" | "UInt16" | "Int32" | "UInt32" | "Int64" | "UInt64" | "Single" | "Double" | "String" | "Object" | "Guid" | "IntPtr" | "UIntPtr" }
  | { readonly kind: "named"; readonly fullName: string }
  | { readonly kind: "genericInst"; readonly fullName: string; readonly args: readonly WinRTTypeRef[] }
  | { readonly kind: "array"; readonly element: WinRTTypeRef }
  | { readonly kind: "genericParam"; readonly index: number; readonly name: string };

export interface WinRTParam {
  readonly name: string;
  readonly type: WinRTTypeRef;
  readonly isOut: boolean;
  readonly isByRef: boolean;
  readonly isArray: boolean;
}

export interface WinRTMethod {
  readonly name: string;
  /** Unique ABI name (uses `[OverloadAttribute]` when overloaded, else `name`). */
  readonly abiName: string;
  readonly returnType: WinRTTypeRef;
  readonly params: readonly WinRTParam[];
  readonly isSpecialName: boolean;
  readonly isGetter: boolean;
  readonly isSetter: boolean;
  readonly isAddEvent: boolean;
  readonly isRemoveEvent: boolean;
}

export interface WinRTEnumDef {
  readonly kind: "enum";
  readonly namespace: string;
  readonly name: string;
  readonly fullName: string;
  readonly underlying: "Int32" | "UInt32";
  readonly isFlags: boolean;
  readonly members: readonly { readonly name: string; readonly value: number }[];
}

export interface WinRTStructField {
  readonly name: string;
  readonly type: WinRTTypeRef;
}

export interface WinRTStructDef {
  readonly kind: "struct";
  readonly namespace: string;
  readonly name: string;
  readonly fullName: string;
  readonly fields: readonly WinRTStructField[];
}

export interface WinRTInterfaceDef {
  readonly kind: "interface";
  readonly namespace: string;
  readonly name: string;
  readonly fullName: string;
  readonly guid: string | null;
  readonly genericParams: readonly string[];
  readonly requiredInterfaces: readonly WinRTTypeRef[];
  readonly methods: readonly WinRTMethod[];
  readonly exclusiveTo: string | null;
}

export interface WinRTDelegateDef {
  readonly kind: "delegate";
  readonly namespace: string;
  readonly name: string;
  readonly fullName: string;
  readonly guid: string | null;
  readonly genericParams: readonly string[];
  readonly invoke: WinRTMethod | null;
}

export interface WinRTClassDef {
  readonly kind: "class";
  readonly namespace: string;
  readonly name: string;
  readonly fullName: string;
  readonly baseClass: string | null;
  readonly defaultInterface: WinRTTypeRef | null;
  readonly interfaces: readonly WinRTTypeRef[];
  readonly staticInterfaces: readonly string[];
  readonly factoryInterfaces: readonly string[];
  readonly composableFactories: readonly string[];
  readonly hasDefaultConstructor: boolean;
  readonly isClosable: boolean;
}

export type WinRTTypeDef = WinRTEnumDef | WinRTStructDef | WinRTInterfaceDef | WinRTDelegateDef | WinRTClassDef;

const TYPE_SEMANTICS_INTERFACE = 0x00000020;
const PARAM_FLAG_OUT = 0x0002;
const METHOD_SPECIAL_NAME = 0x0800;

function formatGuidFromBlob(blob: Buffer): string | null {
  // CustomAttribute blob: uint16 prolog (0x0001), uint32 a, uint16 b, uint16 c, 8x uint8 d..k
  if (blob.length < 18 || blob.readUInt16LE(0) !== 0x0001) return null;
  const a = blob.readUInt32LE(2).toString(16).padStart(8, "0");
  const b = blob.readUInt16LE(6).toString(16).padStart(4, "0");
  const c = blob.readUInt16LE(8).toString(16).padStart(4, "0");
  const d = blob.subarray(10, 12).toString("hex");
  const e = blob.subarray(12, 18).toString("hex");
  return `{${a}-${b}-${c}-${d}-${e}}`.toUpperCase();
}

function parseFirstStringArg(blob: Buffer): string | null {
  if (blob.length < 3 || blob.readUInt16LE(0) !== 0x0001) return null;
  const reader = new BlobReader(blob, 2);
  return reader.readSerString();
}

function parseComposableAttr(blob: Buffer): { readonly factoryName: string; readonly isPublic: boolean } | null {
  // ComposableAttribute(Type factory, CompositionType type, uint32 version, ...)
  // CompositionType: Protected = 1, Public = 2
  if (blob.length < 7 || blob.readUInt16LE(0) !== 0x0001) return null;
  const reader = new BlobReader(blob, 2);
  const factoryName = reader.readSerString();
  if (!factoryName || reader.remaining < 4) return null;
  const compositionType = reader.readU32();
  return { factoryName, isPublic: compositionType === 2 };
}

function keyOfCoded(token: CodedIndex): string {
  return `${token.table}:${token.row}`;
}

/** Return the default system `.winmd` paths on Windows (`C:\Windows\System32\WinMetadata\*.winmd`). */
export function defaultWinMdPaths(): string[] {
  const sysRoot = process.env.SystemRoot ?? "C:\\Windows";
  const dir = join(sysRoot, "System32", "WinMetadata");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".winmd"))
    .sort()
    .map((name) => join(dir, name));
}

function expandWinMdInputs(inputs: readonly string[]): string[] {
  const files: string[] = [];
  for (const input of inputs) {
    if (!existsSync(input)) throw new Error(`WinMD path not found: ${input}`);
    const st = statSync(input);
    if (st.isDirectory()) {
      for (const name of readdirSync(input).sort()) {
        if (name.toLowerCase().endsWith(".winmd")) files.push(join(input, name));
      }
    } else {
      files.push(input);
    }
  }
  return files;
}

/**
 * Multi-file WinRT `.winmd` metadata store.
 * Indexes all namespaces and types across System32 WinMetadata (or custom `.winmd`
 * files) and resolves cross-file references and PIID signatures.
 */
export class WinMdStore {
  readonly files: readonly Ecma335File[];
  readonly #types = new Map<string, WinRTTypeDef>();
  readonly #namespaces = new Map<string, WinRTTypeDef[]>();
  readonly #namedSignatures = new Map<string, string>();

  constructor(paths?: readonly string[]) {
    const resolved = paths && paths.length > 0 ? expandWinMdInputs(paths) : defaultWinMdPaths();
    if (resolved.length === 0) {
      throw new Error("No .winmd metadata files found. Pass --winmd <path> or run on Windows 10/11.");
    }
    this.files = resolved.map((filePath) => new Ecma335File(filePath));
    for (const file of this.files) {
      this.#indexFile(file);
    }
  }

  /** All sorted WinRT namespaces present in the loaded `.winmd` files. */
  listNamespaces(): string[] {
    return [...this.#namespaces.keys()].sort();
  }

  /** All types defined directly inside `namespace`. */
  getNamespace(namespace: string): readonly WinRTTypeDef[] {
    return this.#namespaces.get(namespace) ?? [];
  }

  /** Look up a type by its exact full name (e.g. `"Windows.Media.Ocr.OcrEngine"` or `"Windows.Foundation.IAsyncOperation`1"`). */
  getType(fullName: string): WinRTTypeDef | undefined {
    return this.#types.get(fullName);
  }

  /** Compute the canonical WinRT signature string used for PIID UUIDv5 hashing. */
  typeSignature(ref: WinRTTypeRef): string {
    switch (ref.kind) {
      case "void":
        return "void";
      case "primitive":
        switch (ref.name) {
          case "Boolean":
            return "b1";
          case "UInt8":
            return "u1";
          case "Int8":
            return "i1";
          case "Int16":
            return "i2";
          case "UInt16":
            return "u2";
          case "Int32":
            return "i4";
          case "UInt32":
            return "u4";
          case "Int64":
            return "i8";
          case "UInt64":
            return "u8";
          case "Single":
            return "f4";
          case "Double":
            return "f8";
          case "Char":
            return "c2";
          case "String":
            return "string";
          case "Guid":
            return "g16";
          case "Object":
            return "cinterface(IInspectable)";
          default:
            return "u8";
        }
      case "named": {
        if (ref.fullName === "System.Guid") return "g16";
        const cached = this.#namedSignatures.get(ref.fullName);
        if (cached !== undefined) return cached;
        const def = this.#types.get(ref.fullName);
        if (!def) return `rc(${ref.fullName};cinterface(IInspectable))`;
        let sig: string;
        switch (def.kind) {
          case "enum":
            sig = enumSignature(def.fullName, def.underlying === "Int32");
            break;
          case "struct":
            sig = structSignature(
              def.fullName,
              def.fields.map((f) => this.typeSignature(f.type)),
            );
            break;
          case "interface":
            if (!def.guid) throw new Error(`Interface ${def.fullName} has no GuidAttribute`);
            sig = def.guid.toLowerCase();
            break;
          case "delegate":
            if (!def.guid) throw new Error(`Delegate ${def.fullName} has no GuidAttribute`);
            sig = delegateSignature(def.guid);
            break;
          case "class":
            if (!def.defaultInterface) throw new Error(`Runtime class ${def.fullName} has no default interface`);
            sig = runtimeClassSignature(def.fullName, this.typeSignature(def.defaultInterface));
            break;
        }
        this.#namedSignatures.set(ref.fullName, sig);
        return sig;
      }
      case "genericInst": {
        const def = this.#types.get(ref.fullName);
        if (!def || (def.kind !== "interface" && def.kind !== "delegate") || !def.guid) {
          throw new Error(`Generic template ${ref.fullName} not found or missing GuidAttribute`);
        }
        return pinterfaceSignature(
          def.guid,
          ref.args.map((a) => this.typeSignature(a)),
        );
      }
      default:
        throw new Error(`Cannot compute WinRT type signature for kind=${ref.kind}`);
    }
  }

  /** Compute the concrete IID (static GUID or UUIDv5 PIID) of an interface/delegate reference. */
  interfaceIid(ref: WinRTTypeRef): string | null {
    if (ref.kind === "named") {
      const def = this.#types.get(ref.fullName);
      return def && (def.kind === "interface" || def.kind === "delegate") ? def.guid : null;
    }
    if (ref.kind === "genericInst") {
      return computePiid(this.typeSignature(ref));
    }
    return null;
  }

  #indexFile(file: Ecma335File): void {
    const typeDefCount = file.rowCount(TableId.TypeDef);
    const fieldCount = file.rowCount(TableId.Field);
    const methodCount = file.rowCount(TableId.MethodDef);
    const paramCount = file.rowCount(TableId.Param);
    const implCount = file.rowCount(TableId.InterfaceImpl);
    const constCount = file.rowCount(TableId.Constant);
    const attrCount = file.rowCount(TableId.CustomAttribute);
    const gpCount = file.rowCount(TableId.GenericParam);

    // Pre-index CustomAttributes by parent coded key.
    const attrsByParent = new Map<string, CustomAttributeRow[]>();
    for (let r = 1; r <= attrCount; r++) {
      const attr = file.getCustomAttribute(r);
      const key = keyOfCoded(attr.parent);
      let list = attrsByParent.get(key);
      if (!list) attrsByParent.set(key, (list = []));
      list.push(attr);
    }

    // Pre-index InterfaceImpl rows by TypeDef row.
    const implsByClass = new Map<number, Array<{ readonly row: number; readonly iface: CodedIndex }>>();
    for (let r = 1; r <= implCount; r++) {
      const impl = file.getInterfaceImpl(r);
      let list = implsByClass.get(impl.classRow);
      if (!list) implsByClass.set(impl.classRow, (list = []));
      list.push({ row: r, iface: impl.iface });
    }

    // Pre-index Constants by Field row.
    const constByField = new Map<number, Buffer>();
    for (let r = 1; r <= constCount; r++) {
      const c = file.getConstant(r);
      if (c.parent.table === TableId.Field) constByField.set(c.parent.row, c.value);
    }

    // Pre-index GenericParams by TypeDef row.
    const genericParamsByTypeDef = new Map<number, string[]>();
    for (let r = 1; r <= gpCount; r++) {
      const gp = file.getGenericParam(r);
      if (gp.owner.table === TableId.TypeDef) {
        let list = genericParamsByTypeDef.get(gp.owner.row);
        if (!list) genericParamsByTypeDef.set(gp.owner.row, (list = []));
        list[gp.number] = gp.name;
      }
    }

    const resolveTypeDefOrRefName = (token: CodedIndex): string => {
      if (token.row === 0) return "";
      if (token.table === TableId.TypeDef) {
        const td = file.getTypeDef(token.row);
        return td.namespace ? `${td.namespace}.${td.name}` : td.name;
      }
      if (token.table === TableId.TypeRef) {
        const tr = file.getTypeRef(token.row);
        return tr.namespace ? `${tr.namespace}.${tr.name}` : tr.name;
      }
      return "";
    };

    const getAttrName = (attr: CustomAttributeRow): string => {
      if (attr.type.table === TableId.MemberRef) {
        const mr = file.getMemberRef(attr.type.row);
        return resolveTypeDefOrRefName(mr.parent);
      }
      if (attr.type.table === TableId.MethodDef) {
        // Rare intra-file attribute ctor; resolve by scanning TypeDef method ranges if needed.
        return "";
      }
      return "";
    };

    const getAttrCtorSigParams = (attr: CustomAttributeRow): readonly SigType[] => {
      if (attr.type.table === TableId.MemberRef) {
        const mr = file.getMemberRef(attr.type.row);
        return decodeMethodSig(mr.signature).params;
      }
      return [];
    };

    const resolveSigType = (sig: SigType, gpNames: readonly string[]): WinRTTypeRef => {
      switch (sig.kind) {
        case "primitive":
          switch (sig.code) {
            case ElementType.VOID:
              return { kind: "void" };
            case ElementType.BOOLEAN:
              return { kind: "primitive", name: "Boolean" };
            case ElementType.CHAR:
              return { kind: "primitive", name: "Char" };
            case ElementType.I1:
              return { kind: "primitive", name: "Int8" };
            case ElementType.U1:
              return { kind: "primitive", name: "UInt8" };
            case ElementType.I2:
              return { kind: "primitive", name: "Int16" };
            case ElementType.U2:
              return { kind: "primitive", name: "UInt16" };
            case ElementType.I4:
              return { kind: "primitive", name: "Int32" };
            case ElementType.U4:
              return { kind: "primitive", name: "UInt32" };
            case ElementType.I8:
              return { kind: "primitive", name: "Int64" };
            case ElementType.U8:
              return { kind: "primitive", name: "UInt64" };
            case ElementType.R4:
              return { kind: "primitive", name: "Single" };
            case ElementType.R8:
              return { kind: "primitive", name: "Double" };
            case ElementType.STRING:
              return { kind: "primitive", name: "String" };
            case ElementType.OBJECT:
              return { kind: "primitive", name: "Object" };
            case ElementType.I:
              return { kind: "primitive", name: "IntPtr" };
            case ElementType.U:
              return { kind: "primitive", name: "UIntPtr" };
            default:
              return { kind: "primitive", name: "Object" };
          }
        case "type": {
          if (sig.token.table === TableId.TypeSpec) {
            const spec = file.getTypeSpec(sig.token.row);
            return resolveSigType(readSigType(new BlobReader(spec.signature)), gpNames);
          }
          const fullName = resolveTypeDefOrRefName(sig.token);
          if (fullName === "System.Guid") return { kind: "primitive", name: "Guid" };
          if (fullName === "System.Object") return { kind: "primitive", name: "Object" };
          if (fullName === "System.String") return { kind: "primitive", name: "String" };
          return { kind: "named", fullName };
        }
        case "genericInst": {
          const fullName = resolveTypeDefOrRefName(sig.genericToken);
          return {
            kind: "genericInst",
            fullName,
            args: sig.args.map((a) => resolveSigType(a, gpNames)),
          };
        }
        case "szArray":
          return { kind: "array", element: resolveSigType(sig.element, gpNames) };
        case "byRef":
        case "ptr":
          return resolveSigType(sig.inner, gpNames);
        case "genericVar":
          return { kind: "genericParam", index: sig.index, name: gpNames[sig.index] ?? `T${sig.index}` };
      }
    };

    const resolveInterfaceRef = (token: CodedIndex, gpNames: readonly string[]): WinRTTypeRef => {
      if (token.table === TableId.TypeSpec) {
        const spec = file.getTypeSpec(token.row);
        return resolveSigType(readSigType(new BlobReader(spec.signature)), gpNames);
      }
      return { kind: "named", fullName: resolveTypeDefOrRefName(token) };
    };

    const parseMethods = (td: TypeDefRow, nextMethodRow: number, gpNames: readonly string[]): WinRTMethod[] => {
      const methods: WinRTMethod[] = [];
      for (let mRow = td.methodList; mRow < nextMethodRow; mRow++) {
        const md = file.getMethodDef(mRow);
        const nextParamRow = mRow < methodCount ? file.getMethodDef(mRow + 1).paramList : paramCount + 1;
        const decoded = decodeMethodSig(md.signature);

        const paramRows = new Map<number, { readonly name: string; readonly flags: number }>();
        for (let pRow = md.paramList; pRow < nextParamRow; pRow++) {
          const p = file.getParam(pRow);
          paramRows.set(p.sequence, { name: p.name, flags: p.flags });
        }

        const params: WinRTParam[] = decoded.params.map((sig, i) => {
          const info = paramRows.get(i + 1);
          const isByRef = sig.kind === "byRef";
          const unwrapped = isByRef ? sig.inner : sig;
          const isArray = unwrapped.kind === "szArray";
          const isOut = Boolean(info && info.flags & PARAM_FLAG_OUT);
          return {
            name: info?.name || `arg${i}`,
            type: resolveSigType(unwrapped, gpNames),
            isOut,
            isByRef,
            isArray,
          };
        });

        // Check [OverloadAttribute("...")]
        const mAttrs = attrsByParent.get(`${TableId.MethodDef}:${mRow}`) ?? [];
        let overloadName: string | null = null;
        for (const attr of mAttrs) {
          if (getAttrName(attr) === "Windows.Foundation.Metadata.OverloadAttribute") {
            overloadName = parseFirstStringArg(attr.value);
          }
        }

        const isSpecialName = Boolean(md.flags & METHOD_SPECIAL_NAME);
        methods.push({
          name: md.name,
          abiName: overloadName ?? md.name,
          returnType: resolveSigType(decoded.returnType, gpNames),
          params,
          isSpecialName,
          isGetter: isSpecialName && md.name.startsWith("get_"),
          isSetter: isSpecialName && md.name.startsWith("put_"),
          isAddEvent: isSpecialName && md.name.startsWith("add_"),
          isRemoveEvent: isSpecialName && md.name.startsWith("remove_"),
        });
      }
      return methods;
    };

    for (let row = 1; row <= typeDefCount; row++) {
      const td = file.getTypeDef(row);
      if (!td.namespace || td.name === "<Module>") continue;

      const fullName = `${td.namespace}.${td.name}`;
      if (this.#types.has(fullName)) continue;

      const nextFieldRow = row < typeDefCount ? file.getTypeDef(row + 1).fieldList : fieldCount + 1;
      const nextMethodRow = row < typeDefCount ? file.getTypeDef(row + 1).methodList : methodCount + 1;
      const extendsName = resolveTypeDefOrRefName(td.extends);
      const attrs = attrsByParent.get(`${TableId.TypeDef}:${row}`) ?? [];
      const gpNames = genericParamsByTypeDef.get(row) ?? [];

      let guid: string | null = null;
      let exclusiveTo: string | null = null;
      let isFlags = false;
      const staticInterfaces: string[] = [];
      const factoryInterfaces: string[] = [];
      const composableFactories: string[] = [];
      let hasDefaultConstructor = false;

      for (const attr of attrs) {
        const attrName = getAttrName(attr);
        if (attrName === "Windows.Foundation.Metadata.GuidAttribute") {
          const g = formatGuidFromBlob(attr.value);
          if (g) guid = normalizeGuidUpper(g);
        } else if (attrName === "Windows.Foundation.Metadata.ExclusiveToAttribute") {
          exclusiveTo = parseFirstStringArg(attr.value);
        } else if (attrName === "System.FlagsAttribute") {
          isFlags = true;
        } else if (attrName === "Windows.Foundation.Metadata.StaticAttribute") {
          const ifaceName = parseFirstStringArg(attr.value);
          if (ifaceName && !staticInterfaces.includes(ifaceName)) staticInterfaces.push(ifaceName);
        } else if (attrName === "Windows.Foundation.Metadata.ActivatableAttribute") {
          const ctorParams = getAttrCtorSigParams(attr);
          // ActivatableAttribute(uint32 version, ...) => default constructor
          // ActivatableAttribute(Type factory, uint32 version, ...) => factory interface
          if (ctorParams.length > 0 && ctorParams[0].kind === "type") {
            const factoryName = parseFirstStringArg(attr.value);
            if (factoryName && !factoryInterfaces.includes(factoryName)) factoryInterfaces.push(factoryName);
          } else {
            hasDefaultConstructor = true;
          }
        } else if (attrName === "Windows.Foundation.Metadata.ComposableAttribute") {
          const parsed = parseComposableAttr(attr.value);
          if (parsed && parsed.isPublic && !composableFactories.includes(parsed.factoryName)) {
            composableFactories.push(parsed.factoryName);
          }
        }
      }

      let def: WinRTTypeDef;

      if (extendsName === "System.Enum") {
        let underlying: "Int32" | "UInt32" = "Int32";
        const members: Array<{ readonly name: string; readonly value: number }> = [];
        for (let fRow = td.fieldList; fRow < nextFieldRow; fRow++) {
          const f = file.getField(fRow);
          if (f.name === "value__") {
            const sig = decodeFieldSig(f.signature);
            if (sig.kind === "primitive" && sig.code === ElementType.U4) underlying = "UInt32";
            continue;
          }
          const cBlob = constByField.get(fRow);
          if (cBlob && cBlob.length >= 4) {
            const value = underlying === "UInt32" ? cBlob.readUInt32LE(0) : cBlob.readInt32LE(0);
            members.push({ name: f.name, value });
          }
        }
        def = { kind: "enum", namespace: td.namespace, name: td.name, fullName, underlying, isFlags, members };
      } else if (extendsName === "System.ValueType") {
        const fields: WinRTStructField[] = [];
        for (let fRow = td.fieldList; fRow < nextFieldRow; fRow++) {
          const f = file.getField(fRow);
          // Skip static literal fields if any.
          if (f.flags & 0x0010) continue;
          fields.push({ name: f.name, type: resolveSigType(decodeFieldSig(f.signature), gpNames) });
        }
        def = { kind: "struct", namespace: td.namespace, name: td.name, fullName, fields };
      } else if (extendsName === "System.MulticastDelegate") {
        const methods = parseMethods(td, nextMethodRow, gpNames);
        const invoke = methods.find((m) => m.name === "Invoke") ?? null;
        def = { kind: "delegate", namespace: td.namespace, name: td.name, fullName, guid, genericParams: gpNames, invoke };
      } else if (td.flags & TYPE_SEMANTICS_INTERFACE) {
        const impls = implsByClass.get(row) ?? [];
        const requiredInterfaces = impls.map((impl) => resolveInterfaceRef(impl.iface, gpNames));
        const methods = parseMethods(td, nextMethodRow, gpNames);
        def = { kind: "interface", namespace: td.namespace, name: td.name, fullName, guid, genericParams: gpNames, requiredInterfaces, methods, exclusiveTo };
      } else {
        // Runtime class (extends System.Object or another runtime class).
        const impls = implsByClass.get(row) ?? [];
        const interfaces: WinRTTypeRef[] = [];
        let defaultInterface: WinRTTypeRef | null = null;
        let isClosable = false;

        for (const impl of impls) {
          const ref = resolveInterfaceRef(impl.iface, gpNames);
          interfaces.push(ref);
          if (ref.kind === "named" && ref.fullName === "Windows.Foundation.IClosable") isClosable = true;
          const implAttrs = attrsByParent.get(`${TableId.InterfaceImpl}:${impl.row}`) ?? [];
          if (implAttrs.some((a) => getAttrName(a) === "Windows.Foundation.Metadata.DefaultAttribute")) {
            defaultInterface = ref;
          }
        }
        if (!defaultInterface && interfaces.length > 0) defaultInterface = interfaces[0];

        const baseClass = extendsName && extendsName !== "System.Object" ? extendsName : null;

        def = {
          kind: "class",
          namespace: td.namespace,
          name: td.name,
          fullName,
          baseClass,
          defaultInterface,
          interfaces,
          staticInterfaces,
          factoryInterfaces,
          composableFactories,
          hasDefaultConstructor,
          isClosable,
        };
      }

      this.#types.set(fullName, def);
      let nsList = this.#namespaces.get(td.namespace);
      if (!nsList) this.#namespaces.set(td.namespace, (nsList = []));
      nsList.push(def);
    }
  }
}
