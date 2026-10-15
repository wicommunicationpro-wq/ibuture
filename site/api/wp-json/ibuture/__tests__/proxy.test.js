import test from "node:test";
import assert from "node:assert/strict";
import handler, {
  normalizeRest, isValidRest, buildUpstreamUrl, stripIncompatibleDomain, resolveRedirect,
} from "../[...path].js";

const REAL_FETCH = globalThis.fetch;
const UPSTREAM = "https://darkred-partridge-609254.hostingersite.com/wp-json/ibuture";

function fakeRes() {
  const headers = {};
  return {
    statusCode: 0,
    setHeader(k, v) { headers[k] = v; return this; },
    getHeader(k) { return headers[k]; },
    write() {}, end() {}, _headers: headers,
  };
}
function fakeReq(over = {}) {
  return {
    method: "GET", url: "/api/wp-json/ibuture/v1/cart",
    headers: {}, query: { path: ["v1", "cart"] }, ...over,
  };
}
function mockFetch(response) { globalThis.fetch = async () => response; }

// --- Normalisation + URL amont (régression, cas exigés) ---
test("normalizeRest: cart->v1/cart, v1/cart->v1/cart, v1->v1, jamais v1/v1", (t) => {
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  assert.equal(normalizeRest(["cart"]), "v1/cart");
  assert.equal(normalizeRest(["v1", "cart"]), "v1/cart");
  assert.equal(normalizeRest(["v1"]), "v1");                       // jamais v1/v1
  assert.equal(buildUpstreamUrl("v1", "/x"), `${UPSTREAM}/v1`);
  assert.equal(/\/v1\/v1\b/.test(buildUpstreamUrl(normalizeRest(["v1"]), "/x")), false);
});
test("normalizeRest: vide et traversal et encodages -> rejet", (t) => {
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  assert.equal(normalizeRest([]), "");
  assert.equal(normalizeRest(["v1", "..", "secret"]), "");
  assert.equal(normalizeRest(["v1", "%2e%2e"]), "");
  assert.equal(normalizeRest(["v1", "%2f"]), "");
  assert.equal(normalizeRest(["v1", "%5c"]), "");
});
test("isValidRest: routes connues/inconnues + URL amont finale", (t) => {
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  assert.equal(isValidRest("v1/cart"), true);
  assert.equal(isValidRest("v1/checkout/order"), true);
  assert.equal(isValidRest("v1/wp-admin"), false);
  assert.equal(isValidRest("v1/../secret"), false);
  assert.equal(buildUpstreamUrl("v1/cart/add", "/api/wp-json/ibuture/v1/cart/add?x=1"),
               `${UPSTREAM}/v1/cart/add?x=1`);
});

// --- Méthodes ---
test("méthode interdite -> 405 + Allow", async (t) => {
  mockFetch({ status: 200, body: null, headers: { get: () => null, getSetCookie: () => [] } });
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  const res = fakeRes();
  await handler(fakeReq({ method: "DELETE" }), res);
  assert.equal(res.statusCode, 405);
  assert.match(res.getHeader("Allow"), /GET, POST, OPTIONS/);
});
test("OPTIONS -> 204, amont NON appelé", async (t) => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { status: 200, body: null, headers: { get: () => null, getSetCookie: () => [] } }; };
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  const res = fakeRes();
  await handler(fakeReq({ method: "OPTIONS" }), res);
  assert.equal(res.statusCode, 204);
  assert.equal(called, false);   // preuve: amont non joint
});

// --- Cookie entrant relayé ---
test("cookie entrant relayé tel quel à l'amont", async (t) => {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return { status: 200, body: null, headers: { get: () => null, getSetCookie: () => [] } };
  };
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  const res = fakeRes();
  await handler(fakeReq({ headers: { cookie: "wp_woocommerce_session_=<mask>" } }), res);
  assert.equal(seen.init.headers.cookie, "wp_woocommerce_session_=<mask>");
});

