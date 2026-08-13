import { isIP } from "node:net";

export function normalizeIpLiteral(value: string): string | undefined {
  const source = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  const family = isIP(source);
  if (family === 4) return source;
  if (family !== 6) return undefined;
  const hostname = new URL(`http://[${source}]/`).hostname;
  return hostname.slice(1, -1);
}

export function isPublicIpAddress(value: string): boolean {
  const normalized = normalizeIpLiteral(value);
  if (!normalized) return false;
  const mapped = mappedIpv4(normalized);
  if (mapped) return isPublicIpv4(mapped);
  if (isIP(normalized) === 4) return isPublicIpv4(normalized);
  return !(normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff"));
}

export function isLoopbackIpAddress(value: string): boolean {
  const normalized = normalizeIpLiteral(value);
  if (!normalized) return false;
  if (normalized === "::1") return true;
  const mapped = mappedIpv4(normalized);
  const ipv4 = mapped ?? (isIP(normalized) === 4 ? normalized : undefined);
  return ipv4?.startsWith("127.") ?? false;
}

function mappedIpv4(value: string): string | undefined {
  if (isIP(value) !== 6) return undefined;
  const words = expandIpv6Words(value);
  if (!words || words.slice(0, 5).some(word => word !== 0) || words[5] !== 0xffff) return undefined;
  const high = words[6]!;
  const low = words[7]!;
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function expandIpv6Words(value: string): readonly number[] | undefined {
  const halves = value.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const omitted = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (omitted < (halves.length === 2 ? 1 : 0)) return undefined;
  const words = [...left, ...Array(omitted).fill("0"), ...right].map(word => Number.parseInt(word, 16));
  return words.length === 8 && words.every(word => Number.isInteger(word) && word >= 0 && word <= 0xffff) ? words : undefined;
}

function isPublicIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  const [a, b] = parts;
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) && !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || a >= 224);
}
