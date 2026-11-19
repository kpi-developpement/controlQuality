# Correctif KCQ — Contrat Orange (novembre 2026)

Ce correctif adapte la plateforme Kyntus CQ, déjà en production pour Bytel, au périmètre Orange. Il a été construit à partir de l'archive `projet_kcq.zip` déployée sur `10.10.10.50`.

Toutes les évolutions sont **additives**. Aucun champ existant n'est supprimé ni renommé, et aucune formule de notation n'est modifiée. Les données existantes restent valides sans migration.

## 1. Besoins couverts

| § | Besoin | Livré | Où |
|---|---|---|---|
| 1 | Déploiement Orange | Référentiels **Projets** et **Contrats** ; rattachement des cellules et des profils | Admin › Paramètres qualité, Panneau Admin |
| 2.1 | Taux de validation des coachings | Coachings validés / reçus | Indicateurs qualité |
| 2.2 | Taux de validation des évaluations | Nouveau bouton **« Je valide cette évaluation »** dans l'espace agent ; validées / reçues | Agent › Mes évaluations ; Indicateurs |
| 2.3 | Taux de contestation | Contestées (y compris déjà traitées) / reçues, ventilé par évaluateur, collaborateur, cellule, projet, contrat et mois | Indicateurs › Ventilation |
| 2.4 | Taux d'utilisation | Journal des connexions ; **3 dénominateurs au choix** (habilités, connectés, attendus) + taux d'adoption | Indicateurs ; paramétrage |
| 2.5 | Réalisation des coachings | **Les 3 lectures** : moyenne mensuelle, atteinte d'un objectif annuel (12 par défaut, par agent), moyenne sur 12 mois glissants | Indicateurs ; paramétrage |
| 2.6 | Couverture des évaluations | Réalisées / attendues, **par mois d'appel** ; objectifs mensuels par cellule, contrat, projet ou global | Indicateurs, Avancement CQ |
| 2.7 | Passation des quiz | Quiz actifs : finalisés, en cours, non commencés, échus (nouvelle échéance facultative) | Indicateurs ; Formations |
| 3.1 | Onglet Calibrages | Entrants et sortants, plusieurs évaluateurs sur un même appel, écart et alignement, matrice des critères divergents. Une grille marquée « Calibrage » quitte « Nouvelle évaluation » | Menu Calibrages ; Grilles › Usage |
| 3.2 | Onglet Échantillons | Sélection d'appels enregistrés ou saisie manuelle, grille, affectation, suivi (en attente, affecté, en cours, standby avec motif, finalisé), statistiques | Menu Échantillons |
| 3.3 | Échantillons en attente / standby | Indicateur dont les statuts comptés sont paramétrables | Échantillons, Indicateurs |
| 4 | Vue CQ | Réalisées, restantes, couverture, taux d'évaluation, tendance par **mois d'appel**, résultats par cellule, contrat, projet et évaluateur | Menu Avancement CQ |
| 5 | Codes de clôture et type d'évaluation | Champ dans la fiche d'évaluation (liste gérée par l'admin, saisie libre possible), colonnes dans les onglets, filtres et **tous les exports** (+ feuille « Grilles (critères) ») | Évaluations, exports |
| 6 | Projet / Contrat / Cellule sur les profils | Création, modification, import en masse, mise à jour groupée des profils existants, recopie depuis les cellules | Panneau Admin, Paramètres qualité |
| 7 | Rôles | **Supervision** créé (lecture seule, limité à sa cellule) ; Management filtré sur sa cellule ; Admin, CQ, Formateur et Pilote inchangés | — |

Les menus Calibrages, Échantillons et Indicateurs sont visibles pour Admin, CQ et Management. Avancement CQ est visible pour CQ, Admin et Supervision. Le Formateur n'a pas de nouveau menu (§7.5).

## 2. Décisions à valider par le métier (toutes paramétrables, sans redéploiement)

Ces règles se règlent dans Admin › **Paramètres qualité** › Définitions des indicateurs :

- **Taux d'utilisation** : dénominateur par défaut = utilisateurs habilités (comptes actifs). Les connexions sont enregistrées à partir de l'installation : il n'existe pas d'historique antérieur.
- **Réalisation des coachings** : lecture principale par défaut = atteinte de l'objectif annuel (12 par agent). Un coaching est « réalisé » dès qu'il est enregistré ; on peut choisir « statut clôturé » ou « validé par l'agent ».
- **Couverture** : 4 évaluations attendues par agent et par mois par défaut. Des objectifs mensuels plus précis peuvent être saisis.
- **Standby** : par défaut, « en attente ou standby » regroupe en attente + affecté non commencé + standby. Le standby porte un motif obligatoire : bloqué, attente d'information, audio indisponible ou autre.
- **Types d'évaluation** : standard, picking (créée depuis « Appels à évaluer »), échantillon, calibrage, coaching. Le calibrage est exclu des indicateurs agents et n'est pas affiché dans l'espace agent.
- **Validation des évaluations par l'agent** : activée par défaut. Elle peut être désactivée si le rôle Pilote doit rester strictement inchangé (§7.6).

## 3. Règles d'accès

| Rôle | Visibilité |
|---|---|
| Admin | Tout (inchangé) |
| CQ, Formateur | Inchangé. Peut être restreint profil par profil (périmètre « contrat » par exemple) |
| Management | Sa cellule (+ projet / contrat s'ils sont renseignés) **lorsque le contrôle d'accès est activé**. Comportement historique tant qu'il ne l'est pas |
| Supervision | Toujours sa cellule (+ cellules supplémentaires explicitement autorisées), lecture seule |
| Pilote | Ses propres données. Correctif de sécurité : un agent ne peut plus ouvrir l'évaluation d'un autre agent par son identifiant |

Le filtrage est appliqué **côté serveur**. Un profil sans cellule ne voit rien (refus par défaut). Le contrôle d'accès du Management est **désactivé à l'installation** : il s'active dans Paramètres qualité, une fois les profils complétés. L'écran indique les profils bloquants.

## 4. Installation — commandes

Prérequis : Docker Compose v2, curl, droits Docker du compte `webserver`, accès au registre npm pour les builds, environ 2 Go libres pour les sauvegardes. Les builds tournent pendant que l'application actuelle reste en service. Le remplacement des deux conteneurs provoque une courte interruption (environ 1 minute). Prévenez les utilisateurs de fermer ou d'enregistrer leurs formulaires.

### 4.1 Depuis PowerShell (PC Windows)

```powershell
scp D:\correctif_kcq_orange_2026-11.tar.gz webserver@10.10.10.50:/home/webserver/
```

### 4.2 Sur le serveur (SSH)

```bash
ssh webserver@10.10.10.50
cd /home/webserver
tar -xzf correctif_kcq_orange_2026-11.tar.gz

# 1) Contrôle seul (aucune modification)
bash correctif_kcq_orange_2026-11/installer.sh /home/webserver/projet_kcq --check
```

- « Compatible » : passer à l'étape 2.
- « différences » : **ne pas forcer**. Le serveur contient une autre version que l'archive analysée. Transmettez la liste affichée pour rapprochement.

```bash
# 2) Installation (sauvegardes automatiques + retour automatique si échec)
bash correctif_kcq_orange_2026-11/installer.sh /home/webserver/projet_kcq
```

Le script sauvegarde la base `KyntusCQ` (mongodump), les fichiers remplacés, les **fichiers de formation téléversés** (`/app/uploads`, qui n'est pas sur un volume Docker) et les anciennes images. Il applique ensuite les 61 fichiers du manifeste, construit `backend` et `frontend`, puis lance `docker compose up -d --no-deps backend frontend`. Il contrôle l'API, la nouvelle route `/api/kpi` et le frontend, exécute les tests unitaires dans le conteneur et affiche un rapport des profils.

```bash
# 3) Valeurs par défaut en base (idempotent, n'efface rien)
docker exec my-backend node scripts/migrate_orange_v1.js --apply

# 3 bis) Facultatif : rattacher les profils et cellules existants (champs vides uniquement)
docker exec my-backend node scripts/migrate_orange_v1.js --apply --default-contract=Bytel
docker exec my-backend node scripts/migrate_orange_v1.js --apply --propagate-cells
```

Sans `--apply`, le script affiche seulement ce qu'il ferait.

### 4.3 Vérifications rapides

```bash
docker ps --filter name=my- --format '{{.Names}}  {{.Status}}'
curl -s http://127.0.0.1:5000/                                   # {"message":"API KCQ opérationnelle 🚀"}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/api/kpi/summary   # 401 attendu (route présente, authentification requise)
docker logs --tail 50 my-backend
```

Ouvrez ensuite http://10.10.10.50:5173 puis faites `Ctrl+F5`.

## 5. Mise en service recommandée (ordre)

1. **Admin › Paramètres qualité** : créer les contrats (`Orange`, `Bytel`), les projets et les codes de clôture.
2. **Panneau Admin › Cellules** : rattacher chaque cellule à son projet et à son contrat.
3. **Paramètres qualité › Mise à jour des profils existants** : « Recopier projet/contrat des cellules », puis compléter les profils restants (sélection groupée).
4. Créer les profils **Supervision** (rôle Supervision + cellule).
5. **Grilles** : passer en usage « Calibrages » les grilles de calibrage, en précisant le sens d'appel entrant ou sortant.
6. Saisir les objectifs mensuels d'évaluations et valider les définitions (§2).
7. Quand le compteur « Management/Supervision sans cellule » est à 0, **activer le contrôle d'accès**.

## 6. Recette après installation

- **Parcours existants** : connexion, nouvelle évaluation, appel à évaluer (picking), modification, contestation, réévaluation CQ, coaching et validation agent, quiz, notifications, Power BI, exports Excel.
- **CQ** : Avancement CQ (changer le mois d'appel) ; Échantillons › Ajouter des appels › Évaluer › vérifier « Finalisé » ; Calibrages › Nouveau calibrage (sens obligatoire) ; filtre « Code de clôture ».
- **Management** : le tableau de bord et les évaluations ne montrent que sa cellule, une fois le contrôle activé.
- **Supervision** : lecture seule, uniquement sa cellule ; aucun bouton Modifier, Contester ou Supprimer.
- **Agent** : Mes évaluations › « Voir / valider » › valider.
- **Exports** : colonnes « Type d'évaluation », « Code de clôture », « Mois d'appel », Projet, Contrat, « Validée par l'agent » et feuille « Grilles (critères) ».

## 7. Retour arrière

L'installation affiche le chemin exact, de la forme :

```bash
bash /home/webserver/sauvegardes_kcq/orange-AAAAMMJJ-HHMMSS/retour.sh
```

Le retour restaure les fichiers et les anciennes images backend/frontend, puis recopie les fichiers téléversés. Il **ne restaure pas MongoDB** : les évaluations saisies entre-temps sont conservées, et l'ancienne version ignore simplement les nouveaux champs et collections. Si un fichier a été modifié après l'installation, le retour s'arrête (option `--force` pour l'écraser). La sauvegarde `mongo_KyntusCQ.archive.gz` reste disponible comme recours manuel.

## 8. Vérifications réalisées

- **Non-régression différentielle** : l'ancienne et la nouvelle version, sur les mêmes données historiques, renvoient les mêmes réponses pour 61 appels (listes, statistiques, scores, coachings, quiz, grilles, contestations, réévaluations, suppressions), pour chaque rôle. Seules différences : les champs ajoutés, la date de contestation désormais enregistrée, et le correctif de sécurité de l'espace agent.
- La fonction de notation a été extraite à l'identique et comparée sur 20 000 cas aléatoires : 0 écart.
- 21 tests unitaires (`node --test tests/*.test.js`), dont les 6 tests existants.
- 15 scénarios HTTP de bout en bout (environ 100 contrôles : droits, périmètres, calibrage, échantillons, validation, indicateurs).
- Parcours navigateur (Chromium) pour les 6 rôles, sur 42 écrans, sans erreur JavaScript ni appel API en échec. 13 parcours interactifs validés.
- Installateur testé (simulation Docker) : contrôle, conflit, installation, relance, échec de build, échec de démarrage avec retour automatique, retour manuel (projet identique à l'origine).

Limites : aucun test n'a été exécuté sur votre serveur, votre base réelle ni votre MySQL d'enregistrements. MongoDB a été simulée (moteur de requêtes compatible), faute de pouvoir télécharger MongoDB dans l'environnement de préparation. La recette du §6 reste indispensable.

## 9. Recommandations (non appliquées, pour ne rien modifier hors périmètre)

- Ajouter un volume Docker pour `/app/uploads` (vidéos et PDF de formation), aujourd'hui perdus à chaque recréation du conteneur. L'installateur les préserve.
- Remplacer `JWT_SECRET: your_secret_here` dans `docker-compose.yml` par un secret fort. Cela déconnecte les utilisateurs une fois.
- La route `/api/calls` (écoute des enregistrements) n'exige pas d'authentification.
- Les mois sont calculés en UTC, comme les filtres existants. L'effectif « agents actifs » est celui du jour : il n'y a pas d'historique d'effectif.
