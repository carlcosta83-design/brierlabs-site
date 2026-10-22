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

  /* ------------------- corrélation entre score et rendement --------------
     Le taux de justesse jette de l'information : il réduit chaque appel à
     « juste » ou « faux ». La corrélation de rang utilise l'ordre complet
     des scores, elle détecte donc un avantage plus faible, et plus tôt.
     ---------------------------------------------------------------------- */

  /* Rangs avec égalités moyennées (1, 2.5, 2.5, 4...). */
  function rangs(v) {
    var ordre = [], i;
    for (i = 0; i < v.length; i++) ordre.push(i);
    ordre.sort(function (a, b) { return v[a] - v[b]; });
    var r = new Array(v.length);
    i = 0;
    while (i < ordre.length) {
      var j = i;
      while (j + 1 < ordre.length && v[ordre[j + 1]] === v[ordre[i]]) j++;
      var moyen = (i + j) / 2 + 1;
      for (var k = i; k <= j; k++) r[ordre[k]] = moyen;
      i = j + 1;
    }
    return r;
  }

  function pearson(xs, ys) {
    var n = xs.length, i;
    if (n < 2) return null;
    var mx = 0, my = 0;
    for (i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    var num = 0, dx = 0, dy = 0;
    for (i = 0; i < n; i++) {
      var a = xs[i] - mx, b = ys[i] - my;
      num += a * b; dx += a * a; dy += b * b;
    }
    if (!dx || !dy) return null;
    return num / Math.sqrt(dx * dy);
  }

  function spearman(paires) {
    var s = [], r = [];
    paires.forEach(function (p) { s.push(p.s); r.push(p.r); });
    return pearson(rangs(s), rangs(r));
  }

  /* Rendement moyen et proportion de séances en hausse, par cinquième de
     score. C'est la façon la plus lisible de voir s'il y a du signal. */
  function quintiles(paires) {
    var tri = paires.slice().sort(function (a, b) { return a.s - b.s; });
    var n = tri.length;
    if (n < 25) return [];

    /* Les scores sont arrondis au vingtième : il y a beaucoup d'ex aequo.
       On ne coupe jamais à l'intérieur d'un groupe d'ex aequo. Sinon deux
       appels portant le même score tomberaient dans des cinquièmes
       différents selon l'ordre de lecture, et les bornes affichées se
       chevaucheraient. Les groupes sont donc un peu inégaux — leur taille
       est affichée — mais chaque tranche de score est nette. */
    var groupes = [], i = 0;
    while (i < n) {
      var j = i;
      while (j + 1 < n && tri[j + 1].s === tri[i].s) j++;
      groupes.push(tri.slice(i, j + 1));
      i = j + 1;
    }

    var tranches = [], courant = [], vus = 0, cible = 1;
    groupes.forEach(function (g) {
      courant = courant.concat(g);
      vus += g.length;
      if (tranches.length < 4 && vus >= Math.round((cible * n) / 5)) {
        tranches.push(courant); courant = []; cible++;
      }
    });
    if (courant.length) tranches.push(courant);

    /* Moins de trois tranches veut dire que les scores sont trop concentrés
       pour que le découpage ait un sens : on préfère ne rien afficher. */
    if (tranches.length < 3) return [];

    return tranches.map(function (g) {
      var somme = 0, hausses = 0;
      g.forEach(function (x) { somme += x.r; if (x.r > 0) hausses++; });
      return {
        bas: g[0].s,
        haut: g[g.length - 1].s,
        n: g.length,
        rendement: somme / g.length,
        hausses: Math.round((hausses / g.length) * 100)
      };
    });
  }

  /* En dessous de ce nombre d'appels notés, afficher une corrélation
     induirait en erreur : on s'abstient. */
  var MIN_CORRELATION = 30;

  function calculer(lignes) {
    var evaluees = lignes.filter(function (l) { return l.correct_t1 !== null && l.correct_t1 !== undefined; });

    var bons = 0, refAchat = 0, refConserve = 0, refVente = 0, avecRendement = 0;
    var parSignal = {};
    var paires = [];

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
        if (justeSelonRegle("SELL", l.return_t1)) refVente++;
        if (l.sentiment_score !== null && l.sentiment_score !== undefined) {
          paires.push({ s: Number(l.sentiment_score), r: Number(l.return_t1) });
        }
      }
    });

    var assez = paires.length >= MIN_CORRELATION;

    var dates = lignes.map(function (l) { return l.prediction_date; }).filter(Boolean).sort();

    return {
      total: lignes.length,
      evaluees: evaluees.length,
      ia: pourcent(bons, evaluees.length),
      achat: pourcent(refAchat, avecRendement),
      conserve: pourcent(refConserve, avecRendement),
      vente: pourcent(refVente, avecRendement),
      parSignal: parSignal,
      nPaires: paires.length,
      rho: assez ? spearman(paires) : null,
      seuil: assez ? 1.96 / Math.sqrt(paires.length) : null,
      quintiles: assez ? quintiles(paires) : [],
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

  /* Version texte brut, à utiliser à l'intérieur d'une chaîne qui sera
     elle-même passée à bilingue(). */
  function nombreBrut(x, dec, avecSigne) {
    var t = Number(x).toFixed(dec === undefined ? 2 : dec);
    return ((avecSigne && Number(x) >= 0) ? "+" : "") + t;
  }

  /* Le français écrit la virgule décimale, l'anglais le point. */
  function nombre(x, dec, avecSigne) {
    var t = nombreBrut(x, dec, avecSigne);
    return bilingue(t, t.replace(".", ","));
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
    /* Les trois références triviales sont toutes affichées, y compris celle
       qui bat le modèle : en cacher une rendrait le relevé flatteur. */
    return ligne("Brier-Labs model", "Modèle Brier-Labs", s.ia, true) +
      ligne("Always “buy”", "Toujours « acheter »", s.achat, false) +
      ligne("Always “hold”", "Toujours « conserver »", s.conserve, false) +
      ligne("Always “sell”", "Toujours « vendre »", s.vente, false);
  }

  /* La meilleure des trois règles triviales — c'est elle qu'il faut battre. */
  function meilleureReference(s) {
    return Math.max(
      s.achat === null ? 0 : s.achat,
      s.conserve === null ? 0 : s.conserve,
      s.vente === null ? 0 : s.vente
    );
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
      var ecart = s.ia - meilleureReference(s);
      var verdictEn, verdictFr;
      if (ecart > 3) {
        verdictEn = "The model is currently ahead of all three trivial strategies. With a sample this size that is encouraging rather than conclusive.";
        verdictFr = "Le modèle devance actuellement les trois stratégies triviales. Sur un échantillon de cette taille, c’est encourageant plutôt que concluant.";
      } else if (ecart < -3) {
        verdictEn = "The model is currently behind the best of the three trivial strategies. The working hypothesis is that public headlines are already reflected in the opening price.";
        verdictFr = "Le modèle est actuellement derrière la meilleure des trois stratégies triviales. L’hypothèse de travail est que les titres de presse publics sont déjà intégrés au cours d’ouverture.";
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

  /* --------------- bloc « le score porte-t-il de l'information ? » -------- */

  function blocSignal(s) {
    if (s.nPaires < MIN_CORRELATION) {
      return '<p class="read">' + bilingue(
        "This measure needs at least " + MIN_CORRELATION + " scored calls; there are " + s.nPaires + " so far.",
        "Cette mesure demande au moins " + MIN_CORRELATION + " appels notés ; il y en a " + s.nPaires + " pour l’instant."
      ) + "</p>";
    }

    /* Peut arriver si le modèle attribue le même score à tout : il n'y a
       alors aucun classement à mettre en regard des résultats. */
    if (s.rho === null || s.rho === undefined) {
      return '<p class="read">' + bilingue(
        "Every scored call carries the same sentiment score, so there is no ordering to compare against outcomes.",
        "Tous les appels notés portent le même score de sentiment : il n’y a aucun classement à mettre en regard des résultats."
      ) + "</p>";
    }

    var r = s.rho, seuil = s.seuil, verdictEn, verdictFr;

    if (Math.abs(r) <= seuil) {
      verdictEn = "The correlation sits inside the detection threshold for a sample this size, so nothing is demonstrated — a value this small is what noise alone produces. The sign is still worth watching, and the fifths below show whether the tendency is orderly or scattered.";
      verdictFr = "La corrélation reste à l’intérieur du seuil de détection pour un échantillon de cette taille : rien n’est démontré, une valeur aussi faible est ce que produit le bruit seul. Le signe mérite tout de même d’être suivi, et les cinquièmes ci-dessous montrent si la tendance est ordonnée ou dispersée.";
    } else if (r > 0) {
      verdictEn = "The correlation is above the detection threshold: the score carries information about what follows. That is a statistical result, not a trading result — it says the ordering beats chance, not that the effect is large enough to act on.";
      verdictFr = "La corrélation dépasse le seuil de détection : le score porte de l’information sur ce qui suit. C’est un résultat statistique, pas un résultat de marché — il dit que le classement fait mieux que le hasard, pas que l’effet soit assez fort pour agir dessus.";
    } else {
      verdictEn = "The correlation is below the negative threshold: higher scores have systematically preceded worse returns. If it holds, the model is reading the news backwards — which is itself information, and more useful than no signal at all.";
      verdictFr = "La corrélation est sous le seuil négatif : les scores élevés ont systématiquement précédé de moins bons rendements. Si cela tient, le modèle lit les nouvelles à l’envers — ce qui est en soi une information, et plus utile qu’une absence de signal.";
    }

    var html =
      '<div class="corr">' +
        '<div class="corr-v">' + nombre(r, 3, true) + "</div>" +
        '<div class="corr-x">' +
          '<div class="corr-k">' + bilingue(
            "Rank correlation between the sentiment score and the next-day return",
            "Corrélation de rang entre le score de sentiment et le rendement du lendemain") + "</div>" +
          '<div class="corr-s">' + bilingue(
            "Detection threshold at " + s.nPaires + " scored calls: ±" + Number(seuil).toFixed(3),
            "Seuil de détection à " + s.nPaires + " appels notés : ±" + Number(seuil).toFixed(3).replace(".", ",")) + "</div>" +
        "</div>" +
      "</div>" +
      '<p class="read">' + bilingue(verdictEn, verdictFr) + "</p>";

    if (s.quintiles.length >= 3) {
      var q = s.quintiles;
      var ecart = q[q.length - 1].rendement - q[0].rendement;
      html += '<h3 class="corr-h">' + bilingue(
        "Next-day outcome, by band of score",
        "Résultat du lendemain, par tranche de score") + "</h3>" +
        '<p class="corr-n">' + bilingue(
          "Share of calls followed by a rising session. If the score were meaningless these bars would all be the same height. Bands are cut into roughly equal fifths, never through a group of identical scores — so their sizes differ slightly.",
          "Part des appels suivis d’une séance en hausse. Si le score ne voulait rien dire, ces barres seraient toutes de même hauteur. Les tranches visent des cinquièmes, mais ne coupent jamais un groupe de scores identiques — leurs tailles diffèrent donc un peu.") + "</p>" +
        q.map(function (g, i) {
          var l = Math.max(0, Math.min(100, g.hausses));
          var bornes = g.bas.toFixed(2) + (g.bas === g.haut ? "" : " … " + g.haut.toFixed(2));
          return '<div class="row">' +
            '<div class="row-name">' +
              bilingue("Q" + (i + 1) + " · " + bornes + " · n=" + g.n,
                       "Q" + (i + 1) + " · " + bornes.replace(/\./g, ",") + " · n=" + g.n) +
            "</div>" +
            '<div class="bar"><span style="width:' + l + '%"></span></div>' +
            '<div class="row-val">' + val(g.hausses) + "</div></div>";
        }).join("") +
        '<p class="corr-n">' + bilingue(
          "Gap between the highest and lowest band: " + nombreBrut(ecart, 2, true) +
            " percentage points of average next-day return.",
          "Écart entre la tranche haute et la tranche basse : " +
            nombreBrut(ecart, 2, true).replace(".", ",") +
            " point de pourcentage de rendement moyen du lendemain.") + "</p>";
    }

    return html;
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
      /* Sans quoi les autres sections resteraient sur « Chargement… ». */
      ["by-signal", "signal", "latest"].forEach(function (id) {
        var e = document.getElementById(id);
        if (e) e.innerHTML = "";
      });
      var dlVide = document.getElementById("download");
      if (dlVide) dlVide.style.display = "none";
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

    /* Le score porte-t-il de l'information ? */
    var zoneSignal = document.getElementById("signal");
    if (zoneSignal) zoneSignal.innerHTML = blocSignal(s);

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
      "&order=prediction_date.desc,ticker.asc&limit=60");   /* 60 : de quoi couvrir un portefeuille de 30 titres */

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
