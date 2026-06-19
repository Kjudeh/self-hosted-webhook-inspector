import { randomBytes } from "node:crypto";

// URL-safe, unambiguous alphabet (no 0/O/1/l/I).
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function generateSlug(length = 6): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
