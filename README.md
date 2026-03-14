# @prsm/fsm

Non-deterministic finite state machine with time-based ticks, persistence, and multiple active states.

## Basic Usage

Obligatory traffic light example:

```js
import { createMachine } from "@prsm/fsm";

const trafficLight = createMachine({
  states: { green: 1, yellow: 0, red: 0 },
  transitions: [
    { from: "green",  to: "yellow" },
    { from: "yellow", to: "red" },
    { from: "red",    to: "green" }
  ]
});

// cycle through lights
trafficLight.step();
console.log(trafficLight.state); // ['yellow']

trafficLight.step();
console.log(trafficLight.state); // ['red']

trafficLight.step();
console.log(trafficLight.state); // ['green']
```

## State Ticking

States can have time-based functions that execute at regular intervals:

```js
const battery = createMachine({
  data: { charge: 100 },
  states: {
    discharging: 1,
    charging: 0
  },
  transitions: [
    {
      from: "discharging",
      to: "charging", 
      when: ctx => ctx.get("charge") <= 10
    }
  ]
});

// drain 5% every second while discharging
battery.tick("discharging", (ctx) => {
  const current = ctx.get("charge");
  ctx.set("charge", Math.max(0, current - 5));
}, { interval: 1000 });

// simulate time passing
setInterval(() => battery.step(), 100);
```

Ticks only execute for active states. If you want conditional behavior, handle it in the tick function:

```js
battery.tick("discharging", (ctx) => {
  if (ctx.get("frozen")) return; // skip this tick
  
  const current = ctx.get("charge");
  ctx.set("charge", current - 5);
}, { interval: 1000 });
```

## Multiple Active States

This is a non-deterministic FSM, so multiple states can be active simultaneously:

```js
const person = createMachine({
  data: { energy: 100, hunger: 0 },
  states: {
    alive: 1,
    awake: 1,
    hungry: 0,
    tired: 0
  },
  transitions: [
    {
      to: "hungry",
      when: ctx => ctx.get("hunger") > 50
    },
    {
      to: "tired", 
      when: ctx => ctx.get("energy") < 30
    }
  ]
});

// person can be alive + awake + hungry + tired all at once
```

## Transition Priorities

When multiple transitions match, the one with the highest priority wins:

```js
const machine = createMachine({
  states: { idle: 1, working: 0, sleeping: 0 },
  transitions: [
    {
      from: "idle",
      to: "working",
      when: ctx => ctx.get("energy") > 50
    },
    {
      from: "idle", 
      to: "sleeping",
      when: ctx => ctx.get("energy") > 30,
      priority: 10  // this wins if both conditions are true
    }
  ]
});
```

## Arrays in Transitions

Use arrays to specify multiple from/to states:

```js
{
  from: ["awake", "alert"],  // must be in BOTH states
  to: ["asleep", "dreaming"] // enters BOTH states, removing BOTH "awake" and "alert"
}
```

## Hooks

Run code when entering or exiting states:

```js
const machine = createMachine({
  states: { on: 0, off: 1 },
  transitions: [
    { from: "off", to: "on", when: ctx => ctx.get("power") }
  ],
  hooks: {
    enter: {
      on: () => console.log("lights on")
    },
    exit: {
      off: () => console.log("powering up")
    }
  }
});
```

## Events

Listen for state changes and ticks:

```js
machine.on("transition", ({ from, to }) => {
  // called before activeStates are mutated
});

machine.on("state:exit", ({ state, to }) => {
  // called immediately after the old state is removed
});

machine.on("state:enter", ({ state, from }) => {
  // called after the new state is added (machine.state reflects post-transition)
});

machine.on("tick", ({ state, interval }) => {
  // called after your tick function has executed but before transitions in that step
});

machine.on("step", ({ state, data }) => {
  // called once per step(), after ticks and transitions
});
```

Notes:

- “transition” handlers run before the machine’s activeStates set is updated.
- “state:exit” runs immediately after exiting a state.
- “state:enter” runs once the new state is active (machine.state reflects the post-transition set).
- if you only care about reacting once *after* a transition, subscribe to `state:enter`.
- “tick” fires after your tick function has executed but before transitions in that step.
- “step” fires once per step(), after ticks and transitions.

## Persistence

Save and restore machine state:

```js
import { createMachine, loadMachine, setStorageDriver } from "@prsm/fsm";
import { sqliteDriver } from "@prsm/fsm/sqlite";

// optional, but recommended
setStorageDriver(sqliteDriver({ filename: "./my.db" }));

// create and save
const game = createMachine({
  data: { score: 0 },
  states: { playing: 1, paused: 0 },
  transitions: [
    // your transitions here
  ],
  hooks: {
    // your hooks here
  }
});
await game.save("player1");

// later...
const restored = await loadMachine("player1", {
  transitions: [
    // your transitions here
  ],
  hooks: {
    // your hooks here
  }
});

// re-register tick functions
restored.tick("playing", (ctx) => {
  ctx.set("score", ctx.get("score") + 1);
}, { interval: 1000 });
```

Ticks have catch-up logic - if 5 seconds passed while saved, the tick function runs 5 times on the next step.

## API

### Machine Instance

- `step()` - process transitions and ticks
- `has(state)` - check if state is active  
- `tick(state, fn, options)` - register tick function
- `save(name)` - persist to storage
- `on(event, handler)` - subscribe to events
- `off(event, handler)` - unsubscribe
- `data` - machine data object
- `state` - array of active states

### Functions

- `createMachine(config)` - create new machine
- `loadMachine(name, config)` - restore from storage
