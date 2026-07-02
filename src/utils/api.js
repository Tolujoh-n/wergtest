import axios from 'axios';

// const API_BASE_URL = 'http://localhost:5000/api';

const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === 'development'
    ? 'http://localhost:5000/api'
    : 'https://server.wergame.io/api');

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Add token to requests if available and handle FormData
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // If data is FormData, let axios set Content-Type automatically (with boundary)
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default api;

const RESOLVE_REQUEST_TIMEOUT_MS = 180000;
const RESOLVE_MAX_ATTEMPTS = 4;

function isRetryableResolveError(err) {
  if (!err) return false;
  if (!err.response) return true;
  const status = err.response.status;
  return status === 502 || status === 503 || status === 504 || status === 408;
}

/** Admin resolve can be slow; retry on proxy/network blips after on-chain resolve succeeds. */
export async function postAdminResolveWithRetry(path, body) {
  let lastError;
  for (let attempt = 0; attempt < RESOLVE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await api.post(path, body, { timeout: RESOLVE_REQUEST_TIMEOUT_MS });
    } catch (err) {
      lastError = err;
      if (!isRetryableResolveError(err) || attempt === RESOLVE_MAX_ATTEMPTS - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }
  throw lastError;
}
