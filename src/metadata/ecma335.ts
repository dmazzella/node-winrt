import { readFileSync } from "node:fs";

/** ECMA-335 metadata table IDs (II.22). */
export const TableId = {
  Module: 0x00,
  TypeRef: 0x01,
  TypeDef: 0x02,
  Field: 0x04,
  MethodDef: 0x06,
  Param: 0x08,
  InterfaceImpl: 0x09,
  MemberRef: 0x0a,
  Constant: 0x0b,
  CustomAttribute: 0x0c,
  FieldMarshal: 0x0d,
  DeclSecurity: 0x0e,
  ClassLayout: 0x0f,
  FieldLayout: 0x10,
  StandAloneSig: 0x11,
  EventMap: 0x12,
  Event: 0x14,
  PropertyMap: 0x15,
  Property: 0x17,
  MethodSemantics: 0x18,
  MethodImpl: 0x19,
  ModuleRef: 0x1a,
  TypeSpec: 0x1b,
  ImplMap: 0x1c,
  FieldRVA: 0x1d,
  Assembly: 0x20,
  AssemblyProcessor: 0x21,
  AssemblyOS: 0x22,
  AssemblyRef: 0x23,
  AssemblyRefProcessor: 0x24,
  AssemblyRefOS: 0x25,
  File: 0x26,
  ExportedType: 0x27,
  ManifestResource: 0x28,
  NestedClass: 0x29,
  GenericParam: 0x2a,
  MethodSpec: 0x2b,
  GenericParamConstraint: 0x2c,
} as const;

export type TableIdValue = (typeof TableId)[keyof typeof TableId];

/** ECMA-335 element type codes (II.23.1.16). */
export const ElementType = {
  END: 0x00,
  VOID: 0x01,
  BOOLEAN: 0x02,
  CHAR: 0x03,
  I1: 0x04,
  U1: 0x05,
  I2: 0x06,
  U2: 0x07,
  I4: 0x08,
  U4: 0x09,
  I8: 0x0a,
  U8: 0x0b,
  R4: 0x0c,
  R8: 0x0d,
  STRING: 0x0e,
  PTR: 0x0f,
  BYREF: 0x10,
  VALUETYPE: 0x11,
  CLASS: 0x12,
  VAR: 0x13,
  ARRAY: 0x14,
  GENERICINST: 0x15,
  TYPEDBYREF: 0x16,
  I: 0x18,
  U: 0x19,
  FNPTR: 0x1b,
  OBJECT: 0x1c,
  SZARRAY: 0x1d,
  MVAR: 0x1e,
  CMOD_REQD: 0x1f,
  CMOD_OPT: 0x20,
} as const;

/** Decoded coded index: `{ table, row }` (1-based row; `0` means null). */
export interface CodedIndex {
  readonly table: number;
  readonly row: number;
}

interface CodedIndexDef {
  readonly tagBits: number;
  readonly tables: readonly number[];
}

