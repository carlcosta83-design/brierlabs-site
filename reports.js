/* ==========================================================================
   LISTE DES RAPPORTS

   Fichier produit par l'outil « Publier un rapport ». Tu peux le modifier
   à la main, mais le plus sûr est de repasser par l'outil : il reprend
   cette liste, y ajoute le nouveau rapport et te rend le fichier complet.

   Règles :
     - date : toujours au format AAAA-MM-JJ
     - file : le chemin du PDF, quand il n'existe qu'une seule version
     - file_fr / file_en : les deux versions, quand elles existent ;
       le site sert alors celle qui correspond à la langue du visiteur
     - si une langue manque, l'autre s'affiche à la place
     - le plus récent remonte automatiquement en haut
   ========================================================================== */

const REPORTS = [
  {
    date: "2026-11-11",
    file_fr: "reports/2026-11-11-le-canada-a-t-il-la-dette-la-plus-faible-du-g7-fr.pdf",
    file_en: "reports/2026-11-11-does-canada-have-the-lowest-debt-in-the-g7-en.pdf",

    title_en: "Does Canada have the lowest debt in the G7?",
    title_fr: "Le Canada a-t-il la dette la plus faible du G7 ?",

    summary_en: "Canada is often described as the least indebted country in the G7, but it all depends on how debt is measured. This report looks at what lies behind that claim and what it really says about the strength of Canada’s public finances.",
    summary_fr: "Le Canada est souvent présenté comme le pays le moins endetté du G7, mais tout dépend de la façon dont on mesure la dette. Ce rapport examine ce qui se cache derrière ce chiffre et ce qu’il révèle vraiment sur la solidité des finances publiques canadiennes."
  },

];
