(function () {
  const API = "https://darkred-partridge-609254.hostingersite.com/wp-json/ibuture/v1";

  function getFormId(form) {
    return form?.getAttribute?.("id") || "";
  }
  const forms = Array.from(document.querySelectorAll('form[is="product-form"]'));
  if (!forms.length) return;

  function productSlug(form) {
    const picker = document.querySelector(`variant-picker[form-id="${CSS.escape(getFormId(form))}"]`);
    if (picker?.getAttribute("handle")) return picker.getAttribute("handle");
    const match = window.location.pathname.match(/\/products\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function syncForm(form, product) {
    const productIdInput = form.querySelector('input[name="product-id"]');
    const variationIdInput = form.querySelector('input[name="id"]');
    if (!productIdInput || !product?.id) return;

    productIdInput.value = String(product.id);
    if (!variationIdInput) return;

    const shopifyId = String(variationIdInput.value || "");
    const wooVariation = (product.variations || []).find((variation) =>
      String(variation.shopify_variant_id || "") === shopifyId
    );

    if (wooVariation) {
      variationIdInput.value = String(wooVariation.id);
      return;
    }

    if (!product.variations?.length) variationIdInput.value = "0";
  }

  async function loadProduct(slug) {
    if (!slug) return null;
    const response = await fetch(`${API}/products?slug=${encodeURIComponent(slug)}&per_page=1&_=${Date.now()}`, {
      credentials: "include",
      cache: "no-store",
      headers: window.IBUTURE_MARKET_HEADERS()
    });
    if (!response.ok) throw new Error(`Product mapping failed: ${response.status}`);
    const payload = await response.json();
    return payload.data?.[0] || null;
  }

  function findShopifyVariant(form, wooVariation) {
    if (!wooVariation?.shopify_variant_id) return null;

    const picker = document.querySelector(`variant-picker[form-id="${CSS.escape(getFormId(form))}"]`);
    const placements = Array.isArray(window.appBlockPlacements) ? window.appBlockPlacements : [];
    const variants = placements.flatMap((item) =>
      Array.isArray(item.productVariants) ? item.productVariants : []
    );

    const shopifyId = String(wooVariation.shopify_variant_id);

    return variants.find((variant) =>
      String(variant?.id || "") === shopifyId
    ) || null;
  }

  function findMainProductForm(form) {
    const picker = document.querySelector(`variant-picker[form-id="${CSS.escape(getFormId(form))}"]`);
    if (!picker) return false;

    const productGallery = document.querySelector(`product-gallery[form="${CSS.escape(getFormId(form))}"]`);
    return !!productGallery;
  }

  function formatPrice(value) {
    if (value === null || value === undefined || value === "") return "";
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);

    const current = document.querySelector("#price-show");
    const currency =
      current?.querySelector?.("[data-currency]")?.textContent?.trim() ||
      current?.textContent?.match(/[A-Z]{3}/)?.[0] ||
      "EUR";

    try {
      return new Intl.NumberFormat(document.documentElement.lang || "fr-FR", {
        style: "currency",
        currency,
        minimumFractionDigits: 2
      }).format(number);
    } catch {
      return `${number.toFixed(2)} ${currency}`;
    }
  }

  function updatePrice(variant) {
    if (!variant) return;

    const price = variant.sale_price || variant.price || "";
    const regularPrice = variant.regular_price || variant.price || "";
    if (!price) return;

    const priceShow = document.querySelector("#price-show");
    if (!priceShow) return;

    const priceText = formatPrice(price);
    const regularText = formatPrice(regularPrice);

    const salePrice = priceShow.querySelector("sale-price");
    const compareAtPrice = priceShow.querySelector("compare-at-price");

    if (salePrice) {
      const srOnly = salePrice.querySelector(".sr-only");
      salePrice.textContent = "";

      if (srOnly) {
        salePrice.appendChild(srOnly);
      } else {
        const label = document.createElement("span");
        label.className = "sr-only";
        label.textContent = "Prix de vente";
        salePrice.appendChild(label);
      }

      salePrice.appendChild(document.createTextNode(priceText));
    }

    if (compareAtPrice) {
      const srOnly = compareAtPrice.querySelector(".sr-only");
      compareAtPrice.textContent = "";

      if (srOnly) {
        compareAtPrice.appendChild(srOnly);
      } else {
        const label = document.createElement("span");
        label.className = "sr-only";
        label.textContent = "Prix régulier";
        compareAtPrice.appendChild(label);
      }

      if (
        regularPrice &&
        String(regularPrice) !== String(price)
      ) {
        compareAtPrice.style.display = "";
        compareAtPrice.appendChild(
          document.createTextNode(regularText)
        );
      } else {
        compareAtPrice.style.display = "none";
      }
    }
  }

  function enhanceVariantEvent(event) {
    const form = event.target;
    const variant = event.detail?.variant;

    if (!form || !variant || !forms.includes(form)) return;

    const wooVariationId = String(
      variant.woo_variation_id ||
      variant.id ||
      ""
    );

    const product = form.__wooProduct;
    const wooVariation = product?.variations?.find((variation) =>
      String(variation.id) === wooVariationId
    );

    if (!wooVariation) return;

    const shopifyVariant = findShopifyVariant(form, wooVariation);

    if (shopifyVariant?.featured_media) {
      variant.featured_media = {
        id: shopifyVariant.featured_media.id,
        position: shopifyVariant.featured_media.position
      };
    }

    if (findMainProductForm(form)) {
      updatePrice(variant);
    }
  }

  document.addEventListener("variant:change", enhanceVariantEvent, true);

  forms.forEach((form) => {
    const slug = productSlug(form);
    const variationIdInput = form.querySelector('input[name="id"]');

    form.__wooMappingReady = false;

    if (variationIdInput) {
      variationIdInput.addEventListener("change", () => {
        if (form.__wooProduct) syncForm(form, form.__wooProduct);
      });
    }

    form.__wooMappingPromise = loadProduct(slug).then((product) => {
      if (!product) return;
      form.__wooProduct = product;
      syncForm(form, product);
      form.__wooMappingReady = true;
    }).catch((error) => {
      console.error("[IBUTURE] Product mapping:", error);
      throw error;
    });

    form.addEventListener("submit", (event) => {
      if (form.__wooMappingReady) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      form.__wooMappingPromise
        .then(() => form.requestSubmit(event.submitter))
        .catch(() => {});
    }, true);
  });
})();
