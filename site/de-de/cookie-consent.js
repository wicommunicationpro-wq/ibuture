(function () {
  "use strict";

  var storageKey = "ibuture_de_de_analytics_consent";
  var consentLifetimeMs = 180 * 24 * 60 * 60 * 1000;
  var bannerId = "ibuture-cookie-consent";
  var settingsButtonId = "ibuture-cookie-settings";
  var contentsquareScriptUrl =
    "https://t.contentsquare.net/uxa/6accf1c593503.js";
  var contentsquareLoadedKey =
    "__ibutureContentsquare6accf1c593503Loaded";

  function logStorageError(operation, error) {
    console.error("Cookie consent could not " + operation + ".", error);
  }

  function removeStoredConsent() {
    try {
      window.localStorage.removeItem(storageKey);
    } catch (error) {
      logStorageError("clear the stored choice", error);
    }
  }

  function readConsent() {
    var storedValue;
    try {
      storedValue = window.localStorage.getItem(storageKey);
    } catch (error) {
      logStorageError("read the stored choice", error);
      return null;
    }

    if (!storedValue) return null;

    var consent;
    try {
      consent = JSON.parse(storedValue);
    } catch (error) {
      logStorageError("parse the stored choice", error);
      removeStoredConsent();
      return null;
    }

    if (
      !consent ||
      typeof consent !== "object" ||
      (consent.choice !== "accepted" && consent.choice !== "rejected") ||
      typeof consent.expiresAt !== "number" ||
      consent.expiresAt <= Date.now()
    ) {
      removeStoredConsent();
      return null;
    }

    return consent.choice;
  }

  function saveConsent(choice) {
    var consent = {
      choice: choice,
      expiresAt: Date.now() + consentLifetimeMs,
    };

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(consent));
      return true;
    } catch (error) {
      logStorageError("save the choice", error);
      removeStoredConsent();
      return false;
    }
  }

  function loadContentsquare() {
    if (window[contentsquareLoadedKey]) return;

    var existingScripts = document.querySelectorAll("script[src]");
    for (var i = 0; i < existingScripts.length; i++) {
      if (existingScripts[i].src === contentsquareScriptUrl) {
        window[contentsquareLoadedKey] = true;
        return;
      }
    }

    window._uxa = window._uxa || [];
    var pagePath =
      window.location.pathname + window.location.hash.replace("#", "?__");

    if (typeof window.CS_CONF !== "undefined") {
      window._uxa.push(["trackPageview", pagePath]);
      window[contentsquareLoadedKey] = true;
      return;
    }

    window._uxa.push([
      "setPath",
      pagePath,
      { lifespan: "onNextPageviewOnly" },
    ]);

    var script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = contentsquareScriptUrl;
    window[contentsquareLoadedKey] = true;
    script.addEventListener("error", function () {
      window[contentsquareLoadedKey] = false;
      script.remove();
      console.error("Contentsquare could not be loaded.");
    });
    document.head.appendChild(script);
  }

  function createLink(label, href) {
    var link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    return link;
  }

  var banner = document.createElement("section");
  banner.id = bannerId;
  banner.className = "ibuture-cookie-consent";
  banner.setAttribute("aria-label", "Cookie-Einstellungen");
  banner.hidden = true;

  var heading = document.createElement("h2");
  heading.className = "ibuture-cookie-consent__heading";
  heading.textContent = "Cookie-Einstellungen";

  var message = document.createElement("p");
  message.className = "ibuture-cookie-consent__message";
  message.textContent =
    "Wir verwenden Contentsquare-Analyse nur mit Ihrer ausdrücklichen Zustimmung. Ihre Auswahl wird bis zu 6 Monate gespeichert. Wenn Sie Ihre Zustimmung auf dieser Seite widerrufen, kann ein bereits geladenes Skript bis zum Verlassen der Seite weiterlaufen; auf späteren Seiten wird es nicht erneut geladen.";

  var policyLinks = document.createElement("p");
  policyLinks.className = "ibuture-cookie-consent__links";
  policyLinks.append(
    createLink("Datenschutzerklärung", "/de-de/pages/datenschutzrichtlinie/"),
    document.createTextNode(" · "),
    createLink("Cookie-Richtlinie", "/de-de/pages/cookie-richtlinie/")
  );

  var actions = document.createElement("div");
  actions.className = "ibuture-cookie-consent__actions";

  var acceptButton = document.createElement("button");
  acceptButton.className =
    "ibuture-cookie-consent__button ibuture-cookie-consent__button--accept";
  acceptButton.type = "button";
  acceptButton.textContent = "Alle akzeptieren";

  var rejectButton = document.createElement("button");
  rejectButton.className =
    "ibuture-cookie-consent__button ibuture-cookie-consent__button--reject";
  rejectButton.type = "button";
  rejectButton.textContent = "Ablehnen";

  var status = document.createElement("p");
  status.className = "ibuture-cookie-consent__status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  actions.append(acceptButton, rejectButton);
  banner.append(heading, message, policyLinks, actions, status);

  var settingsButton = document.createElement("button");
  settingsButton.id = settingsButtonId;
  settingsButton.className = "ibuture-cookie-settings";
  settingsButton.type = "button";
  settingsButton.textContent = "Cookie-Einstellungen";
  settingsButton.setAttribute("aria-controls", bannerId);
  settingsButton.setAttribute("aria-expanded", "false");

  document.body.append(banner, settingsButton);

  function openBanner(shouldFocus) {
    banner.hidden = false;
    settingsButton.hidden = true;
    settingsButton.setAttribute("aria-expanded", "true");
    status.textContent = "";
    if (shouldFocus) acceptButton.focus();
  }

  function closeBanner() {
    banner.hidden = true;
    settingsButton.hidden = false;
    settingsButton.setAttribute("aria-expanded", "false");
    settingsButton.focus();
  }

  function choose(choice) {
    if (!saveConsent(choice)) {
      status.textContent =
        "Ihre Auswahl konnte nicht gespeichert werden. Bitte aktivieren Sie den lokalen Speicher Ihres Browsers und versuchen Sie es erneut.";
      return;
    }

    if (choice === "accepted") loadContentsquare();
    closeBanner();
  }

  acceptButton.addEventListener("click", function () {
    choose("accepted");
  });

  rejectButton.addEventListener("click", function () {
    choose("rejected");
  });

  settingsButton.addEventListener("click", function () {
    openBanner(true);
  });

  var currentConsent = readConsent();
  if (currentConsent === "accepted") {
    loadContentsquare();
    settingsButton.hidden = false;
  } else {
    settingsButton.hidden = false;
    if (currentConsent === null) openBanner(false);
  }
})();
