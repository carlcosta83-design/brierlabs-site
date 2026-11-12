/* ==========================================================================
   Brier-Labs — comportement commun à toutes les pages
   1. bascule de langue FR / EN
   2. affichage de la liste des rapports (lue dans reports.js)
   3. menus déroulants (« Résultats » et ses sous-pages)
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

  /* Un rapport peut exister en deux versions. On sert celle qui correspond à
     la langue du site ; à défaut le fichier unique ; à défaut l'autre langue
     — et dans ce dernier cas on le dit dans le libellé, plutôt que de laisser
     le lecteur tomber sur un document qu'il n'attendait pas. */
  function fichierDe(r, lang) {
    var voulu = r["file_" + lang];
    if (voulu) return { chemin: voulu, autre: null };
    if (r.file) return { chemin: r.file, autre: null };
    if (r.file_fr) return { chemin: r.file_fr, autre: "fr" };
    if (r.file_en) return { chemin: r.file_en, autre: "en" };
    return { chemin: "", autre: null };
  }

  function libelleLien(autre, lang) {
    if (lang === "fr") {
      return autre === "en" ? "Lire le rapport (PDF, en anglais) →"
                            : "Lire le rapport (PDF) →";
    }
    return autre === "fr" ? "Read the report (PDF, in French) →"
                          : "Read the report (PDF) →";
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
      var cible = fichierDe(r, lang);
      var fichier = encodeURI(String(cible.chemin));
      var lire = libelleLien(cible.autre, lang);
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

  /* --------------------------- menus déroulants -------------------------- */
  /* « Résultats » ouvre la liste de ses sous-pages au clic. Un clic ailleurs
     ou la touche Échap la referment ; le bouton annonce son état aux
     lecteurs d'écran (aria-expanded). */
  function menusDeroulants() {
    var boutons = document.querySelectorAll(".nav-deroule");
    Array.prototype.forEach.call(boutons, function (bouton) {
      var liste = document.getElementById(bouton.getAttribute("aria-controls"));
      if (!liste) return;
      function fermer() { bouton.setAttribute("aria-expanded", "false"); liste.hidden = true; }
      function ouvrir() { bouton.setAttribute("aria-expanded", "true"); liste.hidden = false; }
      bouton.addEventListener("click", function (e) {
        e.stopPropagation();
        if (liste.hidden) ouvrir(); else fermer();
      });
      document.addEventListener("click", function (e) {
        if (!liste.hidden && !liste.contains(e.target)) fermer();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !liste.hidden) { fermer(); bouton.focus(); }
      });
    });
  }

  /* ---------------------------- démarrage -------------------------------- */
  function init() {
    menusDeroulants();
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
