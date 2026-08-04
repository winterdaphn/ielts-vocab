export interface User {
  username: string;
  createdAt: number;
  lastLoginAt: number;
}

export interface AuthState {
  username: string;
  password: string;  // stored locally for encryption, never sent in plain
}
