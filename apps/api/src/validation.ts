import { BadRequestException } from "@nestjs/common";
export function fail(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}
export function stringValue(value: unknown, name: string, max = 200): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.length > max
  )
    fail(
      "INVALID_INPUT",
      `${name} must be a nonempty string of at most ${max} characters`,
    );
  return value.trim();
}
export function integer(
  value: unknown,
  name: string,
  min = 1,
  max = 100000000,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail(
      "INVALID_INPUT",
      `${name} must be an integer between ${min} and ${max}`,
    );
  return value;
}
export function dateValue(value: unknown, name: string): string {
  const input = stringValue(value, name, 40);
  if (!Number.isFinite(Date.parse(input)))
    fail("INVALID_INPUT", `${name} must be an ISO date`);
  return new Date(input).toISOString();
}
