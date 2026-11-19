# Correctif KCQ du 29 septembre 2026

Ce correctif ajoute Power BI pour l’administrateur, la recherche coaching par cellule et agent, les périodes jour/semaine/mois, et les téléchargements Word/Excel de l’assistant. Il a été préparé à partir de l’archive `projet_kcq.tar` fournie. Il n’a pas été installé sur le serveur de production.

## Fonctions ajoutées

| Besoin | Fonction livrée |
| --- | --- |
| Power BI admin | Entrée « Power BI » directement sous « Panneau Admin ». Ajout, modification, suppression et sélection de plusieurs rapports. Stockage MongoDB dans une nouvelle collection `powerbireports`. |
| Page Power BI choisie | Champ facultatif `pageName` pour ouvrir la page souhaitée dans le rapport intégré. Boutons recharger et ouvrir dans Power BI. |
| Recherche coaching | Cellule, sélection d’agents avec recherche par nom, texte rapide sur agent/cellule/EPS/notes/plan d’action/commentaire agent, période et statut. Filtres combinables. |
| Coaching sans troncature à 200 lignes | Pagination côté serveur. Les compteurs sont calculés sur le périmètre filtré complet. Export admin de tous les résultats filtrés. |
| Performance de chaque agent | Vue « Performance agents » pour admin, CQ, management et formateur. Filtre cellule, un ou plusieurs agents, jour, semaine et mois. Moyenne, volumes, contestations, courbe quotidienne, tableau par agent et export Excel. |
| Espace agent | Filtres jour/semaine/mois dans le tableau de bord, les évaluations et les coachings. La jauge, les critères et les graphiques du tableau de bord utilisent tous la sélection. |
| Chatbot | Sortie automatique/texte/Word/Excel, historique des échanges, boutons de téléchargement sur chaque réponse. Fichiers `.docx` et `.xlsx` réels, créés dans le navigateur. |

La semaine va du lundi au dimanche. La sélection « mois » inclut toute l’année et le mois choisis. Les dates de début et fin sont calculées selon le fuseau du navigateur puis envoyées comme instants ISO au serveur.

Les coachings sont filtrés sur leur date de création. La nouvelle vue Performance agents utilise la date de création des évaluations, comme les listes serveur existantes. Dans l’espace pilote, la date de référence antérieure est conservée : date d’écoute, puis interaction, appel, ou création. Ces références sont indiquées à l’écran.

Les filtres anciens de coaching `dateFrom/dateTo`, appliqués à l’évaluation liée, restent disponibles. Les nouvelles dates de coaching utilisent des paramètres distincts. Les formules de notation existantes, grilles, contestations, validations et notifications sont conservées.

## Installation ciblée sur le serveur existant

Utiliser le petit correctif `correctif_kcq_powerbi_coaching_exports.tar.gz` pour la production. Il ne contient ni `.env`, ni mot de passe, ni données métier. Il remplace uniquement les fichiers répertoriés dans son manifeste. Le projet complet mis à jour est aussi fourni dans `projet_kcq.tar`, mais il n’est pas nécessaire de remplacer tout le dossier du serveur.

Prévoir Python 3.9 ou supérieur, Docker Compose v2, curl, les droits Docker habituels du compte `webserver` et l’accès au registre npm pour construire les images. Fermer ou enregistrer les formulaires ouverts avant le redémarrage. Les builds s’effectuent pendant que l’ancienne application fonctionne ; le remplacement des deux conteneurs occasionne une courte interruption.

### 1. Depuis PowerShell sur le PC Windows

