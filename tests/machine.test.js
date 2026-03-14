import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMachine } from "../src/index";

describe("fsm", () => {
  let machine;

  beforeEach(() => {
    machine = createMachine({
      data: {
        sleepiness: 100,
        hunger: 0,
      },
      states: {
        alive: 1,
        asleep: 1,
        awake: 0,
        hungry: 0,
        bored: 1,
        eating: 0,
        dead: 0,
      },
      transitions: [
        {
          from: "asleep",
          to: "awake",
          when: (ctx) => ctx.has("alive"),
          then: (ctx) => ctx.set("sleepiness", 0),
        },
        {
          // transition applies from any state
          to: "hungry",
          when: (ctx) => ctx.get("hunger") >= 50 && ctx.has("alive"),
        },
      ],
    });
  });

  it("should initialize with correct data and states", () => {
    expect(machine.data.sleepiness).toBe(100);
    expect(machine.data.hunger).toBe(0);
    expect(machine.has("alive")).toBe(true);
    expect(machine.has("asleep")).toBe(true);
    expect(machine.has("awake")).toBe(false);
    expect(machine.has("hungry")).toBe(false);
  });

  it("should transition from asleep to awake and reset sleepiness", () => {
    machine.step();
    expect(machine.has("awake")).toBe(true);
    expect(machine.has("asleep")).toBe(false);
    expect(machine.data.sleepiness).toBe(0);
  });

  it("should transition to hungry when hunger is set to 60", () => {
    machine.step(); // Transition from asleep to awake.
    machine.data.hunger = 60;
    machine.step();
    expect(machine.has("hungry")).toBe(true);
  });

  it("should fire event callbacks during transition", () => {
    const transitionSpy = vi.fn();
    const enterSpy = vi.fn();
    const exitSpy = vi.fn();

    machine.on("transition", transitionSpy);
    machine.on("state:enter", enterSpy);
    machine.on("state:exit", exitSpy);

    machine.step();
    expect(transitionSpy).toHaveBeenCalled();
    expect(enterSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalled();
  });

  it("should call enter hooks when entering states", () => {
    const enterAwakeSpy = vi.fn();
    const enterDeadSpy = vi.fn();

    const testMachine = createMachine({
      data: { health: 100 },
      states: { asleep: 1, awake: 0, dead: 0 },
      transitions: [{ from: "asleep", to: "awake", when: () => true }],
      hooks: {
        enter: {
          awake: enterAwakeSpy,
          dead: enterDeadSpy,
        },
      },
    });

    testMachine.step();
    expect(enterAwakeSpy).toHaveBeenCalledTimes(1);
    expect(enterDeadSpy).not.toHaveBeenCalled();
  });

  it("should call exit hooks when leaving states", () => {
    const exitAsleepSpy = vi.fn();
    const exitAwakeSpy = vi.fn();

    const testMachine = createMachine({
      data: { energy: 100 },
      states: { asleep: 1, awake: 0, tired: 0 },
      transitions: [{ from: "asleep", to: "awake", when: () => true }],
      hooks: {
        exit: {
          asleep: exitAsleepSpy,
          awake: exitAwakeSpy,
        },
      },
    });

    testMachine.step();
    expect(exitAsleepSpy).toHaveBeenCalledTimes(1);
    expect(exitAwakeSpy).not.toHaveBeenCalled();
  });

  it("should call hooks in correct order during transition", () => {
    const callOrder = [];

    const testMachine = createMachine({
      data: { ready: true },
      states: { waiting: 1, running: 0 },
      transitions: [
        {
          from: "waiting",
          to: "running",
          when: (ctx) => ctx.get("ready"),
          then: (ctx) => callOrder.push("transition-then"),
        },
      ],
      hooks: {
        exit: {
          waiting: () => callOrder.push("exit-waiting"),
        },
        enter: {
          running: () => callOrder.push("enter-running"),
        },
      },
    });

    testMachine.step();
    expect(callOrder).toEqual(["exit-waiting", "transition-then", "enter-running"]);
  });
});

describe("Priority-based Transition Resolution", () => {
  it("should choose transition with highest priority when multiple transitions match", () => {
    const machine = createMachine({
      data: { health: 50 },
      states: {
        alive: 1,
        asleep: 1,
        awake: 0,
        dead: 0,
      },
      transitions: [
        {
          from: "asleep",
          to: "awake",
          when: (ctx) => ctx.has("alive"),
          // No priority - should be overridden by higher priority transition
        },
        {
          from: "asleep",
          to: "dead",
          when: (ctx) => ctx.has("alive") && ctx.get("health") <= 50,
          priority: 10, // Higher priority - should win
        },
      ],
    });

    machine.step();
    expect(machine.has("dead")).toBe(true);
    expect(machine.has("awake")).toBe(false);
    expect(machine.has("asleep")).toBe(false);
  });

  it("should use first-match when no priorities are defined", () => {
    const machine = createMachine({
      data: { energy: 100 },
      states: {
        idle: 1,
        working: 0,
        resting: 0,
      },
      transitions: [
        {
          from: "idle",
          to: "working",
          when: (ctx) => ctx.get("energy") >= 50,
          // First transition - should win when no priorities
        },
        {
          from: "idle",
          to: "resting",
          when: (ctx) => ctx.get("energy") >= 50,
          // Second transition - should be ignored
        },
      ],
    });

    machine.step();
    expect(machine.has("working")).toBe(true);
    expect(machine.has("resting")).toBe(false);
    expect(machine.has("idle")).toBe(false);
  });

  it("should handle mixed priority and non-priority transitions correctly", () => {
    const machine = createMachine({
      data: { mood: "happy", energy: 80 },
      states: {
        neutral: 1,
        excited: 0,
        tired: 0,
        sleeping: 0,
      },
      transitions: [
        {
          from: "neutral",
          to: "excited",
          when: (ctx) => ctx.get("mood") === "happy",
          // No priority
        },
        {
          from: "neutral",
          to: "tired",
          when: (ctx) => ctx.get("energy") < 90,
          // No priority
        },
        {
          from: "neutral",
          to: "sleeping",
          when: (ctx) => ctx.get("energy") < 100,
          priority: 5, // Has priority - should win over non-priority transitions
        },
      ],
    });

    machine.step();
    expect(machine.has("sleeping")).toBe(true);
    expect(machine.has("excited")).toBe(false);
    expect(machine.has("tired")).toBe(false);
    expect(machine.has("neutral")).toBe(false);
  });

  describe("StateTick API", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should register and execute state tick functions", () => {
      const machine = createMachine({
        data: { sleepiness: 100 },
        states: {
          asleep: 1,
          awake: 0,
        },
        transitions: [],
      });

      // Register a tick function for the asleep state
      machine.tick(
        "asleep",
        (ctx) => {
          const current = ctx.get("sleepiness");
          ctx.set("sleepiness", current - 15);
        },
        { interval: 1000 },
      );

      expect(machine.data.sleepiness).toBe(100);

      // Advance time by 1 second and step
      vi.advanceTimersByTime(1000);
      machine.step();

      expect(machine.data.sleepiness).toBe(85);

      // Advance time by 2 more seconds and step
      vi.advanceTimersByTime(2000);
      machine.step();

      expect(machine.data.sleepiness).toBe(55); // 85 - 30 (2 ticks)
    });

    it("should handle catch-up logic for multiple missed ticks", () => {
      const machine = createMachine({
        data: { energy: 100 },
        states: {
          working: 1,
        },
        transitions: [],
      });

      machine.tick(
        "working",
        (ctx) => {
          ctx.set("energy", ctx.get("energy") - 10);
        },
        { interval: 500 },
      );

      // Advance time by 2.5 seconds (5 ticks)
      vi.advanceTimersByTime(2500);
      machine.step();

      expect(machine.data.energy).toBe(50); // 100 - 50 (5 ticks)
    });

    it("should only tick for active states", () => {
      const machine = createMachine({
        data: { sleepiness: 100, energy: 100 },
        states: {
          asleep: 1,
          awake: 0,
        },
        transitions: [
          {
            from: "asleep",
            to: "awake",
            when: (ctx) => ctx.get("sleepiness") <= 40,
          },
        ],
      });

      machine.tick(
        "asleep",
        (ctx) => {
          ctx.set("sleepiness", ctx.get("sleepiness") - 20);
        },
        { interval: 1000 },
      );

      machine.tick(
        "awake",
        (ctx) => {
          ctx.set("energy", ctx.get("energy") + 10);
        },
        { interval: 1000 },
      );

      // Initially asleep, should tick sleepiness
      vi.advanceTimersByTime(1000);
      machine.step();
      expect(machine.data.sleepiness).toBe(80);
      expect(machine.data.energy).toBe(100); // awake tick shouldn't run

      // Advance more time to trigger transition
      vi.advanceTimersByTime(2000);
      machine.step();
      expect(machine.data.sleepiness).toBe(40); // 80 - 40 (2 more ticks)
      expect(machine.has("awake")).toBe(true);
      expect(machine.has("asleep")).toBe(false);

      // Now awake, should tick energy
      vi.advanceTimersByTime(1000);
      machine.step();
      expect(machine.data.energy).toBe(110); // awake tick runs
      expect(machine.data.sleepiness).toBe(40); // asleep tick doesn't run
    });

    it("should emit tick events with correct payload", () => {
      const machine = createMachine({
        data: { value: 0 },
        states: { active: 1 },
        transitions: [],
      });

      const tickSpy = vi.fn();
      machine.on("tick", tickSpy);

      machine.tick(
        "active",
        (ctx) => {
          ctx.set("value", ctx.get("value") + 1);
        },
        { interval: 1000 },
      );

      vi.advanceTimersByTime(1500);
      machine.step();

      expect(tickSpy).toHaveBeenCalledWith({
        state: "active",
        ctx: expect.objectContaining({
          data: expect.any(Object),
          has: expect.any(Function),
          get: expect.any(Function),
          set: expect.any(Function),
        }),
        interval: 1000,
        elapsed: expect.any(Number),
      });
    });
  });

  describe("StateTick Persistence", () => {
    const createTestMachine = () =>
      createMachine({
        data: { sleepiness: 100 },
        states: {
          asleep: 1,
          awake: 0,
        },
        transitions: [
          {
            from: "asleep",
            to: "awake",
            when: (ctx) => ctx.get("sleepiness") <= 0,
          },
        ],
      });

    beforeEach(() => {
      vi.useFakeTimers();
      if (global.__FSM_STORAGE__) {
        global.__FSM_STORAGE__ = {};
      }
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should save and restore stateTicks with catch-up logic", async () => {
      const machine = createTestMachine();

      machine.tick(
        "asleep",
        (ctx) => {
          ctx.set("sleepiness", ctx.get("sleepiness") - 15);
        },
        { interval: 1000 },
      );

      // Run for 2 seconds
      vi.advanceTimersByTime(2000);
      machine.step();
      expect(machine.data.sleepiness).toBe(70); // 100 - 30

      // Save the machine
      machine.save("sleeper");

      // Advance time by 3 more seconds (but don't step)
      vi.advanceTimersByTime(3000);

      // Load the machine and re-register tick function
      const loaded = await loadMachine("sleeper", {
        data: { sleepiness: 100 },
        states: { asleep: 1, awake: 0 },
        transitions: [
          {
            from: "asleep",
            to: "awake",
            when: (ctx) => ctx.get("sleepiness") <= 0,
          },
        ],
      });

      // Re-register the tick function (functions can't be serialized)
      loaded.tick(
        "asleep",
        (ctx) => {
          ctx.set("sleepiness", ctx.get("sleepiness") - 15);
        },
        { interval: 1000 },
      );

      // Step should catch up for the 3 seconds that passed
      loaded.step();
      expect(loaded.data.sleepiness).toBe(25); // 70 - 45 (3 ticks)
    });

    it("should handle stateTicks data structure in saved state", () => {
      const machine = createTestMachine();

      machine.tick(
        "asleep",
        (ctx) => {
          ctx.set("sleepiness", ctx.get("sleepiness") - 10);
        },
        { interval: 500 },
      );

      machine.tick(
        "awake",
        (ctx) => {
          ctx.set("sleepiness", ctx.get("sleepiness") + 5);
        },
        { interval: 2000 },
      );

      machine.save("multi-tick");

      // Check the saved data structure
      const saved = JSON.parse(global.__FSM_STORAGE__["fsm_multi-tick"]);
      expect(saved.stateTicks).toEqual({
        asleep: {
          interval: 500,
          lastTickTime: expect.any(Number),
        },
        awake: {
          interval: 2000,
          lastTickTime: expect.any(Number),
        },
      });
    });
  });

  it("should choose highest priority among multiple priority transitions", () => {
    const machine = createMachine({
      data: { danger: 100, health: 20 },
      states: {
        normal: 1,
        alert: 0,
        panic: 0,
        dead: 0,
      },
      transitions: [
        {
          from: "normal",
          to: "alert",
          when: (ctx) => ctx.get("danger") > 50,
          priority: 1,
        },
        {
          from: "normal",
          to: "panic",
          when: (ctx) => ctx.get("danger") > 80,
          priority: 5,
        },
        {
          from: "normal",
          to: "dead",
          when: (ctx) => ctx.get("health") < 30,
          priority: 10, // Highest priority - should win
        },
      ],
    });

    machine.step();
    expect(machine.has("dead")).toBe(true);
    expect(machine.has("panic")).toBe(false);
    expect(machine.has("alert")).toBe(false);
    expect(machine.has("normal")).toBe(false);
  });

  it("should work with array from/to states and priorities", () => {
    const machine = createMachine({
      data: { emergency: true },
      states: {
        alive: 1,
        awake: 1,
        healthy: 1,
        injured: 0,
        unconscious: 0,
      },
      transitions: [
        {
          from: ["awake", "alive"],
          to: "injured",
          when: (ctx) => ctx.get("emergency"),
          priority: 1,
        },
        {
          from: ["awake", "alive"],
          to: ["injured", "unconscious"],
          when: (ctx) => ctx.get("emergency"),
          priority: 5, // Higher priority - should win
        },
      ],
    });

    machine.step();
    expect(machine.has("injured")).toBe(true);
    expect(machine.has("unconscious")).toBe(true);
    expect(machine.has("awake")).toBe(false);
    expect(machine.has("alive")).toBe(false);
    expect(machine.has("healthy")).toBe(true); // Should remain unchanged
  });
});

