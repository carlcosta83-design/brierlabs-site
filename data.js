/* ==========================================================================
   Brier-Labs — lecture des résultats réels depuis Supabase.

   Ce fichier va chercher les prédictions dans la base, calcule les taux de
   justesse et les références, puis remplit la page Résultats et le relevé
   de la page d'accueil.

   Tu n'as normalement jamais besoin d'y toucher : tout ce qui te concerne
   est dans config.js.
   ========================================================================== */

(function () {
  "use strict";

  /* La même règle que celle du script d'évaluation : un mouvement de moins
     d'un demi-point de pourcentage compte comme une absence de mouvement. */
  var BANDE = 0.5;

  /* ------------------------- garde-fous de config ------------------------ */

  function etatConfig() {
    if (typeof SUPABASE_URL === "undefined" || typeof SUPABASE_PUBLIC_KEY === "undefined") {
      return "absente";
    }
    if (!SUPABASE_URL || SUPABASE_URL.indexOf("COLLE-ICI") === 0) return "absente";
    if (!SUPABASE_PUBLIC_KEY || SUPABASE_PUBLIC_KEY.indexOf("COLLE-ICI") === 0) return "absente";
    /* Protection : une clé secrète ne doit JAMAIS se retrouver dans une page
       web. Si c'est le cas, on refuse de faire quoi que ce soit. */
    if (SUPABASE_PUBLIC_KEY.indexOf("sb_secret_") === 0) return "cle_secrete";
    return "ok";
  }

  function racine() {
    var u = String(SUPABASE_URL).trim().replace(/\/+$/, "");
    return u.replace(/\/rest(\/v1)?$/, "");
  }

  /* ----------------------------- requêtes -------------------------------- */

  function interroger(parametres) {
    return fetch(racine() + "/rest/v1/predictions?" + parametres, {
      headers: { apikey: SUPABASE_PUBLIC_KEY }
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  var COLONNES_STATS =
    "prediction_date,ticker,signal,sentiment_score,return_t1,correct_t1,return_t7,correct_t7,return_t30,correct_t30";

  /* ------------------------------ calculs -------------------------------- */

  function justeSelonRegle(signal, rendement) {
    if (rendement === null || rendement === undefined) return null;
    var s = String(signal || "").toUpperCase();
    var r = Number(rendement);
    if (s === "BUY") return r > BANDE;
    if (s === "SELL") return r < -BANDE;
    if (s === "HOLD") return r >= -BANDE && r <= BANDE;
    return false;
  }

  function pourcent(bons, total) {
    return total ? Math.round((bons / total) * 100) : null;
  }

  function calculer(lignes) {
    var evaluees = lignes.filter(function (l) { return l.correct_t1 !== null && l.correct_t1 !== undefined; });

    var bons = 0, refAchat = 0, refConserve = 0, avecRendement = 0;
    var parSignal = {};

    evaluees.forEach(function (l) {
      if (l.correct_t1) bons++;
      var sig = String(l.signal || "?").toUpperCase();
      if (!parSignal[sig]) parSignal[sig] = { n: 0, bons: 0, n7: 0, bons7: 0 };
      parSignal[sig].n++;
      if (l.correct_t1) parSignal[sig].bons++;
      if (l.correct_t7 !== null && l.correct_t7 !== undefined) {
        parSignal[sig].n7++;
        if (l.correct_t7) parSignal[sig].bons7++;
      }
      if (l.return_t1 !== null && l.return_t1 !== undefined) {
        avecRendement++;
        if (justeSelonRegle("BUY", l.return_t1)) refAchat++;
        if (justeSelonRegle("HOLD", l.return_t1)) refConserve++;
      }
    });

    var dates = lignes.map(function (l) { return l.prediction_date; }).filter(Boolean).sort();

    return {
      total: lignes.length,
      evaluees: evaluees.length,
      ia: pourcent(bons, evaluees.length),
      achat: pourcent(refAchat, avecRendement),
      conserve: pourcent(refConserve, avecRendement),
      parSignal: parSignal,
      premiere: dates[0] || null,
      derniere: dates[dates.length - 1] || null,
      titres: Object.keys(lignes.reduce(function (acc, l) { acc[l.ticker] = 1; return acc; }, {})).length
    };
  }

  /* ------------------------------ affichage ------------------------------ */

  function echapper(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* Les deux langues sont toujours écrites dans la page et c'est la feuille
     de style qui masque l'inactive. Rien n'est donc figé au chargement :
     la bascule FR/EN change aussi les dates et les pourcentages. */
  function bilingue(en, fr) {
    return '<span lang="en">' + en + '</span><span lang="fr">' + fr + "</span>";
  }

  function dateLisible(iso, l) {
    var p = String(iso || "").split("-");
    if (p.length !== 3) return iso || "";
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(l === "fr" ? "fr-CA" : "en-CA",
      { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  }

  function periode(s, l) {
    return s.premiere === s.derniere
      ? dateLisible(s.derniere, l)
      : dateLisible(s.premiere, l) + " – " + dateLisible(s.derniere, l);
  }

  function val(n) {
    return n === null ? "—" : bilingue(n + "%", n + " %");
  }

  /* Le relevé en trois barres, utilisé sur l'accueil ET sur la page Résultats */
  function barres(s) {
    function ligne(nomEn, nomFr, valeur, mien) {
      var l = Math.max(0, Math.min(100, valeur === null ? 0 : valeur));
      return '<div class="row' + (mien ? " mine" : "") + '">' +
        '<div class="row-name">' + bilingue(nomEn, nomFr) + "</div>" +
        '<div class="bar"><span style="width:' + l + '%"></span></div>' +
        '<div class="row-val">' + val(valeur) + "</div></div>";
    }
    return ligne("Brier-Labs model", "Modèle Brier-Labs", s.ia, true) +
      ligne("Always “buy”", "Toujours « acheter »", s.achat, false) +
      ligne("Always “hold”", "Toujours « conserver »", s.conserve, false);
  }

  function entete(s) {
    return bilingue(
      periode(s, "en") + " · " + s.evaluees + " calls scored · " + s.titres + " tickers",
      periode(s, "fr") + " · " + s.evaluees + " appels notés · " + s.titres + " titres"
    );
  }

  /* --------------------------- page d'accueil ---------------------------- */

  function remplirAccueil(s) {
    var zone = document.querySelector(".record");
    if (!zone || s.evaluees === 0) return;   /* on garde les chiffres écrits en dur */
    var meta = zone.querySelector(".record-meta");
    var lecture = zone.querySelector(".read");
    var anciennes = zone.querySelectorAll(".row");
    if (!meta || anciennes.length === 0) return;

    meta.innerHTML = entete(s);
    var html = barres(s);
    anciennes[0].insertAdjacentHTML("beforebegin", html);
    for (var i = 0; i < anciennes.length; i++) anciennes[i].remove();

    if (lecture) {
      var ecart = s.ia - Math.max(s.achat, s.conserve);
      var verdictEn, verdictFr;
      if (ecart > 3) {
        verdictEn = "The model is currently ahead of both trivial strategies. With a sample this size that is encouraging rather than conclusive.";
        verdictFr = "Le modèle devance actuellement les deux stratégies triviales. Sur un échantillon de cette taille, c’est encourageant plutôt que concluant.";
      } else if (ecart < -3) {
        verdictEn = "The model is currently behind the better of the two trivial strategies. The working hypothesis is that public headlines are already reflected in the opening price.";
        verdictFr = "Le modèle est actuellement derrière la meilleure des deux stratégies triviales. L’hypothèse de travail est que les titres de presse publics sont déjà intégrés au cours d’ouverture.";
      } else {
        verdictEn = "The model is level with the trivial strategies — no edge detected so far.";
        verdictFr = "Le modèle est au même niveau que les stratégies triviales — aucun avantage détecté à ce stade.";
      }
      lecture.innerHTML = bilingue(
        verdictEn + " These figures are read live from the database and update themselves as the record grows.",
        verdictFr + " Ces chiffres sont lus en direct dans la base et se mettent à jour d’eux-mêmes à mesure que le relevé s’étoffe."
      );
    }
  }

  /* -------------------------- page Résultats ----------------------------- */

  function tableauParSignal(s) {
    var ordre = ["BUY", "HOLD", "SELL"];
    var noms = { BUY: ["Buy", "Acheter"], HOLD: ["Hold", "Conserver"], SELL: ["Sell", "Vendre"] };
    var out = "";
    ordre.forEach(function (sig) {
      var d = s.parSignal[sig];
      var n = d ? d.n : 0;
      var t1 = d && d.n ? pourcent(d.bons, d.n) : null;
      var t7 = d && d.n7 ? pourcent(d.bons7, d.n7) : null;
      out += '<div class="sig">' +
        '<div class="sig-k">' + bilingue(noms[sig][0], noms[sig][1]) + "</div>" +
        '<div class="sig-n">' + n + " " + bilingue(n === 1 ? "call" : "calls", n === 1 ? "appel" : "appels") + "</div>" +
        '<div class="sig-v">' + val(t1) + '<span class="sig-h">T+1</span></div>' +
        '<div class="sig-v">' + (t7 === null ? "—" : val(t7)) + '<span class="sig-h">T+7</span></div>' +
        "</div>";
    });
    return out;
  }

  function listeAppels(lignes) {
    if (!lignes.length) return "";
    return lignes.map(function (l) {
      var sig = String(l.signal || "").toUpperCase();
      var verdict = "";
      if (l.correct_t1 === true) verdict = '<span class="v ok">' + bilingue("Correct", "Juste") + "</span>";
      else if (l.correct_t1 === false) verdict = '<span class="v ko">' + bilingue("Missed", "Manqué") + "</span>";
      else verdict = '<span class="v wait">' + bilingue("Not scored yet", "Pas encore noté") + "</span>";

      var rend = (l.return_t1 === null || l.return_t1 === undefined)
        ? "" : '<span class="ret">' + (Number(l.return_t1) >= 0 ? "+" : "") + Number(l.return_t1).toFixed(2) + "%</span>";

      return '<div class="call">' +
        '<div class="call-top">' +
        '<span class="call-tk">' + echapper(l.ticker) + "</span>" +
        '<span class="call-sig s-' + sig.toLowerCase() + '">' + echapper(sig) + "</span>" +
        '<span class="call-sc">' + (l.sentiment_score === null || l.sentiment_score === undefined
          ? "" : Number(l.sentiment_score).toFixed(2)) + "</span>" +
        '<span class="call-end">' + rend + verdict + "</span>" +
        "</div>" +
        (l.rationale ? '<p class="call-why">' + echapper(l.rationale) + "</p>" : "") +
        "</div>";
    }).join("");
  }

  function csv(lignes) {
    var cols = ["prediction_date", "ticker", "signal", "sentiment_score",
      "return_t1", "correct_t1", "return_t7", "correct_t7", "return_t30", "correct_t30"];
    var l = [cols.join(",")];
    lignes.forEach(function (r) {
      l.push(cols.map(function (c) {
        var v = r[c];
        return v === null || v === undefined ? "" : String(v);
      }).join(","));
    });
    return l.join("\n");
  }

  function message(zone, titreEn, titreFr, texteEn, texteFr) {
    zone.innerHTML = '<div class="notice"><h3>' + bilingue(titreEn, titreFr) + "</h3><p>" +
      bilingue(texteEn, texteFr) + "</p></div>";
  }

  function remplirResultats(statsLignes, dernierJour) {
    var zone = document.getElementById("live");
    if (!zone) return;
    var s = calculer(statsLignes);

    if (s.total === 0) {
      message(zone,
        "No data yet", "Aucune donnée pour l’instant",
        "The database returned no rows. Either the pipeline has not written anything yet, or the public read rule has not been created in Supabase.",
        "La base n’a renvoyé aucune ligne. Soit le pipeline n’a encore rien écrit, soit la règle de lecture publique n’a pas été créée dans Supabase.");
      return;
    }

    var html = "";

    /* Bandeau de synthèse */
    html += '<div class="record">' +
      '<div class="record-meta">' + entete(s) + "</div>" +
      (s.evaluees ? barres(s) :
        '<p class="read">' + bilingue(
          "Calls are recorded but none has been scored yet — scoring happens after the market closes.",
          "Des appels sont enregistrés mais aucun n’a encore été noté — la notation a lieu après la clôture des marchés.") + "</p>") +
      "</div>";
    zone.innerHTML = html;

    /* Détail par type d'appel */
    var parType = document.getElementById("by-signal");
    if (parType && s.evaluees) parType.innerHTML = tableauParSignal(s);

    /* Derniers appels produits */
    var recents = document.getElementById("latest");
    if (recents) {
      if (dernierJour && dernierJour.length) {
        var j = dernierJour[0].prediction_date;
        recents.innerHTML = '<div class="record-meta">' +
          bilingue("Calls of " + dateLisible(j, "en"), "Appels du " + dateLisible(j, "fr")) +
          "</div>" + listeAppels(dernierJour);
      } else {
        recents.innerHTML = "";
      }
    }

    /* Téléchargement */
    var dl = document.getElementById("download");
    if (dl) {
      var blob = new Blob([csv(statsLignes)], { type: "text/csv;charset=utf-8" });
      dl.href = URL.createObjectURL(blob);
      dl.download = "brier-labs-record-" + (s.derniere || "") + ".csv";
      dl.style.display = "";
    }
  }

  /* ------------------------------ démarrage ------------------------------ */

  function demarrer() {
    var surResultats = !!document.getElementById("live");
    var surAccueil = !!document.querySelector(".record");
    if (!surResultats && !surAccueil) return;

    var etat = etatConfig();

    if (etat === "cle_secrete") {
      if (surResultats) {
        message(document.getElementById("live"),
          "Configuration error", "Erreur de configuration",
          "A secret key was placed in config.js. It has not been used. Replace it with the publishable key, which is the only one safe to publish.",
          "Une clé secrète a été placée dans config.js. Elle n’a pas été utilisée. Remplace-la par la clé publishable, la seule qui puisse être publiée sans risque.");
      }
      if (window.console) console.error(
        "Brier-Labs : clé secrète détectée dans config.js. Aucune requête n’a été envoyée. " +
        "Remplace-la par la clé publishable (sb_publishable_...).");
      return;
    }

    if (etat === "absente") {
      if (surResultats) {
        message(document.getElementById("live"),
          "Not connected yet", "Pas encore connecté",
          "Fill in config.js with the project URL and the publishable key from Supabase.",
          "Remplis config.js avec l’URL du projet et la clé publishable trouvées dans Supabase.");
      }
      return;
    }

    /* Requête légère pour les statistiques sur tout l'historique */
    var p1 = interroger("select=" + COLONNES_STATS + "&order=prediction_date.desc&limit=5000");

    if (surAccueil && !surResultats) {
      p1.then(function (lignes) { remplirAccueil(calculer(lignes)); })
        .catch(function (e) { if (window.console) console.warn("Brier-Labs :", e.message); });
      return;
    }

    /* Page Résultats : on ajoute le détail du dernier jour, avec les justifications */
    var p2 = interroger(
      "select=prediction_date,ticker,signal,sentiment_score,rationale,return_t1,correct_t1" +
      "&order=prediction_date.desc,ticker.asc&limit=40");

    Promise.all([p1, p2]).then(function (res) {
      var stats = res[0], recents = res[1];
      var dernier = recents.length ? recents[0].prediction_date : null;
      remplirResultats(stats, recents.filter(function (l) { return l.prediction_date === dernier; }));
      if (surAccueil) remplirAccueil(calculer(stats));
    }).catch(function (e) {
      message(document.getElementById("live"),
        "Could not reach the database", "Impossible de joindre la base",
        "The request failed (" + echapper(e.message) + "). Check the project URL and the publishable key in config.js.",
        "La requête a échoué (" + echapper(e.message) + "). Vérifie l’URL du projet et la clé publishable dans config.js.");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", demarrer);
  } else {
    demarrer();
  }
})();
