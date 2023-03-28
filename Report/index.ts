import { AzureFunction, Context, HttpRequest } from '@azure/functions';

import { checkParams } from '../utils/checkParams.js';
import { analyzeServiceWorker, AnalyzeServiceWorkerResponce } from '../utils/analyzeServiceWorker.js';
import { Report } from './type.js';

import { dirname } from 'path';
import { fileURLToPath } from 'url';
import childProcess from 'child_process';
import util from 'util';
const exec = util.promisify(childProcess.exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

import puppeteer from 'puppeteer';
import { getManifestByLink } from '../utils/getManifestByLink.js';
const browserFetcher = puppeteer.createBrowserFetcher();
const localRevisions = await browserFetcher.localRevisions();
const firstRevision = localRevisions?.length? browserFetcher.revisionInfo(localRevisions[0]) : null;


const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {

  const checkResult = checkParams(req, ['site']);
  if (checkResult.status !== 200){
    context.res = checkResult;
    context.log.error(`Report: ${checkResult.body?.error.message}`);
    return;
  }
  
  context.log.info(
    `Report: function is processing a request for site: ${req.query.site}`
  );

  const url = req.query.site as string;
  const desktop = req.query.desktop == 'true'? true : undefined;

  try {
    const webAppReport = await audit(url, desktop);
    if (!webAppReport)
      throw new Error('Lighthouse audit failed');

    context.res = {
      status: 200,
      body: {
        data: webAppReport,
      },
    };

    context.log.info(
      `Report: function is DONE processing a request for site: ${req.query.site}`
    );
    
  } catch (error: any) {
    context.res = {
      status: 500,
      body: {
        error: error?.toString?.() || error,
      },
    };

    if (error.name && error.name.indexOf('TimeoutError') > -1) {
      context.log.error(
        `Report: function TIMED OUT processing a request for site: ${url}`
      );
    } else {
      context.log.error(
        `Report: function failed for ${url} with the following error: ${error}`
      );
    }
  }
};

const audit = async (url: string, desktop?: boolean): Promise<Report|null> => {

  const onlyAudits = `--only-audits=${[
    'service-worker',
    'installable-manifest',
    'is-on-https',
    'maskable-icon',
    // 'apple-touch-icon',
    'splash-screen',
    'themed-omnibox', 
    'viewport'
  ].join(',')}`;

  // adding puppeter's like flags https://github.com/puppeteer/puppeteer/blob/main/packages/puppeteer-core/src/node/ChromeLauncher.ts
  // on to op chrome-launcher https://github.com/GoogleChrome/chrome-launcher/blob/main/src/flags.ts#L13
  const chromeFlags = `--chrome-flags="${[
    '--headless=new',
   	'--no-sandbox',
    '--no-pings',
    '--enable-automation',
    // '--enable-features=NetworkServiceInProcess2',
    '--allow-pre-commit-input',
    '--deny-permission-prompts',
    '--disable-breakpad',
    '--disable-dev-shm-usage',
    '--disable-domain-reliability',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disabe-gpu',
    '--disable-dev-shm-usage',
    '--block-new-web-contents',
    // '--single-process',
  ].join(' ')}"`;
  const throttling = '--throttling-method=simulate --throttling.rttMs=0 --throttling.throughputKbps=0 --throttling.requestLatencyMs=0 --throttling.downloadThroughputKbps=0 --throttling.uploadThroughputKbps=0 --throttling.cpuSlowdownMultiplier=0'
  
  let rawResult: { audits?: unknown} = {};
  try {
    let { stdout, stderr } = await exec(
      `${__dirname}/../../node_modules/.bin/lighthouse ${throttling} ${url} --output json${desktop? ' --preset=desktop':''} ${onlyAudits} ${chromeFlags} --disable-full-page-screenshot --disable-storage-reset`,
      { env: { 
          ...process.env, 
          CHROME_PATH: firstRevision?.executablePath || puppeteer.executablePath(), 
          TEMP: `${__dirname}/../../temp`,
          PATCHED: 'true',
        } 
      });
      if (stdout)

    rawResult = JSON.parse(stdout);
  } catch (error) {
    return null;
  }

  const audits = rawResult?.audits || null;
  if (!audits)
    return null;

  const artifacts: {
    WebAppManifest?: {
      raw?: string,
      url?: string,
      json?: unknown
    },
    ServiceWorker?: {
      raw?: string[],
      url?: string,
    }
  } = {};
  let swFeatures: AnalyzeServiceWorkerResponce | null = null;

  const processServiceWorker = async () => {
    if (audits['service-worker']?.details?.scriptUrl) {
      artifacts.ServiceWorker = {
        url: audits['service-worker']?.details?.scriptUrl,
      };
      try{
        swFeatures = await analyzeServiceWorker(artifacts.ServiceWorker.url);
      }
      catch(error: any){
        swFeatures = {
          error: error
        }
      }
      artifacts.ServiceWorker.raw = swFeatures?.raw;
    }
  }
  
  const processManifest = async () => {
    if (audits['installable-manifest']?.details?.debugData?.manifestUrl) {
      artifacts.WebAppManifest = {
        url: audits['installable-manifest']?.details?.debugData?.manifestUrl,
      };

      if (artifacts.WebAppManifest.url){
        const results = await getManifestByLink(artifacts.WebAppManifest.url, url);
        if (results && !results.error) {
          artifacts.WebAppManifest.raw = results.raw;
          artifacts.WebAppManifest.json = results.json;
        }
      }
    }
    else {
      delete artifacts.WebAppManifest;
    }
  }

  await Promise.allSettled([processServiceWorker(), processManifest()]);
   

  const report = {
    audits: {
      isOnHttps: { score: audits['is-on-https']?.score? true : false },
      installableManifest: { 
        score: audits['installable-manifest']?.score? true : false,
        details: { url: audits['installable-manifest']?.details?.debugData?.manifestUrl || undefined }
      },
      serviceWorker: {
        score: audits['service-worker']?.score? true : false,
        details: {
          url: audits['service-worker']?.details?.scriptUrl || undefined,
          scope: audits['service-worker']?.details?.scopeUrl || undefined,
          features: swFeatures? {...(swFeatures as object), raw: undefined} : undefined
        }
      },
      maskableIcon: { score: audits['maskable-icon']?.score? true : false },
      splashScreen: { score: audits['splash-screen']?.score? true : false },
      themedOmnibox: { score: audits['themed-omnibox']?.score? true : false },
      viewport: { score: audits['viewport']?.score? true : false }
    },
    artifacts: {
      webAppManifest: artifacts?.WebAppManifest,
      serviceWorker: artifacts?.ServiceWorker,
    }
  }

  return report;
};

export default httpTrigger;

/**
 * @openapi
 *  /Report:
 *    get:
 *      summary: Lighthouse report
 *      description: Generate PWA-related Lighthouse report for webapp
 *      tags:
 *        - Report
 *      parameters:
 *        - $ref: ?file=components.yaml#/parameters/site
 *        - name: desktop
 *          schema: 
 *            type: boolean
 *            # default: ''
 *          in: query
 *          description: Use desktop form factor
 *          required: false
 *      responses:
 *        '200':
 *          $ref: ?file=components.yaml#/responses/report/200
 */​