import { loadMachine } from "../src/index";

describe("FSM Persistence", () => {
  const config = {
    data: {
      sleepiness: 100,
      hunger: 0,
    },
    states: {
      alive: 1,
      asleep: 1,
      awake: 0,
      hungry: 0,
      bored: 1,
      eating: 0,
      dead: 0,
    },
    transitions: [
      {
        from: "asleep",
        to: "awake",
        when: (ctx) => ctx.has("alive"),
        then: (ctx) => ctx.set("sleepiness", 0),
      },
      {
        to: "hungry",
        when: (ctx) => ctx.get("hunger") >= 50 && ctx.has("alive"),
      },
    ],
    hooks: {
      enter: {
        awake: (ctx) => {},
        dead: (ctx) => {},
      },
      exit: {
        asleep: (ctx) => {},
      },
    },
  };

  beforeEach(() => {
    if (global.__FSM_STORAGE__) {
      global.__FSM_STORAGE__ = {};
    }
  });

  it("should save and load machine state and data", async () => {
    const machine = createMachine(config);
    machine.data.hunger = 55;
    machine.step(); // asleep -> awake
    machine.step(); // enters 'hungry' (hunger >= 50)
    await machine.save("test1");

    // Deep clone config to avoid mutation issues
    const configClone = JSON.parse(JSON.stringify(config));
    // Restore hooks and transitions (functions are lost in JSON clone)
    configClone.hooks = config.hooks;
    configClone.transitions = config.transitions;

    const loaded = await loadMachine("test1", configClone);
    expect(loaded.data.hunger).toBe(55);
    expect(loaded.has("hungry")).toBe(true);
    expect(loaded.has("alive")).toBe(true);
    expect(loaded.has("asleep")).toBe(false);
  });

  it("should throw if loading a non-existent machine", async () => {
    await expect(loadMachine("nope", config)).rejects.toThrow();
  });
});
