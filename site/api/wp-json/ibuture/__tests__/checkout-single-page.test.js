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

function createCheckoutHarness() {
  const elements = new Map();
  const requests = [];
  const orderRequests = [];
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
      location: { pathname: "/de-de/checkout/" },
      IBUTURE_MARKET_HEADERS: () => ({ "X-IBUTURE-Market": "DE" }),
      crypto: { randomUUID: () => "mock-idempotency-key" },
    },
    FormData: class {
      constructor(form) { this.form = form; }
      entries() {
        return Object.entries(this.form.selector === "#ibuture-customer-form"
          ? { first_name: "Test", last_name: "Buyer", email: "buyer@example.test", phone: "123" }
          : { first_name: "Test", last_name: "Buyer", address_1: "Test Street 1", city: "Berlin", postcode: "10115", country: "DE" });
      }
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
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
    resolveOrder(index = 0, payload = { success: true, order_id: 123 }) {
      orderRequests[index].resolve(response(payload));
    },
    rejectOrder(index = 0, error = new Error("network failure")) {
      orderRequests[index].reject(error);
    },
  };
}

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
