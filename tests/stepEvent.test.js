import { describe, it, expect, vi } from "vitest";
import { createMachine } from "../src/index";

describe("step event", () => {
  it("should emit step event after ticks and transitions", () => {
    const machine = createMachine({
      data: {},
      states: { x: 1, y: 0 },
      transitions: [{ from: "x", to: "y", when: () => true }],
    });
    const stepSpy = vi.fn();
    machine.on("step", stepSpy);
    machine.step();
    expect(stepSpy).toHaveBeenCalledWith({
      state: ["y"],
      data: machine.data,
    });
  });
});
