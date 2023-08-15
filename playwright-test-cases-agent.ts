import { Page, chromium as chromium2 } from "@playwright/test";
import fs from "fs";
import { appConfig } from "./config/app";
import { OpenAI } from "langchain";

async function captureScreenshot(url) {
    const browser = await chromium2.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForLoadState('networkidle');

    // const screenshot = await page.screenshot({ fullPage: true });
    // fs.writeFileSync("saved.png", screenshot);
    const inputFields = await extractInputFields(page);

    await browser.close();
    return inputFields;
}

async function extractParentInnerHTML(element: any, page: Page): Promise<string> {
    return page.evaluate((el: HTMLElement) => {
        let currentElement: HTMLElement | null = el;
        let count = 0;

        while (currentElement && count < 2) {
            if (currentElement.parentElement) {
                currentElement = currentElement.parentElement;
                count++;
            } else {
                break;
            }
        }

        return currentElement.innerHTML;
    }, element);
}

async function getInputPath(element: any, page: Page): Promise<string> {
    return await page.evaluate((inputElem: HTMLElement) => {
        function generatePathForElement(elem: HTMLElement): string {
            if (!elem.parentElement) return elem.tagName;

            let path = elem.tagName;

            if (elem.id) {
                path += `#${elem.id}`;
            } else if (elem.className && typeof elem.className === 'string') {
                path += `.${elem.className.split(' ').join('.')}`;
            }

            return `${generatePathForElement(elem.parentElement)} > ${path}`;
        }

        return generatePathForElement(inputElem);
    }, element);
}

async function extractContextFromElement(element: any, page: Page, labelForInput: string | null): Promise<string[]> {
    const allowedTags = ['h1', 'h2', 'h3', 'p'];

    return page.evaluate(([el, allowedTags, labelForInput]) => {
        let context: string[] = [];
        if (labelForInput) context.push(labelForInput);

        let currentElement: HTMLElement | null = el;

        while (currentElement && context.length < 4) {
            if (allowedTags.includes(currentElement.tagName.toLowerCase()) && currentElement.textContent?.trim()) {
                context.push(currentElement.textContent.trim());
            }
            currentElement = currentElement.parentElement;
        }

        return context;
    }, [element, allowedTags, labelForInput]);
}

async function extractInputFields(page: Page) {
    const inputElements = await page.$$('input');

    let results = [];

    for (const inputElement of inputElements) {
        const inputDetails = await inputElement.evaluate(input => ({
            id: input.id,
            label: input.name,
            type: input.type,
        }));

        const labelElement = await page.$(`label[for="${inputDetails.id}"]`);
        const labelText = labelElement ? await labelElement.innerText() : null;

        const context = await extractContextFromElement(inputElement, page, labelText);
        const html_structure = await extractParentInnerHTML(inputElement, page);

        results.push({
            ...inputDetails,
            meaning: context.join(' '),
            html_structure
        });
    }

    return results;
}

let model = new OpenAI({
    temperature: 0.1,
    openAIApiKey: appConfig.openAIApiKey,
});

const websiteURL = 'https://demo.odoo.com/web#cids=1&menu_id=403&action=643&active_id=2&model=stock.picking&view_type=form';

interface UserJourney {
    title: string,
    description: string,
    goal: string
}

async function planner(resultList, retryCount = 0) {
    try {

        if (retryCount > 3) {
            throw new Error('Retry count exceeded');
        }

        const promptPlanner = `
        <Input>${JSON.stringify(resultList)}</Input>
        ### Instructions:
        1,   '<Input>' Reflects a scraped page with its inputs, come up with 3 user journeys on that UI.
        2.  Stick to the given input fields, don't add make up fields or make assumptions.
        3.  Response with a Json array with this format: [{
              // user journey title
              title: string,
              // user journey description
              description: string,
              // goal of the user journey
              goal: string,
              }...] .
        4. Strictly response only the json array no explainations, text or other sentences

        ### Response:

      `;

        console.log('====== Calling with ', promptPlanner);
        let responsePlanner = await model.call(promptPlanner);
        console.log('====== RromptPlannerResponse with ', responsePlanner);
        return JSON.parse(responsePlanner) as UserJourney[];
    } catch (e) {
        return planner(resultList, retryCount + 1);
    }
}

async function testCode(code: string) {
    const chromium = chromium2;

    const safeCall = `const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('${websiteURL}');
    await page.waitForLoadState('networkidle');`

    try {
        const asyncCode = `
        (async () => {
            ${code.includes('chromium.launch') ? '' : safeCall}
            ${code}
        })()
        `;
        await eval(asyncCode);
    } catch (e) {
        console.error(e);
        throw new Error('Code failed to execute');
    }
}

async function playWrightMaker(userJourney: UserJourney, html: string, retryCount = 0) {
    try {
        if (retryCount > 2) {
            throw new Error('Retry count exceeded');
        }

        const promptPlanner = `
        <UserJourney>${JSON.stringify(userJourney)}</UserJourney>
        <HTML>${JSON.stringify(html)}</HTML>

        <StarterTemplate>
            const browser = await chromium.launch({ headless: false });
            const context = await browser.newContext();
            const page = await context.newPage();
            await page.goto('${websiteURL}');
            await page.waitForLoadState('networkidle');
            ...
        </StarterTemplate>

        ### Instructions:
            1. '<UserJourney>' Reflects a User Journey, come up with playwright javascript code to execute that journey with the help of <HTML>.
            2. '<StarterTemplate>' is the starter code to get you started, continue from there.
            3. Use mocking data for fillings.
            4. Strictly response only the code. No explainations, text or other sentences

        ### Response:
      `;
        let codeResponse = await model.call(promptPlanner);
        console.log('====== CodeResponse with ', codeResponse);
        await testCode(codeResponse);
        console.log('====== CodeResponse success ');
        return codeResponse;
    } catch (e) {
        console.error(e);
        return playWrightMaker(userJourney, html, retryCount + 1);
    }
}

async function start() {
    try {

        const resultList = await captureScreenshot(websiteURL);
        console.log('====== ResultList', resultList);
        const responsePlanner = await planner(resultList);
        console.log('====== Planner result', responsePlanner);

        const successfullyExecutedJourneys = [];
        for (const userJourney of responsePlanner) {
            try {
                const code = await playWrightMaker(userJourney, JSON.stringify(resultList));
                successfullyExecutedJourneys.push({ userJourney, code });
            } catch (e) {
                console.error(e);
            }
        }

        fs.writeFileSync("saved.json", JSON.stringify(successfullyExecutedJourneys));
        console.log('Done', successfullyExecutedJourneys);
    } catch (e) {
        console.error(e);
    }
}

start();