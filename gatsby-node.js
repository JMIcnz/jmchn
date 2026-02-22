/**
 * gatsby-node.js — Static page generation for products
 *
 * At build time, Gatsby calls the Cloudflare Worker API to fetch all products,
 * then generates a static HTML page for each one (SEO-optimised, blazing fast).
 */

const { productsApi } = require('./src/lib/api')
const path = require('path')

exports.createPages = async ({ actions, reporter }) => {
  const { createPage } = actions

  reporter.info('Fetching products from API for static generation...')

  let allProducts = []
  try {
    const { products } = await productsApi.list({ limit: 1000 })
    allProducts = products
  } catch (err) {
    reporter.panicOnBuild('Failed to fetch products from API', err)
    return
  }

  reporter.info(`Generating ${allProducts.length} product pages...`)

  allProducts.forEach((product) => {
    createPage({
      path: `/products/${product.slug}`,
      component: path.resolve('./src/templates/ProductPage.tsx'),
      context: { product },    // passed as pageContext — no extra fetch at runtime
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
