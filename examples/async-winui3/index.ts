/**
 * Simple WinUI 3 example with `async/await` event handlers (`onClick(async () => ...)`).
 *
 * Uses `AppWindow` + `DesktopWindowXamlSource` + `startWin32MessageLoop()` so
 * Win32 UI messages interleave with Node.js's libuv loop (`timers/promises`,
 * `fetch()`, and WinRT `*Async()` APIs all work without freezing the window).
 *
 * Generate projections once:
 *   npm run demo:async-winui3:gen
 *
 * Run interactively:
 *   npm run demo:async-winui3
 */
import { setTimeout as delay } from "node:timers/promises";
import { bootstrapWindowsAppRuntime, enablePerMonitorDpiAwareness, getWindowDpiScale, pumpWin32Messages, RO_INIT_SINGLETHREADED, roInitialize, startWin32MessageLoop } from "@node-ctypes/winrt";
import { ContentSizePolicy } from "./winrt/Microsoft.UI.Content.ts";
import { DispatcherQueueController } from "./winrt/Microsoft.UI.Dispatching.ts";
import { AppWindow } from "./winrt/Microsoft.UI.Windowing.ts";
import { FrameworkElement } from "./winrt/Microsoft.UI.Xaml.ts";
import { Border, Button, TextBlock } from "./winrt/Microsoft.UI.Xaml.Controls.ts";
import { DesktopWindowXamlSource, WindowsXamlManager } from "./winrt/Microsoft.UI.Xaml.Hosting.ts";
import { XamlReader } from "./winrt/Microsoft.UI.Xaml.Markup.ts";
import { UserConsentVerifier, UserConsentVerifierAvailability } from "./winrt/Windows.Security.Credentials.UI.ts";

const XAML = `
<ScrollViewer xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
              Background="#F3F3F3"
              VerticalScrollBarVisibility="Auto"
              HorizontalScrollBarVisibility="Disabled">
  <Grid Padding="24" RowSpacing="14">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="Auto"/>
      <RowDefinition Height="*"/>
      <RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>

    <TextBlock Grid.Row="0" Text="WinUI 3 + Node.js async/await" FontSize="20" FontWeight="SemiBold" TextWrapping="Wrap"/>

    <VariableSizedWrapGrid Grid.Row="1" Orientation="Horizontal" ItemWidth="168" ItemHeight="40">
      <Button Name="TimerBtn" Content="Async Timer (1.5s)" Background="#0067C0" Foreground="White" HorizontalAlignment="Stretch" Margin="0,0,8,8"/>
      <Button Name="HelloBtn" Content="Windows Hello" HorizontalAlignment="Stretch" Margin="0,0,8,8"/>
      <Button Name="FetchBtn" Content="Fetch GitHub" HorizontalAlignment="Stretch" Margin="0,0,8,8"/>
    </VariableSizedWrapGrid>

    <Grid Grid.Row="2" ColumnSpacing="10">
      <Grid.ColumnDefinitions>
        <ColumnDefinition Width="*"/>
        <ColumnDefinition Width="Auto"/>
      </Grid.ColumnDefinitions>
      <Border Grid.Column="0" Name="ProgressTrack" Height="8" Background="#E0E0E0" CornerRadius="4" VerticalAlignment="Center">
        <Border Name="ProgressFill" Width="0" Height="8" Background="#0067C0" CornerRadius="4" HorizontalAlignment="Left"/>
      </Border>
      <TextBlock Grid.Column="1" Name="Percent" Text="0%" VerticalAlignment="Center"/>
    </Grid>

    <Border Grid.Row="3" MinHeight="64" Background="White" BorderBrush="#E5E5E5" BorderThickness="1" CornerRadius="6" Padding="14">
      <TextBlock Name="Status" Text="Click any button to run async work without freezing WinUI 3." TextWrapping="Wrap"/>
    </Border>

    <Button Grid.Row="4" Name="ExitBtn" Content="Close" HorizontalAlignment="Right"/>
  </Grid>
</ScrollViewer>
`;

