import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import RequireAuth from './auth/RequireAuth';
import { TasksProvider } from './tasks/TasksContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import Calendar from './pages/Calendar';
import Assistant from './pages/Assistant';
import Analytics from './pages/Analytics';
import Profile from './pages/Profile';
import Feedback from './pages/Feedback';

// Общий каркас: боковое меню + шапка + место, куда подставляется текущая страница
function Layout() {
  return (
    // Список задач общий для всех страниц и сбрасывается при выходе из аккаунта
    <TasksProvider>
      <div className="app-shell">
        <Sidebar />
        <div className="app-main">
          <Header />
          <main className="page">
            <Outlet />
          </main>
        </div>
      </div>
    </TasksProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route path="register" element={<Register />} />

      {/* всё остальное — только для вошедшего пользователя */}
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="profile" element={<Profile />} />
          <Route path="feedback" element={<Feedback />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
