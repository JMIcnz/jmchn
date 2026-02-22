/**
 * CartDrawer.tsx — slide-out cart with checkout CTA
 */
import React, { useState, useCallback } from 'react'
import { useCart } from '../hooks/useCart'
import { checkoutApi } from '../lib/api'

function formatPrice(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function CartDrawer({ open, onClose }: Props) {
  const { cart, updateItem, removeItem, loading } = useCart()
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

  const handleCheckout = useCallback(async () => {
    setCheckingOut(true)
    setCheckoutError(null)
    try {
      const origin = window.location.origin
      const { url } = await checkoutApi.createSession(
        `${origin}/order-success`,
        `${origin}/cart`
      )
      window.location.href = url
    } catch (err: any) {
      setCheckoutError(err.message)
      setCheckingOut(false)
    }
  }, [])

  return (
    <>
      {/* Backdrop */}
      <div
        className={`cart-backdrop ${open ? 'visible' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside className={`cart-drawer ${open ? 'open' : ''}`} aria-label="Shopping cart" role="dialog">
        <div className="cart-header">
          <h2>Cart <span className="cart-count">{cart.item_count}</span></h2>
          <button className="cart-close" onClick={onClose} aria-label="Close cart">✕</button>
        </div>

        <div className="cart-body">
          {cart.items.length === 0 ? (
            <div className="cart-empty">
              <p>Your cart is empty.</p>
              <button className="btn-secondary" onClick={onClose}>Continue Shopping</button>
            </div>
          ) : (
            <ul className="cart-items" role="list">
              {cart.items.map((item) => (
                <li key={item.id} className="cart-item">
                  {item.image && (
                    <img src={item.image} alt={item.product_name} className="cart-item-img" />
                  )}
                  <div className="cart-item-details">
                    <p className="cart-item-name">{item.product_name}</p>
                    {item.variant_name && (
                      <p className="cart-item-variant">{item.variant_name}</p>
                    )}
                    <p className="cart-item-price">{formatPrice(item.price_cents)}</p>

                    <div className="cart-item-qty">
                      <button
                        onClick={() => updateItem(item.id, Math.max(1, item.quantity - 1))}
                        disabled={loading}
                        aria-label="Decrease quantity"
                      >−</button>
                      <span>{item.quantity}</span>
                      <button
                        onClick={() => updateItem(item.id, item.quantity + 1)}
                        disabled={loading}
                        aria-label="Increase quantity"
                      >+</button>
                    </div>
                  </div>

                  <div className="cart-item-right">
                    <p className="cart-item-total">
                      {formatPrice(item.price_cents * item.quantity)}
                    </p>
                    <button
                      className="cart-item-remove"
                      onClick={() => removeItem(item.id)}
                      disabled={loading}
                      aria-label={`Remove ${item.product_name}`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {cart.items.length > 0 && (
          <div className="cart-footer">
            <div className="cart-subtotal">
              <span>Subtotal</span>
              <span>{formatPrice(cart.subtotal)}</span>
            </div>
            <p className="cart-note">Shipping and taxes calculated at checkout</p>

            {checkoutError && (
              <p className="cart-error" role="alert">{checkoutError}</p>
            )}

            <button
              className="btn-checkout"
              onClick={handleCheckout}
              disabled={checkingOut || loading}
            >
              {checkingOut ? 'Redirecting to Stripe…' : `Checkout — ${formatPrice(cart.subtotal)}`}
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
