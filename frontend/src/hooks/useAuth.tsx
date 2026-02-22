/**
 * useAuth.tsx — authentication state & actions
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { authApi, User, storage } from '../lib/api'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name?: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Rehydrate session on mount
  useEffect(() => {
    const token = storage.getToken()
    if (!token) { setLoading(false); return }
    authApi.me()
      .then(setUser)
      .catch(() => storage.clearToken())
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { user, token } = await authApi.login(email, password)
    storage.setToken(token)
    setUser(user)
  }, [])

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const { user, token } = await authApi.register(email, password, name)
    storage.setToken(token)
    setUser(user)
  }, [])

  const logout = useCallback(() => {
    storage.clearToken()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