const CODED_INDEXES: Record<string, CodedIndexDef> = {
  TypeDefOrRef: { tagBits: 2, tables: [TableId.TypeDef, TableId.TypeRef, TableId.TypeSpec] },
  HasConstant: { tagBits: 2, tables: [TableId.Field, TableId.Param, TableId.Property] },
  HasCustomAttribute: {
    tagBits: 5,
    tables: [
      TableId.MethodDef,
      TableId.Field,
      TableId.TypeRef,
      TableId.TypeDef,
      TableId.Param,
      TableId.InterfaceImpl,
      TableId.MemberRef,
      TableId.Module,
      TableId.DeclSecurity,
      TableId.Property,
      TableId.Event,
      TableId.StandAloneSig,
      TableId.ModuleRef,
      TableId.TypeSpec,
      TableId.Assembly,
      TableId.AssemblyRef,
      TableId.File,
      TableId.ExportedType,
      TableId.ManifestResource,
      TableId.GenericParam,
      TableId.GenericParamConstraint,
      TableId.MethodSpec,
    ],
  },
  HasFieldMarshal: { tagBits: 1, tables: [TableId.Field, TableId.Param] },
  HasDeclSecurity: { tagBits: 2, tables: [TableId.TypeDef, TableId.MethodDef, TableId.Assembly] },
  MemberRefParent: { tagBits: 3, tables: [TableId.TypeDef, TableId.TypeRef, TableId.ModuleRef, TableId.MethodDef, TableId.TypeSpec] },
  HasSemantics: { tagBits: 1, tables: [TableId.Event, TableId.Property] },
  MethodDefOrRef: { tagBits: 1, tables: [TableId.MethodDef, TableId.MemberRef] },
  MemberForwarded: { tagBits: 1, tables: [TableId.Field, TableId.MethodDef] },
  Implementation: { tagBits: 2, tables: [TableId.File, TableId.AssemblyRef, TableId.ExportedType] },
  CustomAttributeType: { tagBits: 3, tables: [-1, -1, TableId.MethodDef, TableId.MemberRef, -1] },
  ResolutionScope: { tagBits: 2, tables: [TableId.Module, TableId.ModuleRef, TableId.AssemblyRef, TableId.TypeRef] },
  TypeOrMethodDef: { tagBits: 1, tables: [TableId.TypeDef, TableId.MethodDef] },
};

interface SectionHeader {
  readonly virtualSize: number;
  readonly virtualAddress: number;
  readonly rawSize: number;
  readonly rawOffset: number;
}

export interface TypeRefRow {
  readonly row: number;
  readonly resolutionScope: CodedIndex;
  readonly name: string;
  readonly namespace: string;
}

export interface TypeDefRow {
  readonly row: number;
  readonly flags: number;
  readonly name: string;
  readonly namespace: string;
  readonly extends: CodedIndex;
  readonly fieldList: number;
  readonly methodList: number;
}

export interface FieldRow {
  readonly row: number;
  readonly flags: number;
  readonly name: string;
  readonly signature: Buffer;
}

export interface MethodDefRow {
  readonly row: number;
  readonly rva: number;
  readonly implFlags: number;
  readonly flags: number;
  readonly name: string;
  readonly signature: Buffer;
  readonly paramList: number;
}

export interface ParamRow {
  readonly row: number;
  readonly flags: number;
  readonly sequence: number;
  readonly name: string;
}

export interface InterfaceImplRow {
  readonly row: number;
  readonly classRow: number;
  readonly iface: CodedIndex;
}

export interface MemberRefRow {
  readonly row: number;
  readonly parent: CodedIndex;
  readonly name: string;
  readonly signature: Buffer;
}

export interface ConstantRow {
  readonly row: number;
  readonly type: number;
  readonly parent: CodedIndex;
  readonly value: Buffer;
}

export interface CustomAttributeRow {
  readonly row: number;
  readonly parent: CodedIndex;
  readonly type: CodedIndex;
  readonly value: Buffer;
}

export interface TypeSpecRow {
  readonly row: number;
  readonly signature: Buffer;
}

export interface GenericParamRow {
  readonly row: number;
  readonly number: number;
  readonly flags: number;
  readonly owner: CodedIndex;
  readonly name: string;
}

export interface EventMapRow {
  readonly row: number;
  readonly parent: number;
  readonly eventList: number;
}

export interface EventRow {
  readonly row: number;
  readonly flags: number;
  readonly name: string;
  readonly eventType: CodedIndex;
}

export interface PropertyMapRow {
  readonly row: number;
  readonly parent: number;
  readonly propertyList: number;
}

export interface PropertyRow {
  readonly row: number;
  readonly flags: number;
  readonly name: string;
  readonly signature: Buffer;
}

export interface MethodSemanticsRow {
  readonly row: number;
  readonly semantics: number;
  readonly method: number;
  readonly association: CodedIndex;
}

/** Reader for ECMA-335 `#Blob` compressed integers and signatures. */
export class BlobReader {
  readonly buffer: Buffer;
  offset: number;

