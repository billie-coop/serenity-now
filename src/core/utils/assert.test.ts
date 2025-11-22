import { assert } from "./assert.ts";

Deno.test("assert narrows truthy values and throws otherwise", () => {
  let threw = false;
  try {
    assert(false, () => new Error("fail"));
  } catch (error) {
    threw = error instanceof Error && error.message === "fail";
  }
  if (!threw) {
    throw new Error("Expected assert to throw on false");
  }

  const value: number | null = 42;
  assert(value);
  // if the code reaches here, narrowing worked

  assert(true);

  const customMessage = () => new Error("custom");
  let customThrown = false;
  try {
    assert(null, customMessage);
  } catch (error) {
    customThrown = error instanceof Error && error.message === "custom";
  }
  if (!customThrown) {
    throw new Error("Expected custom error to be thrown");
  }
});
