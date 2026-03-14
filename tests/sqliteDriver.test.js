import { describe, it, expect, beforeEach } from "vitest";
import { sqliteDriver } from "../src/sqliteDriver.js";

describe("sqliteDriver", () => {
  let driver;

  beforeEach(() => {
    driver = sqliteDriver({ filename: ":memory:" });
  });

  it("should set and get arbitrary keys", async () => {
    await driver.set("foo", "bar");
    const val = await driver.get("foo");
    expect(val).toBe("bar");
  });

  it("should return null for missing keys", async () => {
    const val = await driver.get("nope");
    expect(val).toBeNull();
  });
});
