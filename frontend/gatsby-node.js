/**
 * gatsby-node.js — Static page generation for products
 *
 * At build time, Gatsby calls the Cloudflare Worker API to fetch all products,
 * then generates a static HTML page for each one (SEO-optimised, blazing fast).
 *
 * Note: this file runs in plain Node.js — do NOT import from .ts files.
 * The fetch logic is inlined here directly.
 */

const path = require('path')

const API_BASE = process.env.GATSBY_API_URL || 'https://bizify.jmi.workers.dev'

async function fetchAllProducts() {
  const res = await fetch(`${API_BASE}/products?limit=1000`)
  if (!res.ok) throw new Error(`API responded with status ${res.status}`)
  const data = await res.json()
  return data.products || []
}

exports.createPages = async ({ actions, reporter }) => {
  const { createPage } = actions

  reporter.info('Fetching products from API for static generation...')

  let allProducts = []
  try {
    allProducts = await fetchAllProducts()
  } catch (err) {
    reporter.panicOnBuild('Failed to fetch products from API', err)
    return
  }

  reporter.info(`Generating ${allProducts.length} product pages...`)

  allProducts.forEach((product) => {
    createPage({
      path: `/products/${product.slug}`,
      component: path.resolve('./src/templates/ProductPage.tsx'),
      context: { product }, // passed as pageContext — no extra fetch at runtime
    })
  })

  reporter.info('Product pages created ✓')
}

exports.createSchemaCustomization = ({ actions }) => {
  const { createTypes } = actions
  createTypes(`
    type Product {
      id: ID!
      slug: String!
      name: String!
      description: String
      short_description: String
      price_cents: Int!
      compare_at_cents: Int
      images: [ProductImage]
      tags: [String]
      is_featured: Boolean
    }
    type ProductImage {
      url: String!
      alt: String
    }
  `)
}
