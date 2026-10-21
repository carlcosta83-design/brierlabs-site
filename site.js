/* ==========================================================================
   Brier-Labs — comportement commun aux trois pages
   1. bascule de langue FR / EN
   2. affichage de la liste des rapports (lue dans reports.js)
   Tu n'as normalement jamais besoin de toucher à ce fichier.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------------------------- langue ----------------------------------- */
  var LANGUES = ["en", "fr"];

  function langueChoisie() {
    try {
      var l = localStorage.getItem("bl-lang");
      if (LANGUES.indexOf(l) !== -1) return l;
    } catch (e) {
      /* navigation privée : on ignore et on prend la langue du navigateur */
    }
    return (navigator.language || "en").toLowerCase().indexOf("fr") === 0 ? "fr" : "en";
  }

  function appliquer(lang) {
    document.documentElement.lang = lang;
    var btn = document.querySelector(".lang");
    if (btn) {
      var autre = lang === "fr" ? "EN" : "FR";
      btn.textContent = autre;
      btn.setAttribute(
        "aria-label",
        lang === "fr" ? "Switch to English" : "Afficher le site en français"
      );
    }
    try {
      localStorage.setItem("bl-lang", lang);
    } catch (e) {}
    afficherRapports();
  }

  /* ---------------------------- rapports --------------------------------- */
  function texte(rapport, champ, lang) {
    // si la version dans la langue demandée manque, on retombe sur l'autre
    return rapport[champ + "_" + lang] || rapport[champ + "_en"] || rapport[champ + "_fr"] || "";
  }

  function dateLisible(iso, lang) {
    var p = String(iso).split("-");
    if (p.length !== 3) return iso;
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", {
      year: "numeric", month: "long", day: "numeric", timeZone: "UTC"
    });
  }

  function echapper(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function afficherRapports() {
    var zone = document.getElementById("reports");
    if (!zone) return;

    var lang = document.documentElement.lang === "fr" ? "fr" : "en";
    var liste = (typeof REPORTS !== "undefined" && Array.isArray(REPORTS)) ? REPORTS.slice() : [];

    if (!liste.length) {
      zone.innerHTML =
        '<div class="empty">' +
        '<span lang="en">The first report is being written. Check back shortly.</span>' +
        '<span lang="fr">Le premier rapport est en cours de rédaction. Revenez bientôt.</span>' +
        "</div>";
      return;
    }

    liste.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });

    zone.innerHTML = liste.map(function (r) {
      var titre = echapper(texte(r, "title", lang));
      var resume = echapper(texte(r, "summary", lang));
      var fichier = encodeURI(String(r.file || ""));
      var lire = lang === "fr" ? "Lire le rapport (PDF) →" : "Read the report (PDF) →";
      return (
        '<a class="report" href="' + fichier + '" target="_blank" rel="noopener">' +
        '<div class="report-date">' + echapper(dateLisible(r.date, lang)) + "</div>" +
        "<h3>" + titre + "</h3>" +
        (resume ? "<p>" + resume + "</p>" : "") +
        '<span class="report-go">' + lire + "</span>" +
        "</a>"
      );
    }).join("");
  }

  /* ---------------------------- démarrage -------------------------------- */
  function init() {
    appliquer(langueChoisie());
    var btn = document.querySelector(".lang");
    if (btn) {
      btn.addEventListener("click", function () {
        appliquer(document.documentElement.lang === "fr" ? "en" : "fr");
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
