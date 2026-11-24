import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asyncOperationCompletedHandlerPiid,
  asyncOperationPiid,
  asyncOperationWithProgressCompletedHandlerPiid,
  asyncOperationWithProgressPiid,
  computePiid,
  enumSignature,
  eventHandlerPiid,
  mapIterablePiid,
  packPackageVersion,
  pinterfaceSignature,
  runtimeClassSignature,
  structSignature,
  typedEventHandlerPiid,
  vectorViewPiid,
  WINRT_GENERIC_GUIDS,
  WinMdStore,
} from "../../dist/index.js";

describe("WinRT PIID (UUIDv5) computation", () => {
  it("matches exact Microsoft Windows SDK IIDs for parameterized interfaces and delegates", () => {
    // Verified directly against Windows SDK 10.0.26100.0 headers:
    // - windows.graphics.capture.h:
    //   ITypedEventHandler<Direct3D11CaptureFramePool*, IInspectable*> = {51a947f7-79cf-5a3e-a3a5-1289cfa6dfe8}
    //   ITypedEventHandler<GraphicsCaptureItem*, IInspectable*>        = {e9c610c0-a68c-5bd9-8021-8589346eeee2}
    const framePoolSig = runtimeClassSignature("Windows.Graphics.Capture.Direct3D11CaptureFramePool", "{24eb6d22-1975-422e-82e7-780dbd8ddf24}");
    const captureItemSig = runtimeClassSignature("Windows.Graphics.Capture.GraphicsCaptureItem", "{79c3f95b-31f7-4ec2-a464-632ef5d30760}");

    assert.equal(typedEventHandlerPiid(framePoolSig, "cinterface(IInspectable)"), "{51A947F7-79CF-5A3E-A3A5-1289CFA6DFE8}");
    assert.equal(typedEventHandlerPiid(captureItemSig, "cinterface(IInspectable)"), "{E9C610C0-A68C-5BD9-8021-8589346EEEE2}");

    // OcrResult / OcrLine / OcrWord parameterized interfaces
    const ocrResultSig = runtimeClassSignature("Windows.Media.Ocr.OcrResult", "{9bd235b2-175b-3d6a-92e2-388c206e2f63}");
    assert.equal(asyncOperationPiid(ocrResultSig), "{C7D7118E-AE36-59C0-AC76-7BADEE711C8B}");
    assert.equal(asyncOperationCompletedHandlerPiid(ocrResultSig), "{989C1371-444A-5E7E-B197-9EAAF9D2829A}");

    // Helper signature builders
    assert.equal(enumSignature("Windows.Graphics.Imaging.BitmapPixelFormat", true), "enum(Windows.Graphics.Imaging.BitmapPixelFormat;i4)");
    assert.equal(structSignature("Windows.Foundation.Rect", ["f4", "f4", "f4", "f4"]), "struct(Windows.Foundation.Rect;f4;f4;f4;f4)");
    assert.equal(computePiid(pinterfaceSignature(WINRT_GENERIC_GUIDS.IVectorView, ["string"])), vectorViewPiid("string"));

    // Progress, EventHandler, Map iterable PIIDs & PACKAGE_VERSION packing
    assert.match(asyncOperationWithProgressPiid("u4", "u4"), /^\{[0-9A-F-]{36}\}$/);
    assert.match(asyncOperationWithProgressCompletedHandlerPiid("u4", "u4"), /^\{[0-9A-F-]{36}\}$/);
    assert.match(eventHandlerPiid("cinterface(IInspectable)"), /^\{[0-9A-F-]{36}\}$/);
    assert.match(mapIterablePiid("string", "string"), /^\{[0-9A-F-]{36}\}$/);
    assert.equal(packPackageVersion(1, 6, 2, 3), 0x0001_0006_0002_0003n);
  });
});

describe("WinMdStore (ECMA-335 .winmd metadata reader)", { skip: process.platform !== "win32" }, () => {
  it("loads System32 WinMetadata and resolves enums, structs, interfaces, and runtime classes", () => {
    const store = new WinMdStore();
    assert.ok(store.files.length >= 10, "expected System32 WinMetadata .winmd files");
    const namespaces = store.listNamespaces();
    assert.ok(namespaces.includes("Windows.Media.Ocr"));
    assert.ok(namespaces.includes("Windows.Graphics.Capture"));
    assert.ok(namespaces.includes("Windows.Globalization"));

    const pixelFmt = store.getType("Windows.Graphics.Imaging.BitmapPixelFormat");
    assert.equal(pixelFmt?.kind, "enum");
    assert.equal(pixelFmt.members.find((m) => m.name === "Bgra8")?.value, 87);

    const rect = store.getType("Windows.Foundation.Rect");
    assert.equal(rect?.kind, "struct");
    assert.deepEqual(
      rect.fields.map((f) => f.name),
      ["X", "Y", "Width", "Height"],
    );

    const ocrEngine = store.getType("Windows.Media.Ocr.OcrEngine");
    assert.equal(ocrEngine?.kind, "class");
    assert.deepEqual(ocrEngine.staticInterfaces, ["Windows.Media.Ocr.IOcrEngineStatics"]);

    const bitmap = store.getType("Windows.Graphics.Imaging.SoftwareBitmap");
    assert.equal(bitmap?.kind, "class");
    assert.equal(bitmap.isClosable, true);
  });
});