// --- Cookies: plusieurs Set-Cookie + Domain retiré + attributs préservés ---
test("plusieurs Set-Cookie distincts, Domain retiré, attributs préservés", async (t) => {
  mockFetch({
    status: 200, body: null,
    headers: {
      get: () => null,
      getSetCookie: () => [
        "wp_woocommerce_session_=a; Domain=.hostingersite.com; Path=/; Secure; HttpOnly; SameSite=None; Expires=Wed, 01 Jan 2025 00:00:00 GMT",
        "woocommerce_cart_hash=b; Domain=ibuture.com; Path=/; SameSite=Lax; Max-Age=3600",
      ],
    },
  });
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  const res = fakeRes();
  await handler(fakeReq(), res);
  const sc = res.getHeader("Set-Cookie");
  assert.equal(sc.length, 2);
  assert.doesNotMatch(sc[0], /domain=/i);
  assert.match(sc[0], /Path=\//); assert.match(sc[0], /Secure/); assert.match(sc[0], /HttpOnly/);
  assert.match(sc[0], /SameSite=None/); assert.match(sc[0], /Expires=/);
  assert.doesNotMatch(sc[1], /domain=/i);            // même ibuture.com: Domain retiré
  assert.match(sc[1], /Max-Age=3600/);
});
test("stripIncompatibleDomain: retire Domain dans tous les cas, garde le reste", (t) => {
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  assert.equal(stripIncompatibleDomain("k=v; Domain=.hostingersite.com; Path=/; Secure; HttpOnly; SameSite=None"),
               "k=v; Path=/; Secure; HttpOnly; SameSite=None");
  assert.equal(stripIncompatibleDomain("k=v; Domain=ibuture.com; Path=/; Secure"), "k=v; Path=/; Secure");
  assert.equal(stripIncompatibleDomain("k=v; Path=/; Secure; HttpOnly"), "k=v; Path=/; Secure; HttpOnly");
  assert.equal(stripIncompatibleDomain("k=v; Domain=evil.com; Path=/"), "k=v; Path=/");
  assert.equal(stripIncompatibleDomain("k=v; Domain=; Path=/"), "k=v; Path=/");
});

// --- Corps POST + en-têtes marché + query conservée ---
test("POST relaie corps, X-IBUTURE-Market, Content-Type, query", async (t) => {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return { status: 200, body: null, headers: { get: () => null, getSetCookie: () => [] } };
  };
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  const chunks = [Buffer.from("product_id=106&quantity=1")];
  const req = fakeReq({
    method: "POST", url: "/api/wp-json/ibuture/v1/cart/add?x=1",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-ibuture-market": "DE", "x-wp-nonce": "<mask>" },
    query: { path: ["v1", "cart", "add"] },
    async *[Symbol.asyncIterator]() { yield* chunks; },
  });
  const res = fakeRes();
  await handler(req, res);
  assert.match(seen.url, /\/v1\/cart\/add\?x=1$/);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["x-ibuture-market"], "DE");
  assert.equal(seen.init.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(seen.init.headers["x-wp-nonce"], "<mask>");
  assert.equal(Buffer.from(seen.init.body).toString(), "product_id=106&quantity=1");
  assert.match(res.getHeader("Cache-Control"), /no-store/);
});


// --- 204 sans corps + erreur amont 502 ---
test("204 sans corps, sans cache", async (t) => {
  mockFetch({ status: 204, body: null, headers: { get: () => null, getSetCookie: () => [] } });
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 204);
  assert.match(res.getHeader("Cache-Control"), /no-store/);
});
test("échec amont -> 502", async (t) => {
  globalThis.fetch = async () => { throw new Error("boom"); };
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 502);
});

// --- Redirections (règle simplifiée : relatif uniquement) ---
test("redirection relative first-party: Location conservé", async (t) => {
  mockFetch({ status: 302, body: null, headers: { get: (k) => (k.toLowerCase() === "location" ? "/de/checkout/" : null), getSetCookie: () => [] } });
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.getHeader("Location"), "/de/checkout/");
});
test("redirection absolue (Hostinger OU ibuture.com): Location SUPPRIMÉ", async (t) => {
  for (const target of ["https://hostingersite.com/x", "https://ibuture.com/de/checkout/", "//evil.com/x"]) {
    mockFetch({ status: 302, body: null, headers: { get: (k) => (k.toLowerCase() === "location" ? target : null), getSetCookie: () => [] } });
    const res = fakeRes();
    await handler(fakeReq(), res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.getHeader("Location"), undefined, `externe transmis: ${target}`);
  }
});
test("resolveRedirect: cas limites", (t) => {
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  assert.deepEqual(resolveRedirect("/de/checkout/"), { allow: true, value: "/de/checkout/" });
  assert.equal(resolveRedirect("//evil.com/x").allow, false);
  assert.equal(resolveRedirect("https://ibuture.com/a").allow, false);   // absolu refusé
  assert.equal(resolveRedirect("javascript:alert(1)").allow, false);
  assert.equal(resolveRedirect("/de/../etc").allow, false);
  assert.equal(resolveRedirect("/a/./b").allow, false);
  assert.equal(resolveRedirect("relative/path").allow, false);
  assert.equal(resolveRedirect("").allow, false);
});

// --- Périmètre en-têtes : ni Authorization ni en-têtes arbitraires relayés ---
test("en-têtes arbitraires et Authorization non relayés", async (t) => {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return { status: 200, body: null, headers: { get: () => null, getSetCookie: () => [] } };
  };
  t.after(() => { globalThis.fetch = REAL_FETCH; });
  const req = fakeReq({
    headers: {
      authorization: "Bearer SECRET",   // ne doit PAS être relayé
      "x-custom-evil": "1",             // ne doit PAS être relayé
      cookie: "wp_woocommerce_session_=<mask>",  // relayé
      "x-ibuture-market": "DE",         // relayé
    },
  });
  const res = fakeRes();
  await handler(req, res);
  assert.equal(seen.init.headers.authorization, undefined);
  assert.equal(seen.init.headers["x-custom-evil"], undefined);
  assert.equal(seen.init.headers.cookie, "wp_woocommerce_session_=<mask>");
  assert.equal(seen.init.headers["x-ibuture-market"], "DE");
});
