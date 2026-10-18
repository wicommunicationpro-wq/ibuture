import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../ibuture-chatwoot.js", import.meta.url),
  "utf8"
);

const SDK_URL = "https://app.chatwoot.com/packs/js/sdk.js";
const STATE_KEY = "__ibutureChatwootState";

function createHarness({
  hostname = "lbuture.com",
  pathname = "/fr/products/example",
  existingScript = false,
  appendError = false,
  sdk,
  run
} = {}) {
  const scripts = [];
  const errors = [];
  let createdScriptCount = 0;
  const timers = new Map();
  let nextTimerId = 1;
  let now = 0;
  const runCalls = [];

  class ScriptElement {
    constructor() {
      this.src = "";
      this.async = false;
      this.parentNode = null;
      this.listeners = new Map();
    }

    addEventListener(name, handler) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(handler);
    }

    removeEventListener(name, handler) {
      this.listeners.get(name)?.delete(handler);
    }

    emit(name) {
      for (const handler of this.listeners.get(name) || []) handler();
    }

    listenerCount() {
      let count = 0;
      for (const listeners of this.listeners.values()) count += listeners.size;
      return count;
    }
  }

  const head = {
    appendChild(script) {
      if (appendError) throw new Error("append failed");
      scripts.push(script);
      script.parentNode = head;
      return script;
    },
    removeChild(script) {
      const index = scripts.indexOf(script);
      if (index !== -1) scripts.splice(index, 1);
      script.parentNode = null;
      return script;
    }
  };

  const existing = existingScript ? new ScriptElement() : null;
  if (existing) {
    existing.src = SDK_URL;
    head.appendChild(existing);
  }

  const window = {
    location: { hostname, pathname }
  };
  if (sdk) window.chatwootSDK = sdk;
  else if (run) {
    window.chatwootSDK = {
      run(options) {
        runCalls.push(options);
        return run(options);
      }
    };
  }

  const document = {
    head,
    createElement(name) {
      assert.equal(name, "script");
      createdScriptCount += 1;
      return new ScriptElement();
    },
    querySelector(selector) {
      assert.equal(selector, `script[src="${SDK_URL}"]`);
      return scripts.find(script => script.src === SDK_URL) || null;
    }
  };

  const addTimer = (callback, delay, interval) => {
    const id = nextTimerId++;
    timers.set(id, { callback, due: now + delay, delay, interval });
    return id;
  };

  const clearTimer = id => timers.delete(id);

  const advance = milliseconds => {
    const end = now + milliseconds;
    while (true) {
      let nextId = null;
      let nextDue = Infinity;
      for (const [id, timer] of timers) {
        if (timer.due < nextDue) {
          nextId = id;
          nextDue = timer.due;
        }
      }

      if (nextId === null || nextDue > end) break;

      now = nextDue;
      const timer = timers.get(nextId);
      if (!timer) continue;
      if (timer.interval) timer.due += timer.delay;
      else timers.delete(nextId);
      timer.callback();
    }
    now = end;
  };

  const execute = () =>
    vm.runInNewContext(source, {
      window,
      document,
      console: {
        error(...args) {
          errors.push(args);
        }
      },
      setInterval(callback, delay) {
        return addTimer(callback, delay, true);
      },
      clearInterval: clearTimer,
      setTimeout(callback, delay) {
        return addTimer(callback, delay, false);
      },
      clearTimeout: clearTimer
    });

  return {
    advance,
    errors,
    execute,
    existing,
    runCalls,
    scripts,
    createdScriptCount: () => createdScriptCount,
    activeTimerCount: () => timers.size,
    window
  };
}

test("loads and initializes Chatwoot on the exact allowed domain", () => {
  const harness = createHarness();
  harness.execute();

  assert.equal(harness.scripts.length, 1);
  assert.equal(harness.scripts[0].src, SDK_URL);
  assert.equal(harness.scripts[0].async, true);

  harness.window.chatwootSDK = {
    run(options) {
      harness.runCalls.push(options);
    }
  };
  harness.scripts[0].emit("load");

  assert.equal(harness.runCalls.length, 1);
  assert.equal(harness.activeTimerCount(), 0);
  assert.equal(harness.scripts[0].listenerCount(), 0);
  assert.equal(
    harness.runCalls[0].websiteToken,
    "uaBnvpGKVa5iqCVBHNRxkSc1"
  );
  assert.equal(harness.runCalls[0].baseUrl, "https://app.chatwoot.com");
});

test("allows both production hosts and rejects other domains", () => {
  for (const hostname of ["lbuture.com", "www.lbuture.com"]) {
    const harness = createHarness({ hostname });
    harness.execute();
    assert.equal(harness.scripts.length, 1, hostname);
  }

  for (const hostname of [
    "ibuture.com",
    "preview.vercel.app",
    "example.com"
  ]) {
    const harness = createHarness({ hostname });
    harness.execute();
    assert.equal(harness.scripts.length, 0, hostname);
  }
});

