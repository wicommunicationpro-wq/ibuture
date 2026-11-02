(function () {
  "use strict";

  var scriptUrl = "https://t.contentsquare.net/uxa/6accf1c593503.js";
  var initializedKey = "__ibutureContentsquare6accf1c593503Initialized";
  var path = window.location.pathname + window.location.hash.replace("#", "?__");

  window._uxa = window._uxa || [];

  if (typeof window.CS_CONF !== "undefined") {
    window._uxa.push(["trackPageview", path]);
    return;
  }

  if (window[initializedKey]) return;
  window[initializedKey] = true;
  window._uxa.push([
    "setPath",
    path,
    { lifespan: "onNextPageviewOnly" },
  ]);

  var scripts = document.querySelectorAll("script[src]");
  for (var i = 0; i < scripts.length; i++) {
    var existingUrl = new URL(scripts[i].src, document.baseURI);
    if (
      existingUrl.origin === "https://t.contentsquare.net" &&
      existingUrl.pathname === "/uxa/6accf1c593503.js"
    ) {
      return;
    }
  }

  var script = document.createElement("script");
  script.type = "text/javascript";
  script.async = true;
  script.src = scriptUrl;
  script.addEventListener("error", function () {
    window[initializedKey] = false;
    script.remove();
    console.error("Contentsquare could not be loaded.");
  });
  document.head.appendChild(script);
})();