Télécharger le correctif dans `D:\`, puis :

```powershell
scp D:\correctif_kcq_powerbi_coaching_exports.tar.gz webserver@10.10.10.50:/home/webserver/
```

### 2. Depuis la session SSH du serveur

```bash
cd /home/webserver
tar -xzf correctif_kcq_powerbi_coaching_exports.tar.gz
bash correctif_kcq_2026-09-29/installer.sh /home/webserver/projet_kcq --check
```

Le contrôle compare les empreintes des fichiers du serveur à celles de l’archive analysée. Si une différence est signalée, il s’arrête sans modification : ne pas forcer l’installation, car le serveur contient une autre version à rapprocher du correctif.

Si le contrôle est compatible :

```bash
bash /home/webserver/correctif_kcq_2026-09-29/installer.sh /home/webserver/projet_kcq
```

Le script :

1. Vérifie le contenu du correctif et le dossier Compose des deux conteneurs.
2. Sauvegarde la base `KyntusCQ` avec `mongodump`, les fichiers remplacés et les anciennes images.
3. Applique les fichiers du correctif.
4. Construit uniquement les services `backend` et `frontend`.
5. Lance `docker compose up -d --no-deps backend frontend` et vérifie les réponses HTTP.
6. Affiche l’emplacement précis du script de retour arrière.

Les fichiers `.env`, `docker-compose.yml`, les ports, les volumes MongoDB et les autres projets Docker ne sont pas modifiés. Aucun `docker compose down`, nettoyage de volumes ou restauration de base n’est lancé. Si la construction échoue, les fichiers sont restaurés et les anciens conteneurs restent en place. Si le démarrage ou les contrôles HTTP échouent, le script relance les anciennes images.

### 3. Vérification après installation

Ouvrir [http://10.10.10.50:5173](http://10.10.10.50:5173), puis `Ctrl+F5`.

- Admin : vérifier que « Power BI » apparaît sous « Panneau Admin ». Enregistrer un rapport test autorisé, sélectionner une page et le recharger.
- Coaching : combiner cellule, agent et semaine ; tester aussi une sélection sans résultat, puis réinitialiser les dates. Vérifier une deuxième page si plus de 50 résultats.
- Performance agents : choisir un agent et comparer un jour, une semaine et un mois. Contrôler les compteurs et le fichier exporté.
- Pilote : filtrer le tableau de bord et les évaluations, consulter un coaching et vérifier la validation existante.
- Assistant : demander un document Word puis un tableau Excel ; cliquer sur le téléchargement correspondant. Ouvrir les fichiers dans Word/Excel.
- Parcours existants : connexion, création d’évaluation, contestation, validation de coaching, notifications et accès aux appels selon le rôle.

## Clé IA après un redémarrage

Dans le code d’origine, une clé saisie dans « Santé > Configuration API » est conservée dans la mémoire du processus. Si elle n’est pas aussi fournie par l’environnement du backend, elle est perdue lors de son redémarrage. Disposer de cette clé avant l’installation et la ressaisir dans cette interface si nécessaire. Le correctif ne change pas le stockage des clés ni les connexions picking.

L’assistant utilise le service OpenRouter déjà présent. Une clé valide, une connectivité sortante et la disponibilité du fournisseur restent nécessaires pour obtenir une nouvelle réponse. Les téléchargements de réponses déjà affichées sont ensuite fabriqués localement. Une réponse signalée comme tronquée par le fournisseur est refusée plutôt qu’exportée comme document complet.

L’assistant n’avait pas de connexion directe aux données métier dans la version fournie. Ce correctif n’en crée pas : fournir les chiffres dans la conversation pour un rapport personnalisé. Pour les performances réelles, utiliser l’export Excel de la vue Performance agents. Les données fictives ne sont pas présentées comme des chiffres de production.

## Utiliser Power BI

Dans Power BI, choisir **Fichier > Incorporer le rapport > Site web ou portail**, puis copier le lien `https://app.powerbi.com/reportEmbed?...` dans le formulaire.

Le champ de page attend l’identifiant technique `pageName`, par exemple `ReportSection…`, et non le libellé affiché de l’onglet. Si le lien contient déjà `pageName`, il est conservé. Pour l’enlever, retirer aussi ce paramètre du lien lors de la modification.

Les liens publics existants `https://app.powerbi.com/view?r=...` sont également acceptés. « Publier sur le web » rend le rapport public ; préférer l’intégration sécurisée pour les données internes. L’application ne donne pas de droits Microsoft supplémentaires : chaque lecteur doit avoir les autorisations/licences requises. En cas de demande de connexion, utiliser « Ouvrir dans Power BI », se connecter puis recharger. Le choix d’une page ne constitue pas une restriction d’accès aux autres pages du rapport.

Référence Microsoft : [Intégrer un rapport dans un portail sécurisé](https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-embed-secure).

## Retour arrière

Le script affiche un chemin de la forme :

```bash
bash /home/webserver/sauvegardes_kcq/AAAAMMJJ-HHMMSS/retour.sh
```

Exécuter **le chemin exact affiché à l’installation**. Le retour restaure seulement les fichiers du correctif et les anciennes images frontend/backend. Il ne restaure pas MongoDB : les évaluations et coachings créés entre-temps sont donc conservés. La collection Power BI peut rester en base, sans être utilisée par l’ancienne application.

Si un fichier a été modifié après l’installation, le retour automatique s’arrête pour ne pas écraser cette modification. La sauvegarde de MongoDB est conservée comme recours manuel ; aucune restauration de données n’est nécessaire pour retirer ce correctif.

## Vérifications réalisées et limites

- Compilation de production Vite réussie. Avertissements de taille de bundle non bloquants.
- Six tests unitaires de validation des URL Power BI et bornes de dates réussis.
- Cinquante contrôles de routes HTTP réussis : authentification et rôles, filtres combinés, pagination, historique IA, validation des entrées et réponse tronquée. Express, JWT et le casting Mongoose sont exécutés ; la base et le fournisseur IA sont simulés.
- Parcours Chromium réussis pour admin, CQ, management, formateur et pilote : création/affichage Power BI, filtres, deuxième page de coachings, recalcul des performances, téléchargements Word/Excel et historique de conversation. Données et services externes simulés ; aucune erreur JavaScript non interceptée observée.
- Fichiers téléchargés depuis le navigateur contrôlés : archives ZIP et XML valides. Tables Excel, nombres, identifiants avec zéros initiaux, cellules contenant `=1+1` conservées comme texte, et réponses sans tableau vérifiés. Exemple Word rendu et contrôlé visuellement.
- Bornes de semaine à cheval sur deux années, mois de février bissextile et changement d’heure vérifiés.

Aucun test n’a été exécuté sur votre serveur, votre base de production, un vrai rapport Microsoft ou votre clé OpenRouter. Un démarrage MongoDB local n’était pas possible dans cet environnement ; les vérifications de base restent simulées. La recette ci-dessus est nécessaire après installation. L’absence totale de régression en production ne peut pas être garantie à partir de l’archive seule.
