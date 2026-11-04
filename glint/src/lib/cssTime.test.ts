import { expect, it } from "vitest";
import { cssTimeMs } from "./cssTime";

it.each([
  ["700ms", 700], [".7s", 700], [" .35s ", 350], ["150ms", 150],
  ["0s", 0], ["0ms", 0], ["1e-05s", 0.01],
  ["", 250], ["invalid", 250], ["700", 250], ["-1s", 250], ["1e999s", 250],
])("reads CSS time %j in milliseconds", (value, expected) => {
  expect(cssTimeMs(value as string, 250)).toBe(expected);
});
