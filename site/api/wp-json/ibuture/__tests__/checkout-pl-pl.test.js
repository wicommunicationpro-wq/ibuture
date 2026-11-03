import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const checkout = readFileSync(new URL("../../../../pl-pl/checkout/index.html", import.meta.url), "utf8");
const controller = checkout.match(/<script src="\/cdn\/shop\/t\/52\/assets\/ibuture-market\.js"><\/script>\s*<script>([\s\S]*?)<\/script>/)?.[1];

test("PL-PL checkout controller parses and keeps existing proxy routes and credentials", () => {
  assert.ok(controller, "checkout controller script not found");
  assert.doesNotThrow(() => new vm.Script(controller));
  assert.match(controller, /const API = "\/wp-json\/ibuture\/v1"/);
  assert.match(controller, /fetch\(API \+ path, \{ credentials: "include"/);
  assert.match(controller, /window\.IBUTURE_MARKET_HEADERS\(\)/);
});

test("PL-PL checkout links back to the equivalent checkout and presents its market in Polish", () => {
  assert.match(checkout, /href="\/pl-pl\/checkout\/" hreflang="pl-PL"/);
  assert.match(checkout, /Polska \(PLN zł\)/);
  assert.match(checkout, /country-flags--PL/);
  assert.doesNotMatch(checkout, /Pays-Bas \(EUR €\)/);
  assert.doesNotMatch(checkout, /<h1 class="h2">Finaliser la commande<\/h1>/);
  assert.doesNotMatch(checkout, /<h2 class="h3">Informations client<\/h2>/);
});

test("loads a non-empty cart and renders it only after an explicit successful response", async () => {
  const harness = createCheckoutHarness();
  await harness.ready;

  assert.equal(harness.getElement("#ibuture-checkout-content").hidden, false);
  assert.match(harness.getElement("#ibuture-checkout-items").innerHTML, /Test item/);
  assert.ok(harness.requests.some(({ url }) => url.includes("/checkout?_=")));

  const failed = createCheckoutHarness({ checkoutPayload: { success: false, items_count: 1, cart: sampleCart } });
  await failed.ready;
  assert.equal(failed.getElement("#ibuture-checkout-content").hidden, true);
  assert.equal(failed.getElement("#ibuture-checkout-error").hidden, false);
});

test("synchronizes delivery, blocks order during sync, and rejects stale delivery selection", async () => {
  let releaseSync;
  const harness = createCheckoutHarness({
    shippingHandler: ({ response, index }) => index === 1
      ? new Promise((resolve) => { releaseSync = () => resolve(response({ success: true, cart: sampleCart })); })
      : response({ success: true, cart: sampleCart }),
  });
  await harness.ready;
  await harness.advanceToShipping();
  await harness.confirmShipping();

  const methods = harness.getElement("#ibuture-shipping-methods");
  const change = methods.listeners.change[0];
  const order = harness.getElement("#ibuture-place-order").listeners.click[0];
  const syncPromise = change({ target: harness.selectShippingMethod("flat_rate:2") });
  const orderPromise = order();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(harness.orderRequests.length, 0);
  assert.equal(harness.getElement("#ibuture-place-order").disabled, true);
  releaseSync();
  await syncPromise;
  await harness.flush();
  if (harness.orderRequests.length) harness.rejectOrder(0);
  await orderPromise;

  assert.equal(harness.shippingRequests.length, 2);
  assert.equal(harness.getElement("#ibuture-place-order").disabled, false);
});

test("applies and removes coupons, resynchronizing delivery only when its server state changes", async () => {
  let shippingCost = "0.00";
  const harness = createCheckoutHarness({
    getShippingMethods: () => [{ id: "flat_rate:1", name: "Standard", cost: shippingCost }],
    couponHandler: ({ url, cart, setCart, response }) => {
      const applying = url.endsWith("/apply-coupon");
      shippingCost = applying ? "3.00" : "0.00";
      const nextCart = {
        ...cart,
        shipping_total: applying ? 3 : 0,
        discount_total: applying ? 1 : 0,
        applied_coupons: applying ? ["SAVE"] : [],
        total: applying ? 12 : 10,
      };
      setCart(nextCart);
      return response({ success: true, cart: nextCart });
    },
    shippingHandler: ({ body, cart, response }) => response({
      success: true,
      cart: { ...cart, shipping_total: Number(shippingCost), total: cart.subtotal + Number(shippingCost) - cart.discount_total },
      shipping_methods: [{ id: body.shipping_method, name: "Standard", cost: shippingCost }],
    }),
  });
  await harness.ready;
  await harness.advanceToShipping();
  await harness.confirmShipping();

  const beforeApply = harness.shippingRequests.length;
  await harness.submitCoupon();
  assert.equal(harness.couponRequests.length, 1);
  assert.equal(harness.couponRequests[0].url.endsWith("/apply-coupon"), true);
  assert.equal(harness.shippingRequests.length, beforeApply + 1);

  const beforeRemove = harness.shippingRequests.length;
  await harness.getElement("#ibuture-remove-coupon").listeners.click[0]();
  assert.equal(harness.couponRequests.length, 2);
  assert.equal(harness.couponRequests[1].url.endsWith("/remove-coupon"), true);
  assert.equal(harness.shippingRequests.length, beforeRemove + 1);

  const unchanged = createCheckoutHarness();
  await unchanged.ready;
  await unchanged.advanceToShipping();
  await unchanged.confirmShipping();
  const shippingCount = unchanged.shippingRequests.length;
  await unchanged.submitCoupon();
  assert.equal(unchanged.shippingRequests.length, shippingCount);
});

test("accepts only a valid order payload and never shows success for HTTP 200 JSON failure", async () => {
  const valid = createCheckoutHarness();
  await valid.ready;
  await valid.advanceToPayment();
  assert.ok(valid.shippingRequests.length > 0);
  assert.ok(valid.getElement("#ibuture-payment-methods").radios.length > 0);
  assert.equal(valid.getElement("#ibuture-place-order").disabled, false);
  const orderHandler = valid.getElement("#ibuture-place-order").listeners.click[0];
  const request = orderHandler();
  await valid.waitForOrder();
  valid.resolveOrder(0, { success: true, order_id: 123 });
  await request;
  assert.equal(valid.getElement("#ibuture-checkout-success").hidden, false);

  const failed = createCheckoutHarness();
  await failed.ready;
  await failed.advanceToPayment();
  const failedRequest = failed.getElement("#ibuture-place-order").listeners.click[0]();
  await failed.waitForOrder();
  failed.resolveOrder(0, { success: false, message: "Order rejected" });
  await failedRequest;
  assert.equal(failed.getElement("#ibuture-checkout-success").hidden, true);
  assert.equal(failed.getElement("#ibuture-checkout-error").hidden, false);

  const missingId = createCheckoutHarness();
  await missingId.ready;
  await missingId.advanceToPayment();
  const missingIdRequest = missingId.getElement("#ibuture-place-order").listeners.click[0]();
  await missingId.waitForOrder();
  missingId.resolveOrder(0, { success: true });
  await missingIdRequest;
  assert.equal(missingId.getElement("#ibuture-checkout-success").hidden, true);
  assert.equal(missingId.getElement("#ibuture-checkout-error").hidden, false);
});

test("retains the idempotency key after a network error and re-enables order controls", async () => {
  const harness = createCheckoutHarness();
  await harness.ready;
  await harness.advanceToPayment();

  const click = harness.getElement("#ibuture-place-order").listeners.click[0];
  const firstAttempt = click();
  await harness.waitForOrder();
  const firstKey = harness.orderRequests[0].options.headers["X-Idempotency-Key"];
  harness.rejectOrder(0);
  await firstAttempt;
  assert.equal(harness.getElement("#ibuture-place-order").disabled, false);
  assert.equal(harness.getElement("#ibuture-checkout-success").hidden, true);

  const retry = click();
  await harness.waitForOrder(2);
  const retryKey = harness.orderRequests[1].options.headers["X-Idempotency-Key"];
  assert.equal(retryKey, firstKey);
  harness.resolveOrder(1, { success: true, order_id: 124 });
  await retry;
});

test("prevents double submission while an order request is pending", async () => {
  const harness = createCheckoutHarness();
  await harness.ready;
  await harness.advanceToPayment();

  const click = harness.getElement("#ibuture-place-order").listeners.click[0];
  const first = click();
  await harness.waitForOrder();
  await click();
  assert.equal(harness.orderRequests.length, 1);
  harness.resolveOrder(0, { success: true, order_id: 125 });
  await first;
});

const sampleCart = {
  items_count: 1,
  items: [{ name: "Test item", quantity: 1, line_total: "10.00" }],
  subtotal: 10,
  shipping_total: 0,
  discount_total: 0,
  tax_total: 0,
  total: 10,
  currency: "PLN",
  fees: [],
};

function createCheckoutHarness(options = {}) {
  const elements = new Map();
  const requests = [];
  const shippingRequests = [];
  const couponRequests = [];
  const orderRequests = [];
  let generatedKey = 0;
  const crypto = { randomUUID: () => `stable-test-key-${++generatedKey}` };
  const response = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });
  let serverCart = options.cart || sampleCart;

  class Element {
    constructor(selector) {
      this.selector = selector;
      this.listeners = {};
      this.childNodes = [];
      this.radios = [];
      this.controls = [];
      this.hidden = ["#ibuture-checkout-content", "#ibuture-checkout-empty", "#ibuture-checkout-success", "#ibuture-checkout-error"].includes(selector);
      this.disabled = false;
      this.valid = true;
      this.value = selector === "#ibuture-country" ? "PL" : "";
      this.textContent = "";
      this._innerHTML = "";
      this.submitButton = { disabled: false };
      this.reset = () => {};
      if (selector === "#ibuture-customer-form" || selector === "#ibuture-shipping-form") {
        this.controls = [{ disabled: false }, { disabled: false }];
      }
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
      if (selector === 'button[type="submit"]' || selector === "button[type=submit]") return this.submitButton;
      return getElement(`${this.selector} ${selector}`);
    }
    querySelectorAll(selector) {
      if (selector.includes("input[name=")) return this.radios;
      if (selector === "input, select, button") return this.controls;
      return [];
    }
    checkValidity() { return this.valid; }
    reportValidity() {}
  }

  function getElement(selector) {
    if (selector.includes(":checked")) {
      const parent = selector.includes("shipping_method") ? "#ibuture-shipping-methods" : "#ibuture-payment-methods";
      return getElement(parent).radios.find((radio) => radio.checked) || null;
    }
    if (!elements.has(selector)) elements.set(selector, new Element(selector));
    return elements.get(selector);
  }

  const currentShippingMethods = () => options.getShippingMethods?.() || options.shippingMethods || [
    { id: "flat_rate:1", name: "Standard", cost: "0.00" },
    { id: "flat_rate:2", name: "Express", cost: "5.00" },
  ];
  const checkoutPayload = () => options.checkoutPayload || ({
    success: true,
    items_count: serverCart.items_count,
    cart: serverCart,
    shipping_methods: currentShippingMethods(),
  });
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
      location: { pathname: "/pl-pl/checkout/", href: "https://ibuture.com/pl-pl/checkout/" },
      history: { state: null, replaceState() {} },
      IBUTURE_MARKET_HEADERS: () => ({ "X-IBUTURE-Market": "PL" }),
      crypto,
    },
    crypto,
    Intl,
    URL,
    URLSearchParams,
    FormData: class {
      constructor(form) { this.form = form; }
      entries() {
        if (this.form.selector === "#ibuture-customer-form") return Object.entries({ first_name: "Test", last_name: "Buyer", email: "buyer@example.test", phone: "123" });
        if (this.form.selector === "#ibuture-coupon-form") return Object.entries({ code: "SAVE" });
        return Object.entries({ first_name: "Test", last_name: "Buyer", address_1: "Test Street 1", city: "Warsaw", postcode: "00-001", country: "PL" });
      }
    },
    fetch: async (url, requestOptions = {}) => {
      requests.push({ url, options: requestOptions });
      if (url.includes("/checkout/nonce")) return response({ nonce: "test-nonce" });
      if (url.includes("/checkout?_=")) return response(checkoutPayload());
      if (url.endsWith("/checkout/customer")) return response({ success: true });
      if (url.endsWith("/checkout/shipping")) {
        const call = { url, body: JSON.parse(requestOptions.body), options: requestOptions };
        shippingRequests.push(call);
        if (options.shippingHandler) return options.shippingHandler({ ...call, index: shippingRequests.length - 1, cart: serverCart, response, setCart: (cart) => { serverCart = cart; } });
        return response({ success: true, cart: serverCart });
      }
      if (url.includes("/checkout/payment-methods")) return response({ payment_methods: [{ id: "cod", title: "Cash on delivery" }] });
      if (url.endsWith("/checkout/payment-method")) return response({ success: true, cart: serverCart });
      if (url.endsWith("/checkout/apply-coupon") || url.endsWith("/checkout/remove-coupon")) {
        const call = { url, body: JSON.parse(requestOptions.body), options: requestOptions };
        couponRequests.push(call);
        if (options.couponHandler) return options.couponHandler({ ...call, cart: serverCart, response, setCart: (cart) => { serverCart = cart; } });
        return response({ success: true, cart: serverCart });
      }
      if (url.endsWith("/checkout/order")) {
        return new Promise((resolve, reject) => orderRequests.push({ resolve, reject, options: requestOptions }));
      }
      return response({ success: true });
    },
    setTimeout,
    console,
  };
  for (const selector of [
    "#ibuture-customer-form", "#ibuture-shipping-form", "#ibuture-checkout-content",
    "#ibuture-checkout-empty", "#ibuture-checkout-success",
  ]) getElement(selector);
  vm.runInNewContext(controller, context);

  const waitFor = async (predicate, attempts = 20) => {
    for (let index = 0; index < attempts; index += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.fail("Timed out waiting for simulated checkout request");
  };
  const ready = waitFor(() => !getElement("#ibuture-checkout-content").hidden || !getElement("#ibuture-checkout-error").hidden);
  const harness = {
    ready,
    async flush() {
      for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    },
    requests,
    shippingRequests,
    couponRequests,
    orderRequests,
    getElement,
    selectShippingMethod(id) {
      const radios = getElement("#ibuture-shipping-methods").radios;
      radios.forEach((radio) => { radio.checked = radio.value === id; });
      return radios.find((radio) => radio.checked);
    },
    async advanceToShipping() {
      const customer = getElement("#ibuture-customer-form");
      await customer.listeners.submit[0]({ preventDefault() {}, currentTarget: customer });
      const shipping = getElement("#ibuture-shipping-form");
      await shipping.listeners.submit[0]({ preventDefault() {}, currentTarget: shipping });
    },
    async confirmShipping() {
      await getElement("#ibuture-confirm-shipping").listeners.click[0]();
    },
    async advanceToPayment() {
      await this.advanceToShipping();
      await this.confirmShipping();
    },
    async submitCoupon() {
      const form = getElement("#ibuture-coupon-form");
      await form.listeners.submit[0]({ preventDefault() {}, currentTarget: form });
    },
    async waitForOrder(count = 1) {
      for (let index = 0; index < 100 && orderRequests.length < count; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assert.ok(orderRequests.length >= count, `order request not sent; checkout error: ${getElement("#ibuture-checkout-error").textContent}; selected shipping: ${getElement("#ibuture-shipping-methods").radios.find((radio) => radio.checked)?.value}; selected payment: ${getElement("#ibuture-payment-methods").radios.find((radio) => radio.checked)?.value}`);
    },
    resolveOrder(index, payload) { orderRequests[index].resolve(response(payload)); },
    rejectOrder(index) { orderRequests[index].reject(new Error("network failure")); },
  };
  return harness;
}
