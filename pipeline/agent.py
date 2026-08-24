#!/usr/bin/env python3
"""Autonomous data-science agent. Emits NDJSON events on stdout (no private CoT)."""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import traceback
import warnings
from typing import Any

warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import StratifiedKFold, KFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

try:
    from xgboost import XGBClassifier, XGBRegressor

    HAS_XGB = True
except Exception:  # pragma: no cover
    HAS_XGB = False

STAGES = [
    {"id": "data", "label": "Données", "blurb": "Profil du fichier et de la cible"},
    {"id": "cleaning", "label": "Nettoyage", "blurb": "Qualité, manquants, doublons"},
    {"id": "eda", "label": "EDA", "blurb": "Distributions, corrélations, déséquilibre"},
    {"id": "features", "label": "Features", "blurb": "Variables dérivées et encodage"},
    {"id": "ml", "label": "Machine Learning", "blurb": "Comparaison et sélection de modèles"},
    {"id": "evaluation", "label": "Évaluation", "blurb": "Hold-out, métriques, erreurs"},
    {"id": "visualization", "label": "Visualisation", "blurb": "Graphiques du run"},
    {"id": "report", "label": "Rapport", "blurb": "Synthèse actionnable"},
]

TARGET_HINTS = {
    "churn",
    "target",
    "label",
    "y",
    "class",
    "outcome",
    "survived",
    "default",
    "fraude",
    "fraud",
    "attrition",
    "resilie",
    "résilié",
}
ID_HINTS = ("id", "uuid", "index", "pk", "customer_id", "client_id", "user_id")


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(to_jsonable(payload), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def to_jsonable(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        v = float(value)
        return None if math.isnan(v) or math.isinf(v) else v
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, np.ndarray):
        return [to_jsonable(v) for v in value.tolist()]
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(v) for v in value]
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if hasattr(value, "item"):
        try:
            return to_jsonable(value.item())
        except Exception:
            pass
    return str(value)


def finding(stage: str, kind: str, title: str, detail: str) -> None:
    emit({"type": "finding", "stage": stage, "kind": kind, "title": title, "detail": detail})


def stage_start(stage_id: str, intent: str) -> None:
    emit({"type": "stage_start", "id": stage_id, "intent": intent})
    time.sleep(0.28)


def stage_complete(stage_id: str, summary: str) -> None:
    emit({"type": "stage_complete", "id": stage_id, "summary": summary})


def read_table(path: str) -> tuple[pd.DataFrame, str]:
    raw = PathRead(path)
    sample = raw[:8000]
    semi = sample.count(";")
    comma = sample.count(",")
    sep = ";" if semi > comma else ","
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            df = pd.read_csv(path, sep=sep, encoding=enc)
            if df.shape[1] == 1 and sep == "," and semi > 0:
                df = pd.read_csv(path, sep=";", encoding=enc)
                sep = ";"
            return df, sep
        except Exception:
            continue
    raise ValueError("Impossible de lire le CSV (encodage ou séparateur non reconnu).")


def PathRead(path: str) -> str:
    with open(path, "rb") as handle:
        blob = handle.read(12000)
    return blob.decode("utf-8", errors="ignore")


def guess_target(columns: list[str], specified: str | None) -> tuple[str, str]:
    if specified:
        for col in columns:
            if col == specified or col.lower() == specified.lower():
                return col, "fournie par l'utilisateur"
    lower = {c.lower(): c for c in columns}
    for hint in TARGET_HINTS:
        if hint in lower:
            return lower[hint], f"nom de colonne « {lower[hint]} » reconnu comme cible"
    last = columns[-1]
    return last, "aucune cible explicite : dernière colonne retenue par convention AutoML"


def is_id_column(name: str, series: pd.Series, n: int) -> bool:
    key = name.lower().strip()
    if key in ID_HINTS or key.endswith("_id") or key.endswith("id"):
        nunq = series.nunique(dropna=True)
        if nunq >= max(20, int(n * 0.9)):
            return True
    nunq = series.nunique(dropna=True)
    return nunq == n and n > 30


def task_kind(y: pd.Series) -> str:
    nunq = y.nunique(dropna=True)
    if pd.api.types.is_numeric_dtype(y) and nunq > 12:
        return "regression"
    return "classification"


