(function () {
  "use strict";

  const API = "https://darkred-partridge-609254.hostingersite.com/wp-json/ibuture/v1";
  const labels = {
    fr: {
      empty: "Panier vide",
      continueShopping: "Continuer mes achats",
      title: "Votre panier",
      subtotal: "Sous-total",
      total: "Total",
      remove: "Supprimer",
      loading: "Chargement du panier...",
      error: "Impossible de charger le panier.",
      decrease: "Réduire la quantité",
      increase: "Augmenter la quantité"
    },
    de: {
      empty: "Ihr Warenkorb ist leer",
      continueShopping: "Weiter einkaufen",
      title: "Ihr Warenkorb",
      subtotal: "Zwischensumme",
      total: "Gesamt",
      remove: "Entfernen",
      loading: "Warenkorb wird geladen...",
      error: "Der Warenkorb konnte nicht geladen werden.",
      decrease: "Menge verringern",
      increase: "Menge erhöhen"
    },
    it: {
      empty: "Il tuo carrello è vuoto",
      continueShopping: "Continua a fare acquisti",
      title: "Il tuo carrello",
      subtotal: "Sottototale",
      total: "Totale",
      remove: "Rimuovi",
      loading: "Caricamento del carrello...",
      error: "Impossibile caricare il carrello.",
      decrease: "Riduci la quantità",
      increase: "Aumenta la quantità"
    },
    es: {
      empty: "Tu carrito está vacío",
      continueShopping: "Continuar comprando",
      title: "Tu carrito",
      subtotal: "Subtotal",
      total: "Total",
      remove: "Eliminar",
      loading: "Cargando el carrito...",
      error: "No se pudo cargar el carrito.",
      decrease: "Reducir cantidad",
      increase: "Aumentar cantidad"
    },
    pl: {
      empty: "Twój koszyk jest pusty",
      continueShopping: "Kontynuuj zakupy",
      title: "Twój koszyk",
      subtotal: "Suma częściowa",
      total: "Razem",
      remove: "Usuń",
      loading: "Ładowanie koszyka...",
      error: "Nie można załadować koszyka.",
      decrease: "Zmniejsz ilość",
      increase: "Zwiększ ilość"
    },
    en: {
      empty: "Your cart is empty",
      continueShopping: "Continue shopping",
      title: "Your cart",
      subtotal: "Subtotal",
      total: "Total",
      remove: "Remove",
      loading: "Loading cart...",
      error: "Unable to load the cart.",
      decrease: "Decrease quantity",
      increase: "Increase quantity"
    }
  };
  const collectionRoutes = {
    fr: "/fr/collections/all/",
    de: "/de/collections/all/",
    it: "/it/collections/all/",
    es: "/es/collections/all/",
    pl: "/pl/collections/all/",
    en: "/collections/all/"
  };
  const productsPerPage = 50;
  let productIndexPromise;
  const localizedProductCache = new Map();

  function normalizeLocale(value) {
    const locale = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
    return Object.prototype.hasOwnProperty.call(labels, locale) ? locale : "";
  }

  const pathLocale = window.location.pathname.split("/").filter(Boolean)[0];
  const locale = normalizeLocale(window.Shopify && window.Shopify.locale)
    || normalizeLocale(document.documentElement.lang)
    || normalizeLocale(pathLocale)
    || "en";
  const text = labels[locale];
  const page = document.querySelector(".ibuture-cart-page");

  if (!page) return;

  const loading = page.querySelector("#ibuture-cart-loading");
  const empty = page.querySelector("#ibuture-cart-empty");
  const content = page.querySelector("#ibuture-cart-content");
  const itemsContainer = page.querySelector("#ibuture-cart-items");
  const subtotal = page.querySelector("#ibuture-cart-subtotal");
  const total = page.querySelector("#ibuture-cart-total");

  if (!loading || !empty || !content || !itemsContainer || !subtotal || !total) {
    console.error("[IBUTURE] Cart page containers are incomplete.");
    return;
  }

  const title = page.querySelector("h1");
  const emptyTitle = empty.querySelector("p");
  const continueLink = empty.querySelector("a");
  const continueLabel = continueLink && continueLink.querySelector(".button__content");

  if (title) title.textContent = text.title;
  if (emptyTitle) emptyTitle.textContent = text.empty;
  if (continueLink) continueLink.href = collectionRoutes[locale];
  if (continueLabel) continueLabel.textContent = text.continueShopping;
  loading.textContent = text.loading;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function variationText(variation, localizedTitle) {
    if (localizedTitle) {
      return `<div class="text-sm">${escapeHtml(localizedTitle)}</div>`;
    }
    if (!variation || typeof variation !== "object") return "";
    const values = variation.localized
      ? [variation.localized]
      : Object.values(variation);
    return values
      .filter((value) => value !== null && value !== undefined && String(value).trim())
      .map((value) => `<div class="text-sm">${escapeHtml(value)}</div>`)
      .join("");
  }

  function renderItem(item, localizedItem) {
    const key = escapeHtml(item.key);
    const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
    const name = localizedItem.name || item.name || "";
    const image = item.image
      ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" width="112" height="112">`
      : "";

    return `
      <div class="ibuture-cart-item" data-cart-key="${key}">
        <div>${image}</div>
        <div class="prose">
          <p class="h5" style="margin:0;">${escapeHtml(name)}</p>
          ${item.sku ? `<div class="text-sm">SKU: ${escapeHtml(item.sku)}</div>` : ""}
          ${variationText(item.variation, localizedItem.variation)}
          <div style="margin-top:.75rem;">
            <div class="ibuture-cart-quantity">
              <button type="button" data-quantity-step="-1" aria-label="${text.decrease}">−</button>
              <input type="number" value="${quantity}" min="1" max="999" data-cart-key="${key}" aria-label="${text.title}">
              <button type="button" data-quantity-step="1" aria-label="${text.increase}">+</button>
            </div>
          </div>
          <button type="button" class="button button--sm button--outline ibuture-remove-item" data-cart-key="${key}">${text.remove}</button>
          <div class="text-sm">${quantity} × ${escapeHtml(item.price)}</div>
        </div>
        <div><strong>${escapeHtml(item.line_total)}</strong></div>
      </div>`;
  }

  async function fetchProductPage(pageNumber) {
    const response = await fetch(`${API}/products?page=${pageNumber}&per_page=${productsPerPage}`, {
      credentials: "include",
      cache: "no-store",
      headers: window.IBUTURE_MARKET_HEADERS()
    });
    const result = await response.json();

    if (!response.ok || !result.success || !Array.isArray(result.data)) {
      throw new Error("Unable to load the product index.");
    }

    return result;
  }

  function loadProductIndex() {
    if (!productIndexPromise) {
      productIndexPromise = (async () => {
        const firstPage = await fetchProductPage(1);
        const totalPages = Math.max(1, Number(firstPage.pagination?.total_pages) || 1);
        const remainingPages = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, index) => fetchProductPage(index + 2))
        );
        const products = [firstPage, ...remainingPages].flatMap((result) => result.data);

        return new Map(products.map((product) => [String(product.id), product]));
      })().catch((error) => {
        productIndexPromise = null;
        throw error;
      });
    }

    return productIndexPromise;
  }

  function findLocalizedProduct(value, expectedPath) {
    const nodes = [];
    const pending = Array.isArray(value) ? [...value] : [value];

    while (pending.length) {
      const node = pending.pop();
      if (!node || typeof node !== "object") continue;
      nodes.push(node);
      if (Array.isArray(node["@graph"])) pending.push(...node["@graph"]);
    }

    const matchesPath = (node) => {
      const productUrl = node.url || node["@id"];
      if (typeof productUrl !== "string") return false;
      try {
        return new URL(productUrl, window.location.origin).pathname.replace(/\/+$/, "") === expectedPath;
      } catch (error) {
        return false;
      }
    };
    const productGroup = nodes.find((node) => {
      const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
      return types.includes("ProductGroup") && matchesPath(node);
    });
    if (productGroup) return productGroup;

    return nodes.find((node) => {
      const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
      return types.includes("Product") && matchesPath(node);
    }) || null;
  }

  function loadLocalizedProduct(slug) {
    const cacheKey = `${locale}:${slug}`;
    if (!localizedProductCache.has(cacheKey)) {
      localizedProductCache.set(cacheKey, (async () => {
        const productPath = `/${locale}/products/${encodeURIComponent(slug)}/index.html`;
        const response = await fetch(productPath, {
          credentials: "same-origin",
          cache: "force-cache"
        });
        if (!response.ok) return null;

        const html = await response.text();
        const productDocument = new DOMParser().parseFromString(html, "text/html");
        const canonicalLink = productDocument.querySelector('link[rel="canonical"]');
        const canonical = canonicalLink?.getAttribute("href") || canonicalLink?.href;
        const productUrl = new URL(productPath, window.location.origin);
        const expectedPath = productUrl.pathname
          .replace(/\/index\.html$/, "")
          .replace(/\/+$/, "");
        const canonicalPath = canonical
          ? new URL(canonical, productUrl).pathname.replace(/\/index\.html$/, "").replace(/\/+$/, "")
          : "";
        if (!canonical || canonicalPath !== expectedPath) {
          return null;
        }

        let productGroup = null;
        for (const script of productDocument.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            productGroup = findLocalizedProduct(JSON.parse(script.textContent), expectedPath);
          } catch (error) {
            continue;
          }
          if (productGroup) break;
        }
        if (!productGroup || typeof productGroup.name !== "string" || !productGroup.name.trim()) return null;

        const variants = new Map();
        const variantData = productDocument.getElementById("bm_product_variants");
        if (variantData) {
          try {
            const productVariants = JSON.parse(variantData.textContent);
            if (Array.isArray(productVariants)) {
              productVariants.forEach((variant) => {
                if (variant.id !== undefined && typeof variant.title === "string" && variant.title.trim()) {
                  variants.set(String(variant.id), variant.title);
                }
              });
            }
          } catch (error) {
            console.warn("[IBUTURE] Localized variant data is invalid:", error);
          }
        }

        return { name: productGroup.name.trim(), variants };
      })().catch((error) => {
        localizedProductCache.delete(cacheKey);
        throw error;
      }));
    }

    return localizedProductCache.get(cacheKey);
  }

  async function resolveLocalizedItems(items) {
    try {
      const productsById = await loadProductIndex();
      return await Promise.all(items.map(async (item) => {
        const product = productsById.get(String(item.product_id));
        if (!product || !product.slug) return {};

        try {
          const localizedProduct = await loadLocalizedProduct(product.slug);
          if (!localizedProduct) return {};

          let variation = "";
          if (item.variation_id) {
            const wooVariation = (product.variations || []).find((candidate) => (
              String(candidate.id) === String(item.variation_id)
            ));
            if (wooVariation?.shopify_variant_id) {
              variation = localizedProduct.variants.get(String(wooVariation.shopify_variant_id)) || "";
            }
          }

          return { name: localizedProduct.name, variation };
        } catch (error) {
          console.warn("[IBUTURE] Localized product lookup failed:", error);
          return {};
        }
      }));
    } catch (error) {
      console.warn("[IBUTURE] Product index lookup failed:", error);
      return items.map(() => ({}));
    }
  }

  async function postCartAction(path, parameters) {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...window.IBUTURE_MARKET_HEADERS()
      },
      body: new URLSearchParams(parameters)
    });

    if (!response.ok) throw new Error(`Cart request failed (${response.status}).`);
  }

  async function loadCart(showLoading) {
    if (showLoading) {
      loading.hidden = false;
      empty.hidden = true;
      content.hidden = true;
      loading.textContent = text.loading;
    }

    try {
      const response = await fetch(`${API}/cart?_=${Date.now()}`, {
        credentials: "include",
        cache: "no-store",
        headers: window.IBUTURE_MARKET_HEADERS()
      });
      const cart = await response.json();

      if (!response.ok || !cart.success || !Array.isArray(cart.items)) {
        throw new Error("Unexpected cart response.");
      }

      const itemCount = Number(cart.items_count);
      if (!Number.isFinite(itemCount) || itemCount < 0) {
        throw new Error("Cart item count is invalid.");
      }

      itemsContainer.dataset.itemsCount = String(itemCount);

      if (cart.items.length === 0) {
        if (itemCount > 0) throw new Error("Cart item list is inconsistent.");
        loading.hidden = true;
        content.hidden = true;
        empty.hidden = false;
        return;
      }

      const localizedItems = await resolveLocalizedItems(cart.items);
      loading.hidden = true;
      empty.hidden = true;
      content.hidden = false;
      itemsContainer.innerHTML = cart.items.map((item, index) => renderItem(item, localizedItems[index])).join("");
      subtotal.innerHTML = cart.subtotal || "";
      total.innerHTML = cart.total || "";
    } catch (error) {
      console.error("[IBUTURE] Cart page:", error);
      loading.hidden = false;
      loading.textContent = text.error;
    }
  }

  async function updateQuantity(input) {
    const key = input.dataset.cartKey;
    const quantity = Math.max(1, parseInt(input.value, 10) || 1);
    if (!key) return;

    input.disabled = true;
    try {
      await postCartAction("/cart/update", { key, quantity: String(quantity) });
      await loadCart(false);
    } catch (error) {
      console.error("[IBUTURE] Cart quantity:", error);
      input.disabled = false;
    }
  }

  itemsContainer.addEventListener("change", (event) => {
    if (event.target.matches("input[data-cart-key]")) updateQuantity(event.target);
  });

  itemsContainer.addEventListener("click", async (event) => {
    const removeButton = event.target.closest(".ibuture-remove-item");
    if (removeButton) {
      const key = removeButton.dataset.cartKey;
      if (!key) return;

      removeButton.disabled = true;
      try {
        await postCartAction("/cart/remove", { key });
        await loadCart(false);
      } catch (error) {
        console.error("[IBUTURE] Cart remove:", error);
        removeButton.disabled = false;
      }
      return;
    }

    const stepButton = event.target.closest("[data-quantity-step]");
    if (!stepButton) return;
    const row = stepButton.closest(".ibuture-cart-item");
    const input = row && row.querySelector("input[data-cart-key]");
    if (!input) return;

    input.value = String(Math.max(1, (parseInt(input.value, 10) || 1) + Number(stepButton.dataset.quantityStep)));
    await updateQuantity(input);
  });

  loadCart(true);
})();