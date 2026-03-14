/**
 * @typedef {Object} FSMConfig
 * @property {Object} [data]
 * @property {Object.<string, Object>} states
 * @property {Array<FSMTransition>} transitions
 * @property {Object} [hooks]
 */

/**
 * @typedef {Object} FSMTransition
 * @property {string|string[]} from
 * @property {string|string[]} to
 * @property {function(Object): boolean} [when]
 * @property {function(Object): void} [then]
 * @property {function(Object): void} [action]
 * @property {number} [priority]
 */

/**
 * @typedef {Object} FSMInstance
 * @property {function(): void} step
 * @property {function(string, function): void} on
 * @property {function(string, function): void} off
 * @property {function(string): boolean} has
 * @property {function(string, function, Object): void} tick
 * @property {function(string): void} save
 * @property {Object} data
 * @property {Array<string>} state
 */

let storageDriver = {
  set(key, value) {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(`fsm_${key}`, value);
    } else if (typeof global !== "undefined") {
      global.__FSM_STORAGE__ = global.__FSM_STORAGE__ || {};
      global.__FSM_STORAGE__[`fsm_${key}`] = value;
    }
  },
  get(key) {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage.getItem(`fsm_${key}`);
    } else if (typeof global !== "undefined" && global.__FSM_STORAGE__) {
      return global.__FSM_STORAGE__[`fsm_${key}`] ?? null;
    }
    return null;
  },
};

export function setStorageDriver(driver) {
  storageDriver = driver;
}

