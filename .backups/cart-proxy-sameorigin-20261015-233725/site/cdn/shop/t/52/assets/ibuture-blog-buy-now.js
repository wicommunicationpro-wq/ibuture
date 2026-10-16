(function () {
  "use strict";

  const API = "https://darkred-partridge-609254.hostingersite.com/wp-json/ibuture/v1";
  let pending = false;

  function getRootPath() {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const locales = ["fr", "de", "it", "es", "pl"];

    if (locales.includes(segments[0])) {
      return segments[0];
    }

    return "fr";
  }

  function getShopifyProductByVariant(variantId) {
    const products = Array.isArray(window.allProducts)
      ? window.allProducts
      : [];

    return products.find((product) =>
      Array.isArray(product?.variants) &&
      product.variants.some(
        (variant) => String(variant?.id || "") === String(variantId)
      )
    ) || null;
  }

  async function loadWooProduct(slug) {
    if (!slug) {
      throw new Error("Handle Shopify manquant.");
    }

    const response = await fetch(
      `${API}/products?slug=${encodeURIComponent(slug)}&per_page=1&_=${Date.now()}`,
      {
        credentials: "include",
        cache: "no-store",
        headers: window.IBUTURE_MARKET_HEADERS
          ? window.IBUTURE_MARKET_HEADERS()
          : {}
      }
    );

    if (!response.ok) {
      throw new Error(`Mapping produit impossible: HTTP ${response.status}`);
    }

    const payload = await response.json();
    const product = payload?.data?.[0];

    if (!product?.id) {
      throw new Error(`Produit Woo introuvable pour le handle "${slug}".`);
    }

    return product;
  }

  function findWooVariation(wooProduct, shopifyVariantId) {
    const variations = Array.isArray(wooProduct?.variations)
      ? wooProduct.variations
      : [];

    return variations.find(
      (variation) =>
        String(variation?.shopify_variant_id || "") ===
        String(shopifyVariantId)
    ) || null;
  }

  async function buyNow(button) {
    if (!button) return;

    const shopifyVariantId = String(
      button.getAttribute("data-variant-id") || ""
    );

    if (!shopifyVariantId) {
      throw new Error("Shopify Variant ID manquant.");
    }

    const shopifyProduct = getShopifyProductByVariant(shopifyVariantId);

    if (!shopifyProduct?.handle) {
      throw new Error(
        `Produit Shopify introuvable pour la variante ${shopifyVariantId}.`
      );
    }

    const wooProduct = await loadWooProduct(shopifyProduct.handle);

    const wooVariation = findWooVariation(
      wooProduct,
      shopifyVariantId
    );

    /*
     * Produit simple :
     * Woo n'a pas de variation, mais le backend utilise le
     * ibuture_shopify_variant_id du produit pour son mapping marché.
     */
    const wooVariationId = wooVariation?.id
      ? String(wooVariation.id)
      : "0";

    const shopifyVariant = Array.isArray(shopifyProduct.variants)
      ? shopifyProduct.variants.find(
          (variant) =>
            String(variant?.id || "") === String(shopifyVariantId)
        )
      : null;

    const localizedName =
      shopifyProduct.title ||
      button.closest?.(".product-card, .card, article")?.querySelector?.("h2, h3, h4")?.textContent?.trim() ||
      "";

    const localizedVariation =
      shopifyVariant?.title || "";

    const localizedLocale =
      window.Shopify?.locale ||
      document.documentElement.lang ||
      "";

    const response = await fetch(`${API}/cart/add`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(window.IBUTURE_MARKET_HEADERS
          ? window.IBUTURE_MARKET_HEADERS()
          : {})
      },
      body: new URLSearchParams({
        product_id: String(wooProduct.id),
        variation_id: wooVariationId,
        quantity: "1",
        localized_name: localizedName,
        localized_variation: localizedVariation,
        localized_locale: localizedLocale
      })
    });

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        json.message ||
        json.code ||
        `Impossible d'ajouter le produit au panier (${response.status}).`
      );
    }

    const root = getRootPath();

    window.location.href = `/${root}/checkout/`;
  }

  document.addEventListener(
    "click",
    async function (event) {
      const button = event.target.closest?.(
        ".buy-now-button.buy-now[data-variant-id]"
      );

      if (!button) return;

      /*
       * Les anciens articles ont encore leur propre handleBuyNow().
       * Capture + stopImmediatePropagation empêche l'ancien Shopify
       * /cart/add.js et /checkout d'être exécuté.
       */
      event.preventDefault();
      event.stopImmediatePropagation();

      if (pending) return;

      pending = true;
      button.setAttribute("aria-busy", "true");

      try {
        await buyNow(button);
      } catch (error) {
        console.error("[IBUTURE] Blog Buy Now:", error);

        document.documentElement.dispatchEvent(
          new CustomEvent("cart:error", {
            bubbles: true,
            detail: {
              error: error?.message || "Erreur lors de l'achat."
            }
          })
        );
      } finally {
        pending = false;
        button.removeAttribute("aria-busy");
      }
    },
    true
  );
})();
