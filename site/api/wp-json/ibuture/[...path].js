// Proxy first-party IBUTURE. AUCUN log de cookies/valeurs/secrets.
const UPSTREAM = "https://darkred-partridge-609254.hostingersite.com/wp-json/ibuture"; // SANS /v1

const ALLOWED_METHODS = new Set(["GET", "POST", "OPTIONS"]);

// Routes IBUTURE réelles (confrontées au code front). Rien d'autre -> pas de proxy ouvert.
const ALLOWED_ROUTES = new Set([
  "v1/products",
  "v1/cart", "v1/cart/add", "v1/cart/update", "v1/cart/remove",
  "v1/checkout/nonce", "v1/checkout",
  "v1/checkout/customer", "v1/checkout/shipping",
  "v1/checkout/payment-method", "v1/checkout/payment-methods",
  "v1/checkout/apply-coupon", "v1/checkout/remove-coupon", "v1/checkout/order",
]);

const ALLOWED_REQ_HEADERS = ["content-type", "x-ibuture-market", "x-wp-nonce", "x-idempotency-key", "cookie"];
const ALLOWED_RESP_HEADERS = ["content-type", "cache-control", "pragma", "expires"];

// --- Helpers purs (testables hors ligne) ---

// (Normalisation) Un seul préfixe v1 ; rejette vide, . .. \0 et encodages/séparateurs dangereux.
export function normalizeRest(queryPath) {
  const segs = Array.isArray(queryPath) ? queryPath : [queryPath].filter(Boolean);
  let rest = segs.join("/").replace(/^\/+|\/+$/g, "");
  if (!rest) return "";                                             // chemin vide
  if (rest.split("/").some((s) => s === ".." || s === "." || s.includes("\0"))) return "";
  if (/%2e|%2f|%5c|%00|\\/i.test(rest)) return "";                  // encodages/backslash dangereux
  if (rest !== "v1" && !rest.startsWith("v1/")) rest = "v1/" + rest; // garantit v1 unique
  return rest;
}

// (Routes) Liste blanche stricte.
export function isValidRest(rest) {
  if (!rest || rest.split("/")[0] !== "v1") return false;
  if (rest.split("/").some((s) => s === ".." || s === "." || s.includes("\0"))) return false;
  return ALLOWED_ROUTES.has(rest);
}

// (URL amont) UPSTREAM sans /v1 + rest commençant par v1. Query conservée.
export function buildUpstreamUrl(rest, url) {
  const q = (url || "").includes("?") ? url.slice(url.indexOf("?")) : "";
  return `${UPSTREAM}/${rest}${q}`;
}

// (Cookies) Proxy first-party : on retire SYSTEMATIQUEMENT l'attribut Domain.
// Le cookie devient ainsi "host-only" sur ibuture.com (le plus sûr pour la 1re version).
// On préserve Path, Secure, HttpOnly, SameSite, Expires, Max-Age (et tout autre attribut).
export function stripIncompatibleDomain(setCookie) {
  return setCookie
    .split(";")
    .map((p) => p.trim())
    .filter((part) => !/^domain\s*=/i.test(part))
    .join("; ");
}

// (Redirections) SIMPLIFIÉ : uniquement les chemins relatifs first-party.
// Refus de TOUTE URL absolue (y compris ibuture.com), protocole inattendu, creds, traversal, //.
export function resolveRedirect(location) {
  if (typeof location !== "string") return { allow: false };
  const loc = location.trim();
  if (loc === "") return { allow: false };
  if (/[\u0000-\u001f\u007f]/.test(loc)) return { allow: false };   // caractères de contrôle
  if (loc.includes("\\\\")) return { allow: false };                // backslash
  if (!loc.startsWith("/") || loc.startsWith("//")) return { allow: false }; // relatif requis, pas protocol-relative
  const segs = loc.replace(/^\/+/, "").split("/");
  if (segs.some((s) => s === "." || s === "..")) return { allow: false };     // pas de traversal
  return { allow: true, value: loc };
}

export default async function handler(req, res) {
  try {
    const method = (req.method || "GET").toUpperCase();

    // (1) Méthode
    if (!ALLOWED_METHODS.has(method)) {
      res.statusCode = 405; res.setHeader("Allow", [...ALLOWED_METHODS].join(", "));
      return res.end();
    }

    // (2) Chemin : normalisation + liste blanche
    const raw = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
    const rest = normalizeRest(raw);
    if (!isValidRest(rest)) { res.statusCode = 404; return res.end("Not Found"); }

    // (3) Préflight CORS : réponse directe, amont NON joint
    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers",
        "Content-Type, X-Requested-With, X-WP-Nonce, X-Idempotency-Key, X-IBUTURE-Market");
      res.setHeader("Access-Control-Max-Age", "86400");
      return res.end();
    }

    // (4) URL amont + query conservée
    const requestUrl = new URL(req.url || "/", "https://vercel.internal");
    requestUrl.searchParams.delete("path");
    const upstreamUrl = buildUpstreamUrl(rest, requestUrl.pathname + requestUrl.search);

    // (5) En-têtes requête (liste blanche) — relaie session, sans auth WP
    const forwardHeaders = {};
    for (const h of ALLOWED_REQ_HEADERS) {
      if (req.headers[h] !== undefined) forwardHeaders[h] = req.headers[h];
    }

    // (6) Corps POST : lecture manuelle en Buffer (runtime Node Vercel)
    let body;
    if (method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }

    // (7) Appel amont, redirect manuel
    const upstream = await fetch(upstreamUrl, {
      method, headers: forwardHeaders,
      body: method === "POST" ? body : undefined, redirect: "manual",
    });

    // (8) En-têtes réponse relayés (liste blanche)
    for (const h of ALLOWED_RESP_HEADERS) {
      const v = upstream.headers.get(h);
      if (v !== null) res.setHeader(h, v);
    }

    // (9) Anti-cache strict (panier/checkout = données de session)
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Vary", "Cookie");

    // (10) Redirections 3xx : uniquement relatif first-party, jamais d'externe
    if (upstream.status >= 300 && upstream.status < 400) {
      const r = resolveRedirect(upstream.headers.get("location"));
      res.statusCode = upstream.status;
      if (r.allow) res.setHeader("Location", r.value);
      return res.end();
    }

    // (11) Set-Cookie multiples, Domain retiré (host-only ibuture.com)
    const setCookies = upstream.headers.getSetCookie?.() || upstream.headers.raw?.()["set-cookie"] || [];
    if (setCookies.length) {
      res.setHeader("Set-Cookie", setCookies.map((c) => stripIncompatibleDomain(c)));
    }

    // (12) Statut + corps (stream). Relaie 2xx/4xx/5xx avec leur corps JSON.
    res.statusCode = upstream.status;
    if (upstream.body) {
      const reader = upstream.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) res.write(Buffer.from(value)); }
    }
    res.end();
  } catch (err) {
    // Journalisation SANS cookie/valeur/secret.
    console.error("[IBUTURE proxy] upstream error");
    res.statusCode = 502; res.setHeader("Cache-Control", "no-store"); res.end("Bad Gateway");
  }
}
