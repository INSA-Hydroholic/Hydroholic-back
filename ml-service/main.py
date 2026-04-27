from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
import numpy as np
import pandas as pd
from datetime import datetime
from scipy.optimize import minimize
from scipy.interpolate import interp1d
from sklearn.model_selection import KFold

app = FastAPI(title="Hydroholic ML Service - Matrix Cumulative Ridge")

# ==========================================
# 1. Interface Data Models (Schemas)
# ==========================================
class UserFeatures(BaseModel):
    weight: float
    age: int
    activities: int

class HydrationLog(BaseModel):
    time: datetime
    amount: float

class PredictionRequest(BaseModel):
    target_b: float
    logs: List[HydrationLog]

# ==========================================
# 2. Core Preprocessing: Converting Irregular Logs to Standard Cumulative Matrix
# ==========================================
def create_cumulative_curve(logs_df: pd.DataFrame, target_hours: np.ndarray) -> np.ndarray:
    """
    Step 1 interpolation: Converts irregular logging timestamps into a 
    standardized hourly cumulative intake matrix.
    """
    if logs_df.empty:
        return np.zeros(len(target_hours))
        
    # Extract time (convert to float hours, e.g., 10:30 -> 10.5) and water amount
    times = logs_df['time'].dt.hour + logs_df['time'].dt.minute / 60.0
    amounts = logs_df['amount'].values
    
    # Integration: Calculate the actual cumulative water volume
    cum_amounts = np.cumsum(amounts)
    
    # Supplement boundary points to ensure the interpolation function is defined at 0:00 and 24:00
    t_points = [0.0] + times.tolist() + [24.0]
    # 0 amount before the first log; after the last log until 24:00, cumulative amount remains constant
    y_points = [0.0] + cum_amounts.tolist() + [cum_amounts[-1]]
    
    # Linear interpolation to generate a clean hourly matrix
    return np.interp(target_hours, t_points, y_points)

# ==========================================
# 3. Core Optimizer
# ==========================================
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
        end_of_day_pred = y_today_pred[-1]
        raw_diff_sq = (end_of_day_pred - target_b) ** 2
        # Nudge loss helps guide the prediction toward the target goal
        nudge_loss = gamma * np.log1p(raw_diff_sq)
        
        return mse_loss + l2_loss + nudge_loss

    def monotonicity_constraint(w_flat):
        W = w_flat.reshape(H_plus_1, F_hours)
        y_today_pred = x_today_bias.dot(W)
        
        # Calculate differences: [predicted first hour - current last hour] and [differences between future hours]
        # np.diff requires every element >= 0, ensuring the cumulative curve never decreases
        diffs = np.diff(y_today_pred, prepend=x_today[-1])
        return diffs 
    
    # Configure SLSQP constraints; 'ineq' stands for inequality (>= 0)
    constraints = [{'type': 'ineq', 'fun': monotonicity_constraint}]
    res = minimize(
        loss_function, 
        w_init, 
        method='SLSQP', 
        constraints=constraints
    )
    
    W_opt = res.x.reshape(H_plus_1, F_hours)

    future_curve = x_today_bias.dot(W_opt)
    return future_curve

def find_best_alpha_cv_matrix(X_train, Y_train, alphas=[0.1, 1.0, 5.0, 10.0, 50.0], n_splits=3):
    N_days, F_hours = Y_train.shape
    # If historical days are fewer than folds, skip CV and return a conservative Alpha to prevent overfitting
    if N_days < n_splits:
        return 5.0 

    kf = KFold(n_splits=n_splits, shuffle=True, random_state=42)
    best_alpha = 1.0
    best_score = float('inf')
    H_features = X_train.shape[1]
    H_plus_1 = H_features + 1

    for alpha in alphas:
        fold_scores = []
        for train_index, val_index in kf.split(X_train):
            X_fold_train, X_fold_val = X_train[train_index], X_train[val_index]
            Y_fold_train, Y_fold_val = Y_train[train_index], Y_train[val_index]
            
            # Bias term
            X_train_bias = np.hstack([np.ones((len(X_fold_train), 1)), X_fold_train])
            X_val_bias = np.hstack([np.ones((len(X_fold_val), 1)), X_fold_val])
            
            w_init = np.zeros(H_plus_1 * F_hours)
            
            # The CV stage loss is pure, evaluating only historical generalization capability
            def cv_loss(w_flat):
                W = w_flat.reshape(H_plus_1, F_hours)
                Y_pred = X_train_bias.dot(W)
                mse = np.mean((Y_pred - Y_fold_train) ** 2)
                l2 = alpha * np.sum(W ** 2)
                return mse + l2
            
            # Since there are no inequality constraints here, L-BFGS-B is highly efficient
            res = minimize(cv_loss, w_init, method='L-BFGS-B') 
            W_fold = res.x.reshape(H_plus_1, F_hours)
            
            # Calculate pure prediction error on the validation set
            val_preds = X_val_bias.dot(W_fold)
            val_mse = np.mean((val_preds - Y_fold_val) ** 2)
            fold_scores.append(val_mse)
            
        avg_score = np.mean(fold_scores)
        if avg_score < best_score:
            best_score = avg_score
            best_alpha = alpha
            
    return best_alpha

