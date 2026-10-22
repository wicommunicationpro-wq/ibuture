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
  const shippingRequests = [];
  const couponRequests = [];
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
  const cart = options.cart || {
    items_count: 1,
    items: [{ name: "Test item", quantity: 1, line_total: "10.00" }],
    subtotal: 10, shipping_total: 0, discount_total: 0, tax_total: 0, total: 10, currency: "EUR", fees: [],
  };
  let serverCart = cart;
  const shippingMethods = options.shippingMethods || [
    { id: "flat_rate:1", name: "Standard", cost: "0.00" },
    { id: "flat_rate:2", name: "Express", cost: "5.00" },
  ];
  const paymentMethods = options.paymentMethods || [{ id: "cod", title: "Cash on delivery" }];
  const response = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });
  const checkoutPayload = () => ({ success: true, cart: serverCart, shipping_methods: shippingMethods, payment_methods: paymentMethods });
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
        if (this.form.selector === "#ibuture-customer-form") {
          return Object.entries({ first_name: "Test", last_name: "Buyer", email: "buyer@example.test", phone: "123" });
        }
        if (this.form.selector === "#ibuture-coupon-form") {
          return Object.entries({ code: options.couponCode || "SAVE" });
        }
        return Object.entries({ first_name: "Test", last_name: "Buyer", address_1: "Test Street 1", city: "Berlin", postcode: "10115", country: "DE" });
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
      if (url.endsWith("/checkout/order")) return new Promise((resolve, reject) => { orderRequests.push({ resolve, reject, options: requestOptions }); });
      if (url.includes("/checkout?_=")) return response(checkoutPayload());
      if (url.endsWith("/checkout/shipping")) {
        const call = { body: JSON.parse(requestOptions.body), options: requestOptions };
        shippingRequests.push(call);
        if (options.shippingHandler) return options.shippingHandler({ ...call, index: shippingRequests.length - 1, cart: serverCart, setCart: (nextCart) => { serverCart = nextCart; }, response });
        if (options.deferShipping && shippingRequests.length > 1) {
          return new Promise((resolve) => { call.resolve = resolve; });
        }
        return response({ success: true, cart: serverCart, shipping_methods: shippingMethods });
      }
      if (url.endsWith("/checkout/apply-coupon") || url.endsWith("/checkout/remove-coupon")) {
        const call = { url, body: JSON.parse(requestOptions.body), options: requestOptions };
        couponRequests.push(call);
        if (options.couponHandler) return options.couponHandler({ ...call, cart: serverCart, setCart: (nextCart) => { serverCart = nextCart; }, response });
        return response({ success: true, cart: serverCart });
      }
      if (url.includes("/checkout/")) return response({ success: true, cart: serverCart });
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
    shippingRequests,
    couponRequests,
    cart,
    selectShippingMethod(id) {
      const radios = getElement("#ibuture-shipping-methods").radios;
      radios.forEach((radio) => { radio.checked = radio.value === id; });
      return radios.find((radio) => radio.value === id);
    },
    resolveShipping(index, payload, status = 200) {
      shippingRequests[index].resolve(response(payload, status));
    },
    getCart() { return serverCart; },
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

