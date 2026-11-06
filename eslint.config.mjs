import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  {ignores:['dist/**','node_modules/**','output/**']},
  js.configs.recommended,
  ...ts.configs.recommended,
  {files:['public/**/*.js'],languageOptions:{globals:{window:'readonly',document:'readonly',location:'readonly',fetch:'readonly',URL:'readonly'}}},
  {files:['scripts/**/*.mjs'],languageOptions:{globals:{console:'readonly',globalThis:'readonly'}}},
  {files:['e2e/**/*.ts'],rules:{'no-empty-pattern':'off'}},
);
