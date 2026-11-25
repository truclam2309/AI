import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
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
import { useAuth } from './contexts/AuthContext';
import { GuestMealPlanPreview } from './pages/GuestMealPlanPreview';
import { Analysis } from './pages/Analysis';
import { FoodLog } from './pages/FoodLog';

function HomeRoute() {
  const { user, status, isGuest } = useAuth();
  if (status === 'loading') return null;
  return user || isGuest ? <Dashboard /> : <Navigate to="/login" replace />;
}

function GuestAwareMealPlan() {
  return <MealPlan />;
}

function GuestAwareProfile() {
  const { isGuest } = useAuth();
  return isGuest ? <GuestMealPlanPreview /> : <Profile />;
}

function GuestAwareAnalysis() {
  return <Analysis />;
}

function MemberOnlyFoodLog() {
  const { isGuest } = useAuth();
  const location = useLocation();
  return isGuest
    ? <Navigate to="/login" replace state={{from: location.pathname}} />
    : <FoodLog />;
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route index element={<HomeRoute />} />
              <Route path="/menu" element={<DishMenu />} />
              <Route path="/roulette" element={<FoodRoulette />} />
              <Route path="/recommendations" element={<Recommendations />} />
              <Route path="/try-plan" element={<GuestMealPlanPreview />} />
              <Route path="/meal-plan" element={<GuestAwareMealPlan />} />
              <Route path="/food-log" element={<MemberOnlyFoodLog />} />
              <Route path="/analysis" element={<GuestAwareAnalysis />} />
              <Route path="/profile" element={<GuestAwareProfile />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster position="top-center" richColors closeButton offset={16} />
        </AuthProvider>
      </BrowserRouter>
    </MotionConfig>);

}
