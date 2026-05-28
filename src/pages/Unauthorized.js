import React from 'react';
import { Link } from 'react-router-dom';

const Unauthorized = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gray-50 dark:bg-gray-900">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Access denied</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-6 text-center max-w-md">
        You do not have permission to view this page. If you believe this is a mistake, contact support.
      </p>
      <Link
        to="/"
        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
      >
        Return home
      </Link>
    </div>
  );
};

export default Unauthorized;
