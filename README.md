# Ada — Agent data scientist autonome

Uploadez un CSV. Ada enchaîne tout seul :

**Données → Nettoyage → EDA → Feature engineering → ML → Évaluation → Visualisation → Rapport**

Chaque étape apparaît dans un workflow : observations, actions et décisions publiques. L’agent choisit lui-même entre régression logistique, Random Forest et XGBoost (ou Ridge en régression).

## Prérequis

- Node.js 20+
- Python 3.11+ avec un virtualenv

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r pipeline/requirements.txt
npm install
```

## Lancer

```bash
npm run dev
```

Ouvrez [http://127.0.0.1:43217](http://127.0.0.1:43217). Cliquez **Analyser customers.csv** pour un run de churn télécom, ou déposez votre propre fichier.

La colonne cible est auto-détectée (`churn`, `target`, `label`, …) ; vous pouvez la changer avant de lancer.

## Pipeline

Le moteur est `pipeline/agent.py` (pandas, scikit-learn, XGBoost). L’interface Next.js streame les événements NDJSON et affiche :

- le workflow d’étapes
- l’aperçu des données
- les graphiques (cible, manquants, modèles, ROC, confusion, importances)
- un rapport Markdown téléchargeable

Le jeu d’exemple `public/samples/customers.csv` contient des manquants, des doublons et des outliers volontairement.

## Limites

- CSV jusqu’à 20 Mo ; au-delà de 12 000 lignes, un échantillon est tiré.
- Pas de base de données ni d’authentification : tout se joue dans le run.
