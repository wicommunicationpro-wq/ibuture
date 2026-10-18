import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../ibuture-market.js", import.meta.url),
  "utf8"
);

const CHATWOOT_SCRIPT_SRC = "/cdn/shop/t/52/assets/ibuture-chatwoot.js";
const CHATWOOT_SCRIPT_SELECTOR = `script[src="${CHATWOOT_SCRIPT_SRC}"]`;

function createHarness({
  hostname = "lbuture.com",
  pathname = "/products/example"
} = {}) {
  const scripts = [];
  let createdScriptCount = 0;
  const window = { location: { hostname, pathname } };
  const document = {
    head: {
      appendChild(script) {
        scripts.push(script);
        return script;
      }
    },
    createElement(name) {
      assert.equal(name, "script");
      createdScriptCount += 1;
      return { src: "", async: false };
    },
    querySelector(selector) {
      assert.equal(selector, CHATWOOT_SCRIPT_SELECTOR);
      return scripts.find(script => script.src === CHATWOOT_SCRIPT_SRC) || null;
    }
  };

  return {
    execute() {
      vm.runInNewContext(source, { window, document });
    },
    scripts,
    createdScriptCount: () => createdScriptCount,
    window
  };
}

test("loads one async Chatwoot asset on public pages at both allowed hosts", () => {
  for (const hostname of ["lbuture.com", "www.lbuture.com"]) {
    const harness = createHarness({ hostname });
    harness.execute();

    assert.equal(harness.scripts.length, 1, hostname);
    assert.equal(harness.scripts[0].src, CHATWOOT_SCRIPT_SRC, hostname);
    assert.equal(harness.scripts[0].async, true, hostname);
  }
});

test("does not load Chatwoot on Vercel preview or other hosts", () => {
  for (const hostname of [
    "ibuture-preview.vercel.app",
    "example.com"
  ]) {
    const harness = createHarness({ hostname });
    harness.execute();
    assert.equal(harness.scripts.length, 0, hostname);
  }
});

test("does not load Chatwoot on cart routes with optional locale and slash", () => {
  for (const pathname of [
    "/cart",
    "/cart/",
    "/fr/cart",
    "/fr/cart/",
    "/de-de/cart",
    "/de-de/cart/"
  ]) {
    const harness = createHarness({ pathname });
    harness.execute();
    assert.equal(harness.scripts.length, 0, pathname);
  }
});

test("does not load Chatwoot on checkout routes with optional locale and slash", () => {
  for (const pathname of [
    "/checkout",
    "/checkout/",
    "/fr/checkout",
    "/fr/checkout/",
    "/fr-nl/checkout",
    "/fr-nl/checkout/"
  ]) {
    const harness = createHarness({ pathname });
    harness.execute();
    assert.equal(harness.scripts.length, 0, pathname);
  }
});

test("loads Chatwoot on a public localized page and preserves market globals", () => {
  const harness = createHarness({ pathname: "/fr-nl/products/example" });
  harness.execute();

  assert.equal(harness.scripts.length, 1);
  assert.equal(harness.scripts[0].async, true);
  assert.equal(harness.window.IBUTURE_MARKET, "NL");
  assert.equal(
    harness.window.IBUTURE_MARKET_HEADERS()["X-IBUTURE-Market"],
    "NL"
  );
});

test("does not duplicate the Chatwoot script when executed twice", () => {
  const harness = createHarness({ pathname: "/de-de/products/example" });
  harness.execute();
  harness.execute();

  assert.equal(harness.scripts.length, 1);
  assert.equal(harness.createdScriptCount(), 1);
  assert.equal(harness.window.IBUTURE_MARKET, "DE");
  assert.equal(
    harness.window.IBUTURE_MARKET_HEADERS()["X-IBUTURE-Market"],
    "DE"
  );
});

test("preserves market detection and header values for existing routes", () => {
  for (const [pathname, expectedMarket] of [
    ["/", "US"],
    ["/fr/", "US"],
    ["/de-de/products/example", "DE"],
    ["/fr-fr/products/example", "FR"],
    ["/fr-pl/products/example", "PL"]
  ]) {
    const harness = createHarness({ pathname });
    harness.execute();

    assert.equal(harness.window.IBUTURE_MARKET, expectedMarket, pathname);
    assert.equal(
      harness.window.IBUTURE_MARKET_HEADERS()["X-IBUTURE-Market"],
      expectedMarket,
      pathname
    );
  }
});
