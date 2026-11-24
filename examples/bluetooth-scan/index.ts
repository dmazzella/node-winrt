/**
 * Live Bluetooth LE Advertisement Scanner — pure TypeScript via `@node-ctypes/winrt`.
 *
 * Generate projections once:
 *   npm run demo:ble:gen
 *
 * Scan for nearby BLE devices (default 5 seconds):
 *   node examples/bluetooth-scan/index.ts
 *   node examples/bluetooth-scan/index.ts --duration 10000
 */
import { BluetoothLEAdvertisementReceivedEventArgs, BluetoothLEAdvertisementWatcher, BluetoothLEAdvertisementWatcherStatus, BluetoothLEScanningMode } from "./winrt/Windows.Devices.Bluetooth.Advertisement.ts";

function formatMac(addr: bigint): string {
  return addr.toString(16).padStart(12, "0").toUpperCase().match(/.{2}/g)!.join(":");
}

const durIdx = process.argv.indexOf("--duration");
const durationMs = durIdx !== -1 ? Math.max(500, Number(process.argv[durIdx + 1]) || 5000) : 5000;

using watcher = BluetoothLEAdvertisementWatcher.create();
watcher.scanningMode = BluetoothLEScanningMode.Active;

const seen = new Map<string, { name: string; rssi: number; count: number }>();

using _onReceived = watcher.onReceived((_senderAddr, argsAddr) => {
  if (!argsAddr) return;
  using args = BluetoothLEAdvertisementReceivedEventArgs.fromAddress(argsAddr, BluetoothLEAdvertisementReceivedEventArgs.defaultInterface, true);
  const mac = formatMac(args.bluetoothAddress);
  const rssi = args.rawSignalStrengthInDBm;
  using adv = args.advertisement;
  const name = adv?.localName || seen.get(mac)?.name || "(unnamed)";
  const prev = seen.get(mac);
  seen.set(mac, { name, rssi, count: (prev?.count ?? 0) + 1 });
  if (!prev) {
    console.log(`  [+] ${mac}  ${String(rssi).padStart(4)} dBm  ${name}`);
  }
});

let stoppedEarly = false;
using _onStopped = watcher.onStopped(() => {
  stoppedEarly = true;
});

console.log(`Scanning for Bluetooth LE advertisements for ${durationMs} ms...`);
watcher.start();
await new Promise((r) => setTimeout(r, durationMs));

const statusBeforeStop = watcher.status;
if (statusBeforeStop === BluetoothLEAdvertisementWatcherStatus.Started) {
  watcher.stop();
}

const statusName = Object.entries(BluetoothLEAdvertisementWatcherStatus).find(([, v]) => v === statusBeforeStop)?.[0] ?? String(statusBeforeStop);
console.log(`Scan finished (status=${statusName}${stoppedEarly ? ", stopped early" : ""}): ${seen.size} unique BLE device(s) found.`);
