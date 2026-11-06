import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/public',{recursive:true});
cpSync('public','dist/public',{recursive:true});
console.log('TypeScript compiled; static assets copied to dist/public.');

mkdirSync('dist/scripts',{recursive:true});
cpSync('scripts/network-guard.mjs','dist/scripts/network-guard.mjs');
