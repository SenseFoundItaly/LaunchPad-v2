import axios from 'axios';

const api = axios.create({
  baseURL: '',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API error:', error?.config?.url, error?.response?.status || error?.message);
    return Promise.reject(error);
  }
);

export default api;
