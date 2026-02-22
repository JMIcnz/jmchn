/**
 * order-success.tsx — shown after successful Stripe Checkout
 * Reads ?session_id= from URL to display confirmation.
 */
import React, { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet'
import { Link } from 'gatsby'
import Layout from '../components/Layout'

export default function OrderSuccessPage() {
  const [sessionId, setSessionId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      setSessionId(params.get('session_id'))
    }
  }, [])

  return (
    <Layout>
      <Helmet>
        <title>Order Confirmed — STRATUM</title>
      </Helmet>

      <div style={{
        maxWidth: '640px',
        margin: '8rem auto',
        padding: '0 2rem',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '2rem' }}>✦</div>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '3rem', fontStyle: 'italic', marginBottom: '1rem' }}>
          Order Confirmed
        </h1>

        <p style={{ color: 'var(--text-muted)', lineHeight: 1.8, marginBottom: '0.5rem' }}>
          Thank you for your order. A confirmation email will be sent to you shortly.
        </p>

        {sessionId && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '3rem' }}>
            Ref: {sessionId}
          </p>
        )}

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/account/orders" style={{
            padding: '0.875rem 2rem',
            background: 'var(--gold)',
            color: 'var(--bg)',
            fontSize: '0.75rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}>
            View Orders
          </Link>
          <Link to="/products" style={{
            padding: '0.875rem 2rem',
            border: '1px solid var(--border)',
            fontSize: '0.75rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>
            Continue Shopping
          </Link>
        </div>
      </div>
    </Layout>
  )
}
