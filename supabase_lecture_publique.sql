-- ============================================================================
-- Ouvrir la table predictions en LECTURE SEULE pour le site web
-- À coller dans Supabase : SQL Editor > New query > Run
-- ============================================================================
--
-- CE QUE ÇA FAIT
--   Aujourd'hui ta table est fermée : seule la clé secrète du pipeline peut
--   y accéder. Le site web, lui, utilisera une clé « publishable » visible
--   dans le code de la page — c'est normal et voulu, elle est faite pour ça.
--   Mais sans la règle ci-dessous, cette clé ne verrait rien du tout.
--
-- CE QUE ÇA N'AUTORISE PAS
--   Uniquement « select » : lire. Personne ne pourra ajouter, modifier ni
--   supprimer une ligne depuis le site. Le pipeline continue d'écrire
--   normalement avec sa clé secrète, qui ignore ces règles.
--
-- À SAVOIR AVANT DE LANCER
--   Toutes les colonnes de la table deviennent lisibles publiquement, y
--   compris le nom du modèle utilisé et les titres de presse archivés.
--   Rien là-dedans n'est confidentiel — ce sont des analyses d'actualités
--   publiques — et c'est cohérent avec ce que le site promet. Mais autant
--   le décider en connaissance de cause.
-- ============================================================================

-- On repart propre si la règle existe déjà (permet de relancer sans erreur)
drop policy if exists "lecture publique des predictions" on predictions;

create policy "lecture publique des predictions"
  on predictions
  for select          -- lecture uniquement, jamais d'écriture
  to anon             -- le rôle utilisé par une clé publishable
  using (true);       -- toutes les lignes


-- ----------------------------------------------------------------------------
-- VÉRIFICATION — exécute cette requête après, tu dois voir une ligne
-- ----------------------------------------------------------------------------
select
    policyname  as regle,
    cmd         as operation_autorisee,
    roles       as pour_qui
from pg_policies
where tablename = 'predictions';


-- ----------------------------------------------------------------------------
-- POUR ANNULER plus tard, si tu veux refermer la table :
--   drop policy "lecture publique des predictions" on predictions;
-- ----------------------------------------------------------------------------
