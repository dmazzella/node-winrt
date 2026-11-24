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
import { bootstrapWindowsAppRuntime, composeWinRTClass, enablePerMonitorDpiAwareness, getWindowDpiScale, RO_INIT_SINGLETHREADED, roInitialize } from "@node-ctypes/winrt";
import type { WinRTObject } from "@node-ctypes/winrt";
import { Application, IApplicationOverrides, Visibility, Window } from "./winrt/Microsoft.UI.Xaml.ts";
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

const owned: Disposable[] = [];
const keep = <T extends Disposable>(item: T): T => (owned.push(item), item);
let launchError: unknown = null;

try {
  Application.start(() => {
    using provider = XamlControlsXamlMetaDataProvider.create();
    const app = keep(
      composeWinRTClass(Application, {
        className: "WinUI3Gallery.App",
        delegates: [{ iface: IXamlMetadataProvider, target: provider }],
        onError: (err) => {
          launchError = err;
          app.instance.exit();
        },
        overrides: [
          {
            iface: IApplicationOverrides,
            impl: {
              OnLaunched: (self) => {
                // Register WinUI 3 Fluent v2 styles & Light/Dark theme resources
                using xcr = XamlControlsResources.create();
                using resources = self.resources!;
                using merged = resources.mergedDictionaries!;
                merged.append(xcr);

                // Create native WinUI 3 Window with Mica backdrop & Per-Monitor V2 DPI
                const window = keep(Window.create()!);
                window.title = "WinUI 3 Controls Gallery — @node-ctypes/winrt";
                using backdrop = MicaBackdrop.create()!;
                window.systemBackdrop = backdrop;

                using appWindow = window.appWindow!;
                const dpiScale = getWindowDpiScale(appWindow.id.Value);
                appWindow.resize({ Width: Math.round(1040 * dpiScale), Height: Math.round(740 * dpiScale) });

                // Load declarative Fluent XAML UI
                using rawRoot = XamlReader.load(readFileSync(join(__dirname, "MainWindow.xaml"), "utf8"))!;
                const nav = keep(rawRoot.as(NavigationView));
                window.content = nav;

                const get = <T extends WinRTObject>(name: string, Cls: { new (ptr: any): T; readonly defaultInterface: any }): T => {
                  using raw = nav.findName(name)!;
                  return keep(raw.as(Cls));
                };

                // Header & StatusBar
                const pageTitle = get("PageTitle", TextBlock);
                const statusBar = get("StatusBar", InfoBar);
                get("RuntimeSubtitle", TextBlock).text = `Node ${process.version} (${process.arch}) | DPI ${Math.round(dpiScale * 100)}% | EXTERNAL_BUFFERS=${EXTERNAL_BUFFERS} | Native WinUI 3 + Mica`;

                const status = (title: string, message: string, severity: InfoBarSeverity = InfoBarSeverity.Informational): void => {
                  statusBar.severity = severity;
                  statusBar.title = title;
                  statusBar.message = message;
                };

                // NavigationView page switching
                const pages = [
                  { item: get("NavBasic", NavigationViewItem), view: get("BasicPage", ScrollViewer), title: "Basic Input" },
                  { item: get("NavText", NavigationViewItem), view: get("TextPage", ScrollViewer), title: "Text & Numbers" },
                  { item: get("NavStatus", NavigationViewItem), view: get("StatusPage", ScrollViewer), title: "Status & Layout" },
                  { item: get("NavDateColor", NavigationViewItem), view: get("DateColorPage", ScrollViewer), title: "Date, Time & Color" },
                ];
                keep(
                  nav.onSelectionChanged(() => {
                    using selected = nav.selectedItem;
                    if (!selected) return;
                    for (const p of pages) {
                      const active = p.item.raw.isSameObject(selected.raw);
                      p.view.visibility = active ? Visibility.Visible : Visibility.Collapsed;
                      if (active) pageTitle.text = p.title;
                    }
                  }),
                );

                // Basic Input controls
                let clicks = 0;
                let repeats = 0;
                const slider = get("DemoSlider", Slider);
                const progress = get("DemoProgress", ProgressBar);
                const rating = get("DemoRating", RatingControl);
                const featureSwitch = get("FeatureSwitch", ToggleSwitch);
                const autoSave = get("MenuAutoSave", ToggleMenuFlyoutItem);

                keep(get("AccentBtn", Button).onClick(() => status("Accent Button", `Clicked ${++clicks} time(s).`, InfoBarSeverity.Success)));
                keep(get("StandardBtn", Button).onClick(() => status("Standard Button", "Standard Fluent button clicked.")));
                keep(get("ToggleBtn", ToggleButton).onChecked(() => status("ToggleButton", "ON", InfoBarSeverity.Success)));
                keep(get("ToggleBtn", ToggleButton).onUnchecked(() => status("ToggleButton", "OFF")));
                keep(get("RepeatBtn", RepeatButton).onClick(() => status("RepeatButton", `Continuous fire #${++repeats}.`)));
                keep(get("DemoSplitBtn", SplitButton).onClick(() => status("SplitButton", "Primary action clicked.")));
                keep(get("MenuNew", MenuFlyoutItem).onClick(() => status("DropDownButton", "New File.")));
                keep(get("MenuSave", MenuFlyoutItem).onClick(() => status("DropDownButton", "Saved.", InfoBarSeverity.Success)));
                keep(autoSave.onClick(() => status("DropDownButton", `Auto-Save: ${autoSave.isChecked}`)));
                keep(get("CheckLogging", CheckBox).onChecked(() => status("CheckBox", "Logging enabled.")));
                keep(get("CheckLogging", CheckBox).onUnchecked(() => status("CheckBox", "Logging disabled.", InfoBarSeverity.Warning)));
                keep(get("CheckMirror", CheckBox).onChecked(() => status("CheckBox", "Mirror buffer checked.")));
                keep(get("CheckMirror", CheckBox).onUnchecked(() => status("CheckBox", "Mirror buffer unchecked.")));
                keep(get("RadioStandard", RadioButton).onChecked(() => status("RadioButton", "Density: Standard.")));
                keep(get("RadioCompact", RadioButton).onChecked(() => status("RadioButton", "Density: Compact.")));
                keep(featureSwitch.onToggled(() => status("ToggleSwitch", featureSwitch.isOn ? "Enabled" : "Disabled")));
                keep(
                  slider.onValueChanged(() => {
                    progress.value = slider.value;
                    status("Slider + ProgressBar", `${Math.round(slider.value)}%`);
                  }),
                );
                keep(rating.onValueChanged(() => status("RatingControl", `${rating.value} / 5 stars`, InfoBarSeverity.Success)));

                // Text, Numbers & Collections
                const textBox = get("DemoTextBox", TextBox);
                const numberBox = get("DemoNumberBox", NumberBox);
                const combo = get("DemoCombo", ComboBox);
                const list = get("DemoList", ListView);
                const ring = get("DemoRing", ProgressRing);
                const ringToggle = get("RingToggle", ToggleSwitch);

                keep(textBox.onTextChanged(() => status("TextBox", `Live text: "${textBox.text}"`)));
                keep(numberBox.onValueChanged(() => status("NumberBox", `Value: ${numberBox.value}`)));
                keep(combo.onSelectionChanged(() => status("ComboBox", `Selected index: ${combo.selectedIndex}`)));
                keep(list.onSelectionChanged(() => status("ListView", `Selected row #${list.selectedIndex}`)));
                keep(
                  ringToggle.onToggled(() => {
                    ring.isActive = ringToggle.isOn;
                    status("ProgressRing", ring.isActive ? "Active" : "Paused");
                  }),
                );

                window.activate();
              },
            },
          },
        ],
      }),
    );
  });
} finally {
  for (let i = owned.length - 1; i >= 0; i--) owned[i][Symbol.dispose]();
}

if (launchError) throw launchError;
