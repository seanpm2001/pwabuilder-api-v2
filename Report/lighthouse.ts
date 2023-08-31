
import puppeteer from 'puppeteer';
import lighthouse, { OutputMode, Flags } from 'lighthouse';
import { screenEmulationMetrics, /*userAgents */} from 'lighthouse/core/config/constants.js';


// custom use agents
const userAgents = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Edg/108.0.1462.42',
  mobile: 'Mozilla/5.0 (Linux; Android 12; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36 Edg/108.0.1462.42'
}

const MAX_WAIT_FOR_LOAD = 25; //seconds
const MAX_WAIT_FOR_FCP = 10; //seconds


const audit = async (browser: any, url: string, desktop?: boolean) => {

  // Puppeteer with Lighthouse
  const config = {
    // port: browser.port, //new URL(browser.wsEndpoint()).port,
    logLevel: 'info', // 'silent' | 'error' | 'info' | 'verbose'
    output: 'json',   // 'json' | 'html' | 'csv'
    locale: 'en-US',

    maxWaitForFcp: MAX_WAIT_FOR_FCP * 1000,
    maxWaitForLoad: MAX_WAIT_FOR_LOAD * 1000,
    throttling: {
      rttMs: 0,
      throughputKbps: 0,
      requestLatencyMs: 0,
      downloadThroughputKbps: 0,
      uploadThroughputKbps: 0,
      cpuSlowdownMultiplier: 0
    },
    // disableDeviceEmulation: true,
    disableStorageReset: true,
    disableFullPageScreenshot: true,
    silent: true,

    // chromeFlags: [/*'--disable-mobile-emulation',*/ '--disable-storage-reset'],

    skipAboutBlank: true,
    formFactor: desktop ? 'desktop' : 'mobile', // 'mobile'|'desktop';
    screenEmulation: desktop ? screenEmulationMetrics.desktop : screenEmulationMetrics.mobile,  
    emulatedUserAgent: desktop ? userAgents.desktop : userAgents.mobile,  
    throttlingMethod: 'provided', // 'devtools'|'simulate'|'provided';
    // throttling: false,
    onlyAudits: ['service-worker', 'installable-manifest', 'is-on-https', 'maskable-icon'], //'themed-omnibox', 'viewport', 'apple-touch-icon',  'splash-screen'
    // onlyCategories: ['pwa'] ,
    // skipAudits: ['pwa-cross-browser', 'pwa-each-page-has-url', 'pwa-page-transitions', 'full-page-screenshot', 'network-requests', 'errors-in-console', 'diagnostics'],
  } as Flags;

  // @ts-ignore
  const rawResult = await lighthouse(url, config, undefined, browser);
  return { 
    audits: rawResult?.lhr?.audits, 
    artifacts: { 
      Manifest: {
        url: rawResult?.artifacts.WebAppManifest?.url,
        raw: rawResult?.artifacts.WebAppManifest?.raw
      },
      ServiceWorker: rawResult?.artifacts.ServiceWorker 
    }
  };

  // const audits = rawResult?.lhr?.audits;
  // const artifacts = rawResult?.artifacts;
  
  // if (!audits) {
  //   return null;
  // }

  // let swFeatures: AnalyzeServiceWorkerResponce | null = null;
  // // @ts-ignore  
  // if (audits['service-worker']?.details?.scriptUrl) {
  //   try{
  //     // @ts-ignore  
  //     swFeatures = audits['service-worker']?.details?.scriptUrl? await analyzeServiceWorker(audits['service-worker'].details.scriptUrl) : null;
  //   }
  //   catch(error: any){
  //     swFeatures = {
  //       error: error
  //     }
  //   }
  // }
   

  // const report = {
  //   audits: {
  //     isOnHttps: { score: audits['is-on-https']?.score? true : false },
  //     installableManifest: { 
  //       score: audits['installable-manifest']?.score? true : false,
  //       // @ts-ignore  
  //       details: { url: audits['installable-manifest']?.details?.debugData?.manifestUrl || undefined }
  //     },
  //     serviceWorker: {
  //       score: audits['service-worker']?.score? true : false,
  //       details: {
  //         // @ts-ignore  
  //         url: audits['service-worker']?.details?.scriptUrl || undefined,
  //         // @ts-ignore  
  //         scope: audits['service-worker']?.details?.scopeUrl || undefined,
  //         features: swFeatures? {...swFeatures, raw: undefined} : undefined
  //       }
  //      },
  //     appleTouchIcon: { score: audits['apple-touch-icon']?.score? true : false },
  //     maskableIcon: { score: audits['maskable-icon']?.score? true : false },
  //     splashScreen: { score: audits['splash-screen']?.score? true : false },
  //     themedOmnibox: { score: audits['themed-omnibox']?.score? true : false },
  //     viewport: { score: audits['viewport']?.score? true : false }
  //   },
  //   artifacts: {
  //     webAppManifest: artifacts?.WebAppManifest,
  //     serviceWorker: {...artifacts?.ServiceWorker, raw: (swFeatures as { raw: string[]})?.raw || undefined },
  //     url: artifacts?.URL,
  //     // @ts-ignore  
  //     linkElements: artifacts?.LinkElements?.map(element => { delete element?.node; return element }),
  //     // @ts-ignore  
  //     metaElements: artifacts?.MetaElements?.map(element => { delete element?.node; return element })
  //   }
  // }

  // return report;
};

async function execute () {
  const url = 'https://webboard.app'
  const desktop = true;

  const currentBrowser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--no-pings',
      '--enable-automation',
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
      '--block-new-web-contents',
      // '--single-process'
    ],
    headless: 'new',
    defaultViewport: null,
  });
  const page = await currentBrowser.pages().then(pages => pages[0]);


  try {
    // run lighthouse audit

    if (page) {
      const webAppReport = await audit(page, url, desktop);

      await currentBrowser.close();

      if (process.stdout) {
        process.stdout.write(JSON.stringify(webAppReport));
        process.exit(0);
      }

      // context.log.info(
      //   `Report function is DONE processing a request for site: ${req.query.site}`
      // );
    }
  } catch (error: any) {
    await currentBrowser.close();

    if (process.stdout) {
      process.stdout.write(JSON.stringify(error));
      process.exit(1);
    }

    // if (error.name && error.name.indexOf('TimeoutError') > -1) {
    //   context.log.error(
    //     `Report function TIMED OUT processing a request for site: ${url}`
    //   );
    // } else {
    //   context.log.error(
    //     `Report function failed for ${url} with the following error: ${error}`
    //   );
    // }
  }
};

await execute();