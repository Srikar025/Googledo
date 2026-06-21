import axios from 'axios'

// In production (Vercel), VITE_BACKEND_URL points to the Render backend.
// In development, the Vite proxy forwards /api requests to localhost:5000,
// so we fall back to an empty string (relative URLs) for dev.
const api = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL ?? '',
  withCredentials: true,
})

export default api
