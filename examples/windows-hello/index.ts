/**
 * Windows Hello (Biometrics / PIN) — pure TypeScript via `@node-ctypes/winrt`.
 *
 * Generate projections once:
 *   npm run demo:hello:gen
 *
 * Check availability:
 *   node examples/windows-hello/index.ts
 *
 * Trigger interactive Windows Hello verification dialog:
 *   node examples/windows-hello/index.ts --verify "Confirm access from Node.js"
 */
import { UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability } from "./winrt/Windows.Security.Credentials.UI.ts";

function enumName<T extends Record<string, number>>(obj: T, value: number): string {
  return Object.entries(obj).find(([, v]) => v === value)?.[0] ?? String(value);
}

const availability = await UserConsentVerifier.checkAvailabilityAsync();
console.log(`Windows Hello availability: ${enumName(UserConsentVerifierAvailability, availability)} (${availability})`);

const verifyIdx = process.argv.indexOf("--verify");
if (verifyIdx !== -1) {
  if (availability !== UserConsentVerifierAvailability.Available) {
    console.log("Windows Hello is not available on this device/session.");
  } else {
    const prompt = process.argv[verifyIdx + 1] ?? "Verify your identity from Node.js (@node-ctypes/winrt)";
    const result = await UserConsentVerifier.requestVerificationAsync(prompt);
    console.log(`Verification result: ${enumName(UserConsentVerificationResult, result)} (${result})`);
  }
} else {
  console.log('Tip: pass --verify "Confirm action" to trigger the interactive Windows Hello prompt.');
}
