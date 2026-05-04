import os
import joblib
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Dict, Any
import numpy as np
import pandas as pd
from datetime import datetime
from scipy.optimize import minimize
from sklearn.neighbors import NearestNeighbors
from sklearn.cluster import DBSCAN, AgglomerativeClustering
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler
from scipy.spatial import distance
from sklearn.model_selection import KFold

app = FastAPI(title="Hydroholic ML Service - Integrated Gateway")

os.makedirs("./models", exist_ok=True)
MODEL_PATH = "./models/personas_summary.joblib"
SCALER_PATH = "./models/feature_scaler.joblib"

# ==========================================
# 1. Interface Data Models (Schemas)
# ==========================================
class HydrationLog(BaseModel):
    time: datetime
    amount: float

class PredictionRequest(BaseModel):
    target_b: float
    logs: List[HydrationLog]

class ColdStartRequest(BaseModel):
    height: float
    weight: float
    age: int
    activity_level: int

class TrainingData(BaseModel):
    height: float
    weight: float
    age: int
    activity_level: int
    stable_hydration_target: float

class TrainPersonasRequest(BaseModel):
    users_data: List[TrainingData]

# ==========================================
# 2. Clustering Core Logic (Offline Training)
# ==========================================
def preprocess_data(df, feature_cols):
    X = df[feature_cols].values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    return X_scaled, scaler

def find_optimal_epsilon(X, k=4):
    neigh = NearestNeighbors(n_neighbors=k)
    nbrs = neigh.fit(X)
    distances, indices = nbrs.kneighbors(X)
    k_distances = np.sort(distances[:, k-1])
    
    n_points = len(k_distances)
    all_coords = np.vstack((range(n_points), k_distances)).T

    first_point = all_coords[0]
    last_point = all_coords[-1]
    line_vec = last_point - first_point
    mag = np.sqrt(np.sum(line_vec**2))
    n_vec = np.array([-line_vec[1]/mag, line_vec[0]/mag])
    dist_to_line = np.abs((all_coords - first_point) @ n_vec)
    
    idx_elbow = np.argmax(dist_to_line)
    return k_distances[idx_elbow]

def find_optimal_macro_clusters(X_centroids, k_min=3, k_max=15, penalty_weight=-0.01):
    scores, adjusted_scores = [], []
    actual_k_max = min(k_max, len(X_centroids) - 1)
    if actual_k_max < k_min:
        return max(1, actual_k_max)
        
    k_range = range(k_min, actual_k_max + 1)
    for k in k_range:
        hc = AgglomerativeClustering(n_clusters=k, linkage='ward')
        labels = hc.fit_predict(X_centroids)
        
        if len(set(labels)) > 1:
            score = silhouette_score(X_centroids, labels)
            adjusted_score = score - (k * penalty_weight)
            scores.append(score)
            adjusted_scores.append(adjusted_score)
        else:
            scores.append(-1)
            adjusted_scores.append(-1)
            
    best_k_idx = np.argmax(adjusted_scores)
    return k_range[best_k_idx]

def train_user_personas(df, feature_cols, target_col='stable_hydration_target'):
    X_scaled, scaler = preprocess_data(df, feature_cols)
    
    optimal_eps = find_optimal_epsilon(X_scaled, k=4)
    db = DBSCAN(eps=optimal_eps, min_samples=5, n_jobs=-1)
    df['micro_cluster'] = db.fit_predict(X_scaled)
    
    valid_clusters = df[df['micro_cluster'] != -1]
    if valid_clusters.empty:
        raise ValueError("No valid clusters found after DBSCAN (all noise).")

    micro_centroids_df = valid_clusters.groupby('micro_cluster')[feature_cols].mean().reset_index()
    X_centroids = micro_centroids_df[feature_cols].values
    micro_ids = micro_centroids_df['micro_cluster'].values

    best_k = find_optimal_macro_clusters(X_centroids)
    hc = AgglomerativeClustering(n_clusters=best_k, linkage='ward')
    macro_labels_for_centroids = hc.fit_predict(X_centroids)
    
    micro_to_macro_map = dict(zip(micro_ids, macro_labels_for_centroids))
    df['persona_id'] = df['micro_cluster'].map(micro_to_macro_map).fillna(-1).astype(int)

    personas_summary = {}
    valid_personas = df[df['persona_id'] != -1]
    
    for pid in valid_personas['persona_id'].unique():
        cluster_data = valid_personas[valid_personas['persona_id'] == pid]
        centroid_features = cluster_data[feature_cols].mean().values
        avg_target = cluster_data[target_col].mean()
        
        personas_summary[pid] = {
            'centroid_scaled': scaler.transform([centroid_features])[0],
            'recommended_target': avg_target,
            'user_count': len(cluster_data)
        }
    return personas_summary, scaler

