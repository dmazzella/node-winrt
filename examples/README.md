---
title: Examples
---

# Examples

Runnable TypeScript examples built on `@node-ctypes/winrt`. Build the package and generate projections for all examples in one step:

```sh
npm run build
npm run demo:gen:all
```

| Example                                             | Generate                  | Run                                            | What it demonstrates                                                                                                                                 |
| --------------------------------------------------- | ------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WinUI 3 Controls Gallery](winui3-gallery/index.ts) | `npm run demo:winui3:gen` | `npm run demo:winui3`                          | Native `Application.start` + `composeWinRTClass`, `Window`, `MicaBackdrop`, `NavigationView`, Light/Dark `{ThemeResource}` and 30 Fluent v2 controls |
| [Windows Hello](windows-hello/index.ts)             | `npm run demo:hello:gen`  | `npm run demo:hello` (or `-- --verify`)        | `UserConsentVerifier` biometric / PIN availability check and interactive verification prompt                                                         |
| [OCR Image](ocr-image/index.ts)                     | `npm run demo:ocr:gen`    | `node examples/ocr-image/index.ts <image.png>` | `StorageFile` + `BitmapDecoder` + `Windows.Media.Ocr.OcrEngine` extracting text and word bounds from PNG/JPG                                         |
| [Toast Notification](toast-notification/index.ts)   | `npm run demo:toast:gen`  | `npm run demo:toast`                           | Native Windows toast notifications via `XmlDocument` + `ToastNotificationManager`                                                                    |
| [Bluetooth LE Scanner](bluetooth-scan/index.ts)     | `npm run demo:ble:gen`    | `npm run demo:ble`                             | Live BLE advertisement scanning via `BluetoothLEAdvertisementWatcher` and `onReceived` WinRT events                                                  |

For conceptual walkthroughs and full API guides, see [Guides](../guides/README.md).
