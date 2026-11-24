/**
 * Minimal WinUI 3 Hello World app — direct TypeScript counterpart to
 * `pywinrt/samples/winui3/hello_app.py`.
 *
 * Generate projections once:
 *   npm run demo:hello-winui3:gen
 *
 * Run:
 *   npm run demo:hello-winui3
 */
import { bootstrapWindowsAppRuntime, enablePerMonitorDpiAwareness, RO_INIT_SINGLETHREADED, roInitialize } from "@node-ctypes/winrt";
import { Application, FrameworkElement, Window } from "./winrt/Microsoft.UI.Xaml.ts";
import { Button, XamlControlsResources } from "./winrt/Microsoft.UI.Xaml.Controls.ts";
import { IXamlMetadataProvider, XamlReader } from "./winrt/Microsoft.UI.Xaml.Markup.ts";
import { XamlControlsXamlMetaDataProvider } from "./winrt/Microsoft.UI.Xaml.XamlTypeInfo.ts";

const XAML = `
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <StackPanel VerticalAlignment="Center" HorizontalAlignment="Center" Spacing="12">
    <Button Name="click" Content="Click me" HorizontalAlignment="Center" Style="{ThemeResource AccentButtonStyle}"/>
    <Button Name="exit" Content="Exit" HorizontalAlignment="Center"/>
  </StackPanel>
</Window>
`;

class App extends Application {
  readonly #owned: Disposable[] = [];

  constructor() {
    using provider = new XamlControlsXamlMetaDataProvider();
    super({ delegates: [{ iface: IXamlMetadataProvider, target: provider }] });
  }

  override onLaunched(): void {
    using resources = new XamlControlsResources();
    using appRes = this.resources!;
    using merged = appRes.mergedDictionaries!;
    merged.append(resources);

    const window = XamlReader.load(XAML)!.as(Window);
    this.#owned.push(window);

    using content = window.content!.as(FrameworkElement);
    const clickBtn = content.findName("click")!.as(Button);
    const exitBtn = content.findName("exit")!.as(Button);
    this.#owned.push(
      clickBtn,
      exitBtn,
      clickBtn.onClick(() => console.log("Hello, world!")),
      exitBtn.onClick(() => this.exit()),
    );

    window.activate();
  }

  override dispose(): void {
    for (let i = this.#owned.length - 1; i >= 0; i--) this.#owned[i][Symbol.dispose]();
    this.#owned.length = 0;
    super.dispose();
  }
}

enablePerMonitorDpiAwareness();
roInitialize(RO_INIT_SINGLETHREADED);
using _ = bootstrapWindowsAppRuntime();

const apps: App[] = [];
try {
  Application.start(() => {
    apps.push(new App());
  });
} finally {
  for (const app of apps) app.dispose();
}
