(function (window, document) {
  "use strict";

  var measurementId = "AW-18536733708";
  var initializedKey = "__ibutureGoogleAdsAW18536733708Initialized";
  var loadStateKey = "__ibutureGoogleAdsAW18536733708LoadState";

  // Prevent duplicate initialization if this file is included more than once.
  if (window[initializedKey]) return;
  window[initializedKey] = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };

  window.gtag("js", new Date());
  window.gtag("config", measurementId);

  function setLoadState(status) {
    window[loadStateKey].status = status;
  }

  function attachLoadHandlers(loader) {
    loader.addEventListener("load", function () {
      var state = window[loadStateKey];
      if (state.loader !== loader) return;
      if (state.status !== "loading" && state.status !== "unknown") return;
      setLoadState("loaded");
    });

    loader.addEventListener("error", function () {
      var state = window[loadStateKey];
      if (state.loader !== loader) return;
      if (state.status === "loaded" || state.status === "failed") return;

      if (state.attempts >= 2) {
        setLoadState("failed");
        return;
      }

      state.retryCount += 1;
      state.status = "failed";
      appendLoader();
    });
  }

  function appendLoader() {
    var state = window[loadStateKey];
    var loader = document.createElement("script");
    state.attempts += 1;
    state.loader = loader;
    state.status = "loading";
    loader.async = true;
    loader.src = "https://www.googletagmanager.com/gtag/js?id=" + measurementId;
    attachLoadHandlers(loader);
    document.head.appendChild(loader);
  }

  // Share attempt state so later inclusions cannot reset the retry limit.
  if (window[loadStateKey]) return;
  window[loadStateKey] = {
    status: "unknown",
    attempts: 0,
    retryCount: 0,
    loader: null,
  };

  // Reuse only a matching loader. An existing node starts as unknown until a
  // load/error event is observed; its presence alone is not success evidence.
  var loaders = document.querySelectorAll("script[src]");
  var existingLoader = null;
  for (var i = 0; i < loaders.length; i++) {
    var loaderUrl = new URL(loaders[i].src, document.baseURI);
    if (
      loaderUrl.origin === "https://www.googletagmanager.com" &&
      loaderUrl.pathname === "/gtag/js" &&
      loaderUrl.searchParams.get("id") === measurementId
    ) {
      existingLoader = loaders[i];
      break;
    }
  }

  if (existingLoader) {
    window[loadStateKey].attempts = 1;
    window[loadStateKey].loader = existingLoader;
    attachLoadHandlers(existingLoader);
  } else {
    appendLoader();
  }
})(window, document);
