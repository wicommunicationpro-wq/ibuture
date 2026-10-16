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

test("address changes invalidate delivery and order until server synchronization succeeds", () => {
  assert.match(checkout, /#ibuture-shipping-form"\)\.addEventListener\("input", \(\) => \{ state\.addressSaved = false; state\.shippingConfirmed = false;/);
  assert.match(checkout, /#ibuture-shipping-form"\)\.addEventListener\("change", \(event\) => \{ if \(event\.target\.matches\("select"\)\).*?state\.addressSaved = false/s);
  assert.match(checkout, /await request\("\/checkout\/customer".*?await refreshCheckout\(\);\s*state\.addressSaved = true;/s);
  assert.match(checkout, /if \(state\.shippingSubmitting \|\| !state\.customerSaved \|\| !state\.addressSaved\)/);
  assert.match(checkout, /!state\.customerSaved \|\| !state\.addressSaved \|\| !state\.shippingConfirmed \|\| !state\.paymentMethod/);
});

test("customer, address, delivery and order submissions have duplicate guards", () => {
  assert.match(checkout, /if \(isAddress \? state\.addressSubmitting : state\.customerSubmitting\) return/);
  assert.match(checkout, /if \(state\.shippingSubmitting \|\| !state\.addressSaved\) return/);
  assert.match(checkout, /if \(state\.submitted\) return/);
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
  let resolveOrder;
  class Element {
    constructor(selector) {
      this.selector = selector;
      this.listeners = {};
      this.childNodes = [];
      this.radios = [];
      this.controls = [];
      this.hidden = selector === "#ibuture-checkout-empty";
      this.disabled = false;
      this.value = "";
      this.textContent = "";
      this.href = "";
      this._innerHTML = "";
      this.submitButton = { disabled: false };
      if (selector === "#ibuture-place-order") this.disabled = true;
      if (selector === "#ibuture-confirm-shipping") this.disabled = true;
      if (selector === "#ibuture-customer-form" || selector === "#ibuture-shipping-form") {
        this.controls = [{ disabled: false }, { disabled: false }, this.submitButton];
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
      if (selector === "button[type=submit]") return this.submitButton;
      return new Element(`${this.selector} ${selector}`);
    }
    querySelectorAll(selector) {
      if (selector.includes("input[name=")) return this.radios;
      if (selector === "input, select, button") return this.controls;
      return [];
    }
    checkValidity() { return true; }
    reportValidity() {}
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
  const context = {
    document: { querySelector: getElement },
    window: { location: { pathname: "/de-de/checkout/" }, IBUTURE_MARKET_HEADERS: () => ({ "X-IBUTURE-Market": "DE" }) },
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
      if (url.includes("/checkout/payment-methods")) return response([{ id: "cod", title: "Cash on delivery" }]);
      if (url.endsWith("/checkout/order")) return new Promise((resolve) => { resolveOrder = () => resolve(response({ success: true, order_id: 123 })); });
      if (url.includes("/checkout?_=")) return response(cart);
      if (url.includes("/checkout/")) return response({ success: true, cart });
      return response({});
    },
    crypto: { randomUUID: () => "mock-idempotency-key" },
    setTimeout,
    console,
  };
  vm.runInNewContext(controller, context);
  return { elements, requests, get resolveOrder() { return resolveOrder; } };
}

test("mocked checkout loads DE, saves address, invalidates stale shipping, and blocks duplicate orders", async () => {
  const harness = createCheckoutHarness();
  const { elements, requests } = harness;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  assert.equal(elements.get("#ibuture-checkout-content").hidden, false);
  assert.equal(elements.get("#ibuture-country").value, "DE");
  assert.ok(requests.every(({ url }) => url.startsWith("/wp-json/ibuture/v1/")));
  assert.ok(requests.every(({ options }) => options.headers["X-IBUTURE-Market"] === "DE"));

  const submit = async (selector) => elements.get(selector).listeners.submit[0]({
    preventDefault() {}, currentTarget: elements.get(selector),
  });
  await submit("#ibuture-customer-form");
  await submit("#ibuture-shipping-form");
  await elements.get("#ibuture-confirm-shipping").listeners.click[0]();
  assert.equal(elements.get("#ibuture-place-order").disabled, false);

  elements.get("#ibuture-shipping-form").listeners.input[0]({});
  assert.equal(elements.get("#ibuture-place-order").disabled, true);
  assert.equal(elements.get("#ibuture-confirm-shipping").disabled, true);
  await submit("#ibuture-shipping-form");
  assert.equal(elements.get("#ibuture-confirm-shipping").disabled, false);
  assert.equal(elements.get("#ibuture-place-order").disabled, true);
  await elements.get("#ibuture-confirm-shipping").listeners.click[0]();
  assert.equal(elements.get("#ibuture-place-order").disabled, false);

  const placeOrder = elements.get("#ibuture-place-order").listeners.click[0];
  const firstOrder = placeOrder();
  await flush();
  const secondOrder = placeOrder();
  assert.equal(requests.filter(({ url }) => url.endsWith("/checkout/order")).length, 1);
  harness.resolveOrder();
  await Promise.all([firstOrder, secondOrder]);
});
