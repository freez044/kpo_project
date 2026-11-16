// Compatibility entry point for existing consumers.
export { AuthProvider, useAuth } from './services/auth';
export { ApiError, apiGet, apiRequest, authRequest } from './services/api';
export type { User } from './types/user';
