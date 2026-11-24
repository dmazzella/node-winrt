/**
 * Native Windows 10/11 Toast Notifications — 100% pure WinRT (`Windows.UI.Notifications`).
 *
 * Zero PowerShell, zero C++, zero Windows App SDK required.
 *
 * Generate projections once:
 *   npm run demo:toast:gen
 *
 * Send a native Windows toast notification:
 *   node examples/toast-notification/index.ts "Build Succeeded" "All tests passed on Windows!"
 */
import { XmlDocument } from "./winrt/Windows.Data.Xml.Dom.ts";
import { NotificationSetting, ToastNotification, ToastNotificationManager } from "./winrt/Windows.UI.Notifications.ts";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const title = process.argv[2] ?? "@node-ctypes/winrt";
const body = process.argv[3] ?? "Native Windows Toast Notification from pure TypeScript!";
// Windows requires a registered AppUserModelId (AUMID) for unpackaged desktop processes.
const appId = process.env.WINRT_TOAST_APP_ID ?? "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

const xml = `
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>${escapeXml(title)}</text>
      <text>${escapeXml(body)}</text>
      <text placement="attribution">via @node-ctypes/winrt</text>
    </binding>
  </visual>
</toast>`.trim();

using doc = XmlDocument.create();
doc.loadXml(xml);

using toast = ToastNotification.createToastNotification(doc)!;
using notifier = ToastNotificationManager.createToastNotifierWithId(appId)!;

const setting = notifier.setting;
const settingName = Object.entries(NotificationSetting).find(([, v]) => v === setting)?.[0] ?? String(setting);
notifier.show(toast);
console.log(`Toast sent (setting=${settingName}): "${title}" — "${body}"`);
