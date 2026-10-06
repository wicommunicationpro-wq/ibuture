(() => {
  "use strict";

  /*
   * iButure static localization layer
   *
   * Behaviour reproduced from the original Shopify/LangShop setup:
   * - Country detection by IP
   * - Country -> recommended language
   * - Manual language preference is remembered
   * - Static mirror routes are used instead of Shopify /localization
   *
   * IMPORTANT:
   * This file must remain independent from cart/checkout logic.
   */

  const STORAGE_KEY = "ibuture-locale";
  const DETECTION_KEY = "ibuture-locale-detected";

  const LANGUAGE_COUNTRIES = {
    en: [
      "as","ai","ag","aw","au","bs","bh","bd","bb","bz","bm","bw","br","io",
      "bn","kh","ca","ky","cx","cc","ck","cy","dm","eg","et","fk","fj","gm",
      "gh","gi","gr","gl","gd","gu","gg","gy","hk","in","id","ie","im","il",
      "jm","je","jo","ke","ki","kr","kw","la","lb","ls","le","my","mv","mt",
      "mh","fm","ms","na","nr","np","an","nz","ng","nu","nf","mp","om","pk",
      "pw","pg","ph","pn","qa","rw","sh","kn","lc","vc","ws","sc","sl","sg",
      "sb","so","za","gs","lk","sd","sr","sz","sy","tz","th","tl","tk","to",
      "tt","tc","tv","ug","ua","ae","gb","us","um","vn","vg","vi","zm","zw",
      "bq","ss","sx","cw","de","fr","es","it","pl","pt","at","jp","se","ch"
    ],

    de: ["be","dk","is","li","lu"],

    fr: [
      "bj","bf","bi","cm","cf","td","km","cg","cd","ci","dj","gf","pf","tf",
      "ga","gp","gn","ht","mg","ml","mq","mr","yt","mc","ma","nc","ne","re",
      "bl","mf","pm","sn","tg","tn","vu","wf"
    ],

    it: ["va","sm"],
    pl: ["lt"],

    es: [
      "ar","bo","cl","co","cr","cu","do","ec","sv","gq","gt","hn","mx","ni",
      "pa","py","pe","pr","uy","ve"
    ]
  };

  /*
   * Only these language codes exist as root static routes.
   * Regional folders are handled separately when the current market is known.
   */
  const ROOT_LANGUAGES = new Set(["en", "de", "fr", "it", "pl", "es"]);

  /*
   * Existing regional folders discovered in the mirror.
   * We intentionally do not invent unsupported combinations.
   */
  const REGIONAL_ROUTES = new Set([
    "de-at","de-de","de-es","de-fr","de-it","de-lu","de-nl","de-pl",
    "en-at","en-de","en-es","en-fr","en-it","en-lu","en-nl","en-pl",
    "es-at","es-de","es-es","es-fr","es-it","es-lu","es-nl",
    "fr-at","fr-de","fr-es","fr-fr","fr-it","fr-lu","fr-nl",
    "it-at","it-de","it-es","it-fr","it-it","it-lu","it-nl",
    "pl-at","pl-de","pl-es","pl-fr","pl-lu","pl-nl","pl-pl"
  ]);

  function normalizeLanguage(value) {
    if (!value) return null;

    const language = String(value)
      .toLowerCase()
      .split("-")[0]
      .split("_")[0];

    return ROOT_LANGUAGES.has(language) ? language : null;
  }

  function currentPathParts() {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, "");

    if (!path) {
      return {
        language: "en",
        country: null,
        regional: false
      };
    }

    const first = path.split("/")[0].toLowerCase();

    if (ROOT_LANGUAGES.has(first)) {
      return {
        language: first,
        country: null,
        regional: false
      };
    }

    if (REGIONAL_ROUTES.has(first)) {
      const [language, country] = first.split("-");

      return {
        language,
        country: country.toUpperCase(),
        regional: true
      };
    }

    return {
      language: null,
      country: null,
      regional: false
    };
  }

  function getStoredLanguage() {
    try {
      return normalizeLanguage(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  function saveLanguage(language) {
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Storage may be disabled; navigation still works.
    }
  }

  function getStoredCountry() {
    try {
      const value = localStorage.getItem("ibuture-country");

      if (!value) {
        return null;
      }

      const country = value.trim().toUpperCase();

      return /^[A-Z]{2}$/.test(country) ? country : null;
    } catch {
      return null;
    }
  }

  function saveCountry(country) {
    try {
      if (country) {
        localStorage.setItem(
          "ibuture-country",
          country.toUpperCase()
        );
      }
    } catch {
      // Ignore storage errors.
    }
  }

  function languageFromCountry(country) {
    const code = String(country || "").toLowerCase();

    for (const [language, countries] of Object.entries(LANGUAGE_COUNTRIES)) {
      if (countries.includes(code)) {
        return language;
      }
    }

    return null;
  }

  async function detectCountry() {
    const endpoints = [
      {
        url: "https://get.geojs.io/v1/ip/country.json",
        parse: data => data?.country
      },
      {
        url: "https://ipapi.co/country/",
        parse: data => String(data || "").trim()
      },
      {
        url: "https://ipinfo.io/json",
        parse: data => data?.country
      },
      {
        url: "https://extreme-ip-lookup.com/json/",
        parse: data => data?.countryCode
      }
    ];

    for (const endpoint of endpoints) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);

      try {
        const response = await fetch(endpoint.url, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal
        });

        if (!response.ok) {
          continue;
        }

        const contentType = response.headers.get("content-type") || "";
        const data = contentType.includes("json")
          ? await response.json()
          : await response.text();

        const country = String(endpoint.parse(data) || "")
          .trim()
          .toLowerCase();

        if (/^[a-z]{2}$/.test(country)) {
          return country;
        }
      } catch {
        // Try the next provider.
      } finally {
        clearTimeout(timer);
      }
    }

    return null;
  }

  function buildTargetPath(language, country = null) {
    const current = currentPathParts();

    /*
     * Preserve the current page whenever a matching regional route exists.
     * Otherwise use the root language route.
     */
    let localePrefix = "";

    if (country) {
      const regional = `${language}-${country.toLowerCase()}`;

      if (REGIONAL_ROUTES.has(regional)) {
        localePrefix = `/${regional}`;
      }
    }

    /*
     * English is the root locale: "/" rather than "/en/".
     */
    if (!localePrefix && language !== "en") {
      localePrefix = `/${language}`;
    }

    const currentSegments = window.location.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean);

    /*
     * English uses the site root, so "/" has no locale segment to remove.
     * Other root languages and all regional routes have a locale prefix.
     */
    if (current.language && (current.language !== "en" || current.regional)) {
      currentSegments.shift();
    }

    const suffix = currentSegments.join("/");

    if (!localePrefix) {
      return suffix ? `/${suffix}` : "/";
    }

    return suffix
      ? `${localePrefix}/${suffix}`
      : `${localePrefix}/`;
  }

  function buildTargetHomePath(language, country = null) {
    let localePrefix = "";

    if (country) {
      const regional = `${language}-${country.toLowerCase()}`;

      if (REGIONAL_ROUTES.has(regional)) {
        localePrefix = `/${regional}`;
      }
    }

    if (!localePrefix && language !== "en") {
      localePrefix = `/${language}`;
    }

    return localePrefix ? `${localePrefix}/` : "/";
  }

  function findAlternateTarget(language, country = null) {
    const locales = country
      ? [`${language}-${country}`, language]
      : [language];
    const alternateLinks = document.querySelectorAll(
      'link[rel~="alternate"][hreflang][href]'
    );

    for (const locale of locales) {
      const link = Array.from(alternateLinks).find(alternate =>
        alternate.hreflang.toLowerCase() === locale.toLowerCase()
      );

      if (!link) {
        continue;
      }

      try {
        const destination = new URL(link.href, window.location.href);
        const hostname = destination.hostname.toLowerCase();
        const currentHostname = window.location.hostname.toLowerCase();

        if (
          hostname !== currentHostname &&
          hostname !== "ibuture.com" &&
          hostname !== "www.ibuture.com"
        ) {
          continue;
        }

        return destination;
      } catch {
        continue;
      }
    }

    return null;
  }

  function navigate(language, country = null, useAlternate = false) {
    const alternate = useAlternate
      ? findAlternateTarget(language, country)
      : null;
    const target = alternate
      ? alternate.pathname
      : useAlternate
        ? buildTargetHomePath(language, country)
        : buildTargetPath(language, country);
    const search = alternate?.search || window.location.search;
    const hash = alternate?.hash || window.location.hash;
    const destination = target + search + hash;

    if (
      destination ===
      window.location.pathname + window.location.search + window.location.hash
    ) {
      return;
    }

    window.location.assign(destination);
  }

  function installManualLanguageSelection() {
    document.addEventListener("click", event => {
      const button = event.target.closest?.(
        '[name="locale_code"], button[value][name="locale_code"]'
      );

      if (!button) {
        return;
      }

      const language = normalizeLanguage(button.value);

      if (!language) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      const current = currentPathParts();

      saveLanguage(language);

      /*
       * Preserve the current regional market when changing language.
       * Example: /de-de/ -> French = /fr-de/
       */
      navigate(
        language,
        current.regional ? current.country : null,
        true
      );
    }, true);
  }

  function installManualCountrySelection() {
    document.addEventListener("click", event => {
      const button = event.target.closest?.(
        '[name="country_code"], button[value][name="country_code"]'
      );

      if (!button) {
        return;
      }

      const country = String(button.value || "")
        .trim()
        .toUpperCase();

      if (!/^[A-Z]{2}$/.test(country)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      const current = currentPathParts();

      saveCountry(country);

      /*
       * Preserve the current language when changing country.
       * Example: /de-de/ -> France = /de-fr/
       */
      navigate(
        current.language || "en",
        country
      );
    }, true);
  }

  async function init() {
    const current = currentPathParts();

    const storedLanguage = getStoredLanguage();
    const storedCountry = getStoredCountry();

    /*
     * Always install both manual selectors.
     */
    installManualLanguageSelection();
    installManualCountrySelection();

    /*
     * An explicit manual language preference wins.
     */
    if (
      storedLanguage &&
      storedLanguage !== current.language
    ) {
      navigate(
        storedLanguage,
        current.regional ? current.country : storedCountry
      );
      return;
    }

    /*
     * An explicit regional URL is respected.
     * Do not let IP detection overwrite a URL chosen/shared by the user.
     */
    if (current.regional) {
      return;
    }

    /*
     * Root / or a non-localized route:
     * detect the visitor's country only when no manual preference exists.
     */
    if (!storedLanguage && !storedCountry) {
      const detectedCountry = await detectCountry();
      const recommendedLanguage =
        languageFromCountry(detectedCountry);

      try {
        sessionStorage.setItem(
          DETECTION_KEY,
          detectedCountry || "unknown"
        );
      } catch {
        // Ignore storage errors.
      }

      if (recommendedLanguage) {
        navigate(
          recommendedLanguage,
          detectedCountry
        );
        return;
      }
    }

    /*
     * If a country preference exists but the current page is not regional,
     * keep the selected language and country together.
     */
    if (
      storedCountry &&
      current.language &&
      !current.regional
    ) {
      navigate(
        current.language,
        storedCountry
      );
    }
  }

  window.iButureLocalization = {
    detectCountry,
    languageFromCountry,
    navigate,
    getStoredLanguage,
    getStoredCountry,
    saveLanguage,
    saveCountry
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