def histogram(values: np.ndarray, bins: int = 18) -> list[dict[str, Any]]:
    values = values[np.isfinite(values)]
    if values.size == 0:
        return []
    counts, edges = np.histogram(values, bins=bins)
    out = []
    for i, count in enumerate(counts):
        out.append(
            {
                "bin": f"{edges[i]:.2f}–{edges[i + 1]:.2f}",
                "x": float((edges[i] + edges[i + 1]) / 2),
                "count": int(count),
            }
        )
    return out


def metric_name(task: str, y: pd.Series) -> tuple[str, str]:
    if task == "regression":
        return "r2", "R² (CV)"
    if y.nunique() == 2:
        return "roc_auc", "ROC-AUC (CV)"
    return "f1_macro", "F1 macro (CV)"


def build_models(task: str, n_classes: int) -> list[tuple[str, Any]]:
    if task == "classification":
        models: list[tuple[str, Any]] = [
            (
                "Régression logistique",
                Pipeline(
                    [
                        ("scale", StandardScaler(with_mean=False)),
                        (
                            "clf",
                            LogisticRegression(
                                max_iter=400,
                                class_weight="balanced",
                                solver="lbfgs",
                            ),
                        ),
                    ]
                ),
            ),
            (
                "Random Forest",
                RandomForestClassifier(
                    n_estimators=90,
                    max_depth=10,
                    min_samples_leaf=3,
                    class_weight="balanced_subsample",
                    n_jobs=2,
                    random_state=42,
                ),
            ),
        ]
        if HAS_XGB:
            xgb_params: dict[str, Any] = dict(
                n_estimators=90,
                max_depth=4,
                learning_rate=0.08,
                subsample=0.9,
                colsample_bytree=0.85,
                n_jobs=2,
                random_state=42,
                tree_method="hist",
                eval_metric="logloss",
            )
            if n_classes > 2:
                xgb_params["objective"] = "multi:softprob"
                xgb_params["num_class"] = n_classes
                xgb_params["eval_metric"] = "mlogloss"
            models.append(("XGBoost", XGBClassifier(**xgb_params)))
        return models

    models = [
        (
            "Ridge",
            Pipeline(
                [
                    ("scale", StandardScaler(with_mean=False)),
                    ("reg", Ridge(alpha=1.0)),
                ]
            ),
        ),
        (
            "Random Forest",
            RandomForestRegressor(
                n_estimators=90,
                max_depth=10,
                min_samples_leaf=3,
                n_jobs=2,
                random_state=42,
            ),
        ),
    ]
    if HAS_XGB:
        models.append(
            (
                "XGBoost",
                XGBRegressor(
                    n_estimators=90,
                    max_depth=4,
                    learning_rate=0.08,
                    subsample=0.9,
                    colsample_bytree=0.85,
                    n_jobs=2,
                    random_state=42,
                    tree_method="hist",
                ),
            )
        )
    return models


def feature_importance(name: str, model: Any, columns: list[str]) -> list[dict[str, Any]]:
    estimator = model
    if hasattr(model, "named_steps"):
        estimator = list(model.named_steps.values())[-1]
    values: np.ndarray | None = None
    if hasattr(estimator, "feature_importances_"):
        values = np.asarray(estimator.feature_importances_, dtype=float)
    elif hasattr(estimator, "coef_"):
        coef = np.asarray(estimator.coef_, dtype=float)
        values = np.abs(coef).mean(axis=0) if coef.ndim > 1 else np.abs(coef)
    if values is None or values.size != len(columns):
        return []
    order = np.argsort(values)[::-1][:12]
    return [{"feature": columns[i], "importance": float(values[i])} for i in order]


