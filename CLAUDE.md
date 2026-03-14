# @prsm/fsm

non-deterministic finite state machine. multiple active states, time-based ticks with catch-up, priority transitions, persistence.

## structure

```
src/
  index.js          - createMachine, loadMachine, setStorageDriver
  sqliteDriver.js   - sqlite persistence driver (subpath export)
tests/
  machine.test.js         - core FSM tests
  stepEvent.test.js       - step event tests
  sqliteDriver.test.js    - driver unit tests
  sqlitePersistence.test.js - save/load with sqlite
```

## dev

```
make test       # run tests
make types      # generate .d.ts from JSDoc
```

## key details

- plain javascript, ESM, no build step
- sqlite3 is an optional peer dep, only needed if you import `@prsm/fsm/sqlite`
- step() processes ticks first, then fires at most one transition per call
- ticks have catch-up logic: if 5 seconds passed since last tick, it runs the tick function 5 times
- storage driver is module-level state, set via setStorageDriver()
- default storage uses localStorage in browser, global object in node
