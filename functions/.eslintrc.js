/* eslint-env node */
module.exports = {
  root: true,
  env: {
    es6: true,
    node: true, // 🌟 This tells ESLint that 'require' and 'module' are perfectly valid Node globals
  },
  extends: [
    "eslint:recommended",
  ],
  parserOptions: {
    ecmaVersion: 2022,
  },
  rules: {
    "no-unused-vars": "warn", // 🌟 Changes this from a hard error to a warning so it won't block deployments
    "no-undef": "error",
  },
};