def run(csv_path: str, target_arg: str | None, filename: str) -> None:
    emit({"type": "run_start", "filename": filename, "stages": STAGES})

    # --- DATA ---
    stage_start(
        "data",
        "Lire le CSV, inventorier les colonnes et identifier la variable cible.",
    )
    df_raw, sep = read_table(csv_path)
    n_rows, n_cols = df_raw.shape
    if n_rows < 8:
        raise ValueError("Le fichier est trop petit pour un run AutoML (minimum 8 lignes).")

    sampled_note = None
    if n_rows > 12000:
        df_raw = df_raw.sample(12000, random_state=42).reset_index(drop=True)
        sampled_note = f"Échantillon de 12 000 lignes tiré parmi {n_rows} pour rester interactif."
        n_rows = len(df_raw)
        finding("data", "decision", "Échantillonnage", sampled_note)

    dtypes = {c: str(df_raw[c].dtype) for c in df_raw.columns}
    preview_cols = list(df_raw.columns)
    preview_rows = (
        df_raw.head(8)
        .astype(object)
        .where(df_raw.head(8).notna(), None)
        .to_dict(orient="records")
    )
    missing_ratio = float(df_raw.isna().mean().mean())
    target, target_why = guess_target(list(df_raw.columns), target_arg)
    if target not in df_raw.columns:
        raise ValueError(f"Cible inconnue : {target}")

    y_raw = df_raw[target]
    task = task_kind(y_raw)
    finding(
        "data",
        "observation",
        f"{n_rows} lignes × {n_cols} colonnes",
        f"Séparateur « {sep} ». {missing_ratio:.1%} de cellules vides. Types : "
        + ", ".join(f"{k} ({v})" for k, v in list(dtypes.items())[:8])
        + ("…" if len(dtypes) > 8 else ""),
    )
    finding(
        "data",
        "decision",
        f"Cible : {target} ({'classification' if task == 'classification' else 'régression'})",
        target_why
        + (
            f". {y_raw.nunique(dropna=True)} modalités."
            if task == "classification"
            else f". Variable continue, {y_raw.nunique(dropna=True)} valeurs distinctes."
        ),
    )
    if task == "classification":
        counts = y_raw.value_counts(dropna=False).head(8)
        finding(
            "data",
            "observation",
            "Répartition de la cible",
            " · ".join(f"{idx} : {int(val)}" for idx, val in counts.items()),
        )
    stage_complete(
        "data",
        f"{filename} profilé — cible {target}, tâche {task}.",
    )

    # --- CLEANING ---
    stage_start(
        "cleaning",
        "Retirer les identifiants, imputer les manquants, supprimer les doublons et borner les outliers.",
    )
    df = df_raw.copy()
    dropped: list[str] = []
    for col in list(df.columns):
        if col == target:
            continue
        if is_id_column(col, df[col], len(df)):
            df = df.drop(columns=[col])
            dropped.append(col)
            finding(
                "cleaning",
                "action",
                f"Colonne identifiant retirée : {col}",
                "Presque unique par ligne, aucun pouvoir prédictif, risque de fuite d'identifiant.",
            )
    constants = []
    for col in list(df.columns):
        if col == target:
            continue
        if df[col].nunique(dropna=True) <= 1:
            constants.append(col)
    if constants:
        df = df.drop(columns=constants)
        finding(
            "cleaning",
            "action",
            "Colonnes constantes retirées",
            ", ".join(constants),
        )
        dropped.extend(constants)

    before = len(df)
    df = df.drop_duplicates()
    n_dups = before - len(df)
    if n_dups:
        finding(
            "cleaning",
            "action",
            f"{n_dups} doublons supprimés",
            "Les doublons biaient la validation et gonflent artificiellement les scores.",
        )
    else:
        finding("cleaning", "observation", "Aucun doublon", "Chaque ligne est unique.")

    df = df.dropna(subset=[target])
    imputations: list[dict[str, Any]] = []
    missing_before = (
        df.drop(columns=[target]).isna().sum().sort_values(ascending=False)
    )
    missing_before = missing_before[missing_before > 0]
    for col, nmiss in missing_before.items():
        if pd.api.types.is_numeric_dtype(df[col]):
            val = float(df[col].median())
            method = "médiane"
            df[col] = df[col].fillna(val)
        else:
            mode = df[col].mode(dropna=True)
            val = str(mode.iloc[0]) if len(mode) else "inconnu"
            method = "mode"
            df[col] = df[col].fillna(val)
        imputations.append({"column": col, "n": int(nmiss), "method": method, "value": val})
        shown = round(val, 2) if isinstance(val, float) else val
        finding(
            "cleaning",
            "action",
            f"{int(nmiss)} manquants dans {col} → {method}",
            f"Valeur d'imputation : {shown}.",
        )
    if missing_before.empty:
        finding("cleaning", "observation", "Pas de manquants restants", "Aucune imputation nécessaire.")

    outlier_caps: list[str] = []
    for col in df.columns:
        if col == target or not pd.api.types.is_numeric_dtype(df[col]):
            continue
        q1, q3 = df[col].quantile(0.25), df[col].quantile(0.75)
        iqr = q3 - q1
        if iqr == 0:
            continue
        lo, hi = q1 - 3 * iqr, q3 + 3 * iqr
        n_out = int(((df[col] < lo) | (df[col] > hi)).sum())
        if n_out >= 3:
            df[col] = df[col].clip(lo, hi)
            outlier_caps.append(col)
            finding(
                "cleaning",
                "action",
                f"Outliers bornés dans {col}",
                f"{n_out} valeurs hors [Q1−3·IQR, Q3+3·IQR] ont été clipsées.",
            )
    stage_complete(
        "cleaning",
        f"{n_dups} doublons, {len(imputations)} imputations, {len(dropped)} colonnes retirées.",
    )

    # --- EDA ---
    stage_start(
        "eda",
        "Mesurer le déséquilibre, les corrélations et les distributions avant le modeling.",
    )
    X_eda = df.drop(columns=[target])
    numeric_cols = [c for c in X_eda.columns if pd.api.types.is_numeric_dtype(X_eda[c])]
    cat_cols = [c for c in X_eda.columns if c not in numeric_cols]

    target_dist: list[dict[str, Any]] = []
    if task == "classification":
        vc = df[target].astype(str).value_counts()
        target_dist = [{"label": str(k), "count": int(v)} for k, v in vc.items()]
        majority = vc.max() / vc.sum()
        finding(
            "eda",
            "observation",
            f"Classe majoritaire à {majority:.0%}",
            "Un score de précision naïf serait trompeur — l'AUC / F1 sera privilégié."
            if majority > 0.6
            else "Les classes sont relativement équilibrées.",
        )
    else:
        desc = df[target].describe()
        finding(
            "eda",
            "observation",
            "Cible continue",
            f"moyenne {desc['mean']:.3g}, médiane {desc['50%']:.3g}, écart-type {desc['std']:.3g}.",
        )

    corr_labels: list[str] = []
    corr_matrix: list[list[float | None]] = []
    top_corr_with_target: list[dict[str, Any]] = []
    if numeric_cols:
        corr_src = df[numeric_cols].copy()
        if task == "classification":
            y_codes, _ = pd.factorize(df[target])
            corr_src["__target__"] = y_codes
        else:
            corr_src["__target__"] = pd.to_numeric(df[target], errors="coerce")
        corr = corr_src.corr(numeric_only=True)
        show_cols = numeric_cols[:8]
        corr_labels = show_cols
        corr_matrix = [
            [None if pd.isna(corr.loc[a, b]) else float(corr.loc[a, b]) for b in show_cols]
            for a in show_cols
        ]
        if "__target__" in corr.columns:
            series = corr["__target__"].drop(labels=["__target__"], errors="ignore")
            series = series.reindex(series.abs().sort_values(ascending=False).index)
            for col, val in series.head(6).items():
                if pd.isna(val):
                    continue
                top_corr_with_target.append({"feature": str(col), "corr": float(val)})
            if top_corr_with_target:
                top = top_corr_with_target[0]
                finding(
                    "eda",
                    "observation",
                    f"Plus forte corrélation linéaire : {top['feature']}",
                    f"r = {top['corr']:.2f} avec la cible. Utile comme signal, pas comme causalité.",
                )

    numeric_summary = []
    histograms: dict[str, list[dict[str, Any]]] = {}
    for col in numeric_cols[:6]:
        s = df[col]
        numeric_summary.append(
            {
                "column": col,
                "mean": float(s.mean()),
                "std": float(s.std()) if s.std() == s.std() else 0,
                "min": float(s.min()),
                "p50": float(s.median()),
                "max": float(s.max()),
            }
        )
        histograms[col] = histogram(s.to_numpy(dtype=float))

    cat_summary = []
    for col in cat_cols[:6]:
        vc = df[col].astype(str).value_counts().head(6)
        cat_summary.append(
            {
                "column": col,
                "n_unique": int(df[col].nunique()),
                "top": [{"label": str(k), "count": int(v)} for k, v in vc.items()],
            }
        )
        finding(
            "eda",
            "observation",
            f"{col} : {df[col].nunique()} modalités",
            "Dominante : " + ", ".join(f"{k} ({v})" for k, v in vc.head(3).items()),
        )

    if not cat_cols:
        finding("eda", "observation", "Pas de catégorielles", "Toutes les features restantes sont numériques.")

    stage_complete("eda", f"{len(numeric_cols)} numériques, {len(cat_cols)} catégorielles analysées.")

    # --- FEATURES ---
    stage_start(
        "features",
        "Créer des ratios métier, transformer les skews et préparer l'encodage.",
    )
    created: list[str] = []
    if {"facture_mensuelle", "anciennete_mois"} <= set(df.columns):
        df["charges_par_mois_anciennete"] = df["facture_mensuelle"] / df["anciennete_mois"].clip(lower=1)
        created.append("charges_par_mois_anciennete")
    if {"facture_totale", "anciennete_mois"} <= set(df.columns):
        df["depense_moyenne_mensuelle"] = df["facture_totale"] / df["anciennete_mois"].clip(lower=1)
        created.append("depense_moyenne_mensuelle")
    if {"facture_totale", "facture_mensuelle"} <= set(df.columns):
        df["ratio_total_mensuel"] = df["facture_totale"] / df["facture_mensuelle"].clip(lower=1)
        created.append("ratio_total_mensuel")
    if {"tickets_support", "anciennete_mois"} <= set(df.columns):
        df["tickets_par_an"] = df["tickets_support"] * 12 / df["anciennete_mois"].clip(lower=1)
        created.append("tickets_par_an")

    for col in list(df.columns):
        if col == target or not pd.api.types.is_numeric_dtype(df[col]):
            continue
        skew = float(df[col].skew())
        if abs(skew) > 1.4 and (df[col] >= 0).all():
            new_col = f"log1p_{col}"
            df[new_col] = np.log1p(df[col])
            created.append(new_col)
            finding(
                "features",
                "action",
                f"log1p({col})",
                f"Skew = {skew:.2f} : une transformation log compacte la queue et aide les modèles linéaires.",
            )

    if created:
        finding(
            "features",
            "action",
            f"{len(created)} variables dérivées",
            ", ".join(created),
        )
    else:
        finding(
            "features",
            "decision",
            "Pas de dérivation métier évidente",
            "Les colonnes ne correspondent pas à un schéma charges/ancienneté — on conserve le jeu nettoyé.",
        )

    high_card = []
    for col in [c for c in df.columns if c != target and not pd.api.types.is_numeric_dtype(df[c])]:
        nunq = df[col].nunique()
        if nunq > 30:
            freq = df[col].astype(str).value_counts(normalize=True)
            df[f"freq_{col}"] = df[col].astype(str).map(freq).astype(float)
            df = df.drop(columns=[col])
            high_card.append(col)
            created.append(f"freq_{col}")
            finding(
                "features",
                "decision",
                f"{col} encodé en fréquence",
                f"{nunq} modalités : le one-hot exploserait la dimension.",
            )
    if not high_card and cat_cols:
        finding(
            "features",
            "decision",
            "One-hot pour les catégorielles",
            "Cardinalité raisonnable — encodage one-hot dans le pipeline sklearn, identique pour tous les modèles.",
        )

    y = df[target]
    X = df.drop(columns=[target])
    num_features = [c for c in X.columns if pd.api.types.is_numeric_dtype(X[c])]
    cat_features = [c for c in X.columns if c not in num_features]
    for col in cat_features:
        X[col] = X[col].astype(str)

    if task == "classification":
        y_enc, class_labels = pd.factorize(y.astype(str), sort=True)
        y_model = pd.Series(y_enc, index=y.index)
        classes = [str(c) for c in class_labels]
    else:
        y_model = pd.to_numeric(y, errors="coerce")
        mask = y_model.notna()
        X, y_model = X.loc[mask], y_model.loc[mask]
        classes = []

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                num_features,
            ),
            (
                "cat",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        (
                            "onehot",
                            OneHotEncoder(handle_unknown="ignore", sparse_output=True),
                        ),
                    ]
                ),
                cat_features,
            ),
        ],
        remainder="drop",
    )
    finding(
        "features",
        "observation",
        f"Matrice prête : {X.shape[1]} colonnes sources",
        f"{len(num_features)} numériques standardisées, {len(cat_features)} catégorielles one-hot.",
    )
    stage_complete(
        "features",
        f"{len(created)} features créées — {len(num_features)} num. + {len(cat_features)} cat.",
    )

    # --- ML ---
    n_classes = len(classes) if task == "classification" else 0
    scoring, scoring_label = metric_name(task, y if task == "classification" else y_model)
    candidates = [m[0] for m in build_models(task, max(n_classes, 2))]
    stage_start(
        "ml",
        f"Entraîner {', '.join(candidates)} et les comparer en validation croisée ({scoring_label}).",
    )

    stratify = y_model if task == "classification" and y_model.value_counts().min() >= 2 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y_model,
        test_size=0.2,
        random_state=42,
        stratify=stratify,
    )
    finding(
        "ml",
        "decision",
        "Split 80 / 20 stratifié" if stratify is not None else "Split 80 / 20",
        f"{len(X_train)} lignes train, {len(X_test)} lignes test. Seed 42.",
    )

    if task == "classification":
        cv = StratifiedKFold(n_splits=min(5, max(2, int(y_train.value_counts().min()))), shuffle=True, random_state=42)
        if cv.get_n_splits() < 2 or y_train.value_counts().min() < 2:
            cv = KFold(n_splits=3, shuffle=True, random_state=42)
    else:
        cv = KFold(n_splits=4, shuffle=True, random_state=42)

    pre_fit = preprocessor.fit(X_train)
    Xtr = pre_fit.transform(X_train)
    Xte = pre_fit.transform(X_test)
    try:
        feat_names = list(pre_fit.get_feature_names_out())
    except Exception:
        feat_names = [f"f{i}" for i in range(Xtr.shape[1])]
    feat_names = [n.replace("num__", "").replace("cat__", "") for n in feat_names]

    leaderboard: list[dict[str, Any]] = []
    fitted: dict[str, Any] = {}
    for name, estimator in build_models(task, max(n_classes, 2)):
        try:
            scores = cross_val_score(estimator, Xtr, y_train, cv=cv, scoring=scoring, n_jobs=1)
            estimator.fit(Xtr, y_train)
            fitted[name] = estimator
            entry = {
                "name": name,
                "cv_mean": float(np.mean(scores)),
                "cv_std": float(np.std(scores)),
                "scoring": scoring_label,
            }
            leaderboard.append(entry)
            finding(
                "ml",
                "observation",
                f"{name} : {np.mean(scores):.3f} ± {np.std(scores):.3f}",
                scoring_label,
            )
        except Exception as exc:
            finding("ml", "observation", f"{name} a échoué", str(exc))

    if not leaderboard:
        raise ValueError("Aucun modèle n'a pu être entraîné.")

    leaderboard.sort(key=lambda r: r["cv_mean"], reverse=True)
    winner = leaderboard[0]["name"]
    rationale = (
        f"{winner} obtient le meilleur {scoring_label} "
        f"({leaderboard[0]['cv_mean']:.3f} ± {leaderboard[0]['cv_std']:.3f}). "
    )
    if len(leaderboard) > 1:
        gap = leaderboard[0]["cv_mean"] - leaderboard[1]["cv_mean"]
        rationale += (
            f"Écart de {gap:.3f} avec {leaderboard[1]['name']}. "
            "Le modèle retenu sera réévalué sur le hold-out, jamais vu pendant la CV."
        )
    finding("ml", "decision", f"Modèle retenu : {winner}", rationale)
    stage_complete("ml", f"{winner} sélectionné parmi {len(leaderboard)} candidats.")

    # --- EVALUATION ---
    stage_start(
        "evaluation",
        "Mesurer le modèle retenu sur le hold-out et inspecter les erreurs.",
    )
    best = fitted[winner]
    y_pred = best.predict(Xte)
    metrics: dict[str, float] = {}
    roc: dict[str, Any] | None = None
    cm: dict[str, Any] | None = None
    pred_scatter: list[dict[str, Any]] = []

    if task == "classification":
        metrics["accuracy"] = float(accuracy_score(y_test, y_pred))
        metrics["f1_macro"] = float(f1_score(y_test, y_pred, average="macro", zero_division=0))
        metrics["precision_macro"] = float(
            precision_score(y_test, y_pred, average="macro", zero_division=0)
        )
        metrics["recall_macro"] = float(recall_score(y_test, y_pred, average="macro", zero_division=0))
        proba = None
        if hasattr(best, "predict_proba"):
            proba = best.predict_proba(Xte)
        if n_classes == 2 and proba is not None:
            try:
                metrics["roc_auc"] = float(roc_auc_score(y_test, proba[:, 1]))
                fpr, tpr, _ = roc_curve(y_test, proba[:, 1])
                roc = {
                    "fpr": [float(x) for x in fpr[:: max(1, len(fpr) // 80)]],
                    "tpr": [float(x) for x in tpr[:: max(1, len(tpr) // 80)]],
                }
            except Exception:
                pass
        labels_idx = list(range(n_classes))
        matrix = confusion_matrix(y_test, y_pred, labels=labels_idx)
        cm = {"labels": classes, "matrix": matrix.tolist()}
        finding(
            "evaluation",
            "observation",
            f"Hold-out accuracy {metrics['accuracy']:.3f} · F1 {metrics['f1_macro']:.3f}",
            (
                f"ROC-AUC {metrics['roc_auc']:.3f}. "
                if "roc_auc" in metrics
                else ""
            )
            + "Ces chiffres viennent du jeu test, pas de la CV.",
        )
        if cm and n_classes == 2:
            tn, fp, fn, tp = np.array(cm["matrix"]).ravel()
            finding(
                "evaluation",
                "observation",
                "Matrice de confusion",
                f"VP {int(tp)} · VN {int(tn)} · FP {int(fp)} · FN {int(fn)}.",
            )
    else:
        metrics["r2"] = float(r2_score(y_test, y_pred))
        metrics["mae"] = float(mean_absolute_error(y_test, y_pred))
        metrics["rmse"] = float(math.sqrt(mean_squared_error(y_test, y_pred)))
        finding(
            "evaluation",
            "observation",
            f"R² hold-out {metrics['r2']:.3f}",
            f"MAE {metrics['mae']:.3g} · RMSE {metrics['rmse']:.3g}.",
        )
        yt = np.asarray(y_test, dtype=float)
        yp = np.asarray(y_pred, dtype=float)
        take = np.linspace(0, len(yt) - 1, num=min(180, len(yt))).astype(int)
        pred_scatter = [{"actual": float(yt[i]), "pred": float(yp[i])} for i in take]

    importances = feature_importance(winner, best, feat_names)
    if importances:
        top3 = ", ".join(f"{r['feature']} ({r['importance']:.3f})" for r in importances[:3])
        finding(
            "evaluation",
            "observation",
            "Variables les plus influentes",
            top3,
        )
    stage_complete("evaluation", "Hold-out mesuré, importances extraites.")

    # --- VISUALIZATION ---
    stage_start(
        "visualization",
        "Assembler les graphiques du run : cible, corrélations, modèles, erreurs, importances.",
    )
    missing_chart = [
        {"label": r["column"], "count": r["n"]} for r in imputations
    ]
    charts = {
        "target_dist": target_dist,
        "missing": missing_chart,
        "histograms": histograms,
        "corr_labels": corr_labels,
        "corr_matrix": corr_matrix,
        "top_corr": top_corr_with_target,
        "leaderboard": leaderboard,
        "roc": roc,
        "confusion": cm,
        "importances": importances,
        "pred_scatter": pred_scatter,
        "cat_summary": cat_summary,
    }
    finding(
        "visualization",
        "action",
        "Graphiques prêts",
        "Distribution de la cible, heatmap de corrélation, comparaison des modèles, "
        + ("courbe ROC, matrice de confusion, " if task == "classification" else "prédiction vs réel, ")
        + "et importances.",
    )
    stage_complete("visualization", "8 vues prêtes pour le workbench.")

    # --- REPORT ---
    stage_start(
        "report",
        "Rédiger un rapport de data scientist : contexte, choix, métriques, recommandations.",
    )
    recs: list[str] = []
    if task == "classification" and target.lower() in {"churn", "attrition"}:
        recs.append(
            "Prioriser les clients en contrat mensuel et à fort volume de tickets : ce sont les leviers les plus lisibles."
        )
        recs.append(
            "Une offre de bascule vers un contrat annuel, ciblée sur les profils à score élevé, est le levier opérationnel le plus direct."
        )
        if any("cheque" in f["feature"].lower() or "chèque" in f["feature"].lower() for f in importances[:8]):
            recs.append(
                "Le moyen de paiement « chèque électronique » revient souvent : proposer le prélèvement réduit la friction de résiliation."
            )
    if importances:
        recs.append(
            f"Surveiller en production les dérives de {importances[0]['feature']}, variable n°1 du modèle {winner}."
        )
    recs.append(
        "Rejouer ce pipeline à chaque nouvel extrait : le modèle n'est valable que tant que le mix de clients reste comparable."
    )
    recs.append(
        "Ne pas interpréter les importances comme de la causalité : valider les leviers par un test métier (A/B ou politique ciblée)."
    )

    metric_lines = " · ".join(f"{k} {v:.3f}" for k, v in metrics.items())
    lb_lines = "\n".join(
        f"- {r['name']}: {r['cv_mean']:.3f} ± {r['cv_std']:.3f} ({r['scoring']})" for r in leaderboard
    )
    feat_lines = "\n".join(
        f"- {f}" for f in created
    ) or "- (aucune dérivation métier supplémentaire)"
    rec_md = "\n".join(f"{i}. {r}" for i, r in enumerate(recs, 1))
    report_md = f"""# Rapport — {filename}

**Tâche** : {'classification' if task == 'classification' else 'régression'} de `{target}`  
**Modèle retenu** : {winner}  
**Lignes utilisées** : {len(df)} après nettoyage ({n_dups} doublons retirés)

## Choix de l'agent

{rationale}

## Qualité des données

- Manquants imputés : {len(imputations)} colonnes
- Identifiants / constantes retirés : {', '.join(dropped) if dropped else 'aucun'}
- Outliers bornés : {', '.join(outlier_caps) if outlier_caps else 'aucun'}

## Feature engineering

{feat_lines}

## Classement des modèles (validation croisée)

{lb_lines}

## Hold-out

{metric_lines}

## Recommandations

{rec_md}
"""
    finding(
        "report",
        "decision",
        f"Conclusion : {winner}",
        rationale,
    )
    stage_complete("report", "Rapport rédigé, run terminé.")

    result = {
        "meta": {
            "filename": filename,
            "rows": int(n_rows),
            "cols": int(n_cols),
            "rows_clean": int(len(df)),
            "target": target,
            "task": task,
            "selected_model": winner,
            "scoring": scoring_label,
            "classes": classes,
        },
        "preview": {"columns": preview_cols, "rows": preview_rows},
        "cleaning": {
            "dropped": dropped,
            "duplicates": int(n_dups),
            "imputations": imputations,
            "outliers": outlier_caps,
        },
        "eda": {
            "numeric_summary": numeric_summary,
            "cat_summary": cat_summary,
            "target_dist": target_dist,
            "top_corr": top_corr_with_target,
        },
        "features": {"created": created, "numeric": num_features, "categorical": cat_features},
        "leaderboard": leaderboard,
        "metrics": metrics,
        "charts": charts,
        "recommendations": recs,
        "report_md": report_md,
        "rationale": rationale,
    }
    emit({"type": "complete", "result": result})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True)
    parser.add_argument("--target", default=None)
    parser.add_argument("--filename", default=None)
    args = parser.parse_args()
    filename = args.filename or args.csv.rsplit("/", 1)[-1]
    try:
        run(args.csv, args.target, filename)
    except Exception as exc:
        emit({"type": "error", "message": str(exc), "trace": traceback.format_exc()[-2000:]})
        sys.exit(1)


if __name__ == "__main__":
    main()