test("excludes cart and checkout routes with or without locale prefixes", () => {
  for (const pathname of [
    "/cart/",
    "/cart",
    "/fr/cart/",
    "/fr/cart",
    "/de-de/cart/",
    "/de-de/cart",
    "/checkout/",
    "/checkout",
    "/fr-nl/checkout/",
    "/fr-nl/checkout"
  ]) {
    const harness = createHarness({ pathname });
    harness.execute();
    assert.equal(harness.scripts.length, 0, pathname);
  }
});

test("initializes immediately when the SDK is already available", () => {
  const harness = createHarness({
    sdk: {
      run(options) {
        harness.runCalls.push(options);
      }
    }
  });
  harness.execute();

  assert.equal(harness.scripts.length, 0);
  assert.equal(harness.runCalls.length, 1);
});

test("initializes after the asynchronously loaded SDK fires load", () => {
  const harness = createHarness();
  harness.execute();
  harness.window.chatwootSDK = {
    run(options) {
      harness.runCalls.push(options);
    }
  };
  harness.scripts[0].emit("load");

  assert.equal(harness.runCalls.length, 1);
  assert.equal(harness.activeTimerCount(), 0);
  assert.equal(harness.scripts[0].listenerCount(), 0);
});

test("does not inject twice or initialize twice when launched twice", () => {
  const harness = createHarness();
  harness.execute();
  harness.execute();

  assert.equal(harness.scripts.length, 1);
  harness.window.chatwootSDK = {
    run(options) {
      harness.runCalls.push(options);
    }
  };
  harness.scripts[0].emit("load");
  harness.scripts[0].emit("load");

  assert.equal(harness.runCalls.length, 1);
});

test("removes its failed script and permits a later retry", () => {
  const harness = createHarness();
  harness.execute();
  const failedScript = harness.scripts[0];
  failedScript.emit("error");

  assert.equal(harness.scripts.length, 0);
  assert.equal(harness.window[STATE_KEY], undefined);
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.activeTimerCount(), 0);
  assert.equal(failedScript.listenerCount(), 0);

  harness.execute();
  assert.equal(harness.scripts.length, 1);
  assert.notEqual(harness.scripts[0], failedScript);
});

test("keeps failed state after timeout and preserves the pre-existing script", () => {
  const harness = createHarness({ existingScript: true });
  harness.execute();
  harness.advance(15000);

  assert.equal(harness.scripts.length, 1);
  assert.equal(harness.scripts[0], harness.existing);
  assert.equal(harness.window[STATE_KEY].status, "failed");
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.activeTimerCount(), 0);
  assert.equal(harness.existing.listenerCount(), 0);
});

test("keeps failed state after script insertion throws", () => {
  const harness = createHarness({ appendError: true });
  harness.execute();

  assert.equal(harness.createdScriptCount(), 1);
  assert.equal(harness.scripts.length, 0);
  assert.equal(harness.window[STATE_KEY].status, "failed");
  assert.equal(harness.activeTimerCount(), 0);

  harness.execute();

  assert.equal(harness.createdScriptCount(), 1);
  assert.equal(harness.scripts.length, 0);
  assert.equal(harness.runCalls.length, 0);
  assert.equal(harness.window[STATE_KEY].status, "failed");
});

test("waits safely when a pre-existing script already fired load", () => {
  const harness = createHarness({ existingScript: true });
  harness.existing.emit("load");
  harness.execute();

  assert.equal(harness.scripts.length, 1);
  harness.window.chatwootSDK = {
    run(options) {
      harness.runCalls.push(options);
    }
  };
  harness.advance(100);

  assert.equal(harness.scripts.length, 1);
  assert.equal(harness.runCalls.length, 1);
});

test("does not retry run after an exception or remove the pre-existing SDK", () => {
  const harness = createHarness({ existingScript: true });
  let attempts = 0;
  harness.window.chatwootSDK = {
    run() {
      attempts += 1;
      if (attempts === 1) throw new Error("initialization failed");
    }
  };

  harness.execute();
  assert.equal(harness.window[STATE_KEY].status, "failed");
  assert.ok(harness.window[STATE_KEY].error instanceof Error);
  assert.equal(harness.scripts[0], harness.existing);
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.activeTimerCount(), 0);
  assert.equal(harness.existing.listenerCount(), 0);

  harness.execute();
  assert.equal(attempts, 1);
  assert.equal(harness.scripts[0], harness.existing);
  assert.equal(harness.window[STATE_KEY].status, "failed");
});
