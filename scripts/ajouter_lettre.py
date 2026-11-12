"""Valide une édition de la Lettre du lundi et l'ajoute à lettres.json.

    python3 scripts/ajouter_lettre.py edition.json            ajoute l'édition
    python3 scripts/ajouter_lettre.py edition.json --remplacer remplace celle du même jour
    python3 scripts/ajouter_lettre.py --verifier              vérifie lettres.json seul

Rien n'est écrit si une seule règle est enfreinte : le script affiche toutes
les erreurs et s'arrête avec un code 1. C'est le garde-fou de la publication
automatique du lundi : une édition incomplète ne doit jamais atteindre le site.
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
FICHIER = RACINE / "lettres.json"

# Les onze fonds sectoriels SPDR : la même liste que dans lettre.js.
FONDS = {"XLE", "XLF", "XLK", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"}
DIRECTIONS = {"hausse", "baisse", "incertain"}

CLES_EDITION = {"date", "horizon", "titre_fr", "titre_en", "intro_fr", "intro_en",
                "nouvelles", "a_surveiller_fr", "a_surveiller_en", "redige_par", "pilote"}
CLES_NOUVELLE = {"titre_fr", "titre_en", "resume_fr", "resume_en", "sources", "impacts"}
CLES_IMPACT = {"etf", "direction", "raison_fr", "raison_en"}

LONGUEURS = {"titre": 140, "intro": 600, "resume": 900, "raison": 400, "surveiller": 220}


class Erreurs(list):
    def ajouter(self, ou, quoi):
        self.append(f"{ou} : {quoi}")


def date_iso(v):
    try:
        return date.fromisoformat(v) if isinstance(v, str) and len(v) == 10 else None
    except ValueError:
        return None


def texte(err, ou, obj, champ, limite):
    """Un texte obligatoire, dans les deux langues."""
    for l in ("fr", "en"):
        v = obj.get(f"{champ}_{l}")
        lieu = f"{ou}.{champ}_{l}"
        if not isinstance(v, str) or not v.strip():
            err.ajouter(lieu, "manquant ou vide")
            continue
        verifier_style(err, lieu, v, limite)


def verifier_style(err, lieu, v, limite):
    if len(v) > limite:
        err.ajouter(lieu, f"trop long ({len(v)} caractères, maximum {limite})")
    if "—" in v:
        err.ajouter(lieu, "contient un tiret long « — » : le site n'en utilise pas, "
                          "remplace-le par une virgule, deux-points ou un point")
    if re.search(r"<[a-zA-Z/!]", v):
        err.ajouter(lieu, "contient une balise HTML : écris du texte simple")


def valider_edition(e, ou="edition"):
    err = Erreurs()
    if not isinstance(e, dict):
        err.ajouter(ou, "doit être un objet")
        return err

    for k in set(e) - CLES_EDITION:
        err.ajouter(ou, f"clé inconnue « {k} » (faute de frappe ?)")

    d = date_iso(e.get("date"))
    if not d:
        err.ajouter(f"{ou}.date", "attendu au format AAAA-MM-JJ")

    h = e.get("horizon")
    if not isinstance(h, dict):
        err.ajouter(f"{ou}.horizon", "attendu : {\"du\": \"AAAA-MM-JJ\", \"au\": \"AAAA-MM-JJ\"}")
    else:
        du, au = date_iso(h.get("du")), date_iso(h.get("au"))
        if not du or not au:
            err.ajouter(f"{ou}.horizon", "du et au doivent être au format AAAA-MM-JJ")
        elif du > au:
            err.ajouter(f"{ou}.horizon", "du est après au")
        elif d and du < d:
            # Même principe que le run du matin : une prévision ne porte jamais
            # sur une période déjà entamée au moment de la publication.
            err.ajouter(f"{ou}.horizon", f"la semaine visée commence le {du}, avant la "
                                         f"publication du {d} : prévision sur une période déjà entamée")

    texte(err, ou, e, "titre", LONGUEURS["titre"])
    texte(err, ou, e, "intro", LONGUEURS["intro"])

    if not isinstance(e.get("redige_par"), str) or not e["redige_par"].strip():
        err.ajouter(f"{ou}.redige_par", "manquant (ex. « Claude (Anthropic) »)")
    if "pilote" in e and not isinstance(e["pilote"], bool):
        err.ajouter(f"{ou}.pilote", "doit valoir true ou false")

    sf, se = e.get("a_surveiller_fr", []), e.get("a_surveiller_en", [])
    if not isinstance(sf, list) or not isinstance(se, list):
        err.ajouter(f"{ou}.a_surveiller", "doivent être des listes")
    else:
        if len(sf) != len(se):
            err.ajouter(f"{ou}.a_surveiller", f"{len(sf)} élément(s) en français, {len(se)} en anglais")
        if len(sf) > 6:
            err.ajouter(f"{ou}.a_surveiller", "6 éléments au maximum")
        for i, v in enumerate(sf + se):
            if not isinstance(v, str) or not v.strip():
                err.ajouter(f"{ou}.a_surveiller[{i}]", "texte vide")
            else:
                verifier_style(err, f"{ou}.a_surveiller[{i}]", v, LONGUEURS["surveiller"])

    nv = e.get("nouvelles")
    if not isinstance(nv, list) or not (2 <= len(nv) <= 7):
        err.ajouter(f"{ou}.nouvelles", "entre 2 et 7 nouvelles attendues")
        nv = nv if isinstance(nv, list) else []

    for i, n in enumerate(nv):
        lieu = f"{ou}.nouvelles[{i}]"
        if not isinstance(n, dict):
            err.ajouter(lieu, "doit être un objet")
            continue
        for k in set(n) - CLES_NOUVELLE:
            err.ajouter(lieu, f"clé inconnue « {k} »")
        texte(err, lieu, n, "titre", LONGUEURS["titre"])
        texte(err, lieu, n, "resume", LONGUEURS["resume"])

        src = n.get("sources")
        if not isinstance(src, list) or not (1 <= len(src) <= 5):
            err.ajouter(f"{lieu}.sources", "entre 1 et 5 sources attendues : aucune nouvelle sans source")
            src = src if isinstance(src, list) else []
        for j, s in enumerate(src):
            sl = f"{lieu}.sources[{j}]"
            if not isinstance(s, dict) or set(s) != {"nom", "url"}:
                err.ajouter(sl, "attendu : {\"nom\": ..., \"url\": ...}")
                continue
            if not isinstance(s["nom"], str) or not s["nom"].strip():
                err.ajouter(sl, "nom vide")
            if not isinstance(s["url"], str) or not re.fullmatch(r"https://[^\s\"<>]+", s["url"]):
                err.ajouter(sl, "url absente ou pas en https://")

        imp = n.get("impacts")
        if not isinstance(imp, list) or not (1 <= len(imp) <= 4):
            err.ajouter(f"{lieu}.impacts", "entre 1 et 4 impacts attendus")
            imp = imp if isinstance(imp, list) else []
        vus = set()
        for j, m in enumerate(imp):
            ml = f"{lieu}.impacts[{j}]"
            if not isinstance(m, dict):
                err.ajouter(ml, "doit être un objet")
                continue
            for k in set(m) - CLES_IMPACT:
                err.ajouter(ml, f"clé inconnue « {k} »")
            if m.get("etf") not in FONDS:
                err.ajouter(f"{ml}.etf", f"« {m.get('etf')} » n'est pas l'un des onze fonds : {', '.join(sorted(FONDS))}")
            elif m["etf"] in vus:
                err.ajouter(f"{ml}.etf", f"{m['etf']} apparaît deux fois pour la même nouvelle")
            vus.add(m.get("etf"))
            if m.get("direction") not in DIRECTIONS:
                err.ajouter(f"{ml}.direction", "attendu : hausse, baisse ou incertain")
            texte(err, ml, m, "raison", LONGUEURS["raison"])
    return err


def lire_fichier():
    if not FICHIER.exists():
        return {"editions": []}
    donnees = json.loads(FICHIER.read_text(encoding="utf-8"))
    if not isinstance(donnees, dict) or not isinstance(donnees.get("editions"), list):
        raise SystemExit(f"{FICHIER.name} : la structure attendue est {{\"editions\": [...]}}")
    return donnees


def ecrire_fichier(donnees):
    donnees["editions"].sort(key=lambda e: e["date"], reverse=True)
    FICHIER.write_text(json.dumps(donnees, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def echec(err):
    print(f"REFUSÉ : {len(err)} problème(s), rien n'a été écrit.")
    for e in err:
        print("  -", e)
    raise SystemExit(1)


def main(args):
    if args == ["--verifier"]:
        donnees = lire_fichier()
        err = Erreurs()
        dates = [e.get("date") for e in donnees["editions"]]
        for d in {d for d in dates if dates.count(d) > 1}:
            err.ajouter("lettres.json", f"deux éditions datées du {d}")
        for i, e in enumerate(donnees["editions"]):
            err += valider_edition(e, f"editions[{i}]")
        if err:
            echec(err)
        print(f"OK : {len(donnees['editions'])} édition(s) valide(s).")
        return

    if not args or args[0].startswith("--"):
        raise SystemExit(__doc__)
    remplacer = "--remplacer" in args
    try:
        nouvelle = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise SystemExit(f"REFUSÉ : impossible de lire {args[0]} ({e})")

    err = valider_edition(nouvelle)
    donnees = lire_fichier()
    existantes = [e for e in donnees["editions"] if e.get("date") == nouvelle.get("date")]
    if existantes and not remplacer:
        err.ajouter("edition.date", f"une édition du {nouvelle.get('date')} existe déjà "
                                    f"(ajoute --remplacer pour la remplacer)")
    if err:
        echec(err)

    donnees["editions"] = [e for e in donnees["editions"] if e.get("date") != nouvelle["date"]]
    donnees["editions"].append(nouvelle)
    ecrire_fichier(donnees)
    n = len(nouvelle["nouvelles"])
    m = sum(len(x["impacts"]) for x in nouvelle["nouvelles"])
    print(f"OK : édition du {nouvelle['date']} {'remplacée' if existantes else 'ajoutée'} "
          f"({n} nouvelles, {m} prévisions sectorielles). "
          f"{len(donnees['editions'])} édition(s) dans lettres.json.")


if __name__ == "__main__":
    main(sys.argv[1:])
