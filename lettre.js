/* ==========================================================================
   Brier-Labs — affichage de la Lettre du lundi.

   Lit lettres.json et affiche la dernière édition en entier, puis les
   précédentes repliées. Les deux langues sont toujours écrites dans la page :
   c'est la feuille de style qui masque l'inactive, comme partout sur le site.

   lettres.json est écrit chaque lundi par une tâche automatique, après
   validation par scripts/ajouter_lettre.py. Si le fichier manque ou est
   abîmé, seule cette page affiche un message : le reste du site n'en dépend
   pas.
   ========================================================================== */

(function () {
  "use strict";

  /* Les onze fonds sectoriels SPDR. Le fonds sert de référence pour vérifier
     chaque prévision après coup ; le nom du secteur en découle. */
  var SECTEURS = {
    XLE:  ["Energy", "Énergie"],
    XLF:  ["Financials", "Finance"],
    XLK:  ["Technology", "Technologie"],
    XLV:  ["Health care", "Santé"],
    XLI:  ["Industrials", "Industrie"],
    XLY:  ["Consumer discretionary", "Consommation discrétionnaire"],
    XLP:  ["Consumer staples", "Consommation de base"],
    XLU:  ["Utilities", "Services publics"],
    XLB:  ["Materials", "Matériaux"],
    XLRE: ["Real estate", "Immobilier"],
    XLC:  ["Communication services", "Communication"]
  };

  var DIRECTIONS = {
    hausse:    { classe: "s-buy",  en: "▲ Up",      fr: "▲ Hausse" },
    baisse:    { classe: "s-sell", en: "▼ Down",    fr: "▼ Baisse" },
    incertain: { classe: "",       en: "◆ Unclear", fr: "◆ Incertain" }
  };

  function echapper(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function bilingue(en, fr) {
    return '<span lang="en">' + en + '</span><span lang="fr">' + fr + "</span>";
  }

  /* Texte libre venu du fichier : toujours échappé, une langue retombe sur
     l'autre si elle manque. */
  function texte(o, champ) {
    var en = o[champ + "_en"] || o[champ + "_fr"] || "";
    var fr = o[champ + "_fr"] || o[champ + "_en"] || "";
    return bilingue(echapper(en), echapper(fr));
  }

  function dateLisible(iso, l) {
    var p = String(iso || "").split("-");
    if (p.length !== 3) return echapper(iso);
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    if (isNaN(d)) return echapper(iso);
    return d.toLocaleDateString(l === "fr" ? "fr-CA" : "en-CA",
      { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  }

  /* Seuls les liens https sont rendus cliquables. */
  function lienSur(url) {
    return /^https:\/\/[^\s"<>]+$/.test(String(url || ""));
  }

  function impact(i) {
    var s = SECTEURS[i.etf] || [echapper(i.etf), echapper(i.etf)];
    var d = DIRECTIONS[i.direction] || DIRECTIONS.incertain;
    return '<li class="impact">' +
      '<span class="call-sig ' + d.classe + '">' + bilingue(d.en, d.fr) + "</span>" +
      '<span class="impact-k">' + bilingue(s[0], s[1]) +
        ' <span class="impact-etf">' + echapper(i.etf) + "</span></span>" +
      '<span class="impact-why">' + texte(i, "raison") + "</span>" +
      "</li>";
  }

  function nouvelle(n, rang) {
    var sources = (n.sources || []).map(function (src) {
      var nom = echapper(src.nom || src.url);
      return lienSur(src.url)
        ? '<a href="' + echapper(src.url) + '" target="_blank" rel="noopener nofollow">' + nom + "</a>"
        : nom;
    }).join(", ");
    return '<div class="nouvelle">' +
      "<h3>" + (rang + 1) + ". " + texte(n, "titre") + "</h3>" +
      "<p>" + texte(n, "resume") + "</p>" +
      ((n.impacts || []).length ? '<ul class="impacts">' + n.impacts.map(impact).join("") + "</ul>" : "") +
      (sources ? '<p class="nouvelle-src">' + bilingue("Sources: ", "Sources : ") + sources + "</p>" : "") +
      "</div>";
  }

  function aSurveiller(e) {
    var en = e.a_surveiller_en || [], fr = e.a_surveiller_fr || [];
    var n = Math.max(en.length, fr.length);
    if (!n) return "";
    var items = "";
    for (var i = 0; i < n; i++) {
      items += "<li>" + bilingue(echapper(en[i] || fr[i]), echapper(fr[i] || en[i])) + "</li>";
    }
    return '<div class="a-surveiller"><h3>' + bilingue("Coming up", "À surveiller") + "</h3><ul>" + items + "</ul></div>";
  }

  function edition(e) {
    var h = e.horizon || {};
    var entete = bilingue(
      dateLisible(e.date, "en") + (h.du && h.au ? " · for the week of " + dateLisible(h.du, "en") + " to " + dateLisible(h.au, "en") : ""),
      dateLisible(e.date, "fr") + (h.du && h.au ? " · pour la semaine du " + dateLisible(h.du, "fr") + " au " + dateLisible(h.au, "fr") : ""));
    return '<article class="lettre">' +
      '<div class="record-meta">' + entete + (e.pilote ? bilingue(" · pilot issue", " · édition pilote") : "") + "</div>" +
      '<h2 class="lettre-titre">' + texte(e, "titre") + "</h2>" +
      (e.intro_en || e.intro_fr ? '<p class="sec-intro">' + texte(e, "intro") + "</p>" : "") +
      (e.nouvelles || []).map(nouvelle).join("") +
      aSurveiller(e) +
      '<p class="lettre-sig">' + bilingue("Written by ", "Rédigée par ") + echapper(e.redige_par || "Claude (Anthropic)") + "</p>" +
      "</article>";
  }

  function message(zone, en, fr) {
    zone.innerHTML = '<div class="empty">' + bilingue(en, fr) + "</div>";
  }

  function afficher(donnees) {
    var zone = document.getElementById("lettre");
    if (!zone) return;
    var liste = (donnees && Array.isArray(donnees.editions)) ? donnees.editions.slice() : [];
    if (!liste.length) {
      message(zone, "The first letter is on its way. It comes out on Monday mornings.",
                    "La première lettre arrive. Elle paraît le lundi matin.");
      return;
    }
    liste.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });

    var html = edition(liste[0]);
    if (liste.length > 1) {
      html += '<h3 class="corr-h">' + bilingue("Previous letters", "Lettres précédentes") + "</h3>" +
        liste.slice(1).map(function (e) {
          return '<details class="lettre-ancienne"><summary>' +
            bilingue(dateLisible(e.date, "en"), dateLisible(e.date, "fr")) + " · " + texte(e, "titre") +
            "</summary>" + edition(e) + "</details>";
        }).join("");
    }
    zone.innerHTML = html;
  }

  function demarrer() {
    var zone = document.getElementById("lettre");
    if (!zone) return;
    /* no-cache : la lettre du lundi doit apparaître dès sa publication. */
    fetch("lettres.json", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(afficher)
      .catch(function (e) {
        if (window.console) console.warn("Brier-Labs, lettre :", e.message);
        message(zone, "The letter could not be loaded right now. Please try again in a moment.",
                      "La lettre n’a pas pu être chargée pour l’instant. Réessaie dans un moment.");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", demarrer);
  } else {
    demarrer();
  }
})();
