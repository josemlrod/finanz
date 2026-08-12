import { expect, test } from "bun:test";
import { loader } from "./not-found";

test("returns a 404 for unmatched routes", () => {
  expect(loader).toThrow();

  try {
    loader();
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    expect((error as Response).status).toBe(404);
  }
});
