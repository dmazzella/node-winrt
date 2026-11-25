/**
 * WinUI 3 Controls Gallery — single-file TypeScript example using generated
 * `@node-ctypes/winrt` projections directly (`./winrt/*.ts`) + `MainWindow.xaml`.
 *
 * Generate projections once via CLI:
 *   npm run demo:winui3:gen
 *
 * Run interactively:
 *   npm run demo:winui3
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTERNAL_BUFFERS } from "node-ctypes";
import { bootstrapWindowsAppRuntime, enablePerMonitorDpiAwareness, getWindowDpiScale, RO_INIT_SINGLETHREADED, roInitialize } from "@node-ctypes/winrt";
import type { WinRTObject } from "@node-ctypes/winrt";
import { Application, Visibility, Window } from "./winrt/Microsoft.UI.Xaml.ts";
import { MicaBackdrop } from "./winrt/Microsoft.UI.Xaml.Media.ts";
import { IXamlMetadataProvider, XamlReader } from "./winrt/Microsoft.UI.Xaml.Markup.ts";
import { XamlControlsXamlMetaDataProvider } from "./winrt/Microsoft.UI.Xaml.XamlTypeInfo.ts";
import {
  Button,
  CheckBox,
  ComboBox,
  InfoBar,
  InfoBarSeverity,
  ListView,
  MenuFlyoutItem,
  NavigationView,
  NavigationViewItem,
  NumberBox,
  ProgressBar,
  ProgressRing,
  RadioButton,
  RatingControl,
  ScrollViewer,
  Slider,
  SplitButton,
  TextBlock,
  TextBox,
  ToggleMenuFlyoutItem,
  ToggleSwitch,
  XamlControlsResources,
} from "./winrt/Microsoft.UI.Xaml.Controls.ts";
import { RepeatButton, ToggleButton } from "./winrt/Microsoft.UI.Xaml.Controls.Primitives.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

enablePerMonitorDpiAwareness();
roInitialize(RO_INIT_SINGLETHREADED);
using _runtime = bootstrapWindowsAppRuntime();

let launchError: unknown = null;

class GalleryApp extends Application {
  window?: Window;

  constructor() {
    using provider = new XamlControlsXamlMetaDataProvider();
    super({
      className: "WinUI3Gallery.App",
      delegates: [{ iface: IXamlMetadataProvider, target: provider }],
      onError: (err) => {
        launchError = err;
        this.exit();
      },
    });
  }

  override onLaunched(): void {
    // Register WinUI 3 Fluent v2 styles & Light/Dark theme resources
    using xcr = new XamlControlsResources();
    using resources = this.resources!;
    using merged = resources.mergedDictionaries!;
    merged.append(xcr);

    // Create native WinUI 3 Window with Mica backdrop & Per-Monitor V2 DPI
    const window = (this.window = new Window());
    window.title = "WinUI 3 Controls Gallery — @node-ctypes/winrt";
    using backdrop = new MicaBackdrop();
    window.systemBackdrop = backdrop;

    using appWindow = window.appWindow!;
    const dpiScale = getWindowDpiScale(appWindow.id.Value);
    appWindow.resize({ Width: Math.round(1040 * dpiScale), Height: Math.round(740 * dpiScale) });

    // Load declarative Fluent XAML UI
    using rawRoot = XamlReader.load(readFileSync(join(__dirname, "MainWindow.xaml"), "utf8"))!;
    const nav = rawRoot.as(NavigationView);
    window.content = nav;

    const find = <T extends WinRTObject>(name: string, Cls: { new (ptr: any): T; readonly defaultInterface: any }): T => {
      using raw = nav.findName(name)!;
      return raw.as(Cls);
    };
    const wire = <T extends WinRTObject>(name: string, Cls: { new (ptr: any): T; readonly defaultInterface: any }, fn: (ctrl: T) => void): void => {
      using ctrl = find(name, Cls);
      fn(ctrl);
    };

    // Header & StatusBar
    const pageTitle = find("PageTitle", TextBlock);
    const statusBar = find("StatusBar", InfoBar);
    wire("RuntimeSubtitle", TextBlock, (tb) => {
      tb.text = `Node ${process.version} (${process.arch}) | DPI ${Math.round(dpiScale * 100)}% | EXTERNAL_BUFFERS=${EXTERNAL_BUFFERS} | Native WinUI 3 + Mica`;
    });

    const status = (title: string, message: string, severity: InfoBarSeverity = InfoBarSeverity.Informational): void => {
      statusBar.severity = severity;
      statusBar.title = title;
      statusBar.message = message;
    };

    // NavigationView page switching
    const pages = [
      { item: find("NavBasic", NavigationViewItem), view: find("BasicPage", ScrollViewer), title: "Basic Input" },
      { item: find("NavText", NavigationViewItem), view: find("TextPage", ScrollViewer), title: "Text & Numbers" },
      { item: find("NavStatus", NavigationViewItem), view: find("StatusPage", ScrollViewer), title: "Status & Layout" },
      { item: find("NavDateColor", NavigationViewItem), view: find("DateColorPage", ScrollViewer), title: "Date, Time & Color" },
    ];
    nav.onSelectionChanged(() => {
      using selected = nav.selectedItem;
      if (!selected) return;
      for (const p of pages) {
        const active = p.item.raw.isSameObject(selected.raw);
        p.view.visibility = active ? Visibility.Visible : Visibility.Collapsed;
        if (active) pageTitle.text = p.title;
      }
    });

    // Basic Input controls
    let clicks = 0;
    let repeats = 0;
    const slider = find("DemoSlider", Slider);
    const progress = find("DemoProgress", ProgressBar);
    const rating = find("DemoRating", RatingControl);
    const featureSwitch = find("FeatureSwitch", ToggleSwitch);
    const autoSave = find("MenuAutoSave", ToggleMenuFlyoutItem);

    wire("AccentBtn", Button, (b) => b.onClick(() => status("Accent Button", `Clicked ${++clicks} time(s).`, InfoBarSeverity.Success)));
    wire("StandardBtn", Button, (b) => b.onClick(() => status("Standard Button", "Standard Fluent button clicked.")));
    wire("ToggleBtn", ToggleButton, (b) => {
      b.onChecked(() => status("ToggleButton", "ON", InfoBarSeverity.Success));
      b.onUnchecked(() => status("ToggleButton", "OFF"));
    });
    wire("RepeatBtn", RepeatButton, (b) => b.onClick(() => status("RepeatButton", `Continuous fire #${++repeats}.`)));
    wire("DemoSplitBtn", SplitButton, (b) => b.onClick(() => status("SplitButton", "Primary action clicked.")));
    wire("MenuNew", MenuFlyoutItem, (m) => m.onClick(() => status("DropDownButton", "New File.")));
    wire("MenuSave", MenuFlyoutItem, (m) => m.onClick(() => status("DropDownButton", "Saved.", InfoBarSeverity.Success)));
    autoSave.onClick(() => status("DropDownButton", `Auto-Save: ${autoSave.isChecked}`));
    wire("CheckLogging", CheckBox, (c) => {
      c.onChecked(() => status("CheckBox", "Logging enabled."));
      c.onUnchecked(() => status("CheckBox", "Logging disabled.", InfoBarSeverity.Warning));
    });
    wire("CheckMirror", CheckBox, (c) => {
      c.onChecked(() => status("CheckBox", "Mirror buffer checked."));
      c.onUnchecked(() => status("CheckBox", "Mirror buffer unchecked."));
    });
    wire("RadioStandard", RadioButton, (r) => r.onChecked(() => status("RadioButton", "Density: Standard.")));
    wire("RadioCompact", RadioButton, (r) => r.onChecked(() => status("RadioButton", "Density: Compact.")));
    featureSwitch.onToggled(() => status("ToggleSwitch", featureSwitch.isOn ? "Enabled" : "Disabled"));
    slider.onValueChanged(() => {
      progress.value = slider.value;
      status("Slider + ProgressBar", `${Math.round(slider.value)}%`);
    });
    rating.onValueChanged(() => status("RatingControl", `${rating.value} / 5 stars`, InfoBarSeverity.Success));

    // Text, Numbers & Collections
    const textBox = find("DemoTextBox", TextBox);
    const numberBox = find("DemoNumberBox", NumberBox);
    const combo = find("DemoCombo", ComboBox);
    const list = find("DemoList", ListView);
    const ring = find("DemoRing", ProgressRing);
    const ringToggle = find("RingToggle", ToggleSwitch);

    textBox.onTextChanged(() => status("TextBox", `Live text: "${textBox.text}"`));
    numberBox.onValueChanged(() => status("NumberBox", `Value: ${numberBox.value}`));
    combo.onSelectionChanged(() => status("ComboBox", `Selected index: ${combo.selectedIndex}`));
    list.onSelectionChanged(() => status("ListView", `Selected row #${list.selectedIndex}`));
    ringToggle.onToggled(() => {
      ring.isActive = ringToggle.isOn;
      status("ProgressRing", ring.isActive ? "Active" : "Paused");
    });

    window.activate();
  }
}

Application.start(() => {
  new GalleryApp();
});

if (launchError) throw launchError;