function createMachine(config) {
  if (!config || typeof config !== "object") throw new Error("FSM config required");
  const { data = {}, states, transitions, hooks = {}, activeStates: initialActiveStates } = config;
  if (!states || typeof states !== "object") throw new Error("FSM states required");
  if (!Array.isArray(transitions)) throw new Error("FSM transitions must be an array");

  const activeStates = new Set();
  if (Array.isArray(initialActiveStates)) {
    for (const state of initialActiveStates) {
      activeStates.add(state);
    }
  } else {
    for (const [state, val] of Object.entries(states)) {
      if (val) activeStates.add(state);
    }
  }

  const listeners = {};
  const stateTicks = {};
  let savedStateTicks = {};

  function emit(event, ...args) {
    (listeners[event] || []).forEach((fn) => fn(...args));
  }
  function on(event, handler) {
    (listeners[event] = listeners[event] || []).push(handler);
  }
  function off(event, handler) {
    if (listeners[event]) listeners[event] = listeners[event].filter((fn) => fn !== handler);
  }
  function runHook(type, state, ...args) {
    if (typeof hooks[type] === "function") hooks[type](state, ...args);
    if (hooks[type] && typeof hooks[type][state] === "function") hooks[type][state](...args);
    if (states[state] && typeof states[state][type] === "function") states[state][type](...args);
  }

  // this finds a valid transition from any active state, handles priority
  function findTransition() {
    const validTransitions = [];

    for (const t of transitions) {
      const fromStates = t.from !== undefined ? (Array.isArray(t.from) ? t.from : [t.from]) : [];

      if (t.from !== undefined && !fromStates.some((s) => activeStates.has(s))) continue;

      if (t.from === undefined) {
        const toStates = Array.isArray(t.to) ? t.to : [t.to];
        if (toStates.some((state) => activeStates.has(state))) continue;
      }

      const ctx = {
        data,
        state: Array.from(activeStates),
        has: (s) => activeStates.has(s),
        get: (k) => data[k],
        set: (k, v) => {
          data[k] = v;
        },
      };

      if (t.when && !t.when(ctx)) continue;

      validTransitions.push({ t, ctx, fromStates });
    }

    if (validTransitions.length === 0) return null;

    const transitionsWithPriority = validTransitions.filter(({ t }) => typeof t.priority === "number");

    if (transitionsWithPriority.length > 0) {
      return transitionsWithPriority.reduce((highest, current) => (current.t.priority > highest.t.priority ? current : highest));
    }

    return validTransitions[0];
  }

  // this does all state transitions, runs hooks, updates state, and emits events
  function step() {
    processStateTicks();

    const fired = [];
    let transitionOccurred = false;

    do {
      transitionOccurred = false;
      const found = findTransition();
      if (!found) break;

      const { t: transition, ctx, fromStates } = found;
      const toStates = transition.to !== undefined ? (Array.isArray(transition.to) ? transition.to : [transition.to]) : [];

      const actuallyFrom = fromStates.filter((s) => activeStates.has(s));

      actuallyFrom.forEach((fromState) => {
        runHook("exit", fromState, toStates[0]);
        runHook("onExit", fromState, toStates[0]);
        emit("state:exit", { state: fromState, to: toStates[0] });
      });

      if (typeof transition.then === "function") {
        transition.then(ctx);
      }
      if (typeof transition.action === "function") {
        transition.action({ data, from: actuallyFrom, to: toStates });
      }
      if (typeof hooks.onTransition === "function") {
        hooks.onTransition({ from: actuallyFrom, to: toStates, data });
      }
      emit("transition", { from: actuallyFrom, to: toStates });

      actuallyFrom.forEach((s) => activeStates.delete(s));
      toStates.forEach((s) => {
        activeStates.add(s);
        if (stateTicks[s]) {
          stateTicks[s].lastTickTime = Date.now();
        }
      });

      toStates.forEach((toState) => {
        runHook("enter", toState, actuallyFrom[0]);
        runHook("onEnter", toState, actuallyFrom[0]);
        emit("state:enter", { state: toState, from: actuallyFrom[0] });
      });

      fired.push({ from: actuallyFrom, to: toStates });
      transitionOccurred = true;
      break;
    } while (transitionOccurred);
    emit("step", { state: Array.from(activeStates), data });

    return fired;
  }

  // this handles all active state ticks and catch-up logic
  function processStateTicks() {
    const now = Date.now();

    for (const state of activeStates) {
      const tickConfig = stateTicks[state];
      if (!tickConfig) continue;

      const { tickFn, interval, lastTickTime } = tickConfig;
      const elapsed = now - lastTickTime;

      if (elapsed >= interval) {
        const tickCount = Math.floor(elapsed / interval);

        const ctx = {
          data,
          state: Array.from(activeStates),
          has: (s) => activeStates.has(s),
          get: (k) => data[k],
          set: (k, v) => {
            data[k] = v;
          },
        };

        for (let i = 0; i < tickCount; i++) {
          tickFn(ctx);
        }

        tickConfig.lastTickTime = now - (elapsed % interval);

        emit("tick", { state, ctx, interval, elapsed });
      }
    }
  }

  function tick(state, tickFn, options = {}) {
    const { interval = 1000 } = options;

    const savedData = savedStateTicks[state];

    stateTicks[state] = {
      tickFn,
      interval: savedData ? savedData.interval : interval,
      lastTickTime: savedData ? savedData.lastTickTime : Date.now(),
    };
  }

  function has(state) {
    return activeStates.has(state);
  }

  async function save(name) {
    const serialized = JSON.stringify({
      data,
      activeStates: Array.from(activeStates),
      stateTicks: Object.fromEntries(
        Object.entries(stateTicks).map(([state, config]) => [
          state,
          {
            interval: config.interval,
            lastTickTime: config.lastTickTime,
          },
        ]),
      ),
    });
    await storageDriver.set(name, serialized);
  }

  function wrappedStep() {
    return step();
  }

  return {
    step: wrappedStep,
    on,
    off,
    data,
    get state() {
      return Array.from(activeStates);
    },
    has,
    save,
    tick,
    stateTicks,
    _setSavedStateTicks: (data) => {
      savedStateTicks = data;
    },
  };
}

async function loadMachine(name, config) {
  const serialized = await storageDriver.get(name);
  if (!serialized) throw new Error(`No saved FSM state for: ${name}`);
  const { data, activeStates, stateTicks: savedStateTicks = {} } = JSON.parse(serialized);

  const fullConfig = { ...config, data, activeStates };
  if (!fullConfig.states) {
    fullConfig.states = Object.fromEntries(activeStates.map((s) => [s, 1]));
  }
  const machine = createMachine(fullConfig);

  // this just stores saved tick data for later restoration when tick functions are re-registered
  machine._setSavedStateTicks(savedStateTicks);

  return machine;
}

export { createMachine, loadMachine };
