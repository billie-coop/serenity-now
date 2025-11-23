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

Deno.test("assert throws on null with default message", () => {
  let threw = false;
  try {
    assert(null);
  } catch (error) {
    threw = error instanceof Error && error.message === "Assertion failed";
  }
  if (!threw) {
    throw new Error("Expected assert to throw default message on null");
  }
});

Deno.test("assert throws on undefined with default message", () => {
  let threw = false;
  try {
    assert(undefined);
  } catch (error) {
    threw = error instanceof Error && error.message === "Assertion failed";
  }
  if (!threw) {
    throw new Error("Expected assert to throw default message on undefined");
  }
});

Deno.test("assert throws Error object directly", () => {
  const customError = new Error("direct error");
  let caughtError: Error | null = null;
  try {
    assert(false, customError);
  } catch (error) {
    caughtError = error as Error;
  }
  if (caughtError !== customError) {
    throw new Error("Expected exact Error object to be thrown");
  }
});
