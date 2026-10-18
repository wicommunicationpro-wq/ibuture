;(() => {
  if (window.location.hostname.toLowerCase() !== "lbuture.com") return;

  const segments = window.location.pathname
    .toLowerCase()
    .split("/")
    .filter(Boolean);
  const localePattern = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
  const routeSegments =
    segments.length > 1 && localePattern.test(segments[0])
      ? segments.slice(1)
      : segments;

  if (routeSegments[0] === "cart" || routeSegments[0] === "checkout") return;

  const stateKey = "__ibutureChatwootState";
  if (window[stateKey]) return;

  const BASE_URL = "https://app.chatwoot.com";
  const SDK_URL = `${BASE_URL}/packs/js/sdk.js`;
  const state = {
    status: "loading",
    script: null,
    ownsScript: false,
    pollId: null,
    timeoutId: null,
    loadHandler: null,
    errorHandler: null
  };
  window[stateKey] = state;

  const stopWaiting = () => {
    if (state.pollId !== null) {
      clearInterval(state.pollId);
      state.pollId = null;
    }
    if (state.timeoutId !== null) {
      clearTimeout(state.timeoutId);
      state.timeoutId = null;
    }
    if (state.script && state.loadHandler) {
      state.script.removeEventListener("load", state.loadHandler);
      state.loadHandler = null;
    }
    if (state.script && state.errorHandler) {
      state.script.removeEventListener("error", state.errorHandler);
      state.errorHandler = null;
    }
  };

  const fail = (message, allowRetry) => {
    state.status = "failed";
    stopWaiting();

    if (
      state.ownsScript &&
      state.script &&
      state.script.parentNode
    ) {
      state.script.parentNode.removeChild(state.script);
    }

    if (allowRetry && window[stateKey] === state) {
      delete window[stateKey];
    }
    console.error(message);
  };

  const initialize = () => {
    if (window[stateKey] !== state || state.status !== "loading") return true;

    const sdk = window.chatwootSDK;
    if (!sdk || typeof sdk.run !== "function") return false;

    state.status = "initializing";
    stopWaiting();

    try {
      sdk.run({
        websiteToken: "uaBnvpGKVa5iqCVBHNRxkSc1",
        baseUrl: BASE_URL
      });
      state.status = "started";
    } catch (error) {
      state.status = "failed";
      state.error = error;
      console.error("Failed to initialize the Chatwoot widget.", error);
    }

    return true;
  };

  if (initialize()) return;

  const existingScript = document.querySelector(`script[src="${SDK_URL}"]`);
  state.script = existingScript || document.createElement("script");
  state.ownsScript = !existingScript;
  state.loadHandler = () => initialize();
  state.errorHandler = () =>
    fail("Failed to load the Chatwoot SDK.", state.ownsScript);

  state.script.addEventListener("load", state.loadHandler);
  state.script.addEventListener("error", state.errorHandler);
  state.pollId = setInterval(initialize, 100);
  state.timeoutId = setTimeout(
    () => fail("Timed out waiting for the Chatwoot SDK.", false),
    15000
  );

  if (!existingScript) {
    state.script.src = SDK_URL;
    state.script.async = true;

    try {
      document.head.appendChild(state.script);
    } catch (error) {
      fail("Failed to add the Chatwoot SDK script to the document.", false);
      console.error(error);
    }
  }
})();
