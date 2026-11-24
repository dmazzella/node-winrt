import type { GenerateOptions, WinMdStore, WinRTObject } from "../../dist/index.js";
import { asyncOperationPiid, computePiid, generateNamespaceModule, typedEventHandlerPiid } from "../../dist/index.js";

export function typeCheck(store: WinMdStore, obj: WinRTObject, opts: GenerateOptions): string {
  const _a: string = computePiid("b1");
  const _b: string = asyncOperationPiid("b1");
  const _c: string = typedEventHandlerPiid("cinterface(IInspectable)", "cinterface(IInspectable)");
  const _name: string = obj.getRuntimeClassName();
  void [_a, _b, _c, _name];
  return generateNamespaceModule(store, "Windows.Media.Ocr", opts);
}
