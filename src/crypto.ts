const encoder = new TextEncoder();
// Cloudflare Workers currently rejects PBKDF2 counts above 100,000.
// Login/setup endpoints are also protected by per-IP Durable Object limits.
const PASSWORD_ITERATIONS = 100_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function randomHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function hashPassword(
  password: string,
  saltHex: string,
  iterations = PASSWORD_ITERATIONS,
): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: hexToBytes(saltHex),
      iterations,
    },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

export function constantTimeHexEqual(actualHex: string, expectedHex: string): boolean {
  const actual = hexToBytes(actualHex);
  const expected = hexToBytes(expectedHex);
  const subtle = crypto.subtle;
  if (!("timingSafeEqual" in subtle) || typeof subtle.timingSafeEqual !== "function") {
    throw new Error("The Workers timing-safe comparison API is unavailable.");
  }
  const lengthsMatch = actual.byteLength === expected.byteLength;
  return lengthsMatch
    ? subtle.timingSafeEqual(actual, expected)
    : !subtle.timingSafeEqual(actual, actual);
}

export const passwordIterations = PASSWORD_ITERATIONS;
