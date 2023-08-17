import { Page, chromium as chromium2 } from "@playwright/test";
import fs from "fs";
import { appConfig } from "./config/app";
import { OpenAI } from "langchain";

const { spawn } = require('child_process');
const { execSync } = require('child_process');
const chromeDebugFlag = '--remote-debugging-port=9222';


const startDefaultBrowserForDebugging = (url) => {
    switch (process.platform) {
        case 'darwin': // macOS
            execSync(`/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome ${chromeDebugFlag} ${url}`);
            break;
        case 'win32': // Windows
            execSync(`start chrome ${chromeDebugFlag} ${url}`);
            break;
        case 'linux': // Linux
            execSync(`google-chrome ${chromeDebugFlag} ${url}`);
            break;
        default:
            console.error('Unsupported platform');
    }
}
// const wsEndpoint = 'ws://127.0.0.1:9222/devtools/browser/';

// const browser = await chromium2.connect({ wsEndpoint });

// const page = await browser.newPage();
// await page.goto(url);
// await page.waitForLoadState('networkidle');

// const screenshot = await page.screenshot({ fullPage: true });
// fs.writeFileSync("saved.png", screenshot);

async function loginGmail(page) {
    await page.goto(
        "https://accounts.google.com/signin/v2/identifier?hl=en&flowName=GlifWebSignIn&flowEntry=ServiceLogin"
    );
    const isLogged = await page.waitForSelector('input[type="email"]', { timeout: 1000 }).catch(() => true);
    if (!isLogged) {
        await page.waitForSelector("div:has-text('signed in')");
    }
}

async function captureScreenshot(url) {
    // startDefaultBrowserForDebugging(url)
    const userDataDir = '/public/userData';
    const browser = await chromium2.launchPersistentContext(userDataDir, {
        headless: false,
        args: ["--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled", '--disable-extensions', '--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    const navigationPromise = page.waitForNavigation({
        waitUntil: "domcontentloaded",
    });
    await page.setDefaultNavigationTimeout(0);
    await page.goto(
        "https://accounts.google.com/signin/v2/identifier?hl=en&flowName=GlifWebSignIn&flowEntry=ServiceLogin"
    );
    await navigationPromise;
    const isLogged = await page.waitForSelector('input[type="email"]', { timeout: 1000 }).catch(() => true);
    if (!isLogged) {
        await page.waitForSelector("div:has-text('signed in')");
    }
    await browser.close();
}

async function start() {
    try {

        const resultList = await captureScreenshot("google.de");

    } catch (e) {
        console.error(e);
    }
}

start();