  constructor(buffer: Buffer, offset = 0) {
    this.buffer = buffer;
    this.offset = offset;
  }

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  readU8(): number {
    return this.buffer[this.offset++];
  }

  readU16(): number {
    const v = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return v;
  }

  readI32(): number {
    const v = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  readU32(): number {
    const v = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  /** ECMA-335 II.23.2 compressed unsigned integer (1, 2, or 4 bytes). */
  readCompressedUInt(): number {
    const b0 = this.buffer[this.offset++];
    if ((b0 & 0x80) === 0) return b0;
    if ((b0 & 0xc0) === 0x80) {
      const b1 = this.buffer[this.offset++];
      return ((b0 & 0x3f) << 8) | b1;
    }
    const b1 = this.buffer[this.offset++];
    const b2 = this.buffer[this.offset++];
    const b3 = this.buffer[this.offset++];
    return (((b0 & 0x1f) << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
  }

  /** ECMA-335 II.23.3 SerString (used in CustomAttribute blobs). */
  readSerString(): string | null {
    if (this.remaining <= 0) return null;
    if (this.buffer[this.offset] === 0xff) {
      this.offset++;
      return null;
    }
    const byteLen = this.readCompressedUInt();
    const str = this.buffer.toString("utf8", this.offset, this.offset + byteLen);
    this.offset += byteLen;
    return str;
  }

  /** Read a `TypeDefOrRefEncoded` compressed token (ECMA-335 II.23.2.8). */
  readTypeDefOrRefEncoded(): CodedIndex {
    const encoded = this.readCompressedUInt();
    const tag = encoded & 0x3;
    const row = encoded >>> 2;
    const table = tag === 0 ? TableId.TypeDef : tag === 1 ? TableId.TypeRef : TableId.TypeSpec;
    return { table, row };
  }
}

/** Decoded signature type tree from `#Blob` (ECMA-335 II.23.2.12). */
export type SigType =
  | { readonly kind: "primitive"; readonly code: number }
  | { readonly kind: "type"; readonly isValueType: boolean; readonly token: CodedIndex }
  | { readonly kind: "genericInst"; readonly isValueType: boolean; readonly genericToken: CodedIndex; readonly args: readonly SigType[] }
  | { readonly kind: "szArray"; readonly element: SigType }
  | { readonly kind: "byRef"; readonly inner: SigType }
  | { readonly kind: "ptr"; readonly inner: SigType }
  | { readonly kind: "genericVar"; readonly index: number; readonly methodVar: boolean };

/** Parse a single ECMA-335 `Type` signature from `reader`. */
export function readSigType(reader: BlobReader): SigType {
  while (true) {
    const code = reader.readU8();
    if (code === ElementType.CMOD_REQD || code === ElementType.CMOD_OPT) {
      reader.readTypeDefOrRefEncoded();
      continue;
    }
    if (code === ElementType.BYREF) return { kind: "byRef", inner: readSigType(reader) };
    if (code === ElementType.PTR) return { kind: "ptr", inner: readSigType(reader) };
    if (code === ElementType.SZARRAY) return { kind: "szArray", element: readSigType(reader) };
    if (code === ElementType.VALUETYPE || code === ElementType.CLASS) {
      return { kind: "type", isValueType: code === ElementType.VALUETYPE, token: reader.readTypeDefOrRefEncoded() };
    }
    if (code === ElementType.GENERICINST) {
      const innerCode = reader.readU8();
      const genericToken = reader.readTypeDefOrRefEncoded();
      const argCount = reader.readCompressedUInt();
      const args: SigType[] = [];
      for (let i = 0; i < argCount; i++) args.push(readSigType(reader));
      return { kind: "genericInst", isValueType: innerCode === ElementType.VALUETYPE, genericToken, args };
    }
    if (code === ElementType.VAR || code === ElementType.MVAR) {
      return { kind: "genericVar", index: reader.readCompressedUInt(), methodVar: code === ElementType.MVAR };
    }
    if (code === ElementType.ARRAY) {
      const element = readSigType(reader);
      const _rank = reader.readCompressedUInt();
      const numSizes = reader.readCompressedUInt();
      for (let i = 0; i < numSizes; i++) reader.readCompressedUInt();
      const numLoBounds = reader.readCompressedUInt();
      for (let i = 0; i < numLoBounds; i++) reader.readCompressedUInt();
      return { kind: "szArray", element };
    }
    return { kind: "primitive", code };
  }
}

export interface DecodedMethodSig {
  readonly callingConvention: number;
  readonly genericParamCount: number;
  readonly returnType: SigType;
  readonly params: readonly SigType[];
}

export function decodeMethodSig(blob: Buffer): DecodedMethodSig {
  const reader = new BlobReader(blob);
  const callingConvention = reader.readU8();
  const genericParamCount = callingConvention & 0x10 ? reader.readCompressedUInt() : 0;
  const paramCount = reader.readCompressedUInt();
  const returnType = readSigType(reader);
  const params: SigType[] = [];
  for (let i = 0; i < paramCount; i++) params.push(readSigType(reader));
  return { callingConvention, genericParamCount, returnType, params };
}

export function decodeFieldSig(blob: Buffer): SigType {
  const reader = new BlobReader(blob);
  const _prologue = reader.readU8(); // 0x06
  return readSigType(reader);
}

/**
 * Pure-TypeScript ECMA-335 PE/CLI metadata reader for `.winmd` files.
 * Works on Windows, macOS, and Linux with zero native dependencies.
 */
export class Ecma335File {
  readonly path: string;
  readonly #buf: Buffer;
  readonly #strings: Buffer;
  readonly #blob: Buffer;
  readonly #rowCounts = new Int32Array(64);
  readonly #tableOffsets = new Int32Array(64);
  readonly #rowSizes = new Int32Array(64);
  readonly #strIdxSize: number;
  readonly #guidIdxSize: number;
  readonly #blobIdxSize: number;

  constructor(path: string, buffer?: Buffer) {
    this.path = path;
    const buf = buffer ?? readFileSync(path);
    this.#buf = buf;

    // 1. PE / COFF / Optional header
    if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error(`${path}: not a valid PE file (missing MZ header)`);
    const peOffset = buf.readUInt32LE(0x3c);
    if (buf.readUInt32LE(peOffset) !== 0x00004550) throw new Error(`${path}: invalid PE signature`);
    const numSections = buf.readUInt16LE(peOffset + 6);
    const optHeaderSize = buf.readUInt16LE(peOffset + 20);
    const optOffset = peOffset + 24;
    const magic = buf.readUInt16LE(optOffset);
    const dataDirOffset = magic === 0x10b ? optOffset + 96 : magic === 0x20b ? optOffset + 112 : -1;
    if (dataDirOffset < 0) throw new Error(`${path}: unsupported PE optional header magic 0x${magic.toString(16)}`);

    const sections: SectionHeader[] = [];
    const secStart = optOffset + optHeaderSize;
    for (let i = 0; i < numSections; i++) {
      const off = secStart + i * 40;
      sections.push({
        virtualSize: buf.readUInt32LE(off + 8),
        virtualAddress: buf.readUInt32LE(off + 12),
        rawSize: buf.readUInt32LE(off + 16),
        rawOffset: buf.readUInt32LE(off + 20),
      });
    }

    const rvaToOffset = (rva: number): number => {
      for (const s of sections) {
        const span = Math.max(s.virtualSize, s.rawSize);
        if (rva >= s.virtualAddress && rva < s.virtualAddress + span) {
          return s.rawOffset + (rva - s.virtualAddress);
        }
      }
      throw new Error(`${path}: RVA 0x${rva.toString(16)} is outside all PE sections`);
    };

    // 2. CLI Header (DataDirectory[14]) -> Metadata Root ("BSJB")
    const cliRva = buf.readUInt32LE(dataDirOffset + 14 * 8);
    if (!cliRva) throw new Error(`${path}: missing CLI header (not a .winmd / ECMA-335 file)`);
    const cliOff = rvaToOffset(cliRva);
    const metaRva = buf.readUInt32LE(cliOff + 8);
    const metaOff = rvaToOffset(metaRva);
    if (buf.readUInt32LE(metaOff) !== 0x424a5342) throw new Error(`${path}: invalid metadata signature (expected BSJB)`);

    const versionLen = buf.readUInt32LE(metaOff + 12);
    const paddedVersionLen = (versionLen + 3) & ~3;
    const streamCount = buf.readUInt16LE(metaOff + 16 + paddedVersionLen + 2);
    let cursor = metaOff + 16 + paddedVersionLen + 4;

    let tablesStream: Buffer | null = null;
    let stringsStream: Buffer | null = null;
    let blobStream: Buffer | null = null;

    for (let i = 0; i < streamCount; i++) {
      const sOff = buf.readUInt32LE(cursor);
      const sSize = buf.readUInt32LE(cursor + 4);
      cursor += 8;
      const nameStart = cursor;
      while (buf[cursor] !== 0) cursor++;
      const name = buf.toString("ascii", nameStart, cursor);
      cursor = (cursor + 4) & ~3; // include NUL and pad to 4 bytes
      const slice = buf.subarray(metaOff + sOff, metaOff + sOff + sSize);
      if (name === "#~" || name === "#-") tablesStream = slice;
      else if (name === "#Strings") stringsStream = slice;
      else if (name === "#Blob") blobStream = slice;
    }

    if (!tablesStream || !stringsStream || !blobStream) {
      throw new Error(`${path}: missing required CLI metadata streams (#~, #Strings, #Blob)`);
    }
    this.#strings = stringsStream;
    this.#blob = blobStream;

    // 3. Parse #~ table header
    const heapSizes = tablesStream[6];
    this.#strIdxSize = heapSizes & 0x01 ? 4 : 2;
    this.#guidIdxSize = heapSizes & 0x02 ? 4 : 2;
    this.#blobIdxSize = heapSizes & 0x04 ? 4 : 2;

    const validMask = tablesStream.readBigUInt64LE(8);
    let tCursor = 24;
    for (let t = 0; t < 64; t++) {
      if ((validMask >> BigInt(t)) & 1n) {
        this.#rowCounts[t] = tablesStream.readUInt32LE(tCursor);
        tCursor += 4;
      }
    }

    const baseOffsetInFile = tablesStream.byteOffset - buf.byteOffset;
    let runningOffset = baseOffsetInFile + tCursor;
    for (let t = 0; t < 64; t++) {
      const count = this.#rowCounts[t];
      if (count > 0) {
        const size = this.#computeRowSize(t);
        this.#rowSizes[t] = size;
        this.#tableOffsets[t] = runningOffset;
        runningOffset += count * size;
      }
    }
  }

  rowCount(table: number): number {
    return this.#rowCounts[table];
  }

  #simpleIdxSize(table: number): number {
    return this.#rowCounts[table] < 65536 ? 2 : 4;
  }

  #codedIdxSize(name: string): number {
    const def = CODED_INDEXES[name];
    let maxRows = 0;
    for (const t of def.tables) {
      if (t >= 0 && this.#rowCounts[t] > maxRows) maxRows = this.#rowCounts[t];
    }
    return maxRows < 1 << (16 - def.tagBits) ? 2 : 4;
  }

  #computeRowSize(table: number): number {
    const s = this.#strIdxSize;
    const g = this.#guidIdxSize;
    const b = this.#blobIdxSize;
    const idx = (t: number) => this.#simpleIdxSize(t);
    const coded = (n: string) => this.#codedIdxSize(n);

    switch (table) {
      case TableId.Module:
        return 2 + s + g + g + g;
      case TableId.TypeRef:
        return coded("ResolutionScope") + s + s;
      case TableId.TypeDef:
        return 4 + s + s + coded("TypeDefOrRef") + idx(TableId.Field) + idx(TableId.MethodDef);
      case TableId.Field:
        return 2 + s + b;
      case TableId.MethodDef:
        return 4 + 2 + 2 + s + b + idx(TableId.Param);
      case TableId.Param:
        return 2 + 2 + s;
      case TableId.InterfaceImpl:
        return idx(TableId.TypeDef) + coded("TypeDefOrRef");
      case TableId.MemberRef:
        return coded("MemberRefParent") + s + b;
      case TableId.Constant:
        return 2 + coded("HasConstant") + b;
      case TableId.CustomAttribute:
        return coded("HasCustomAttribute") + coded("CustomAttributeType") + b;
      case TableId.FieldMarshal:
        return coded("HasFieldMarshal") + b;
      case TableId.DeclSecurity:
        return 2 + coded("HasDeclSecurity") + b;
      case TableId.ClassLayout:
        return 2 + 4 + idx(TableId.TypeDef);
      case TableId.FieldLayout:
        return 4 + idx(TableId.Field);
      case TableId.StandAloneSig:
        return b;
      case TableId.EventMap:
        return idx(TableId.TypeDef) + idx(TableId.Event);
      case TableId.Event:
        return 2 + s + coded("TypeDefOrRef");
      case TableId.PropertyMap:
        return idx(TableId.TypeDef) + idx(TableId.Property);
      case TableId.Property:
        return 2 + s + b;
      case TableId.MethodSemantics:
        return 2 + idx(TableId.MethodDef) + coded("HasSemantics");
      case TableId.MethodImpl:
        return idx(TableId.TypeDef) + coded("MethodDefOrRef") + coded("MethodDefOrRef");
      case TableId.ModuleRef:
        return s;
      case TableId.TypeSpec:
        return b;
      case TableId.ImplMap:
        return 2 + coded("MemberForwarded") + s + idx(TableId.ModuleRef);
      case TableId.FieldRVA:
        return 4 + idx(TableId.Field);
      case TableId.Assembly:
        return 4 + 2 + 2 + 2 + 2 + 4 + b + s + s;
      case TableId.AssemblyProcessor:
        return 4;
      case TableId.AssemblyOS:
        return 12;
      case TableId.AssemblyRef:
        return 2 + 2 + 2 + 2 + 4 + b + s + s + b;
      case TableId.AssemblyRefProcessor:
        return 4 + idx(TableId.AssemblyRef);
      case TableId.AssemblyRefOS:
        return 12 + idx(TableId.AssemblyRef);
      case TableId.File:
        return 4 + s + b;
      case TableId.ExportedType:
        return 4 + 4 + s + s + coded("Implementation");
      case TableId.ManifestResource:
        return 4 + 4 + s + coded("Implementation");
      case TableId.NestedClass:
        return idx(TableId.TypeDef) + idx(TableId.TypeDef);
      case TableId.GenericParam:
        return 2 + 2 + coded("TypeOrMethodDef") + s;
      case TableId.MethodSpec:
        return coded("MethodDefOrRef") + b;
      case TableId.GenericParamConstraint:
        return idx(TableId.GenericParam) + coded("TypeDefOrRef");
      default:
        throw new Error(`${this.path}: unsupported ECMA-335 metadata table 0x${table.toString(16)}`);
    }
  }

  #readIdx(off: number, size: number): number {
    return size === 2 ? this.#buf.readUInt16LE(off) : this.#buf.readUInt32LE(off);
  }

  #readCoded(off: number, name: string): { readonly value: CodedIndex; readonly next: number } {
    const def = CODED_INDEXES[name];
    const size = this.#codedIdxSize(name);
    const raw = this.#readIdx(off, size);
    const mask = (1 << def.tagBits) - 1;
    const tag = raw & mask;
    const row = raw >>> def.tagBits;
    const table = tag < def.tables.length ? def.tables[tag] : -1;
    return { value: { table, row }, next: off + size };
  }

