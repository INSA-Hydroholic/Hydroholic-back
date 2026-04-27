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
# 1. 接口数据模型 (Schemas)
# ==========================================
class UserFeatures(BaseModel):
    weight: float
    age: int
    activities: int

class HydrationLog(BaseModel):
    time: datetime
    amount: float

class PredictionRequest(BaseModel):
    features: UserFeatures
    logs: List[HydrationLog]

# ==========================================
# 2. 核心预处理：不规则日志转标准累积矩阵
# ==========================================
def create_cumulative_curve(logs_df: pd.DataFrame, target_hours: np.ndarray) -> np.ndarray:
    """
    第一步的美化插值：将不规则的打点记录，插值转换为标准的小时累积读数矩阵。
    """
    if logs_df.empty:
        return np.zeros(len(target_hours))
        
    # 提取时间(转换为浮点小时，如 10:30 -> 10.5) 和 饮水量
    times = logs_df['time'].dt.hour + logs_df['time'].dt.minute / 60.0
    amounts = logs_df['amount'].values
    
    # 积分：计算真实的累积水量
    cum_amounts = np.cumsum(amounts)
    
    # 补充边界点，保证插值函数在 0点和24点 都有定义
    t_points = [0.0] + times.tolist() + [24.0]
    # 0点前没喝水就是0，最后一次喝水后直到24点，累积量保持不变
    y_points = [0.0] + cum_amounts.tolist() + [cum_amounts[-1]]
    
    # 线性插值，拉出完美的整点矩阵
    return np.interp(target_hours, t_points, y_points)

from scipy.optimize import minimize

# ==========================================
# 3. 核心优化器
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
        nudge_loss = gamma * np.log1p(raw_diff_sq)
        
        return mse_loss + l2_loss + nudge_loss

    def monotonicity_constraint(w_flat):
        W = w_flat.reshape(H_plus_1, F_hours)
        y_today_pred = x_today_bias.dot(W)
        
        # 计算差分：包含 [预测第一个小时 - 历史最后一小时] 以及 [未来每小时之间的差]
        # np.diff 要求返回的数组中每一个元素都 >= 0，数学引擎就会严格在可行域内寻找解
        diffs = np.diff(y_today_pred, prepend=x_today[-1])
        return diffs 
    
    # 配置 SLSQP 的约束条件，'ineq' 代表不等式 (>= 0)
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
    # 如果历史天数比折数还少，没法做CV，直接返回一个保守的较大Alpha防过拟合
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
            
            # 偏置项 (Bias)
            X_train_bias = np.hstack([np.ones((len(X_fold_train), 1)), X_fold_train])
            X_val_bias = np.hstack([np.ones((len(X_fold_val), 1)), X_fold_val])
            
            w_init = np.zeros(H_plus_1 * F_hours)
            
            # CV 阶段的 Loss 极其纯净，只评估历史泛化能力
            def cv_loss(w_flat):
                W = w_flat.reshape(H_plus_1, F_hours)
                Y_pred = X_train_bias.dot(W)
                mse = np.mean((Y_pred - Y_fold_train) ** 2)
                l2 = alpha * np.sum(W ** 2)
                return mse + l2
            
            # 因为这里没有不等式约束，用 L-BFGS-B 跑得飞快
            res = minimize(cv_loss, w_init, method='L-BFGS-B') 
            W_fold = res.x.reshape(H_plus_1, F_hours)
            
            # 在验证集上计算纯粹的预测误差
            val_preds = X_val_bias.dot(W_fold)
            val_mse = np.mean((val_preds - Y_fold_val) ** 2)
            fold_scores.append(val_mse)
            
        avg_score = np.mean(fold_scores)
        if avg_score < best_score:
            best_score = avg_score
            best_alpha = alpha
            
    return best_alpha

# ==========================================
# 4. 主 API 路由
# ==========================================
@app.post("/predict")
def predict_hydration(request: PredictionRequest):
    try:
        # A. 基础目标计算
        target_b = (request.features.weight * 35) + (request.features.activities * 200)

        now = datetime.utcnow()
        today_date = now.date()
        current_hour = now.hour

        if not request.logs:
            return {"prediction_a": target_b, "target_b": target_b, "curve": [], "formula_version": "v4-matrix-ridge"}

        # B. 数据转为 DataFrame 处理
        df = pd.DataFrame([{"time": log.time, "amount": log.amount} for log in request.logs])
        df['date'] = df['time'].dt.date
        
        # 准备标准的时间序列轴
        past_hours = np.arange(0, current_hour + 1)  # 0 到 H
        future_hours = np.arange(current_hour + 1, 24) # H+1 到 23
        
        if len(future_hours) == 0:
            current_intake = df[df['date'] == today_date]['amount'].sum()
            return {"prediction_a": round(current_intake), "target_b": round(target_b), "current_intake": round(current_intake), "curve": [], "formula_version": "v4-matrix-ridge"}

        # C. 构建历史特征矩阵 X (上午) 和 目标矩阵 Y (下午)
        X_train_list, Y_train_list = [], []
        historical_dates = df[df['date'] < today_date]['date'].unique()
        
        for d in historical_dates:
            day_logs = df[df['date'] == d]
            full_day_curve = create_cumulative_curve(day_logs, target_hours=np.arange(24))
            X_train_list.append(full_day_curve[:current_hour + 1])
            Y_train_list.append(full_day_curve[current_hour + 1:])
            
        X_train = np.array(X_train_list)
        Y_train = np.array(Y_train_list)

        # 构建今天的特征输入 (当前累积)
        today_logs = df[df['date'] == today_date]
        x_today = create_cumulative_curve(today_logs, target_hours=past_hours)
        current_intake = x_today[-1]

        optimal_alpha = 1.0
        if len(Y_train) >= 3: # 至少有3天历史数据才跑 K折
            optimal_alpha = find_best_alpha_cv_matrix(X_train, Y_train)
            print(f"[{today_date}] Auto-tuned Alpha: {optimal_alpha}")

        # D. 核心回归计算
        # 第一次学习：自然预测 a (关闭Nudge, gamma=0)
        future_natural = optimize_matrix_ridge(X_train, Y_train, x_today, target_b, alpha=optimal_alpha, gamma=0.0)
        predicted_a = future_natural[-1]

        # 第二次学习：生成向 b 引导的平滑曲线 (开启Nudge, gamma=50)
        future_nudge = optimize_matrix_ridge(X_train, Y_train, x_today, target_b, alpha=optimal_alpha, gamma=50.0)

        # E. 组装输出结构
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