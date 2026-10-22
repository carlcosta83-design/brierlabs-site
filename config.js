/* ==========================================================================
   CONNEXION À LA BASE DE DONNÉES — à remplir une seule fois.

   Où trouver ces deux valeurs, dans Supabase :

     SUPABASE_URL
       Settings > API (ou le bouton « Connect » en haut)
       Champ « Project URL ». Ressemble à : https://xxxxxxxx.supabase.co
       SANS rien après le .co

     SUPABASE_PUBLIC_KEY
       Settings > API Keys > onglet des clés publishable et secret
       Prends celle de la section « Publishable key ».
       Elle commence par  sb_publishable_

   ⚠️  N'UTILISE JAMAIS LA CLÉ « SECRET » ICI.
       Ce fichier part en ligne et son contenu est visible par tout le monde.
       La clé publishable est conçue pour ça : elle ne peut que lire, et
       seulement ce que la règle SQL autorise.
       La clé secrète, elle, contourne toutes les protections — quelqu'un
       pourrait effacer ta base entière.
       Le site refuse de démarrer si tu colles une clé secrète par erreur.
   ========================================================================== */

const SUPABASE_URL = "https://xcbhyuzvqvxgzecjltpw.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_M5ED8Sqo_ODqDhCFZQweLg_XsYo9jFW";