test("German checkout recalculates totals from WooCommerce when the shipping method changes", async () => {
  const harness = createCheckoutHarness({
    shippingHandler: ({ body, cart, response: makeResponse }) => {
      const shipping = body.shipping_method === "flat_rate:2" ? 7 : 2;
      return makeResponse({
        success: true,
        cart: { ...cart, shipping_total: shipping, total: cart.subtotal + shipping },
        shipping_methods: [
          { id: "flat_rate:1", name: "Standard", cost: "2.00" },
          { id: "flat_rate:2", name: "Express", cost: "7.00" },
        ],
      });
    },
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();

  const summary = harness.getElement("#ibuture-checkout-totals");
  const methods = harness.getElement("#ibuture-shipping-methods");
  assert.equal(harness.shippingRequests[0].body.shipping_method, "flat_rate:1");
  assert.match(summary.innerHTML, /12,00/);
  assert.equal(methods.radios.find((radio) => radio.checked).value, "flat_rate:1");

  const secondMethod = harness.selectShippingMethod("flat_rate:2");
  await methods.listeners.change[0]({ target: secondMethod });

  assert.equal(harness.shippingRequests[1].body.shipping_method, "flat_rate:2");
  assert.deepEqual(Object.keys(harness.shippingRequests[1].body).sort(), ["billing", "shipping", "shipping_method"]);
  assert.equal(harness.shippingRequests[1].options.headers["X-WP-Nonce"], "mock-nonce");
  assert.equal(harness.shippingRequests[1].options.headers["X-IBUTURE-Market"], "DE");
  assert.match(summary.innerHTML, /17,00/);
  assert.match(summary.innerHTML, /7,00/);
  assert.equal(methods.radios.find((radio) => radio.checked).value, "flat_rate:2");
  assert.equal(harness.getElement("#ibuture-place-order").disabled, false);

  const orderAttempt = harness.getElement("#ibuture-place-order").listeners.click[0]();
  await flush();
  const orderRequest = harness.orderRequests[0];
  assert.ok(orderRequest);
  assert.equal(JSON.parse(orderRequest.options.body).shipping_method, "flat_rate:2");
  assert.equal(orderRequest.options.headers["X-WP-Nonce"], "mock-nonce");
  harness.resolveOrder();
  await orderAttempt;
});

test("rapid shipping changes serialize requests and ignore an obsolete response", async () => {
  const harness = createCheckoutHarness({ deferShipping: true });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  const methods = harness.getElement("#ibuture-shipping-methods");
  const change = methods.listeners.change[0];

  const secondMethod = harness.selectShippingMethod("flat_rate:2");
  const secondChange = change({ target: secondMethod });
  await flush();
  assert.equal(harness.shippingRequests.length, 2);

  const latestMethod = harness.selectShippingMethod("flat_rate:1");
  const latestChange = change({ target: latestMethod });
  assert.equal(harness.shippingRequests.length, 2, "the next request waits for the active request");

  harness.resolveShipping(1, {
    success: true,
    cart: { ...harness.cart, shipping_total: 8, total: 18 },
    shipping_methods: [
      { id: "flat_rate:1", name: "Standard", cost: "2.00" },
      { id: "flat_rate:2", name: "Express", cost: "8.00" },
    ],
  });
  await secondChange;
  await flush();
  assert.equal(harness.shippingRequests.length, 3);
  assert.doesNotMatch(harness.getElement("#ibuture-checkout-totals").innerHTML, /18,00/);

  harness.resolveShipping(2, {
    success: true,
    cart: { ...harness.cart, shipping_total: 2, total: 12 },
    shipping_methods: [
      { id: "flat_rate:1", name: "Standard", cost: "2.00" },
      { id: "flat_rate:2", name: "Express", cost: "8.00" },
    ],
  });
  await latestChange;

  assert.deepEqual(harness.shippingRequests.map(({ body }) => body.shipping_method), [
    "flat_rate:1", "flat_rate:2", "flat_rate:1",
  ]);
  assert.match(harness.getElement("#ibuture-checkout-totals").innerHTML, /12,00/);
  assert.equal(methods.radios.find((radio) => radio.checked).value, "flat_rate:1");
  assert.equal(harness.getElement("#ibuture-place-order").disabled, false);
});

test("shipping API failures block order placement until a later synchronization succeeds", async () => {
  let failNextRequest = false;
  const harness = createCheckoutHarness({
    shippingHandler: ({ body, cart, response: makeResponse }) => {
      if (failNextRequest) {
        failNextRequest = false;
        return makeResponse({ code: "shipping_unavailable" }, 500);
      }
      const shipping = body.shipping_method === "flat_rate:2" ? 5 : 0;
      return makeResponse({
        success: true,
        cart: { ...cart, shipping_total: shipping, total: cart.subtotal + shipping },
        shipping_methods: [
          { id: "flat_rate:1", name: "Standard", cost: "0.00" },
          { id: "flat_rate:2", name: "Express", cost: "5.00" },
        ],
      });
    },
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  const methods = harness.getElement("#ibuture-shipping-methods");
  const change = methods.listeners.change[0];
  const placeOrder = harness.getElement("#ibuture-place-order").listeners.click[0];

  failNextRequest = true;
  await change({ target: harness.selectShippingMethod("flat_rate:2") });
  assert.equal(harness.getElement("#ibuture-place-order").disabled, true);
  assert.match(harness.getElement("#ibuture-checkout-error").textContent, /Versandkosten konnten nicht aktualisiert werden/);
  await placeOrder();
  assert.equal(harness.orderRequests.length, 0);

  await change({ target: harness.selectShippingMethod("flat_rate:1") });
  assert.equal(harness.getElement("#ibuture-place-order").disabled, false);
  assert.equal(harness.getElement("#ibuture-checkout-error").hidden, true);
  assert.equal(harness.getElement("#ibuture-shipping-methods").radios.find((radio) => radio.checked).value, "flat_rate:1");
});

test("shipping refresh preserves cart, coupon, fee, and selected payment data", async () => {
  const harness = createCheckoutHarness({
    cart: {
      items_count: 1,
      items: [{ name: "Test item", quantity: 1, line_total: "10.00" }],
      subtotal: 10,
      shipping_total: 0,
      discount_total: 2,
      applied_coupons: ["SAVE"],
      tax_total: 0,
      total: 9,
      currency: "EUR",
      fees: [{ name: "Handling", total: 1 }],
    },
    paymentMethods: [
      { id: "cod", title: "Cash on delivery" },
      { id: "bacs", title: "Bank transfer" },
    ],
    shippingHandler: ({ cart, response: makeResponse }) => makeResponse({
      success: true,
      cart: { ...cart, shipping_total: 3, total: 12 },
      shipping_methods: [
        { id: "flat_rate:1", name: "Standard", cost: "0.00" },
        { id: "flat_rate:2", name: "Express", cost: "3.00" },
      ],
    }),
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  const paymentMethods = harness.getElement("#ibuture-payment-methods");
  const selectedPayment = paymentMethods.radios.find((radio) => radio.value === "bacs");
  selectedPayment.checked = true;
  paymentMethods.listeners.change[0]({ target: selectedPayment });

  await harness.getElement("#ibuture-shipping-methods").listeners.change[0]({
    target: harness.selectShippingMethod("flat_rate:2"),
  });

  const summary = harness.getElement("#ibuture-checkout-totals").innerHTML;
  assert.match(summary, /SAVE/);
  assert.match(summary, /Handling/);
  assert.match(summary, /12,00/);
  assert.equal(harness.getElement("#ibuture-remove-coupon").hidden, false);
  assert.equal(paymentMethods.radios.find((radio) => radio.checked).value, "bacs");
  assert.equal(harness.getElement("#ibuture-checkout-items").innerHTML.includes("Test item"), true);
});

test("applying and removing a coupon revalidates the selected shipping method and server totals", async () => {
  const methods = [
    { id: "flat_rate:1", name: "Standard", cost: "2.00" },
    { id: "flat_rate:2", name: "Express", cost: "7.00" },
  ];
  const calculateShipping = ({ body, cart, setCart, response: makeResponse }) => {
    const shipping = body.shipping_method === "flat_rate:2" ? 7 : 2;
    const nextCart = {
      ...cart,
      shipping_total: shipping,
      total: cart.subtotal + shipping - cart.discount_total,
    };
    setCart(nextCart);
    return makeResponse({ success: true, cart: nextCart, shipping_methods: methods });
  };
  const harness = createCheckoutHarness({
    shippingMethods: methods,
    shippingHandler: calculateShipping,
    couponHandler: ({ url, body, cart, setCart, response: makeResponse }) => {
      assert.equal(body.code, "SAVE");
      const applied = url.endsWith("/apply-coupon");
      const nextCart = {
        ...cart,
        discount_total: applied ? 3 : 0,
        applied_coupons: applied ? ["SAVE"] : [],
        total: cart.subtotal + cart.shipping_total - (applied ? 3 : 0),
      };
      setCart(nextCart);
      return makeResponse({ success: true, cart: nextCart });
    },
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  const shippingMethods = harness.getElement("#ibuture-shipping-methods");
  await shippingMethods.listeners.change[0]({ target: harness.selectShippingMethod("flat_rate:2") });
  const couponForm = harness.getElement("#ibuture-coupon-form");
  const initialShippingRequestCount = harness.shippingRequests.length;
  const initialSubtotal = 10;
  const applyEvent = { currentTarget: couponForm, preventDefault() {} };

  await couponForm.listeners.submit[0](applyEvent);

  assert.equal(harness.couponRequests.length, 1);
  assert.equal(harness.couponRequests[0].url.endsWith("/apply-coupon"), true);
  assert.equal(harness.shippingRequests.length, initialShippingRequestCount + 1);
  assert.equal(harness.shippingRequests.at(-1).body.shipping_method, "flat_rate:2");
  assert.match(harness.getElement("#ibuture-checkout-totals").innerHTML, /14,00/);
  assert.match(harness.getElement("#ibuture-checkout-totals").innerHTML, /SAVE/);
  assert.equal(shippingMethods.radios.find((radio) => radio.checked).value, "flat_rate:2");
  assert.equal(harness.getElement("#ibuture-place-order").disabled, false);
  assert.equal(harness.getCart().total, initialSubtotal + 7 - 3);

  const requestsBeforeRemove = harness.shippingRequests.length;
  await harness.getElement("#ibuture-remove-coupon").listeners.click[0]();

  assert.equal(harness.couponRequests.length, 2);
  assert.equal(harness.couponRequests[1].url.endsWith("/remove-coupon"), true);
  assert.equal(harness.shippingRequests.length, requestsBeforeRemove + 1);
  assert.equal(harness.shippingRequests.at(-1).body.shipping_method, "flat_rate:2");
  assert.match(harness.getElement("#ibuture-checkout-totals").innerHTML, /17,00/);
  assert.doesNotMatch(harness.getElement("#ibuture-checkout-totals").innerHTML, /SAVE/);
  assert.equal(shippingMethods.radios.find((radio) => radio.checked).value, "flat_rate:2");
  assert.equal(harness.getElement("#ibuture-place-order").disabled, false);
  assert.equal(harness.getCart().total, initialSubtotal + 7);
});

test("coupon succeeds but shipping revalidation fails: checkout keeps order blocked", async () => {
  let rejectResync = false;
  const harness = createCheckoutHarness({
    couponHandler: ({ cart, setCart, response: makeResponse }) => {
      const nextCart = { ...cart, discount_total: 1, applied_coupons: ["SAVE"], total: 9 };
      setCart(nextCart);
      return makeResponse({ success: true, cart: nextCart });
    },
    shippingHandler: ({ body, cart, setCart, response: makeResponse }) => {
      if (rejectResync) {
        rejectResync = false;
        return makeResponse({ code: "shipping_unavailable" }, 500);
      }
      const nextCart = { ...cart, shipping_total: 0, total: cart.subtotal - cart.discount_total };
      setCart(nextCart);
      return makeResponse({
        success: true,
        cart: nextCart,
        shipping_methods: [
          { id: "flat_rate:1", name: "Standard", cost: "0.00" },
          { id: "flat_rate:2", name: "Express", cost: "5.00" },
        ],
      });
    },
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  rejectResync = true;

  await harness.getElement("#ibuture-coupon-form").listeners.submit[0]({
    currentTarget: harness.getElement("#ibuture-coupon-form"),
    preventDefault() {},
  });

  assert.equal(harness.getElement("#ibuture-place-order").disabled, true);
  assert.match(harness.getElement("#ibuture-checkout-error").textContent, /Versandkosten konnten nicht aktualisiert werden/);
  await harness.getElement("#ibuture-place-order").listeners.click[0]();
  assert.equal(harness.orderRequests.length, 0);

  const selected = harness.selectShippingMethod("flat_rate:1");
  await harness.getElement("#ibuture-shipping-methods").listeners.change[0]({ target: selected });
  assert.equal(harness.getElement("#ibuture-place-order").disabled, false);
  assert.equal(harness.getElement("#ibuture-checkout-error").hidden, true);
});

test("coupon API failure refreshes and resynchronizes shipping before allowing checkout", async () => {
  const harness = createCheckoutHarness({
    couponHandler: ({ response: makeResponse }) => makeResponse({ code: "coupon_invalid" }, 400),
    shippingHandler: ({ body, cart, setCart, response: makeResponse }) => {
      const nextCart = { ...cart, shipping_total: 2, total: cart.subtotal + 2 - cart.discount_total };
      setCart(nextCart);
      return makeResponse({
        success: true,
        cart: nextCart,
        shipping_methods: [
          { id: "flat_rate:1", name: "Standard", cost: "2.00" },
          { id: "flat_rate:2", name: "Express", cost: "5.00" },
        ],
      });
    },
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  const initialShippingRequests = harness.shippingRequests.length;

  await harness.getElement("#ibuture-coupon-form").listeners.submit[0]({
    currentTarget: harness.getElement("#ibuture-coupon-form"),
    preventDefault() {},
  });

  assert.equal(harness.couponRequests.length, 1);
  assert.equal(harness.shippingRequests.length, initialShippingRequests + 1);
  assert.equal(harness.getElement("#ibuture-shipping-methods").radios.find((radio) => radio.checked).value, "flat_rate:1");
  assert.equal(harness.getElement("#ibuture-place-order").disabled, false);
  assert.match(harness.getElement("#ibuture-checkout-error").textContent, /Gutscheincode ist ungültig/);
});

test("mocked checkout validates and submits all fields once, then waits for server confirmation", async () => {
  const harness = createCheckoutHarness();
  const { elements, requests, orderRequests, shippingRequests } = harness;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  await flush();
  assert.equal(elements.get("#ibuture-checkout-content").hidden, false);
  assert.equal(elements.get("#ibuture-country").value, "DE");
  assert.ok(requests.every(({ url }) => url.startsWith("/wp-json/ibuture/v1/")));
  assert.ok(requests.every(({ options }) => options.headers["X-IBUTURE-Market"] === "DE"));

  const placeOrder = elements.get("#ibuture-place-order").listeners.click[0];
  const customerForm = harness.getElement("#ibuture-customer-form");
  const shippingForm = harness.getElement("#ibuture-shipping-form");
  const initialShippingRequests = shippingRequests.length;
  customerForm.valid = false;
  await placeOrder();
  assert.equal(customerForm.reportValidityCalls, 1);
  assert.equal(shippingRequests.length, initialShippingRequests);

  customerForm.valid = true;
  shippingForm.valid = false;
  await placeOrder();
  assert.equal(shippingForm.reportValidityCalls, 1);
  assert.equal(shippingRequests.length, initialShippingRequests);

  shippingForm.valid = true;
  const firstAttempt = placeOrder();
  await flush();
  assert.equal(shippingRequests.length, initialShippingRequests + 1);
  const shippingRequest = shippingRequests.at(-1);
  const shippingBody = shippingRequest.body;
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