  getString(index: number): string {
    if (index === 0 || index >= this.#strings.length) return "";
    let end = index;
    while (end < this.#strings.length && this.#strings[end] !== 0) end++;
    return this.#strings.toString("utf8", index, end);
  }

  getBlob(index: number): Buffer {
    if (index === 0 || index >= this.#blob.length) return Buffer.alloc(0);
    const reader = new BlobReader(this.#blob, index);
    const len = reader.readCompressedUInt();
    return this.#blob.subarray(reader.offset, reader.offset + len);
  }

  #rowOff(table: number, row: number): number {
    return this.#tableOffsets[table] + (row - 1) * this.#rowSizes[table];
  }

  getTypeRef(row: number): TypeRefRow {
    let off = this.#rowOff(TableId.TypeRef, row);
    const scope = this.#readCoded(off, "ResolutionScope");
    off = scope.next;
    const name = this.getString(this.#readIdx(off, this.#strIdxSize));
    off += this.#strIdxSize;
    const namespace = this.getString(this.#readIdx(off, this.#strIdxSize));
    return { row, resolutionScope: scope.value, name, namespace };
  }

  getTypeDef(row: number): TypeDefRow {
    let off = this.#rowOff(TableId.TypeDef, row);
    const flags = this.#buf.readUInt32LE(off);
    off += 4;
    const name = this.getString(this.#readIdx(off, this.#strIdxSize));
    off += this.#strIdxSize;
    const namespace = this.getString(this.#readIdx(off, this.#strIdxSize));
    off += this.#strIdxSize;
    const ext = this.#readCoded(off, "TypeDefOrRef");
    off = ext.next;
    const fSize = this.#simpleIdxSize(TableId.Field);
    const fieldList = this.#readIdx(off, fSize);
    off += fSize;
    const mSize = this.#simpleIdxSize(TableId.MethodDef);
    const methodList = this.#readIdx(off, mSize);
    return { row, flags, name, namespace, extends: ext.value, fieldList, methodList };
  }

  getField(row: number): FieldRow {
    let off = this.#rowOff(TableId.Field, row);
    const flags = this.#buf.readUInt16LE(off);
    off += 2;
    const name = this.getString(this.#readIdx(off, this.#strIdxSize));
    off += this.#strIdxSize;
    const signature = this.getBlob(this.#readIdx(off, this.#blobIdxSize));
    return { row, flags, name, signature };
  }

  getMethodDef(row: number): MethodDefRow {
    let off = this.#rowOff(TableId.MethodDef, row);
    const rva = this.#buf.readUInt32LE(off);
    off += 4;
    const implFlags = this.#buf.readUInt16LE(off);
    off += 2;
    const flags = this.#buf.readUInt16LE(off);
    off += 2;
    const name = this.getString(this.#readIdx(off, this.#strIdxSize));
    off += this.#strIdxSize;
    const signature = this.getBlob(this.#readIdx(off, this.#blobIdxSize));
    off += this.#blobIdxSize;
    const paramList = this.#readIdx(off, this.#simpleIdxSize(TableId.Param));
    return { row, rva, implFlags, flags, name, signature, paramList };
  }

  getParam(row: number): ParamRow {
    let off = this.#rowOff(TableId.Param, row);
    const flags = this.#buf.readUInt16LE(off);
    off += 2;
    const sequence = this.#buf.readUInt16LE(off);
    off += 2;
    const name = this.getString(this.#readIdx(off, this.#strIdxSize));
    return { row, flags, sequence, name };
  }

  getInterfaceImpl(row: number): InterfaceImplRow {
    let off = this.#rowOff(TableId.InterfaceImpl, row);
    const tdSize = this.#simpleIdxSize(TableId.TypeDef);
    const classRow = this.#readIdx(off, tdSize);
    off += tdSize;
    const iface = this.#readCoded(off, "TypeDefOrRef").value;
    return { row, classRow, iface };
  }

  getMemberRef(row: number): MemberRefRow {
    let off = this.#rowOff(TableId.MemberRef, row);
    const parent = this.#readCoded(off, "MemberRefParent");
    off = parent.next;
    const name = this.getString(this.#readIdx(off, this.#strIdxSize));
    off += this.#strIdxSize;
    const signature = this.getBlob(this.#readIdx(off, this.#blobIdxSize));
    return { row, parent: parent.value, name, signature };
  }

  getConstant(row: number): ConstantRow {
    let off = this.#rowOff(TableId.Constant, row);
    const type = this.#buf[off];
    off += 2;
    const parent = this.#readCoded(off, "HasConstant");
    off = parent.next;
    const value = this.getBlob(this.#readIdx(off, this.#blobIdxSize));
    return { row, type, parent: parent.value, value };
  }

  getCustomAttribute(row: number): CustomAttributeRow {
    let off = this.#rowOff(TableId.CustomAttribute, row);
    const parent = this.#readCoded(off, "HasCustomAttribute");
    off = parent.next;
    const type = this.#readCoded(off, "CustomAttributeType");
    off = type.next;
    const value = this.getBlob(this.#readIdx(off, this.#blobIdxSize));
    return { row, parent: parent.value, type: type.value, value };
  }

  getTypeSpec(row: number): TypeSpecRow {
    const off = this.#rowOff(TableId.TypeSpec, row);
    return { row, signature: this.getBlob(this.#readIdx(off, this.#blobIdxSize)) };
  }

  getGenericParam(row: number): GenericParamRow {
    let off = this.#rowOff(TableId.GenericParam, row);
    const number = this.#buf.readUInt16LE(off);
    off += 2;
    const flags = this.#buf.readUInt16LE(off);
    off += 2;
    const owner = this.#readCoded(off, "TypeOrMethodDef");
    off = owner.next;
    const name = this.getString(this.#readIdx(off, this.#strIdxSize));
    return { row, number, flags, owner: owner.value, name };
  }

  getEventMap(row: number): EventMapRow {
    let off = this.#rowOff(TableId.EventMap, row);
    const tdSize = this.#simpleIdxSize(TableId.TypeDef);
    const parent = this.#readIdx(off, tdSize);
    off += tdSize;
    const eventList = this.#readIdx(off, this.#simpleIdxSize(TableId.Event));
    return { row, parent, eventList };
  }

  getEvent(row: number): EventRow {
    let off = this.#rowOff(TableId.Event, row);
    const flags = this.#buf.readUInt16LE(off);
    off += 2;
    const name = this.getString(this.#readIdx(off, this.#strIdxSize));
    off += this.#strIdxSize;
    const eventType = this.#readCoded(off, "TypeDefOrRef").value;
    return { row, flags, name, eventType };
  }

  getPropertyMap(row: number): PropertyMapRow {
    let off = this.#rowOff(TableId.PropertyMap, row);
    const tdSize = this.#simpleIdxSize(TableId.TypeDef);
    const parent = this.#readIdx(off, tdSize);
    off += tdSize;
    const propertyList = this.#readIdx(off, this.#simpleIdxSize(TableId.Property));
    return { row, parent, propertyList };
  }

  getProperty(row: number): PropertyRow {
    let off = this.#rowOff(TableId.Property, row);
    const flags = this.#buf.readUInt16LE(off);
    off += 2;
    const name = this.getString(this.#readIdx(off, this.#strIdxSize));
    off += this.#strIdxSize;
    const signature = this.getBlob(this.#readIdx(off, this.#blobIdxSize));
    return { row, flags, name, signature };
  }

  getMethodSemantics(row: number): MethodSemanticsRow {
    let off = this.#rowOff(TableId.MethodSemantics, row);
    const semantics = this.#buf.readUInt16LE(off);
    off += 2;
    const mSize = this.#simpleIdxSize(TableId.MethodDef);
    const method = this.#readIdx(off, mSize);
    off += mSize;
    const association = this.#readCoded(off, "HasSemantics").value;
    return { row, semantics, method, association };
  }
}
