# Ada — Agent data scientist autonome

Uploadez un CSV. Ada enchaîne tout seul :

**Données → Nettoyage → EDA → Feature engineering → ML → Évaluation → Visualisation → Rapport**

Chaque étape apparaît dans un workflow : observations, actions et décisions publiques. L’agent choisit lui-même entre régression logistique, Random Forest et XGBoost (ou Ridge en régression). Les runs sont enregistrés dans **MySQL** (`runs`, `findings`, `stage_logs`).

## Prérequis

- Node.js 20+
- Python 3.11+ avec un virtualenv
- MySQL / MariaDB 10.11+

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r pipeline/requirements.txt
npm install
```

## Base MySQL

Schéma : `sql/schema.sql` (aussi appliqué au premier appel).

```bash
mysql -u root -p < sql/schema.sql
mysql -u root -e "CREATE USER 'ada'@'127.0.0.1' IDENTIFIED BY 'ada'; GRANT ALL ON ada.* TO 'ada'@'127.0.0.1';"
```

Variables d’environnement (valeurs locales par défaut) :

```
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=ada
MYSQL_PASSWORD=ada
MYSQL_DATABASE=ada
```

## Lancer

```bash
npm run dev
```

Ouvrez [http://127.0.0.1:43217](http://127.0.0.1:43217). Cliquez **Analyser customers.csv** pour un run de churn télécom, ou déposez votre propre fichier. L’historique en bas de page relit les analyses déjà stockées.

## Pipeline

Le moteur est `pipeline/agent.py` (pandas, scikit-learn, XGBoost). L’interface Next.js streame les événements NDJSON, les écrit en MySQL, et affiche :

- le workflow d’étapes
- l’aperçu des données
- les graphiques (cible, manquants, modèles, ROC, confusion, importances)
- un rapport Markdown téléchargeable
- l’historique des runs

Le jeu d’exemple `public/samples/customers.csv` contient des manquants, des doublons et des outliers volontairement.

## Limites

- CSV jusqu’à 20 Mo ; au-delà de 12 000 lignes, un échantillon est tiré.
- Pas d’authentification : la base est locale au workbench.
