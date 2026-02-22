/**
 * CartContext.tsx — global cart state with optimistic updates
 */
import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react'
import { cartApi, CartState, CartItem } from '../lib/api'

// ─── State & Actions ─────────────────────────────────────────────────────────

type CartAction =
  | { type: 'SET'; payload: CartState }
  | { type: 'LOADING'; value: boolean }
  | { type: 'ERROR'; message: string | null }

interface CartContextValue {
  cart: CartState
  loading: boolean
  error: string | null
  addItem: (productId: string, variantId?: string, qty?: number) => Promise<void>
  updateItem: (itemId: string, qty: number) => Promise<void>
  removeItem: (itemId: string) => Promise<void>
  refresh: () => Promise<void>
}

const emptyCart: CartState = { items: [], subtotal: 0, item_count: 0 }

interface State {
  cart: CartState
  loading: boolean
  error: string | null
}

function reducer(state: State, action: CartAction): State {
  switch (action.type) {
    case 'SET':     return { ...state, cart: action.payload, error: null }
    case 'LOADING': return { ...state, loading: action.value }
    case 'ERROR':   return { ...state, error: action.message, loading: false }
    default:        return state
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    cart: emptyCart,
    loading: false,
    error: null,
  })

  const refresh = useCallback(async () => {
    dispatch({ type: 'LOADING', value: true })
    try {
      const data = await cartApi.get()
      dispatch({ type: 'SET', payload: data })
    } catch (err: any) {
      dispatch({ type: 'ERROR', message: err.message })
    } finally {
      dispatch({ type: 'LOADING', value: false })
    }
  }, [])

  // Load cart on mount
  useEffect(() => { refresh() }, [refresh])

  const addItem = useCallback(async (productId: string, variantId?: string, qty = 1) => {
    dispatch({ type: 'LOADING', value: true })
    try {
      const data = await cartApi.addItem(productId, variantId, qty)
      dispatch({ type: 'SET', payload: data })
    } catch (err: any) {
      dispatch({ type: 'ERROR', message: err.message })
    } finally {
      dispatch({ type: 'LOADING', value: false })
    }
  }, [])

  const updateItem = useCallback(async (itemId: string, qty: number) => {
    dispatch({ type: 'LOADING', value: true })
    try {
      const data = await cartApi.updateItem(itemId, qty)
      dispatch({ type: 'SET', payload: data })
    } catch (err: any) {
      dispatch({ type: 'ERROR', message: err.message })
    } finally {
      dispatch({ type: 'LOADING', value: false })
    }
  }, [])

  const removeItem = useCallback(async (itemId: string) => {
    // Optimistic update
    const optimistic: CartState = {
      ...state.cart,
      items: state.cart.items.filter((i: CartItem) => i.id !== itemId),
      item_count: state.cart.item_count - 1,
    }
    dispatch({ type: 'SET', payload: optimistic })
    try {
      const data = await cartApi.removeItem(itemId)
      dispatch({ type: 'SET', payload: data })
    } catch (err: any) {
      // Revert on error
      dispatch({ type: 'SET', payload: state.cart })
      dispatch({ type: 'ERROR', message: err.message })
    }
  }, [state.cart])

  return (
    <CartContext.Provider value={{
      cart: state.cart,
      loading: state.loading,
      error: state.error,
      addItem,
      updateItem,
      removeItem,
      refresh,
    }}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
