import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import { AppLayout } from './layouts/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { MealPlan } from './pages/MealPlan';
import { Profile } from './pages/Profile';
import { Recommendations } from './pages/Recommendations';
import { DishMenu } from './pages/DishMenu';
import { Register } from './pages/Register';
import { FoodRoulette } from './pages/FoodRoulette';

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route
              element={
              <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }>
              
              <Route index element={<Dashboard />} />
              <Route path="recommendations" element={<Recommendations />} />
              <Route path="menu" element={<DishMenu />} />
              <Route path="roulette" element={<FoodRoulette />} />
              <Route path="meal-plan" element={<MealPlan />} />
              <Route path="analysis" element={<Navigate to="/" replace />} />
              <Route path="profile" element={<Profile />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster position="top-center" richColors closeButton offset={16} />
        </AuthProvider>
      </BrowserRouter>
    </MotionConfig>);

}
