import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.neighbors import NearestNeighbors
from sklearn.cluster import DBSCAN, AgglomerativeClustering
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler
from scipy.spatial import distance

# ==========================================
# 1. Data Preprocessing (极为关键)
# ==========================================
def preprocess_data(df, feature_cols):
    print("--- 1. Preprocessing & Scaling Data ---")
    X = df[feature_cols].values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    return X_scaled, scaler

# ==========================================
# 2. Find Optimal Epsilon (沿用原代码的 Kneedle 逻辑)
# ==========================================
def find_optimal_epsilon(X, k=4):
    print(f"\n--- 2. Calculating K-distance and Knee point (k={k}) ---")
    neigh = NearestNeighbors(n_neighbors=k)
    nbrs = neigh.fit(X)
    distances, indices = nbrs.kneighbors(X)
    k_distances = np.sort(distances[:, k-1])
    
    # Kneedle Algorithm
    n_points = len(k_distances)
    all_coords = np.vstack((range(n_points), k_distances)).T

    first_point = all_coords[0]
    last_point = all_coords[-1]
    line_vec = last_point - first_point
    mag = np.sqrt(np.sum(line_vec**2))
    n_vec = np.array([-line_vec[1]/mag, line_vec[0]/mag])
    dist_to_line = np.abs((all_coords - first_point) @ n_vec)
    
    idx_elbow = np.argmax(dist_to_line)
    optimal_eps = k_distances[idx_elbow]
    
    print(f"Recommended Optimal Epsilon (eps): {optimal_eps:.5f}")
    return optimal_eps

# ==========================================
# 3. Find Optimal Macro-Cluster (沿用带惩罚的轮廓系数逻辑)
# ==========================================
def find_optimal_macro_clusters(X_centroids, k_min=3, k_max=15, penalty_weight=-0.01):
    print(f"\n--- 3. Automatically finding optimal macro clusters ---")
    scores = []
    adjusted_scores = []
    
    # 根据微簇的数量，动态调整 k_max，防止报错
    actual_k_max = min(k_max, len(X_centroids) - 1)
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
    best_k = k_range[best_k_idx]
    print(f"Optimal number of user personas k={best_k}")
    return best_k

# ==========================================
# 4. 执行两阶段聚类并提取画像质心 (Training)
# ==========================================
def train_user_personas(df, feature_cols, target_col='stable_hydration_target'):
    X_scaled, scaler = preprocess_data(df, feature_cols)
    
    # Stage 1: DBSCAN 微聚类
    optimal_eps = find_optimal_epsilon(X_scaled, k=4)
    db = DBSCAN(eps=optimal_eps, min_samples=5, n_jobs=-1)
    micro_labels = db.fit_predict(X_scaled)
    df['micro_cluster'] = micro_labels
    
    print(f"DBSCAN: Found {len(set(micro_labels)) - (1 if -1 in micro_labels else 0)} micro-groups.")

    # 提取微簇的质心 (排除噪声点 -1)
    valid_clusters = df[df['micro_cluster'] != -1]
    micro_centroids_df = valid_clusters.groupby('micro_cluster')[feature_cols].mean().reset_index()
    X_centroids = micro_centroids_df[feature_cols].values
    micro_ids = micro_centroids_df['micro_cluster'].values

    # Stage 2: 宏观聚类 (合并为大画像)
    best_k = find_optimal_macro_clusters(X_centroids)
    hc = AgglomerativeClustering(n_clusters=best_k, linkage='ward')
    macro_labels_for_centroids = hc.fit_predict(X_centroids)
    
    # 映射回原始 DataFrame
    micro_to_macro_map = dict(zip(micro_ids, macro_labels_for_centroids))
    df['persona_id'] = df['micro_cluster'].map(micro_to_macro_map).fillna(-1).astype(int)

    # 提取最终的“画像字典” (包含每个画像的中心坐标，以及平均饮水目标)
    personas_summary = {}
    valid_personas = df[df['persona_id'] != -1]
    
    for pid in valid_personas['persona_id'].unique():
        cluster_data = valid_personas[valid_personas['persona_id'] == pid]
        # 计算该群体的质心特征
        centroid_features = cluster_data[feature_cols].mean().values
        # 计算该群体最终稳定的饮水目标
        avg_target = cluster_data[target_col].mean()
        
        personas_summary[pid] = {
            'centroid_scaled': scaler.transform([centroid_features])[0], # 保存标准化后的质心用于后续计算
            'recommended_target': avg_target,
            'user_count': len(cluster_data)
        }
        
    print(f"\n--- Training Complete: Identified {len(personas_summary)} core personas ---")
    return personas_summary, scaler

# ==========================================
# 5. 在线推断：为新用户分配冷启动目标 (Online Inference)
# ==========================================
def predict_new_user_target(new_user_features, personas_summary, scaler):
    """
    new_user_features: [身高, 体重, 年龄, 运动频率...] 列表
    """
    # 1. 按照离线训练时的尺度进行标准化
    scaled_features = scaler.transform([new_user_features])[0]
    
    # 2. 寻找欧式距离最近的画像质心
    min_dist = float('inf')
    best_persona = None
    
    for pid, data in personas_summary.items():
        dist = distance.euclidean(scaled_features, data['centroid_scaled'])
        if dist < min_dist:
            min_dist = dist
            best_persona = pid
            
    # 3. 返回该画像群体稳定的饮水量作为新用户的初始目标
    recommended_water = personas_summary[best_persona]['recommended_target']
    print(f"New user assigned to Persona #{best_persona} (Distance: {min_dist:.2f}).")
    print(f"Cold-start Hydration Target: {recommended_water:.2f} ml")
    
    return recommended_water

# ==========================================
# 测试运行
# ==========================================
if __name__ == "__main__":
    # 模拟你们数据库导出的老用户数据
    data = {
        'height': np.random.normal(170, 10, 1000),
        'weight': np.random.normal(65, 12, 1000),
        'age': np.random.normal(30, 8, 1000),
        'activity_level': np.random.randint(1, 5, 1000), # 1极少运动 -> 4重度运动
        'stable_hydration_target': np.random.normal(2000, 400, 1000) # 老用户跑完 Feedback Loop 稳定后的真实指标
    }
    df_old_users = pd.DataFrame(data)
    feature_cols = ['height', 'weight', 'age', 'activity_level']
    
    # 离线过程：训练并在服务器端保存 personas_summary 和 scaler
    personas, trained_scaler = train_user_personas(df_old_users, feature_cols)
    
    # 在线过程：后端接收到新用户注册信息
    new_user_A = [185, 90, 25, 4] # 高大、重度运动年轻男性
    target_A = predict_new_user_target(new_user_A, personas, trained_scaler)