import type { RandomGenerator, BoundaryKind } from "./testModel";

/**
 * Pure, dependency-free random test-data generation, shared between the
 * renderer (the 🎲 button's live preview) and the main process (baking a
 * "Generate Once" value at save time). Not cryptographically secure by
 * design — this produces test data, not secrets.
 */

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Charles", "Karen", "Priya", "Wei", "Fatima", "Carlos", "Aiko",
];
const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Patel", "Chen", "Khan", "Silva",
];
const STREET_NAMES = ["Main St", "Oak Ave", "Maple Dr", "Cedar Ln", "Park Blvd", "Sunset Way"];
const CITIES = ["Springfield", "Riverside", "Fairview", "Franklin", "Georgetown", "Clinton"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDigits(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += randomInt(0, 9);
  return s;
}

function uuidLike(): string {
  const hex = () => randomInt(0, 15).toString(16);
  const seg = (n: number) => Array.from({ length: n }, hex).join("");
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${(8 + randomInt(0, 3)).toString(16)}${seg(3)}-${seg(12)}`;
}

function alphanumeric(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < length; i++) s += chars[randomInt(0, chars.length - 1)];
  return s;
}

function lowercaseLetters(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < length; i++) s += chars[randomInt(0, chars.length - 1)];
  return s;
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function generateRandomValue(generator: RandomGenerator, pattern?: string): string {
  switch (generator) {
    case "firstName": return pick(FIRST_NAMES);
    case "lastName": return pick(LAST_NAMES);
    case "fullName": return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    case "email": return `${pick(FIRST_NAMES).toLowerCase()}.${alphanumeric(5).toLowerCase()}@example.com`;
    case "phone": return `(${randomDigits(3)}) ${randomDigits(3)}-${randomDigits(4)}`;
    case "address": return `${randomInt(1, 9999)} ${pick(STREET_NAMES)}, ${pick(CITIES)}`;
    case "uuid": return uuidLike();
    case "integer": return String(randomInt(0, 1_000_000));
    case "decimal": return (Math.random() * 10_000).toFixed(2);
    case "alphanumeric": return alphanumeric(10);
    // Deliberately garbage-looking (lowercase letters + trailing digits,
    // e.g. "ihabscjhbajchs8812") rather than mixed-case — this is the
    // default generator for "Random", and junk data that obviously isn't a
    // real value is exactly the point, as opposed to something that could
    // be mistaken for genuine (if fake) input.
    case "randomString": return `${lowercaseLetters(randomInt(8, 14))}${randomDigits(randomInt(2, 4))}`;
    case "date": return isoDate(0);
    case "pastDate": return isoDate(-randomInt(1, 365));
    case "futureDate": return isoDate(randomInt(1, 365));
    case "url": return `https://example.com/${alphanumeric(6).toLowerCase()}`;
    case "customPattern": return expandPattern(pattern ?? "####");
    default: return "";
  }
}

/** `#` -> digit, `?` -> letter, everything else literal. */
function expandPattern(pattern: string): string {
  let out = "";
  for (const ch of pattern) {
    if (ch === "#") out += randomInt(0, 9);
    else if (ch === "?") out += String.fromCharCode(97 + randomInt(0, 25));
    else out += ch;
  }
  return out;
}

export function generateBoundaryValue(boundary: BoundaryKind, maxLength = 50): string {
  switch (boundary) {
    case "empty": return "";
    case "whitespace": return "   ";
    case "oneCharacter": return "a";
    case "maxLength": return "a".repeat(maxLength);
    case "maxLengthPlusOne": return "a".repeat(maxLength + 1);
    case "specialCharacters": return "!@#$%^&*()_+-=[]{}|;:',.<>/?`~\"\\";
    case "unicode": return "测试 テスト тест 🚀 é ñ";
    case "veryLongValue": return "a".repeat(5000);
    default: return "";
  }
}
