/**
 * gatsby-config.js
 */
module.exports = {
  siteMetadata: {
    title:       'STRATUM — Modern Commerce',
    description: 'Precision-crafted apparel and accessories.',
    siteUrl:     'https://yourstore.com',
    author:      'Stratum',
  },

  plugins: [
    'gatsby-plugin-react-helmet',
    'gatsby-plugin-image',
    'gatsby-transformer-sharp',
    'gatsby-plugin-sharp',

    {
      resolve: 'gatsby-plugin-manifest',
      options: {
        name:             'Stratum',
        short_name:       'Stratum',
        start_url:        '/',
        background_color: '#0a0a0a',
        theme_color:      '#c8a96e',
        display:          'standalone',
        icon:             'src/images/icon.png',
      },
    },

    // Inline critical CSS
    {
      resolve: 'gatsby-plugin-postcss',
      options: { postCssPlugins: [] },
    },

    // Environment variables available in browser as GATSBY_*
    //{
      //resolve: 'gatsby-plugin-env-variables',
      //options: {
      //  allowList: ['GATSBY_API_URL', 'GATSBY_STRIPE_PUBLISHABLE_KEY'],
      //},
    //},
  ],
}