# ==========================================
# 4. Main API Routes
# ==========================================
@app.post("/predict")
def predict_hydration(request: PredictionRequest):
    try:
        # A. Basic target calculation
        target_b = request.target_b
        now = datetime.utcnow()
        today_date = now.date()
        current_hour = now.hour

        if not request.logs:
            return {"prediction_a": target_b, "target_b": target_b, "curve": [], "formula_version": "v4-matrix-ridge"}

        # B. Convert data to DataFrame for processing
        df = pd.DataFrame([{"time": log.time, "amount": log.amount} for log in request.logs])
        df['date'] = df['time'].dt.date
        
        # Prepare standard time-series axes
        past_hours = np.arange(0, current_hour + 1)  # 0 to H
        future_hours = np.arange(current_hour + 1, 24) # H+1 to 23
        
        if len(future_hours) == 0:
            current_intake = df[df['date'] == today_date]['amount'].sum()
            return {"prediction_a": round(current_intake), "target_b": round(target_b), "current_intake": round(current_intake), "curve": [], "formula_version": "v4-matrix-ridge"}

        # C. Construct historical feature matrix X (Morning) and target matrix Y (Afternoon)
        X_train_list, Y_train_list = [], []
        historical_dates = df[df['date'] < today_date]['date'].unique()
        
        for d in historical_dates:
            day_logs = df[df['date'] == d]
            full_day_curve = create_cumulative_curve(day_logs, target_hours=np.arange(24))
            X_train_list.append(full_day_curve[:current_hour + 1])
            Y_train_list.append(full_day_curve[current_hour + 1:])
            
        X_train = np.array(X_train_list)
        Y_train = np.array(Y_train_list)

        # Construct today's feature input (Current accumulation)
        today_logs = df[df['date'] == today_date]
        x_today = create_cumulative_curve(today_logs, target_hours=past_hours)
        current_intake = x_today[-1]

        optimal_alpha = 1.0
        if len(Y_train) >= 3: # Perform K-fold only if there are at least 3 days of historical data
            optimal_alpha = find_best_alpha_cv_matrix(X_train, Y_train)
            print(f"[{today_date}] Auto-tuned Alpha: {optimal_alpha}")

        # D. Core Regression Calculation
        # First pass: Natural prediction 'a' (Nudge disabled, gamma=0)
        future_natural = optimize_matrix_ridge(X_train, Y_train, x_today, target_b, alpha=optimal_alpha, gamma=0.0)
        predicted_a = future_natural[-1]

        # Second pass: Generate a smooth curve nudged towards target 'b' (Nudge enabled, gamma=50)
        future_nudge = optimize_matrix_ridge(X_train, Y_train, x_today, target_b, alpha=optimal_alpha, gamma=50.0)

        # E. Assemble Output Structure
        nudge_curve = []
        for i, h in enumerate(future_hours):
            nudge_curve.append({
                "hour": f"{h:02d}:00",
                "suggested_cumulative_ml": round(future_nudge[i])
            })

        return {
            "prediction_a": round(predicted_a),
            "target_b": round(target_b),
            "current_intake": round(current_intake),
            "curve": nudge_curve,
            "formula_version": "v4-matrix-ridge"
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Error processing ML request")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)