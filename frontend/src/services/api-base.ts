import axios from "axios";

// Base API URL
const API_BASE_URL =
  import.meta.env.VITE_API_URL || "https://sms-backend-783m.onrender.com";
const API_TIMEOUT =
  Number((import.meta.env.VITE_API_TIMEOUT as string | undefined) ?? "") ||
  180000;

// Create axios instance
export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: API_TIMEOUT,
  withCredentials: true, 
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor (no longer needed for token, but kept for future extensions)
api.interceptors.request.use(
  (config) => {
    // Since we're using HTTP-only cookies, no need to manually add auth headers
    // The cookie will be automatically included with withCredentials: true
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response: any) => {
    return response;
  },
  (error: any) => {
    // Remove the automatic redirect on 401 - let the AuthContext handle authentication state
    // The 401 error will be passed through to the calling code to handle appropriately
    return Promise.reject(error);
  }
);

// Generic API response type
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  meta?: {
    page: number;
    limit: number;
    total: number;
  };
}

export default api;
