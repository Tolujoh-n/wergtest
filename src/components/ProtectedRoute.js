import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Guards routes that require authentication and optionally specific roles.
 * Mirrors backend: admin routes allow admin | superAdmin; superadmin routes allow superAdmin only.
 *
 * @param {React.ReactNode} children
 * @param {string[]} [allowedRoles] - If set, user must be allowed (DB role or on-chain admin wallet).
 */
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" aria-label="Loading" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  if (allowedRoles?.length) {
    const roleOk = allowedRoles.includes(user.role);
    const adminRouteOk = allowedRoles.includes('admin') && user.canAccessAdmin;
    const superAdminRouteOk = allowedRoles.includes('superAdmin') && user.role === 'superAdmin';
    if (!roleOk && !adminRouteOk && !superAdminRouteOk) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return children;
};

export default ProtectedRoute;
