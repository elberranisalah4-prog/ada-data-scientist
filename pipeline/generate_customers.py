"""Generate a realistic French telco-style customers.csv with quality issues."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd


def build_customers(n: int = 1400, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    age = rng.integers(18, 82, n)
    genre = rng.choice(["Femme", "Homme", "Autre"], n, p=[0.49, 0.48, 0.03])
    anciennete = rng.integers(1, 73, n)
    type_contrat = rng.choice(
        ["Mensuel", "Annuel", "Biennal"], n, p=[0.56, 0.27, 0.17]
    )
    service_internet = rng.choice(["Fibre", "DSL", "Aucun"], n, p=[0.46, 0.34, 0.20])
    facture_mensuelle = np.clip(rng.normal(68, 28, n), 18.5, 165).round(2)
    moyen_paiement = rng.choice(
        ["Carte bancaire", "Prélèvement", "Virement", "Chèque électronique"],
        n,
        p=[0.38, 0.32, 0.14, 0.16],
    )
    tickets_support = rng.poisson(1.15, n)
    region = rng.choice(
        [
            "Île-de-France",
            "Auvergne-Rhône-Alpes",
            "Occitanie",
            "Nouvelle-Aquitaine",
            "Hauts-de-France",
            "Grand Est",
            "Provence-Alpes-Côte d'Azur",
        ],
        n,
    )
    offre_promo = rng.choice([0, 1], n, p=[0.72, 0.28])
    senior = (age >= 65).astype(int)
    facture_electronique = rng.choice([0, 1], n, p=[0.38, 0.62])
    dernier_contact_jours = np.clip(rng.gamma(2.2, 12, n).astype(int), 0, 120)

    jitter = rng.uniform(0.88, 1.08, n)
    facture_totale = (facture_mensuelle * anciennete * jitter).round(2)

    logit = (
        -1.85
        + 1.45 * (type_contrat == "Mensuel")
        - 0.85 * (type_contrat == "Biennal")
        + 0.75 * ((service_internet == "Fibre") & (facture_mensuelle > 85))
        + 0.32 * tickets_support
        - 0.032 * anciennete
        + 0.55 * (moyen_paiement == "Chèque électronique")
        + 0.42 * senior
        - 0.38 * offre_promo
        + 0.012 * dernier_contact_jours
        + 0.18 * facture_electronique
    )
    proba = 1 / (1 + np.exp(-logit))
    churn = np.where(rng.random(n) < proba, "Oui", "Non")

    client_id = np.array([f"C{100000 + i}" for i in range(n)])

    df = pd.DataFrame(
        {
            "client_id": client_id,
            "age": age.astype(float),
            "genre": genre,
            "anciennete_mois": anciennete,
            "facture_mensuelle": facture_mensuelle,
            "facture_totale": facture_totale,
            "type_contrat": type_contrat,
            "service_internet": service_internet,
            "moyen_paiement": moyen_paiement,
            "tickets_support": tickets_support,
            "region": region,
            "offre_promo": offre_promo,
            "senior": senior,
            "facture_electronique": facture_electronique,
            "dernier_contact_jours": dernier_contact_jours,
            "churn": churn,
        }
    )

    miss_total = rng.choice(n, size=int(n * 0.07), replace=False)
    df.loc[miss_total, "facture_totale"] = np.nan

    miss_age = rng.choice(n, size=int(n * 0.035), replace=False)
    df.loc[miss_age, "age"] = np.nan

    miss_pay = rng.choice(n, size=18, replace=False)
    df.loc[miss_pay, "moyen_paiement"] = np.nan

    outlier_idx = rng.choice(n, size=6, replace=False)
    df.loc[outlier_idx, "facture_mensuelle"] = rng.uniform(420, 680, size=6).round(2)

    dups = df.sample(8, random_state=seed)
    df = pd.concat([df, dups], ignore_index=True)
    df = df.sample(frac=1, random_state=seed).reset_index(drop=True)
    return df


def main() -> None:
    out = Path(__file__).resolve().parents[1] / "public" / "samples" / "customers.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    df = build_customers()
    df.to_csv(out, index=False)
    print(f"Wrote {out} ({len(df)} rows, {df['churn'].value_counts().to_dict()})")


if __name__ == "__main__":
    main()
