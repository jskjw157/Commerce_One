import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',fullyParallel:false,workers:1,timeout:30000,
  outputDir:'output/playwright/results',reporter:[['list'],['html',{outputFolder:'output/playwright/report',open:'never'}]],
  use:{channel:'chrome',serviceWorkers:'block',trace:'retain-on-failure'},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium',channel:'chrome'}}]
});
