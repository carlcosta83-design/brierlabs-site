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

  /* ------------------------------ horizons -------------------------------

     Le modèle rend quatre verdicts par titre, un par échéance, et chacun est
     noté contre sa propre zone neutre. Celle-ci s'élargit comme la racine du
     temps : l'amplitude cumulée d'une marche aléatoire grandit en racine du
     nombre de pas. Garder ±0,5 % à un an reviendrait à déclarer « conserver »
     faux d'avance, puisque presque aucune action ne finit l'année à un
     demi-point de son point de départ.

     Les mêmes nombres sont calculés à l'identique dans evaluate.py.
     ---------------------------------------------------------------------- */

  var BANDE_JOUR = 0.5;

  var HORIZONS = [
    { cle: "t1",   seances: 1,   col: "signal",   en: "One day",   fr: "Un jour" },
    { cle: "t7",   seances: 7,   col: "signal_w", en: "One week",  fr: "Une semaine" },
    { cle: "t30",  seances: 30,  col: "signal_m", en: "One month", fr: "Un mois" },
    { cle: "t252", seances: 252, col: "signal_y", en: "One year",  fr: "Un an" }
  ];

  function bandeDe(seances, regle) {
    return regle >= 2 ? BANDE_JOUR * Math.sqrt(seances) : BANDE_JOUR;
  }

  /* 1 = un signal unique noté avec une bande fixe (jusqu'au 20 novembre 2026).
     2 = un signal par horizon, bande élargie. Une ligne sans la colonne vaut 1. */
  function regleDe(l) {
    var r = Number(l.scoring_rule);
    return isFinite(r) && r >= 2 ? 2 : 1;
  }

  /* Quel verdict juger à cet horizon. null quand la ligne n'en porte aucun :
     une prédiction de septembre n'a jamais été interrogée sur l'année, et on
     ne lui en attribue pas une après coup. */
  function signalPour(l, h) {
    if (regleDe(l) >= 2) return l[h.col] || null;
    return h.cle === "t252" ? null : (l.signal || null);
  }

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
    "prediction_date,ticker,signal,signal_w,signal_m,signal_y,scoring_rule,sentiment_score," +
    "return_t1,correct_t1,return_t7,correct_t7,return_t30,correct_t30,return_t252,correct_t252";

  /* Jeu de colonnes d'avant la migration. Sert de repli : si le site est mis
     en ligne avant que supabase_horizons.sql ait été passé, la page continue
     d'afficher l'ancien relevé au lieu de tomber en panne. */
  var COLONNES_ANCIENNES =
    "prediction_date,ticker,signal,sentiment_score,return_t1,correct_t1,return_t7,correct_t7,return_t30,correct_t30";

  var COLONNES_RECENTS =
    "prediction_date,ticker,signal,signal_w,signal_m,signal_y,scoring_rule," +
    "sentiment_score,rationale,horizon_notes,return_t1,correct_t1";

  var COLONNES_RECENTS_ANCIENNES =
    "prediction_date,ticker,signal,sentiment_score,rationale,return_t1,correct_t1";

  /* Tente le jeu complet, retombe sur l'ancien si la base ne connaît pas
     encore les nouvelles colonnes. */
  function interrogerAvecRepli(colonnes, repli, suite) {
    return interroger("select=" + colonnes + suite).catch(function (e) {
      if (String(e.message).indexOf("400") === -1) throw e;
      if (window.console) console.info(
        "Brier-Labs : colonnes d'horizon absentes de la base : affichage de " +
        "l'ancien relevé. Passe supabase_horizons.sql dans Supabase.");
      return interroger("select=" + repli + suite);
    });
  }

  /* ------------------------------ calculs -------------------------------- */

  function justeSelonRegle(signal, rendement, bande) {
    if (rendement === null || rendement === undefined) return null;
    var b = bande === undefined ? BANDE_JOUR : bande;
    var s = String(signal || "").toUpperCase();
    var r = Number(rendement);
    if (s === "BUY") return r > b;
    if (s === "SELL") return r < -b;
    if (s === "HOLD") return r >= -b && r <= b;
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

  /* ------------------------ relevé d'un seul horizon ---------------------

     `regleVoulue` vaut 1, 2, ou null pour ne pas filtrer. On ne mélange
     jamais les deux régimes de notation dans une même moyenne : la bande
     n'est pas la même de part et d'autre du 21 novembre 2026, et la moyenne
     des deux ne voudrait rien dire.

     Les trois références triviales sont recalculées sur EXACTEMENT les mêmes
     lignes que le modèle — mêmes jours, mêmes titres, même bande. C'est la
     seule façon pour que la comparaison dise quelque chose.
     ---------------------------------------------------------------------- */

  function statsHorizon(lignes, h, regleVoulue) {
    var n = 0, bons = 0, achat = 0, conserve = 0, vente = 0;
    var paires = [];
    var bande = bandeDe(h.seances, regleVoulue === null ? 2 : regleVoulue);

    lignes.forEach(function (l) {
      var regle = regleDe(l);
      if (regleVoulue !== null && regle !== regleVoulue) return;

      var rendement = l["return_" + h.cle];
      if (rendement === null || rendement === undefined) return;

      var b = bandeDe(h.seances, regle);
      var verdict = l["correct_" + h.cle];

      if (verdict !== null && verdict !== undefined) {
        n++;
        if (verdict) bons++;
        if (justeSelonRegle("BUY", rendement, b)) achat++;
        if (justeSelonRegle("HOLD", rendement, b)) conserve++;
        if (justeSelonRegle("SELL", rendement, b)) vente++;
      }
      if (l.sentiment_score !== null && l.sentiment_score !== undefined) {
        paires.push({ s: Number(l.sentiment_score), r: Number(rendement) });
      }
    });

    var assez = paires.length >= MIN_CORRELATION;
    return {
      cle: h.cle, en: h.en, fr: h.fr, seances: h.seances, bande: bande,
      n: n,
      ia: pourcent(bons, n),
      achat: pourcent(achat, n),
      conserve: pourcent(conserve, n),
      vente: pourcent(vente, n),
      nPaires: paires.length,
      rho: assez ? spearman(paires) : null,
      seuil: assez ? 1.96 / Math.sqrt(paires.length) : null
    };
  }

  /* ------------------------- relevé et archive ---------------------------

     Le relevé public ne compte que les appels de la méthode actuelle
     (scoring_rule = 2) : quatre verdicts par titre, produits avant
     l'ouverture. Les appels de l'ancienne méthode (scoring_rule = 1) ont
     presque tous été produits après l'ouverture — GitHub lançait les runs
     planifiés avec 4 à 10 heures de retard — et lisaient donc des nouvelles
     qui contenaient déjà le mouvement de la séance. Ils restent dans la base
     et dans le fichier téléchargeable, mais hors de tout calcul.
     ---------------------------------------------------------------------- */

  function calculer(toutes) {
    var releve = toutes.filter(function (l) { return regleDe(l) >= 2; });
    var archive = toutes.filter(function (l) { return regleDe(l) < 2; });
    var s = calculerSur(releve);
    var datesArchive = archive.map(function (l) { return l.prediction_date; })
      .filter(Boolean).sort();
    s.archive = {
      n: archive.length,
      premiere: datesArchive[0] || null,
      derniere: datesArchive[datesArchive.length - 1] || null
    };
    return s;
  }

  function calculerSur(lignes) {
    var evaluees = lignes.filter(function (l) { return l.correct_t1 !== null && l.correct_t1 !== undefined; });

    var bons = 0, refAchat = 0, refConserve = 0, refVente = 0, avecRendement = 0;
    var parSignal = {};
    var paires = [];

    /* Le détail par type d'appel se lit horizon par horizon, et chaque
       colonne regroupe les lignes selon le verdict DE CET HORIZON. Classer
       la réussite à sept jours sous le verdict du jour n'aurait aucun sens
       depuis que le modèle en rend quatre. */
    lignes.forEach(function (l) {
      HORIZONS.forEach(function (h) {
        if (h.cle !== "t1" && regleDe(l) < 2) return;
        var verdict = l["correct_" + h.cle];
        if (verdict === null || verdict === undefined) return;
        var s = String(signalPour(l, h) || "").toUpperCase();
        if (!s) return;
        if (!parSignal[s]) parSignal[s] = {};
        if (!parSignal[s][h.cle]) parSignal[s][h.cle] = { n: 0, bons: 0 };
        parSignal[s][h.cle].n++;
        if (verdict) parSignal[s][h.cle].bons++;
      });
    });

    evaluees.forEach(function (l) {
      if (l.correct_t1) bons++;
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

    var parHorizon = HORIZONS.map(function (h) {
      return statsHorizon(lignes, h, 2);
    });

    return {
      parHorizon: parHorizon,
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

  /* L'accueil a deux paragraphes de commentaire, un par langue. On les
     remplace par un seul paragraphe bilingue : sinon seul l'anglais est mis
     à jour et les visiteurs francophones voient le texte figé de la page. */
  function ecrireLecture(zone, html) {
    var ps = zone.querySelectorAll(".read");
    if (!ps.length) return;
    ps[0].removeAttribute("lang");
    ps[0].innerHTML = html;
    for (var i = 1; i < ps.length; i++) ps[i].remove();
  }

  function remplirAccueil(s) {
    var zone = document.querySelector(".record");
    if (!zone) return;
    var meta = zone.querySelector(".record-meta");
    var lecture = zone.querySelector(".read");
    var anciennes = zone.querySelectorAll(".row");
    if (!meta || anciennes.length === 0) return;

    /* Rien de noté dans le nouveau relevé : on le dit, et on laisse les
       barres vides. Jamais de chiffres de l'archive à la place. */
    if (s.evaluees === 0) {
      meta.innerHTML = s.premiere
        ? bilingue("Record started " + dateLisible(s.premiere, "en") + " · " + s.total +
                     (s.total === 1 ? " call" : " calls") + " made, none scored yet",
                   "Relevé commencé le " + dateLisible(s.premiere, "fr") + " · " + s.total +
                     (s.total === 1 ? " appel produit" : " appels produits") + ", aucun encore noté")
        : bilingue("New record starting", "Nouveau relevé en cours de démarrage");
      if (lecture) {
        ecrireLecture(zone, bilingue(
          "The record restarted from zero: until November 2026 the calls were produced after the market had opened, which flattered the results. Calls are scored every evening after the close, and the first figures will appear here then.",
          "Le relevé est reparti de zéro : jusqu’en novembre 2026, les appels étaient produits après l’ouverture du marché, ce qui flattait les résultats. Les appels sont notés chaque soir après la clôture, et les premiers chiffres apparaîtront alors ici."));
      }
      return;
    }

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
        verdictEn = "The model is level with the trivial strategies, no edge detected so far.";
        verdictFr = "Le modèle est au même niveau que les stratégies triviales, aucun avantage détecté à ce stade.";
      }
      ecrireLecture(zone, bilingue(
        verdictEn + " These figures are read live from the database and update themselves as the record grows.",
        verdictFr + " Ces chiffres sont lus en direct dans la base et se mettent à jour d’eux-mêmes à mesure que le relevé s’étoffe."
      ));
    }
  }

  /* -------------------------- page Résultats ----------------------------- */

  function tableauParSignal(s) {
    var ordre = ["BUY", "HOLD", "SELL"];
    var noms = { BUY: ["Buy", "Acheter"], HOLD: ["Hold", "Conserver"], SELL: ["Sell", "Vendre"] };
    var out = "";
    ordre.forEach(function (sig) {
      var d = s.parSignal[sig] || {};
      var cellules = HORIZONS.map(function (h) {
        var c = d[h.cle];
        var taux = c && c.n ? pourcent(c.bons, c.n) : null;
        return '<div class="sig-v">' + (taux === null ? "—" : val(taux)) +
          '<span class="sig-h">' + bilingue(h.en, h.fr) +
          (c && c.n ? " · n=" + c.n : "") + "</span></div>";
      }).join("");
      out += '<div class="sig sig-4">' +
        '<div class="sig-k">' + bilingue(noms[sig][0], noms[sig][1]) + "</div>" +
        cellules + "</div>";
    });
    return out;
  }

  /* ------------------------ relevé par horizon ---------------------------- */

  function bandeTexte(b) {
    var t = "±" + Number(b).toFixed(2);
    return bilingue(t + "%", t.replace(".", ",") + "&nbsp;%");
  }

  var NOMS_REF = {
    achat:    ["Always “buy”",  "Toujours « acheter »"],
    conserve: ["Always “hold”", "Toujours « conserver »"],
    vente:    ["Always “sell”", "Toujours « vendre »"]
  };

  function meilleureDe(h) {
    var meilleure = null;
    ["achat", "conserve", "vente"].forEach(function (k) {
      if (h[k] !== null && (meilleure === null || h[k] > h[meilleure])) meilleure = k;
    });
    return meilleure;
  }

  function ligneHorizon(h) {
    var titre = '<div class="sig-k">' + bilingue(h.en, h.fr) +
      '<span class="sig-band">' + bandeTexte(h.bande) + "</span></div>";

    if (!h.n) {
      return '<div class="sig sig-vide">' + titre +
        '<div class="sig-n">' + bilingue("no call has reached this horizon yet",
                                         "aucun appel n’a encore atteint cette échéance") + "</div>" +
        '<div class="sig-v">—<span class="sig-h">' +
          bilingue("not measurable yet", "pas encore mesurable") + "</span></div>" +
        /* Cellule vide : garde le tiret aligné sous la colonne « Modèle ». */
        '<div class="sig-v sig-ref"></div>' +
        "</div>";
    }

    var k = meilleureDe(h);
    var detail = bilingue(
      h.n + (h.n === 1 ? " call scored" : " calls scored"),
      h.n + (h.n === 1 ? " appel noté" : " appels notés"));
    if (h.rho !== null && h.rho !== undefined) {
      detail += bilingue(" · ρ " + nombreBrut(h.rho, 3, true),
                         " · ρ " + nombreBrut(h.rho, 3, true).replace(".", ","));
    }

    /* Le modèle est mis en avant seulement quand il devance réellement la
       meilleure des trois règles triviales. Un écart d'un point n'en est pas
       un sur quelques centaines d'appels. */
    var devance = k !== null && h.ia !== null && h.ia - h[k] > 3;

    return '<div class="sig' + (devance ? " sig-devance" : "") + '">' + titre +
      '<div class="sig-n">' + detail + "</div>" +
      '<div class="sig-v">' + val(h.ia) + '<span class="sig-h">' +
        bilingue("Model", "Modèle") + "</span></div>" +
      '<div class="sig-v sig-ref">' + (k === null ? "—" : val(h[k])) +
        '<span class="sig-h">' + (k === null ? "" : bilingue(NOMS_REF[k][0], NOMS_REF[k][1])) +
        "</span></div>" +
      "</div>";
  }

  /* Pourquoi le relevé commence où il commence. Affichée sous le tableau
     par horizon et en tête de la page quand le relevé est encore vide. */
  function texteArchive(s) {
    var a = s.archive;
    if (!a || !a.n) return null;
    var debutEn = s.premiere
      ? "The record starts on " + dateLisible(s.premiere, "en") + ". "
      : "The record restarts with the first call produced under the current method. ";
    var debutFr = s.premiere
      ? "Le relevé commence le " + dateLisible(s.premiere, "fr") + ". "
      : "Le relevé repart avec le premier appel produit sous la méthode actuelle. ";
    var plage = function (l) {
      return a.premiere === a.derniere ? dateLisible(a.premiere, l)
        : dateLisible(a.premiere, l) + " – " + dateLisible(a.derniere, l);
    };
    return bilingue(
      debutEn + "The " + a.n + " earlier calls (" + plage("en") + ") followed an older " +
        "method and were, almost all of them, produced after the market opened: GitHub " +
        "started the scheduled runs four to ten hours late, so the model was reading " +
        "headlines that already reported the day’s move. They are kept in the database " +
        "and in the downloadable file, but left out of every figure on this page.",
      debutFr + "Les " + a.n + " appels antérieurs (" + plage("fr") + ") suivaient une " +
        "ancienne méthode et ont presque tous été produits après l’ouverture du marché : " +
        "GitHub lançait les runs planifiés avec quatre à dix heures de retard, si bien que " +
        "le modèle lisait des titres qui rapportaient déjà le mouvement de la séance. Ils " +
        "restent dans la base et dans le fichier téléchargeable, mais aucun chiffre de " +
        "cette page n’en tient compte.");
  }

  function tableauHorizons(s) {
    var html = s.parHorizon.map(ligneHorizon).join("");
    var note = texteArchive(s);
    return html + (note ? '<p class="corr-n">' + note + "</p>" : "");
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
      verdictEn = "The correlation sits inside the detection threshold for a sample this size, so nothing is demonstrated, a value this small is what noise alone produces. The sign is still worth watching, and the fifths below show whether the tendency is orderly or scattered.";
      verdictFr = "La corrélation reste à l’intérieur du seuil de détection pour un échantillon de cette taille : rien n’est démontré, une valeur aussi faible est ce que produit le bruit seul. Le signe mérite tout de même d’être suivi, et les cinquièmes ci-dessous montrent si la tendance est ordonnée ou dispersée.";
    } else if (r > 0) {
      verdictEn = "The correlation is above the detection threshold: the score carries information about what follows. That is a statistical result, not a trading result, it says the ordering beats chance, not that the effect is large enough to act on.";
      verdictFr = "La corrélation dépasse le seuil de détection : le score porte de l’information sur ce qui suit. C’est un résultat statistique, pas un résultat de marché, il dit que le classement fait mieux que le hasard, pas que l’effet soit assez fort pour agir dessus.";
    } else {
      verdictEn = "The correlation is below the negative threshold: higher scores have systematically preceded worse returns. If it holds, the model is reading the news backwards, which is itself information, and more useful than no signal at all.";
      verdictFr = "La corrélation est sous le seuil négatif : les scores élevés ont systématiquement précédé de moins bons rendements. Si cela tient, le modèle lit les nouvelles à l’envers, ce qui est en soi une information, et plus utile qu’une absence de signal.";
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
          "Share of calls followed by a rising session. If the score were meaningless these bars would all be the same height. Bands are cut into roughly equal fifths, never through a group of identical scores, so their sizes differ slightly.",
          "Part des appels suivis d’une séance en hausse. Si le score ne voulait rien dire, ces barres seraient toutes de même hauteur. Les tranches visent des cinquièmes, mais ne coupent jamais un groupe de scores identiques, leurs tailles diffèrent donc un peu.") + "</p>" +
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

  /* Les trois échéances plus lointaines, sous l'appel du jour. Le verdict du
     jour reste la pastille en tête de ligne : c'est celui qui sera noté dès
     demain soir. Les lignes d'avant le changement n'en portent qu'un, et la
     rangée disparaît alors d'elle-même. */
  function horizonsDeLAppel(l) {
    if (regleDe(l) < 2) return "";
    var notes = l.horizon_notes || {};
    var items = HORIZONS.slice(1).map(function (h) {
      var sig = String(l[h.col] || "").toUpperCase();
      if (!sig) return "";
      var note = notes[h.cle === "t7" ? "w" : (h.cle === "t30" ? "m" : "y")];
      return '<span class="call-hz-i"' + (note ? ' title="' + echapper(note) + '"' : "") + ">" +
        '<span class="call-hz-k">' + bilingue(h.en, h.fr) + "</span>" +
        '<span class="call-sig s-' + sig.toLowerCase() + '">' + echapper(sig) + "</span></span>";
    }).join("");
    return items ? '<div class="call-hz">' + items + "</div>" : "";
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
        /* Sur les lignes à quatre verdicts, on nomme celui-ci : c'est celui
           du jour, noté dès le soir. Les anciennes lignes n'en ont qu'un. */
        (regleDe(l) >= 2 ? '<span class="call-hz-k">' + bilingue("One day", "Un jour") + "</span>" : "") +
        '<span class="call-sig s-' + sig.toLowerCase() + '">' + echapper(sig) + "</span>" +
        '<span class="call-sc">' + (l.sentiment_score === null || l.sentiment_score === undefined
          ? "" : Number(l.sentiment_score).toFixed(2)) + "</span>" +
        '<span class="call-end">' + rend + verdict + "</span>" +
        "</div>" +
        horizonsDeLAppel(l) +
        (l.rationale ? '<p class="call-why">' + echapper(l.rationale) + "</p>" : "") +
        "</div>";
    }).join("");
  }

  function csv(lignes) {
    var cols = ["prediction_date", "ticker", "scoring_rule", "sentiment_score",
      "signal", "return_t1", "correct_t1",
      "signal_w", "return_t7", "correct_t7",
      "signal_m", "return_t30", "correct_t30",
      "signal_y", "return_t252", "correct_t252"];
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

    if (s.total === 0 && !s.archive.n) {
      message(zone,
        "No data yet", "Aucune donnée pour l’instant",
        "The database returned no rows. Either the pipeline has not written anything yet, or the public read rule has not been created in Supabase.",
        "La base n’a renvoyé aucune ligne. Soit le pipeline n’a encore rien écrit, soit la règle de lecture publique n’a pas été créée dans Supabase.");
      /* Sans quoi les autres sections resteraient sur « Chargement… ». */
      ["horizons", "by-signal", "signal", "latest"].forEach(function (id) {
        var e = document.getElementById(id);
        if (e) e.innerHTML = "";
      });
      var dlVide = document.getElementById("download");
      if (dlVide) dlVide.style.display = "none";
      return;
    }

    var html = "";

    /* Bandeau de synthèse */
    if (s.total === 0) {
      /* Le nouveau relevé n'a encore aucun appel : seule l'archive existe. */
      html += '<div class="record">' +
        '<div class="record-meta">' + bilingue("New record starting", "Nouveau relevé en cours de démarrage") + "</div>" +
        '<p class="read">' + bilingue(
          "The record starts with the next call produced before the opening bell. Until then, no figure is shown rather than an unreliable one.",
          "Le relevé commence avec le prochain appel produit avant l’ouverture. D’ici là, aucun chiffre n’est affiché plutôt qu’un chiffre peu fiable.") + "</p>" +
        "</div>";
    } else {
      html += '<div class="record">' +
        '<div class="record-meta">' + entete(s) + "</div>" +
        (s.evaluees ? barres(s) :
          '<p class="read">' + bilingue(
            "Calls are recorded but none has been scored yet, scoring happens after the market closes.",
            "Des appels sont enregistrés mais aucun n’a encore été noté, la notation a lieu après la clôture des marchés.") + "</p>") +
        "</div>";
    }
    zone.innerHTML = html;

    /* Relevé par horizon */
    var zoneHorizons = document.getElementById("horizons");
    if (zoneHorizons) zoneHorizons.innerHTML = tableauHorizons(s);

    /* Détail par type d'appel */
    var parType = document.getElementById("by-signal");
    if (parType) {
      parType.innerHTML = s.evaluees ? tableauParSignal(s) :
        '<p class="read">' + bilingue("Nothing scored yet in the new record.",
                                      "Rien n’a encore été noté dans le nouveau relevé.") + "</p>";
    }

    /* Le score porte-t-il de l'information ? */
    var zoneSignal = document.getElementById("signal");
    if (zoneSignal) zoneSignal.innerHTML = blocSignal(s);

    /* Derniers appels produits */
    var recents = document.getElementById("latest");
    if (recents) {
      if (dernierJour && dernierJour.length) {
        var j = dernierJour[0].prediction_date;
        /* Tant que le nouveau relevé n'a rien produit, le dernier lot est
           un lot d'archive : on le montre, mais signalé comme tel. */
        var archiveEn = regleDe(dernierJour[0]) < 2 ? " · archive, not part of the record" : "";
        var archiveFr = regleDe(dernierJour[0]) < 2 ? " · archive, hors du relevé" : "";
        recents.innerHTML = '<div class="record-meta">' +
          bilingue("Calls of " + dateLisible(j, "en") + archiveEn,
                   "Appels du " + dateLisible(j, "fr") + archiveFr) +
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
    var p1 = interrogerAvecRepli(COLONNES_STATS, COLONNES_ANCIENNES,
      "&order=prediction_date.desc&limit=5000");

    if (surAccueil && !surResultats) {
      p1.then(function (lignes) { remplirAccueil(calculer(lignes)); })
        .catch(function (e) { if (window.console) console.warn("Brier-Labs :", e.message); });
      return;
    }

    /* Page Résultats : on ajoute le détail du dernier jour, avec les justifications */
    var p2 = interrogerAvecRepli(COLONNES_RECENTS, COLONNES_RECENTS_ANCIENNES,
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