# ==========================================
# 3. Time Series Regression Logic
# ==========================================
def create_cumulative_curve(logs_df: pd.DataFrame, target_hours: np.ndarray) -> np.ndarray:
    if logs_df.empty:
        return np.zeros(len(target_hours))
    times = logs_df['time'].dt.hour + logs_df['time'].dt.minute / 60.0
    amounts = logs_df['amount'].values
    cum_amounts = np.cumsum(amounts)
    t_points = [0.0] + times.tolist() + [24.0]
    y_points = [0.0] + cum_amounts.tolist() + [cum_amounts[-1]]
    return np.interp(target_hours, t_points, y_points)

def optimize_matrix_ridge(X_train, Y_train, x_today, target_b, alpha=1.0, gamma=50.0):
    N_days, F_hours = Y_train.shape
    H_features = X_train.shape[1]
    X_train_bias = np.hstack([np.ones((N_days, 1)), X_train])
    x_today_bias = np.append([1.0], x_today)
    H_plus_1 = H_features + 1
    w_init = np.zeros(H_plus_1 * F_hours)
    
    def loss_function(w_flat):
        W = w_flat.reshape(H_plus_1, F_hours)
        Y_pred_train = X_train_bias.dot(W)
        mse_loss = np.mean((Y_pred_train - Y_train) ** 2) if N_days > 0 else 0
        l2_loss = alpha * np.sum(W ** 2)
        y_today_pred = x_today_bias.dot(W)
        raw_diff_sq = (y_today_pred[-1] - target_b) ** 2
        nudge_loss = gamma * np.log1p(raw_diff_sq)
        return mse_loss + l2_loss + nudge_loss

    def monotonicity_constraint(w_flat):
        W = w_flat.reshape(H_plus_1, F_hours)
        y_today_pred = x_today_bias.dot(W)
        return np.diff(y_today_pred, prepend=x_today[-1])
    
    constraints = [{'type': 'ineq', 'fun': monotonicity_constraint}]
    res = minimize(loss_function, w_init, method='SLSQP', constraints=constraints)
    W_opt = res.x.reshape(H_plus_1, F_hours)
    return x_today_bias.dot(W_opt)

def find_best_alpha_cv_matrix(X_train, Y_train, alphas=[0.1, 1.0, 5.0, 10.0, 50.0], n_splits=3):
    N_days, F_hours = Y_train.shape
    if N_days < n_splits:
        return 5.0 

    kf = KFold(n_splits=n_splits, shuffle=True, random_state=42)
    best_alpha, best_score = 1.0, float('inf')
    H_features = X_train.shape[1]
    H_plus_1 = H_features + 1

    for alpha in alphas:
        fold_scores = []
        for train_index, val_index in kf.split(X_train):
            X_fold_train, X_fold_val = X_train[train_index], X_train[val_index]
            Y_fold_train, Y_fold_val = Y_train[train_index], Y_train[val_index]
            X_train_bias = np.hstack([np.ones((len(X_fold_train), 1)), X_fold_train])
            X_val_bias = np.hstack([np.ones((len(X_fold_val), 1)), X_fold_val])
            
            def cv_loss(w_flat):
                W = w_flat.reshape(H_plus_1, F_hours)
                mse = np.mean((X_train_bias.dot(W) - Y_fold_train) ** 2)
                l2 = alpha * np.sum(W ** 2)
                return mse + l2
            
            res = minimize(cv_loss, np.zeros(H_plus_1 * F_hours), method='L-BFGS-B') 
            W_fold = res.x.reshape(H_plus_1, F_hours)
            fold_scores.append(np.mean((X_val_bias.dot(W_fold) - Y_fold_val) ** 2))
            
        avg_score = np.mean(fold_scores)
        if avg_score < best_score:
            best_score, best_alpha = avg_score, alpha
            
    return best_alpha

# ==========================================
# 4. Endpoints
# ==========================================

