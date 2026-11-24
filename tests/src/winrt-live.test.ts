import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import {
  bootstrapWindowsAppRuntime,
  defaultWinMdPaths,
  enablePerMonitorDpiAwareness,
  getWindowDpiScale,
  registerActivationDll,
  RO_INIT_SINGLETHREADED,
  roInitialize,
  startWin32MessageLoop,
  unregisterActivationDll,
  WinMdStore,
  writeNamespaceModules,
} from "../../dist/index.js";

describe("Generated WinRT projections live on Windows", { skip: process.platform !== "win32" }, () => {
  it("generates and executes System32 WinRT + WinUI 3 XAML UI + Windows OCR end-to-end", async () => {
    // Enable Per-Monitor V2 DPI awareness and STA before creating WinUI 3 windows.
    enablePerMonitorDpiAwareness();
    roInitialize(RO_INIT_SINGLETHREADED);

    let appRuntime: ReturnType<typeof bootstrapWindowsAppRuntime> | null = null;
    try {
      appRuntime = bootstrapWindowsAppRuntime();
    } catch {
      // Windows Server CI runners may not ship Microsoft.WindowsAppRuntime; System32 WinRT tests still run.
    }

    const genBase = join(process.cwd(), "tests", ".generated");
    mkdirSync(genBase, { recursive: true });
    const outDir = mkdtempSync(join(genBase, "run-"));
    try {
      const winmdPaths = appRuntime?.packagePath ? [...defaultWinMdPaths(), appRuntime.packagePath] : defaultWinMdPaths();
      const systemNamespaces = [
        "Windows.Data.Json",
        "Windows.Foundation",
        "Windows.Globalization",
        "Windows.Graphics.Capture",
        "Windows.Graphics.Imaging",
        "Windows.Media.Ocr",
        "Windows.Security.Credentials.UI",
        "Windows.Security.Cryptography",
        "Windows.Storage.Streams",
      ];
      const winUiNamespaces = appRuntime?.packagePath
        ? ["Microsoft.UI", "Microsoft.UI.Content", "Microsoft.UI.Dispatching", "Microsoft.UI.Windowing", "Microsoft.UI.Xaml", "Microsoft.UI.Xaml.Hosting", "Microsoft.UI.Xaml.Markup", "Microsoft.UI.Xaml.Media.Imaging"]
        : [];
      const store = new WinMdStore(winmdPaths);
      writeNamespaceModules(store, [...systemNamespaces, ...winUiNamespaces], outDir);

      const glob = await import(pathToFileURL(join(outDir, "Windows.Globalization.ts")).href);
      const foundation = await import(pathToFileURL(join(outDir, "Windows.Foundation.ts")).href);
      const jsonMod = await import(pathToFileURL(join(outDir, "Windows.Data.Json.ts")).href);
      const imaging = await import(pathToFileURL(join(outDir, "Windows.Graphics.Imaging.ts")).href);
      const ocrMod = await import(pathToFileURL(join(outDir, "Windows.Media.Ocr.ts")).href);
      const helloMod = await import(pathToFileURL(join(outDir, "Windows.Security.Credentials.UI.ts")).href);
      const cryptoMod = await import(pathToFileURL(join(outDir, "Windows.Security.Cryptography.ts")).href);
      const streams = await import(pathToFileURL(join(outDir, "Windows.Storage.Streams.ts")).href);

      // 1. Windows.Globalization.Language (Activatable factory + properties)
      using lang = glob.Language.createLanguage("en-US");
      assert.ok(lang);
      assert.equal(lang.languageTag, "en-US");
      assert.ok(lang.displayName.length > 0);
      assert.equal(lang.getRuntimeClassName(), "Windows.Globalization.Language");

      // 1b. Registration-Free WinRT activation via DllGetActivationFactory
      registerActivationDll("Windows.Globalization.Language", "C:\\Windows\\System32\\Windows.Globalization.dll");
      try {
        using langIt = glob.Language.createLanguage("it-IT");
        assert.ok(langIt);
        assert.equal(langIt.languageTag, "it-IT");
      } finally {
        unregisterActivationDll("Windows.Globalization.Language");
      }

      // 1c. WinRT PassArray + ReceiveArray + FillArray + IAsyncOperationWithProgress<UInt32, UInt32>
      const rawBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]);
      using cryptoBuf = cryptoMod.CryptographicBuffer.createFromByteArray(rawBytes);
      assert.ok(cryptoBuf);
      assert.equal(cryptoMod.CryptographicBuffer.encodeToHexString(cryptoBuf), "deadbeef01020304");
      const copiedBack: Buffer = cryptoMod.CryptographicBuffer.copyToByteArray(cryptoBuf);
      assert.deepEqual(new Uint8Array(copiedBack), rawBytes);

      using reader = streams.DataReader.fromBuffer(cryptoBuf);
      assert.ok(reader);
      const filled = new Uint8Array(rawBytes.length);
      reader.readBytes(filled);
      assert.deepEqual(filled, rawBytes);

      using memStream = streams.InMemoryRandomAccessStream.create();
      const writtenCount = await memStream.writeAsync(cryptoBuf);
      assert.equal(writtenCount, rawBytes.length);
      assert.equal(memStream.size, BigInt(rawBytes.length));

      // 1d. Windows.Foundation.Uri & Windows.Data.Json.JsonObject
      using uri = foundation.Uri.createUri("https://example.com:8443/path?foo=bar&lang=it");
      assert.equal(uri.host, "example.com");
      assert.equal(uri.port, 8443);
      using query = uri.queryParsed;
      assert.ok(query);
      assert.equal(query.getFirstValueByName("foo"), "bar");
      assert.equal(query.getFirstValueByName("lang"), "it");

      using parsedJson = jsonMod.JsonObject.parse('{"name":"node-winrt","version":1}');
      assert.ok(parsedJson);
      assert.equal(parsedJson.getNamedString("name"), "node-winrt");
      assert.equal(parsedJson.getNamedNumber("version"), 1);

      // 2. Windows.Security.Credentials.UI.UserConsentVerifier (event-driven IAsyncOperation<Enum>)
      const availability = await helloMod.UserConsentVerifier.checkAvailabilityAsync();
      assert.equal(typeof availability, "number");
      assert.ok(Object.values(helloMod.UserConsentVerifierAvailability).includes(availability));

      // 3. Windows.Media.Ocr.OcrEngine (Statics + IVectorView<Language>)
      assert.ok(ocrMod.OcrEngine.maxImageDimension >= 2000);
      const availableLangs = ocrMod.OcrEngine.availableRecognizerLanguages;
      assert.ok(Array.isArray(availableLangs));
      for (const l of availableLangs) l.dispose();

      // 4. Full live WinUI 3 XAML UI + RenderTargetBitmap -> SoftwareBitmap -> Windows OCR
      //    (when Microsoft.WindowsAppRuntime + Windows OCR language pack are installed).
      using engine = ocrMod.OcrEngine.tryCreateFromUserProfileLanguages();
      if (appRuntime?.packagePath && engine) {
        const dispatching = await import(pathToFileURL(join(outDir, "Microsoft.UI.Dispatching.ts")).href);
        const windowing = await import(pathToFileURL(join(outDir, "Microsoft.UI.Windowing.ts")).href);
        const xamlHosting = await import(pathToFileURL(join(outDir, "Microsoft.UI.Xaml.Hosting.ts")).href);
        const xamlMarkup = await import(pathToFileURL(join(outDir, "Microsoft.UI.Xaml.Markup.ts")).href);
        const xamlImaging = await import(pathToFileURL(join(outDir, "Microsoft.UI.Xaml.Media.Imaging.ts")).href);

        using dispatcher = dispatching.DispatcherQueueController.createOnCurrentThread();
        assert.ok(dispatcher);
        using xamlManager = xamlHosting.WindowsXamlManager.initializeForCurrentThread();
        assert.ok(xamlManager);

        using appWindow = windowing.AppWindow.create();
        assert.ok(appWindow);
        const dpiScale = getWindowDpiScale(appWindow.id.Value);
        appWindow.resize({ Width: Math.round(520 * dpiScale), Height: Math.round(220 * dpiScale) });

        using xamlSource = xamlHosting.DesktopWindowXamlSource.create();
        assert.ok(xamlSource);
        xamlSource.initialize(appWindow.id);

        using siteBridge = xamlSource.siteBridge;
        assert.ok(siteBridge);
        siteBridge.moveAndResize({ X: 0, Y: 0, Width: Math.round(480 * dpiScale), Height: Math.round(180 * dpiScale) });
        siteBridge.show();

        using uiRoot = xamlMarkup.XamlReader.load(
          `<Grid xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Background="White" Width="480" Height="180">` + `<TextBlock Text="Hello WinRT Codegen" Foreground="Black" FontSize="28" Margin="24,40,0,0"/>` + `</Grid>`,
        );
        assert.ok(uiRoot);
        xamlSource.content = uiRoot;
        appWindow.show();

        using messageLoop = startWin32MessageLoop();
        try {
          // Allow WinUI 3 to complete layout & its initial XAML render pass.
          await new Promise((r) => setTimeout(r, 250));

          using rtb = xamlImaging.RenderTargetBitmap.create();
          await rtb.renderAsync(uiRoot);
          assert.ok(rtb.pixelWidth >= 480 && rtb.pixelHeight >= 180, `Unexpected RenderTargetBitmap size: ${rtb.pixelWidth}x${rtb.pixelHeight}`);

          using pixelBuf = await rtb.getPixelsAsync();
          assert.ok(pixelBuf);

          using bitmap = imaging.SoftwareBitmap.createCopyFromBuffer(pixelBuf, imaging.BitmapPixelFormat.Bgra8, rtb.pixelWidth, rtb.pixelHeight);
          assert.ok(bitmap);
          assert.equal(bitmap.pixelWidth, rtb.pixelWidth);
          assert.equal(bitmap.pixelHeight, rtb.pixelHeight);

          using ocrResult = await engine.recognizeAsync(bitmap);
          assert.ok(ocrResult);
          assert.match(ocrResult.text, /Hello/i);
          assert.match(ocrResult.text, /WinRT/i);
          const angle: number | null = ocrResult.textAngle;
          assert.ok(angle === null || typeof angle === "number");

          const lines = ocrResult.lines;
          assert.ok(lines.length >= 1);
          let foundHello = false;
          for (const line of lines) {
            using ownedLine = line;
            const words = ownedLine.words;
            for (const word of words) {
              using ownedWord = word;
              if (/^hello$/i.test(ownedWord.text)) {
                const rect = ownedWord.boundingRect;
                assert.ok(rect.Width > 20 && rect.Height > 10);
                foundHello = true;
              }
            }
          }
          assert.equal(foundHello, true, `Expected word 'Hello' in OCR output: ${JSON.stringify(ocrResult.text)}`);
        } finally {
          messageLoop.stop();
          appWindow.destroy();
        }
      }
    } finally {
      appRuntime?.dispose();
      rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
