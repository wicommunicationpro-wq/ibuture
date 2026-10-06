(function () {
  const API = "https://darkred-partridge-609254.hostingersite.com/wp-json/ibuture/v1";
  let pending = false;

  async function buyNow(form) {
    if (!form || pending) return;
    try {
      if (form.__wooMappingPromise && !form.__wooMappingReady) await form.__wooMappingPromise;
      const productId = parseInt(form.querySelector('input[name="product-id"]')?.value || "0", 10);
      const variationId = parseInt(form.querySelector('input[name="id"]')?.value || "0", 10);
      const quantity = Math.max(1, parseInt(form.querySelector('[name="quantity"]')?.value || "1", 10));

      const localizedVariant =
        variationId &&
        Array.isArray(window.appBlockPlacements?.productVariants)
          ? window.appBlockPlacements.productVariants.find(
              v => String(v.id) === String(variationId) ||
                   String(v.variant_id) === String(variationId)
            )
          : null;

      const localizedName =
        localizedVariant?.name ||
        form.closest("product-info")?.querySelector("h1")?.textContent?.trim() ||
        document.querySelector("h1")?.textContent?.trim() ||
        "";

      const localizedVariation = localizedVariant?.title || "";
      const localizedLocale = window.Shopify?.locale || "";

      if (!productId) throw new Error("Produit manquant.");
      pending = true;
      const response = await fetch(`${API}/cart/add`, {
        body: new URLSearchParams({
          product_id: String(productId),
          variation_id: String(variationId),
          quantity: String(quantity),
          localized_name: localizedName,
          localized_variation: localizedVariation,
          localized_locale: localizedLocale
        }),
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...window.IBUTURE_MARKET_HEADERS() }
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message || json.code || "Impossible d'ajouter le produit au panier.");
      (() => {
  const root = window.location.pathname.split("/").filter(Boolean)[0] || "fr";
  window.location.href = `/${root}/checkout/`;
})();
    } catch (error) {
      console.error("[IBUTURE] Buy now:", error);
      document.documentElement.dispatchEvent(new CustomEvent("cart:error", { bubbles: true, detail: { error: error.message } }));
    } finally { pending = false; }
  }

  window.addEventListener("click", (event) => {
    const shopButton = event.target.closest?.("shopify-accelerated-checkout, .shopify-payment-button");
    if (!shopButton) return;
    const form = shopButton.closest?.('form[is="product-form"]');
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    buyNow(form);
  }, true);
})();