@app.post("/predict/cold-start")
def predict_cold_start(request: ColdStartRequest):
    """
    for cold start users, find the closest persona and return its recommended target.
    """
    if not os.path.exists(MODEL_PATH) or not os.path.exists(SCALER_PATH):
        raise HTTPException(status_code=503, detail="Persona models not trained yet.")

    personas = joblib.load(MODEL_PATH)
    scaler = joblib.load(SCALER_PATH)
    
    features = [request.height, request.weight, request.age, request.activity_level]
    scaled_f = scaler.transform([features])[0]
    
    best_persona = None
    min_dist = float('inf')
    
    for pid, p_data in personas.items():
        dist = distance.euclidean(scaled_f, p_data['centroid_scaled'])
        if dist < min_dist:
            min_dist = dist
            best_persona = pid
            
    return {
        "persona_id": int(best_persona),
        "recommended_target": round(personas[best_persona]['recommended_target']),
        "confidence_score": round(1 / (1 + min_dist), 4)
    }

@app.post("/train/personas")
def trigger_persona_training(request: TrainPersonasRequest):
    """
    accepts a batch of user data for offline clustering and persona generation. This should be called periodically (e.g., weekly) with updated user data.
    """
    try:
        df = pd.DataFrame([u.dict() for u in request.users_data])
        if len(df) < 10:
            raise HTTPException(status_code=400, detail="Not enough data for meaningful clustering. Need at least 10 users.")
            
        feature_cols = ['height', 'weight', 'age', 'activity_level']
        personas, scaler = train_user_personas(df, feature_cols)
        
        joblib.dump(personas, MODEL_PATH)
        joblib.dump(scaler, SCALER_PATH)
        
        return {
            "status": "success", 
            "personas_found": len(personas),
            "message": "Model updated and saved."
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/predict")
def predict_hydration(request: PredictionRequest):
    """
    Main integrated prediction endpoint that handles both natural prediction and nudge curve generation in one pass.
     - If no logs are provided, it returns the target_b as the prediction (cold start scenario).
     - If logs are provided but no future hours remain, it returns the current intake as the prediction.
     - Otherwise, it performs the full matrix regression to predict 'a' and generate a nudge curve towards 'b'.
    """
    try:
        target_b = request.target_b
        now = datetime.utcnow()
        today_date = now.date()
        current_hour = now.hour

        if not request.logs:
            return {"prediction_a": target_b, "target_b": target_b, "curve": [], "formula_version": "v4-matrix-ridge"}

        df = pd.DataFrame([{"time": log.time, "amount": log.amount} for log in request.logs])
        df['date'] = df['time'].dt.date
        
        past_hours = np.arange(0, current_hour + 1)  
        future_hours = np.arange(current_hour + 1, 24) 
        
        if len(future_hours) == 0:
            current_intake = df[df['date'] == today_date]['amount'].sum()
            return {"prediction_a": round(current_intake), "target_b": round(target_b), "current_intake": round(current_intake), "curve": [], "formula_version": "v4-matrix-ridge"}

        X_train_list, Y_train_list = [], []
        historical_dates = df[df['date'] < today_date]['date'].unique()
        
        for d in historical_dates:
            day_logs = df[df['date'] == d]
            full_day_curve = create_cumulative_curve(day_logs, target_hours=np.arange(24))
            X_train_list.append(full_day_curve[:current_hour + 1])
            Y_train_list.append(full_day_curve[current_hour + 1:])
            
        X_train = np.array(X_train_list)
        Y_train = np.array(Y_train_list)

        today_logs = df[df['date'] == today_date]
        x_today = create_cumulative_curve(today_logs, target_hours=past_hours)
        current_intake = x_today[-1]

        optimal_alpha = 1.0
        if len(Y_train) >= 3:
            optimal_alpha = find_best_alpha_cv_matrix(X_train, Y_train)

        future_natural = optimize_matrix_ridge(X_train, Y_train, x_today, target_b, alpha=optimal_alpha, gamma=0.0)
        predicted_a = future_natural[-1]

        future_nudge = optimize_matrix_ridge(X_train, Y_train, x_today, target_b, alpha=optimal_alpha, gamma=50.0)

        nudge_curve = [
            {"hour": f"{h:02d}:00", "suggested_cumulative_ml": round(future_nudge[i])}
            for i, h in enumerate(future_hours)
        ]

        return {
            "prediction_a": round(predicted_a),
            "target_b": round(target_b),
            "current_intake": round(current_intake),
            "curve": nudge_curve,
            "formula_version": "v5-integrated-pipeline"
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Error processing ML request")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)