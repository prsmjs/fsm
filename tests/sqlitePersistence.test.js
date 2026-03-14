import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMachine, loadMachine, setStorageDriver } from "../src/index";
import { sqliteDriver } from "../src/sqliteDriver.js";

describe("sqlite persistence", () => {
  let driver;

  beforeEach(() => {
    driver = sqliteDriver({ filename: ":memory:" });
    setStorageDriver(driver);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should save and load simple data+state", async () => {
    const transitions = [{ from: "a", to: "b", when: () => true }];
    const m = createMachine({
      data: { x: 1 },
      states: { a: 1, b: 0 },
      transitions,
    });

    m.data.x = 42;
    m.step();
    await m.save("testSql");

    const loaded = await loadMachine("testSql", {
      transitions,
    });

    expect(loaded.data.x).toBe(42);
    expect(loaded.has("b")).toBe(true);
  });

  it("should catch up missed ticks after reload", async () => {
    const make = () =>
      createMachine({
        data: { count: 0 },
        states: { run: 1 },
        transitions: [],
      });

    const m1 = make();

    m1.tick("run", (ctx) => ctx.set("count", ctx.get("count") + 1), {
      interval: 1000,
    });

    vi.advanceTimersByTime(3000);

    m1.step();

    expect(m1.data.count).toBe(3);

    await m1.save("tickTest");

    vi.advanceTimersByTime(2000);

    const m2 = await loadMachine("tickTest", {
      transitions: [],
    });

    m2.tick("run", (ctx) => ctx.set("count", ctx.get("count") + 1), {
      interval: 1000,
    });

    m2.step();

    expect(m2.data.count).toBe(5);
  });
});
