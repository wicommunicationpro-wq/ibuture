import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("site/vercel.json réécrit /wp-json/ibuture, sans v1 codé en dur", () => {
  // Depuis site/api/wp-json/ibuture/__tests__/ -> 4 niveaux -> site/vercel.json
  const cfg = JSON.parse(readFileSync(new URL("../../../../vercel.json", import.meta.url), "utf8"));
  const rw = cfg.rewrites.find((r) => r.source === "/wp-json/ibuture/:path*");
  assert.ok(rw, "rewrite /wp-json/ibuture/:path* manquant");
  assert.equal(rw.destination, "/api/wp-json/ibuture/:path*");
  assert.doesNotMatch(rw.destination, /\/v1(\/|$)/);
});