enablePerMonitorDpiAwareness();
roInitialize(RO_INIT_SINGLETHREADED);
using _runtime = bootstrapWindowsAppRuntime();
using _dispatcher = DispatcherQueueController.createOnCurrentThread()!;
{
  using _xaml = WindowsXamlManager.initializeForCurrentThread()!;
  using win = AppWindow.create()!;
  win.title = "WinUI 3 async/await — @node-ctypes/winrt";
  const dpi = getWindowDpiScale(win.id.Value);
  win.resize({ Width: Math.round(580 * dpi), Height: Math.round(320 * dpi) });

  const ac = new AbortController();
  let done!: () => void;
  const closed = new Promise<void>((resolve) => {
    done = () => {
      ac.abort();
      resolve();
    };
  });

  try {
    using source = DesktopWindowXamlSource.create()!;
    source.initialize(win.id);
    using bridge = source.siteBridge!;
    bridge.resizePolicy = ContentSizePolicy.ResizeContentToParentWindow;
    const { Width, Height } = win.clientSize;
    bridge.moveAndResize({ X: 0, Y: 0, Width, Height });
    bridge.show();

    using _onClosing = win.onClosing((_, args) => {
      if (args) args.cancel = true;
      done();
    });

    using root = XamlReader.load(XAML)!.as(FrameworkElement);
    source.content = root;

    using progressTrack = root.findName("ProgressTrack")!.as(Border);
    using progressFill = root.findName("ProgressFill")!.as(Border);
    using percent = root.findName("Percent")!.as(TextBlock);
    using status = root.findName("Status")!.as(TextBlock);

    let progressRatio = 0;
    const updateProgress = (ratio: number) => {
      progressRatio = ratio;
      if (ac.signal.aborted) return;
      progressFill.width = Math.max(0, progressTrack.actualWidth * ratio);
      percent.text = `${Math.round(ratio * 100)}%`;
    };
    progressTrack.onSizeChanged(() => updateProgress(progressRatio));

    const show = (msg: string) => {
      if (!ac.signal.aborted) status.text = msg;
    };

    using timerBtn = root.findName("TimerBtn")!.as(Button);
    timerBtn.onClick(async () => {
      try {
        for (let step = 1; step <= 10; step++) {
          await delay(150, undefined, { signal: ac.signal });
          updateProgress(step / 10);
        }
        show("Timer completed without blocking WinUI 3!");
      } catch (err) {
        if (!ac.signal.aborted) show(`Timer error: ${err}`);
      }
    });

    using helloBtn = root.findName("HelloBtn")!.as(Button);
    helloBtn.onClick(async () => {
      show("Querying Windows Hello...");
      const avail = await UserConsentVerifier.checkAvailabilityAsync();
      const name = Object.entries(UserConsentVerifierAvailability).find(([, v]) => v === avail)?.[0] ?? String(avail);
      show(`Windows Hello: ${name} (${avail})`);
    });

    using fetchBtn = root.findName("FetchBtn")!.as(Button);
    fetchBtn.onClick(async () => {
      try {
        show("Fetching github.com/dmazzella/node-winrt...");
        const res = await fetch("https://api.github.com/repos/dmazzella/node-winrt", {
          headers: { "User-Agent": "@node-ctypes/winrt" },
          signal: AbortSignal.any([ac.signal, AbortSignal.timeout(5000)]),
        });
        const repo = (await res.json()) as { full_name: string; stargazers_count: number };
        show(`${repo.full_name} — ${repo.stargazers_count} stars`);
      } catch (err) {
        if (!ac.signal.aborted) show(`Fetch error: ${err}`);
      }
    });

    using exitBtn = root.findName("ExitBtn")!.as(Button);
    exitBtn.onClick(done);

    win.show();
    using loop = startWin32MessageLoop();
    await closed;
    loop.stop();
  } finally {
    win.destroy();
  }
  pumpWin32Messages();
}
