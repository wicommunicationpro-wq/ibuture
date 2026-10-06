(function () {
  const MARKET_BY_PATH = {
    "fr": "US",
    "de": "US",
    "it": "US",
    "es": "US",
    "pl": "US",

    "fr-at": "AT",
    "de-at": "AT",
    "it-at": "AT",
    "es-at": "AT",
    "pl-at": "AT",

    "fr-de": "DE",
    "de-de": "DE",
    "it-de": "DE",
    "es-de": "DE",
    "pl-de": "DE",

    "fr-es": "ES",
    "de-es": "ES",
    "it-es": "ES",
    "es-es": "ES",
    "pl-es": "ES",

    "fr-fr": "FR",
    "de-fr": "FR",
    "it-fr": "FR",
    "es-fr": "FR",
    "pl-fr": "FR",

    "fr-it": "IT",
    "de-it": "IT",
    "it-it": "IT",
    "es-it": "IT",
    "pl-it": "IT",

    "fr-lu": "LU",
    "de-lu": "LU",
    "it-lu": "LU",
    "es-lu": "LU",
    "pl-lu": "LU",

    "fr-nl": "NL",
    "de-nl": "NL",
    "it-nl": "NL",
    "es-nl": "NL",
    "pl-nl": "NL",

    "fr-pl": "PL",
    "de-pl": "PL",
    "it-pl": "PL",
    "es-pl": "PL",
    "pl-pl": "PL"
  };

  const firstSegment = window.location.pathname
    .split("/")
    .filter(Boolean)[0] || "fr";

  const market = MARKET_BY_PATH[firstSegment] || "US";

  window.IBUTURE_MARKET = market;

  window.IBUTURE_MARKET_HEADERS = function () {
    return {
      "X-IBUTURE-Market": window.IBUTURE_MARKET
    };
  };
})();
