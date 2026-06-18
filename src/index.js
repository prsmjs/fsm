/**
 * @typedef {Object} FSMConfig
 * @property {Object} [data] - Shared mutable data object carried with the machine and exposed to transitions, ticks, and hooks via ctx.get/ctx.set (default {}). It is serialized as-is on save, so keep it JSON-friendly.
 * @property {Object.<string, Object>} states - Map of state name to its initial definition. A truthy value (e.g. 1) marks the state as initially active; a falsy value (e.g. 0) marks it inactive. The value may also be an object holding per-state hooks such as enter/exit. Use activeStates to override which states start active.
 * @property {Array<FSMTransition>} transitions - Ordered list of transition rules evaluated on each step(). At most one transition fires per step(); when several match, priority decides, otherwise the first in array order wins.
 * @property {Object} [hooks] - Lifecycle callbacks invoked during transitions. Supports enter/exit (and their onEnter/onExit aliases) keyed by state name, plus onTransition({ from, to, data }) which fires for every transition.
 */

/**
 * @typedef {Object} FSMTransition
 * @property {string|string[]} from - Source state(s) required for this transition. When an array, every listed state must currently be active for the rule to match. Omit from to express an entry transition that fires whenever the target state is not already active.
 * @property {string|string[]} to - Destination state(s) to activate. When an array, all listed states are entered at once and all matched from states are exited.
 * @property {function(Object): boolean} [when] - Guard predicate receiving the ctx object ({ data, state, has, get, set }); the transition only matches when it returns true. With no when, the transition matches purely on from/to state membership.
 * @property {function(Object): void} [then] - Side-effect callback run when the transition fires, receiving the same ctx object as when. Runs before action and before activeStates are mutated.
 * @property {function(Object): void} [action] - Side-effect callback run when the transition fires, receiving { data, from, to } where from and to are arrays of state names. Runs after then.
 * @property {number} [priority] - Tie-breaker when multiple transitions match in the same step(); the highest priority wins (no default). If no matching transition has a priority, the first match in array order is chosen instead.
 */

/**
 * @typedef {Object} FSMInstance
 * @property {function(): Array<Object>} step - Advances the machine once: processes due ticks, then fires at most one matching transition, returning an array of the transitions that fired (empty when none did).
 * @property {function(string, function): void} on - Subscribes a handler to a machine event ("transition", "state:enter", "state:exit", "tick", or "step").
 * @property {function(string, function): void} off - Unsubscribes a previously registered handler from a machine event; the function reference must be the same one passed to on.
 * @property {function(string): boolean} has - Returns whether the given state is currently active.
 * @property {function(string, function, Object): void} tick - Registers a per-state tick function that runs while the state is active. Re-registering replaces the prior tick for that state and, after loadMachine, restores the saved interval and timing so catch-up continues correctly.
 * @property {function(string): Promise<void>} save - Persists the machine (data, active states, and tick timing) under the given name via the current storage driver. Tick functions themselves are not serialized and must be re-registered with tick() after loadMachine.
 * @property {Object} data - The machine's shared mutable data object, the same reference passed in config and mutated through ctx.set.
 * @property {Array<string>} state - Snapshot array of the currently active state names (read-only; mutate state through transitions, not this array).
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

/**
 * Replaces the module-level storage driver used by save() and loadMachine().
 *
 * @param {{ set: function(string, string): (void|Promise<void>), get: function(string): (string|null|Promise<string|null>) }} driver - Storage backend with set(key, value) and get(key) methods; either may be async. The default keeps state in localStorage in the browser and on a global object in Node.
 */
export function setStorageDriver(driver) {
  storageDriver = driver;
}

/**
 * Creates a new state machine from a configuration object.
 *
 * @param {FSMConfig} config - Machine definition: states, transitions, and optional data and hooks.
 * @returns {FSMInstance} The machine instance.
 */
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

      if (t.from !== undefined && !fromStates.every((s) => activeStates.has(s))) continue;

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
    const found = findTransition();

    if (found) {
      const { t: transition, ctx, fromStates } = found;
      const toStates = transition.to !== undefined ? (Array.isArray(transition.to) ? transition.to : [transition.to]) : [];

      const actuallyFrom = fromStates.filter((s) => activeStates.has(s));

      actuallyFrom.forEach((fromState) => {
        runHook("exit", fromState, toStates);
        runHook("onExit", fromState, toStates);
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

      actuallyFrom.forEach((fromState) => {
        emit("state:exit", { state: fromState, to: toStates });
      });

      toStates.forEach((toState) => {
        runHook("enter", toState, actuallyFrom);
        runHook("onEnter", toState, actuallyFrom);
        emit("state:enter", { state: toState, from: actuallyFrom });
      });

      fired.push({ from: actuallyFrom, to: toStates });
    }
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

  /**
   * Registers a tick function that runs while the given state is active.
   *
   * @param {string} state - State name the tick is bound to; it only runs while this state is active.
   * @param {function(Object): void} tickFn - Function invoked on each due interval, receiving the ctx object ({ data, state, has, get, set }).
   * @param {Object} [options] - Tick options.
   * @param {number} [options.interval] - Milliseconds between ticks (default 1000). Catch-up applies: if more than one interval has elapsed since the last tick, tickFn runs once per missed interval on the next step().
   */
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
    _setSavedStateTicks: (data) => {
      savedStateTicks = data;
    },
  };
}

/**
 * Restores a machine previously persisted with save(), merging the saved data and active states over the supplied config.
 *
 * @param {string} name - Storage key the machine was saved under.
 * @param {FSMConfig} [config] - Configuration to rebuild the machine with, typically the same transitions and hooks used at creation. Saved data and active states take precedence, and states is reconstructed from the saved active states if omitted. Tick functions are not restored automatically and must be re-registered with tick() after loading.
 * @returns {Promise<FSMInstance>} The restored machine instance.
 */
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
