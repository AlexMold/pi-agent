/**
 * Test helper for route matching in lib/routes.js.
 * Run with: node node_modules/.bin/eslint test-router.js
 */
const { ROUTES } = require("./lib/routes");

module.exports = {
  testRoute: function (query) {
    const queryLower = query.toLowerCase();
    for (const route of ROUTES) {
      if (route.keywords) {
        for (const kw of route.keywords) {
          if (queryLower.includes(kw.toLowerCase())) {
            return route;
          }
        }
      }
    }
    return null;
  },

  getRoutes: function () {
    return ROUTES;
  }
};
