const path = require("path");

module.exports = [
  {
    ignores: [
      "node_modules/**",
      "accounting-automation/node_modules/**",
      "wiki/messages/**",
      "wiki/summaries/**",
      "output/**",
      "uploads/**",
      "*.log"
    ]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        module: "readonly",
        require: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        exports: "readonly",
        window: "readonly",
        document: "readonly"
      }
    },
    linterOptions: {
      reportUnusedDisableDirectives: false
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-undef": "off",
      "no-control-regex": "off"
    }
  }
];
