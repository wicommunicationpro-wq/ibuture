import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const checkout = readFileSync(new URL("../../../../de-de/checkout/index.html", import.meta.url), "utf8");
const controller = checkout.match(/<script src="\/cdn\/shop\/t\/52\/assets\/ibuture-market\.js"><\/script>\s*<script>([\s\S]*?)<\/script>/)?.[1];

test("German checkout is localized, uses its own base and preserves the DE market route", () => {
  assert.match(checkout, /<html dir="ltr" lang="de">/);
  assert.match(checkout, /<base href="\/de-de\/"\/?>/);
  assert.match(checkout, /checkoutMarketPath === "de-de"/);
  assert.match(checkout, /`\/\$\{checkoutMarketPath\}\/collections\/\$\{collectionSlugs\[checkoutLocale\]/);
  assert.match(checkout, /countrySelect\.value = "DE"/);
});

test("all checkout sections remain visible together after a non-empty cart loads", () => {
  for (const id of [
    "ibuture-customer-form",
    "ibuture-shipping-form",
    "ibuture-shipping-section",
    "ibuture-payment-section",
    "ibuture-checkout-summary",
  ]) {
    const element = checkout.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0];
    assert.ok(element, `missing ${id}`);
    assert.doesNotMatch(element, /\shidden(?:\s|=|>)/, `${id} is initially hidden`);
  }
  assert.match(checkout, /#ibuture-checkout-content\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(checkout, /if \(!itemsCount\).*?ibuture-checkout-empty/s);
  assert.match(checkout, /#ibuture-checkout-content"\)\.hidden = false/);
});

test("single final action validates both forms and synchronizes address-dependent shipping", () => {
  const orderFlow = controller.slice(controller.indexOf("async function placeOrder()"), controller.indexOf("async function init()"));
  assert.match(orderFlow, /customerForm\.checkValidity\(\).*?customerForm\.reportValidity\(\)/s);
  assert.match(orderFlow, /shippingForm\.checkValidity\(\).*?shippingForm\.reportValidity\(\)/s);
  assert.ok(orderFlow.indexOf("formData(customerForm)") < orderFlow.indexOf("setCheckoutControlsDisabled(true)"));
  assert.ok(orderFlow.indexOf("formData(shippingForm)") < orderFlow.indexOf("setCheckoutControlsDisabled(true)"));
  assert.match(orderFlow, /request\("\/checkout\/shipping"[\s\S]*?JSON\.stringify\(\{ billing, shipping, shipping_method: shippingMethod \}\)/);
  assert.match(orderFlow, /await refreshCheckout\(\)/);
  assert.match(orderFlow, /JSON\.stringify\(\{ billing, shipping, payment_method: paymentMethod, shipping_method: shippingMethod \}\)/);
  assert.doesNotMatch(checkout, /id="ibuture-confirm-shipping"/);
  assert.equal((checkout.match(/id="ibuture-place-order"/g) || []).length, 1);
  for (const formId of ["ibuture-customer-form", "ibuture-shipping-form"]) {
    const form = checkout.match(new RegExp(`<form id="${formId}"[\\s\\S]*?<\\/form>`))?.[0];
    assert.ok(form, `missing ${formId}`);
    assert.doesNotMatch(form, /<button[^>]*type="submit"/);
  }
});

test("final submission guards concurrent orders and reuses the idempotency key", () => {
  assert.match(controller, /if \(state\.submitted\) return/);
  assert.match(controller, /if \(!state\.idempotencyKey\) state\.idempotencyKey =/);
  assert.match(controller, /"X-Idempotency-Key": idempotencyKey\(\)/);
  assert.match(controller, /orderPayload\.success !== true \|\| !orderPayload\.order_id/);
});

test("checkout controller parses as JavaScript and keeps the existing same-origin API", () => {
  assert.ok(controller, "checkout controller script not found");
  assert.doesNotThrow(() => new vm.Script(controller));
  assert.match(controller, /const API = "\/wp-json\/ibuture\/v1"/);
  assert.match(controller, /fetch\(API \+ path, \{ credentials: "include"/);
});

function createCheckoutHarness(options = {}) {
  const elements = new Map();
  const requests = [];
  const orderRequests = [];
  const historyReplacements = [];
  const conversionEvents = [];
  const conversionSuccessVisibility = [];
  const storage = options.storage || new Map();
  class Element {
    constructor(selector) {
      this.selector = selector;
      this.listeners = {};
      this.childNodes = [];
      this.radios = [];
      this.controls = [];
      this.hidden = ["#ibuture-checkout-empty", "#ibuture-checkout-success", "#ibuture-checkout-content"].includes(selector);
      this.disabled = false;
      this.value = "";
      this.textContent = "";
      this.href = "";
      this._innerHTML = "";
      this.submitButton = { disabled: false };
      this.valid = true;
      this.reportValidityCalls = 0;
      this.reset = () => {};
      this.controls = selector === "#ibuture-customer-form" || selector === "#ibuture-shipping-form"
        ? [{ disabled: false }, { disabled: false }] : [];
    }
    set innerHTML(html) {
      this._innerHTML = html;
      const name = this.selector === "#ibuture-shipping-methods" ? "shipping_method" :
        this.selector === "#ibuture-payment-methods" ? "payment_method" : null;
      this.radios = name ? Array.from(html.matchAll(/<input\b[^>]*value="([^"]+)"[^>]*>/g), (match) => ({
        name, value: match[1], checked: /\bchecked\b/.test(match[0]), disabled: false,
        matches(selector) { return selector.includes(this.name); },
      })) : [];
    }
    get innerHTML() { return this._innerHTML; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    querySelector(selector) {
      if (selector.includes("input[name=") && selector.includes(":checked")) return this.radios.find((radio) => radio.checked) || null;
      if (selector === "button[type=submit]") return this.submitButton;
      return new Element(`${this.selector} ${selector}`);
    }
    querySelectorAll(selector) {
      if (selector.includes("input[name=")) return this.radios;
      if (selector === "input, select, button") return this.controls;
      return [];
    }
    checkValidity() { return this.valid; }
    reportValidity() { this.reportValidityCalls += 1; }
  }
  const getElement = (selector) => {
    if (selector.includes(":checked")) {
      const group = selector.includes("shipping_method") ? "#ibuture-shipping-methods" : "#ibuture-payment-methods";
      return getElement(group).radios.find((radio) => radio.checked) || null;
    }
    if (!elements.has(selector)) elements.set(selector, new Element(selector));
    return elements.get(selector);
  };
  const cart = {
    items_count: 1,
    items: [{ name: "Test item", quantity: 1, line_total: "10.00" }],
    totals: { subtotal: 10, shipping_total: 0, discount_total: 0, tax_total: 0, total: 10, currency: "EUR", fees: [] },
    shipping_methods: [{ id: "flat_rate:1", name: "Standard", amount: "0.00" }],
  };
  const response = (payload) => ({ ok: true, status: 200, json: async () => payload });
  const checkoutPayload = () => ({ success: true, ...cart, cart, payment_methods: [{ id: "cod", title: "Cash on delivery" }] });
  const context = {
    document: {
      querySelector: getElement,
      querySelectorAll: () => [
        ...getElement("#ibuture-customer-form").controls,
        ...getElement("#ibuture-shipping-form").controls,
        ...getElement("#ibuture-shipping-methods").radios,
        ...getElement("#ibuture-payment-methods").radios,
        getElement("#ibuture-remove-coupon"),
        getElement("#ibuture-place-order"),
      ],
    },
    window: {
      location: {
        pathname: "/de-de/checkout/",
        href: options.href || "https://www.lbuture.com/de-de/checkout/",
      },
      history: {
        state: null,
        replaceState(_state, _title, url) { historyReplacements.push(String(url)); },
      },
      IBUTURE_MARKET_HEADERS: () => ({ "X-IBUTURE-Market": "DE" }),
      crypto: { randomUUID: () => "mock-idempotency-key" },
      localStorage: {
        getItem(key) { return storage.has(key) ? storage.get(key) : null; },
        setItem(key, value) { storage.set(key, String(value)); },
      },
      gtag: options.gtagDisabled ? undefined : (...args) => {
        conversionEvents.push(args);
        conversionSuccessVisibility.push(getElement("#ibuture-checkout-success").hidden === false);
      },
    },
    URL,
    URLSearchParams,
    FormData: class {
      constructor(form) { this.form = form; }
      entries() {
        return Object.entries(this.form.selector === "#ibuture-customer-form"
          ? { first_name: "Test", last_name: "Buyer", email: "buyer@example.test", phone: "123" }
          : { first_name: "Test", last_name: "Buyer", address_1: "Test Street 1", city: "Berlin", postcode: "10115", country: "DE" });
      }
    },
    fetch: async (url, requestOptions) => {
      requests.push({ url, options: requestOptions });
      if (url.includes("/products?slug=")) return response({
        success: true,
        data: [options.product || {
          id: 123,
          slug: "buture-vc90-cordless-vacuum-cleaner",
          type: "variable",
          variations: [{ id: 456, shopify_variant_id: "47108090527999" }],
        }],
      });
      if (url.includes("/cart?")) return response({ success: true, items: [] });
      if (url.endsWith("/cart/add")) return response({ success: true });
      if (url.includes("/checkout/nonce")) return response({ nonce: "mock-nonce" });
      if (url.endsWith("/checkout/order")) return new Promise((resolve, reject) => { orderRequests.push({ resolve, reject, options }); });
      if (url.includes("/checkout?_=")) return response(checkoutPayload());
      if (url.endsWith("/checkout/shipping")) return response({ success: true, cart, shipping_methods: cart.shipping_methods });
      if (url.includes("/checkout/")) return response({ success: true, cart });
      return response({});
    },
    setTimeout,
    console,
  };
  getElement("#ibuture-customer-form");
  getElement("#ibuture-shipping-form");
  getElement("#ibuture-checkout-content");
  getElement("#ibuture-checkout-success");
  vm.runInNewContext(controller, context);
  return {
    elements,
    getElement,
    requests,
    orderRequests,
    historyReplacements,
    conversionEvents,
    conversionSuccessVisibility,
    storage,
    resolveOrder(index = 0, payload = {
      success: true,
      order_id: 123,
      order_total: 29.95,
      currency: "EUR",
      order_key: "must-not-be-sent",
      email: "buyer@example.test",
    }) {
      orderRequests[index].resolve(response(payload));
    },
    rejectOrder(index = 0, error = new Error("network failure")) {
      orderRequests[index].reject(error);
    },
  };
}

test("German direct link resolves the VC90 through WooCommerce and opens the existing checkout", async () => {
  const harness = createCheckoutHarness({
    href: "https://www.lbuture.com/de-de/checkout/?buy_now=vc90&campaign=spring",
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();

  const productRequest = harness.requests.find(({ url }) => url.includes("/products?slug="));
  const cartRequest = harness.requests.find(({ url }) => url.includes("/cart?"));
  const addRequest = harness.requests.find(({ url }) => url.endsWith("/cart/add"));
  const nonceRequest = harness.requests.find(({ url }) => url.includes("/checkout/nonce"));
  assert.ok(productRequest);
  assert.ok(cartRequest);
  assert.ok(addRequest);
  assert.ok(nonceRequest);
  assert.ok(harness.requests.indexOf(addRequest) < harness.requests.indexOf(nonceRequest));
  assert.match(productRequest.url, /slug=buture-vc90-cordless-vacuum-cleaner/);
  const addBody = new URLSearchParams(addRequest.options.body);
  assert.equal(addBody.get("product_id"), "123");
  assert.equal(addBody.get("variation_id"), "456");
  assert.equal(addBody.get("quantity"), "1");
  assert.equal(addBody.get("localized_locale"), "de");
  assert.deepEqual(harness.historyReplacements, ["https://www.lbuture.com/de-de/checkout/?campaign=spring"]);
  assert.equal(harness.getElement("#ibuture-checkout-content").hidden, false);
});

test("German direct link adds the real simple VC90 product without a variation", async () => {
  const harness = createCheckoutHarness({
    href: "https://www.lbuture.com/de-de/checkout/?buy_now=vc90",
    product: {
      id: 380,
      slug: "buture-vc90-cordless-vacuum-cleaner",
      type: "simple",
      variations: [],
    },
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();

  const productRequest = harness.requests.find(({ url }) => url.includes("/products?slug="));
  const addRequest = harness.requests.find(({ url }) => url.endsWith("/cart/add"));
  const nonceRequest = harness.requests.find(({ url }) => url.includes("/checkout/nonce"));

  assert.ok(productRequest, "WooCommerce product lookup should run");
  assert.ok(addRequest, "the simple VC90 should be added to the cart");
  assert.ok(nonceRequest, "the existing checkout should continue loading");
  assert.ok(harness.requests.indexOf(addRequest) < harness.requests.indexOf(nonceRequest));

  const addBody = new URLSearchParams(addRequest.options.body);
  assert.equal(addBody.get("product_id"), "380");
  assert.equal(addBody.get("variation_id"), "0");
  assert.equal(addBody.get("quantity"), "1");
  assert.equal(addBody.get("localized_locale"), "de");
  assert.deepEqual(harness.historyReplacements, [
    "https://www.lbuture.com/de-de/checkout/"
  ]);
  assert.equal(harness.getElement("#ibuture-checkout-content").hidden, false);
});

test("mocked checkout validates and submits all fields once, then waits for server confirmation", async () => {
  const harness = createCheckoutHarness();
  const { elements, requests, orderRequests } = harness;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  assert.equal(elements.get("#ibuture-checkout-content").hidden, false);
  assert.equal(elements.get("#ibuture-country").value, "DE");
  assert.ok(requests.every(({ url }) => url.startsWith("/wp-json/ibuture/v1/")));
  assert.ok(requests.every(({ options }) => options.headers["X-IBUTURE-Market"] === "DE"));

  const placeOrder = elements.get("#ibuture-place-order").listeners.click[0];
  const customerForm = harness.getElement("#ibuture-customer-form");
  const shippingForm = harness.getElement("#ibuture-shipping-form");
  customerForm.valid = false;
  await placeOrder();
  assert.equal(customerForm.reportValidityCalls, 1);
  assert.equal(requests.some(({ url }) => url.endsWith("/checkout/shipping")), false);

  customerForm.valid = true;
  shippingForm.valid = false;
  await placeOrder();
  assert.equal(shippingForm.reportValidityCalls, 1);
  assert.equal(requests.some(({ url }) => url.endsWith("/checkout/shipping")), false);

  shippingForm.valid = true;
  const firstAttempt = placeOrder();
  await flush();
  assert.equal(requests.filter(({ url }) => url.endsWith("/checkout/shipping")).length, 1);
  const shippingRequest = requests.find(({ url }) => url.endsWith("/checkout/shipping"));
  const shippingBody = JSON.parse(shippingRequest.options.body);
  assert.deepEqual({ ...shippingBody.billing }, {
    first_name: "Test", last_name: "Buyer", address_1: "Test Street 1", city: "Berlin",
    postcode: "10115", country: "DE", email: "buyer@example.test", phone: "123",
  });
  assert.deepEqual({ ...shippingBody.shipping }, {
    first_name: "Test", last_name: "Buyer", address_1: "Test Street 1", city: "Berlin",
    postcode: "10115", country: "DE",
  });
  assert.equal(shippingBody.shipping_method, "flat_rate:1");
  assert.equal(requests.some(({ url }) => url.endsWith("/checkout/order")), true);
  assert.equal(orderRequests.length, 1);
  assert.equal(elements.get("#ibuture-checkout-content").hidden, false);
  assert.equal(elements.get("#ibuture-checkout-success").hidden, true);

  const secondAttempt = placeOrder();
  assert.equal(orderRequests.length, 1);
  harness.resolveOrder();
  await Promise.all([firstAttempt, secondAttempt]);
  assert.equal(elements.get("#ibuture-checkout-content").hidden, true);
  assert.equal(elements.get("#ibuture-checkout-success").hidden, false);
  const orderRequest = requests.find(({ url }) => url.endsWith("/checkout/order"));
  const orderBody = JSON.parse(orderRequest.options.body);
  assert.equal(orderBody.billing.email, "buyer@example.test");
  assert.equal(orderBody.shipping.address_1, "Test Street 1");
  assert.equal(orderBody.shipping_method, "flat_rate:1");
  assert.equal(orderBody.payment_method, "cod");
  assert.equal(orderRequest.options.headers["X-Idempotency-Key"], "mock-idempotency-key");
});

test("retry after an uncertain order response keeps the same idempotency key and success requires confirmation", async () => {
  const harness = createCheckoutHarness();
  const { elements, requests, orderRequests } = harness;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  const placeOrder = elements.get("#ibuture-place-order").listeners.click[0];
  const firstAttempt = placeOrder();
  await flush();
  harness.rejectOrder(0);
  await firstAttempt;
  assert.equal(elements.get("#ibuture-checkout-content").hidden, false);
  assert.equal(elements.get("#ibuture-checkout-success").hidden, true);

  const retry = placeOrder();
  await flush();
  assert.equal(orderRequests.length, 2);
  const orderHeaders = requests.filter(({ url }) => url.endsWith("/checkout/order")).map(({ options }) => options.headers["X-Idempotency-Key"]);
  assert.deepEqual(orderHeaders, ["mock-idempotency-key", "mock-idempotency-key"]);
  assert.equal(elements.get("#ibuture-checkout-content").hidden, false);
  harness.resolveOrder(1);
  await retry;
  assert.equal(elements.get("#ibuture-checkout-content").hidden, true);
  assert.equal(elements.get("#ibuture-checkout-success").hidden, false);
});

test("Google Ads purchase conversion follows valid order confirmation and sends only transaction data", async () => {
  const harness = createCheckoutHarness();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();

  const placeOrder = harness.getElement("#ibuture-place-order").listeners.click[0];
  const attempt = placeOrder();
  await flush();
  harness.resolveOrder();
  await attempt;

  assert.equal(harness.getElement("#ibuture-checkout-success").hidden, false);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.conversionEvents)), [[
    "event",
    "conversion",
    {
      send_to: "AW-18526973909/1IovCP74jaUdENXfrIJF",
      transaction_id: "123",
      value: 29.95,
      currency: "EUR",
    },
  ]]);
  assert.deepEqual(harness.conversionSuccessVisibility, [true]);
});

test("Google Ads purchase conversion is not sent after an unsuccessful API response", async () => {
  const harness = createCheckoutHarness();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();

  const attempt = harness.getElement("#ibuture-place-order").listeners.click[0]();
  await flush();
  harness.resolveOrder(0, { success: false, order_id: 123, order_total: 29.95, currency: "EUR" });
  await attempt;

  assert.deepEqual(harness.conversionEvents, []);
  assert.equal(harness.getElement("#ibuture-checkout-success").hidden, true);
});

test("Google Ads purchase conversion requires a valid order ID, amount, and currency", async (t) => {
  const invalidOrders = [
    { success: true, order_total: 29.95, currency: "EUR" },
    { success: true, order_id: "invalid", order_total: 29.95, currency: "EUR" },
    { success: true, order_id: 123, currency: "EUR" },
    { success: true, order_id: 123, order_total: 29.95 },
  ];

  for (const payload of invalidOrders) {
    await t.test(JSON.stringify(payload), async () => {
      const harness = createCheckoutHarness();
      const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
      await flush();

      const attempt = harness.getElement("#ibuture-place-order").listeners.click[0]();
      await flush();
      harness.resolveOrder(0, payload);
      await attempt;

      assert.deepEqual(harness.conversionEvents, []);
      assert.equal(harness.getElement("#ibuture-checkout-success").hidden, payload.order_id ? false : true);
    });
  }
});

test("Google Ads purchase conversion is deduplicated across checkout reloads", async () => {
  const storage = new Map();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
    const harness = createCheckoutHarness({ storage });
    await flush();

    const attempt = harness.getElement("#ibuture-place-order").listeners.click[0]();
    await flush();
    harness.resolveOrder();
    await attempt;

    assert.equal(harness.conversionEvents.length, attemptIndex === 0 ? 1 : 0);
  }
});

test("missing gtag does not block the order confirmation", async () => {
  const harness = createCheckoutHarness({ gtagDisabled: true });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();

  const attempt = harness.getElement("#ibuture-place-order").listeners.click[0]();
  await flush();
  harness.resolveOrder();
  await attempt;

  assert.equal(harness.getElement("#ibuture-checkout-success").hidden, false);
  assert.deepEqual(harness.conversionEvents, []);
});
