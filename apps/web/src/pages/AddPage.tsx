import { Navigate } from 'react-router-dom';

/** 旧路由：添加生词已并入设置 → 数据 */
export default function AddPage() {
  return <Navigate to="/settings?tab=data" replace />;
}
