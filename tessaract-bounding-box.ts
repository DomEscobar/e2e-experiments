import { chromium } from "@playwright/test";
import Tesseract from 'tesseract.js';
import fs from "fs";
import sharp from "sharp";

async function captureScreenshot(url) {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForLoadState('networkidle');

    const screenshot = await page.screenshot({ fullPage: true });
    fs.writeFileSync("saved.png", screenshot);

    await browser.close();
    return screenshot;
}

async function getLabelPositions(screenshotBuffer) {
    const result = await Tesseract.recognize(
        screenshotBuffer,
        'eng'
    );

    let labelPositions: any[] = [];
    result.data.words.forEach(word => {
        let position = {
            text: word.text,
            boundingBox: {
                x0: word.bbox.x0,
                y0: word.bbox.y0,
                x1: word.bbox.x1,
                y1: word.bbox.y1
            }
        };
        labelPositions.push(position);
    });

    return labelPositions;
}


async function drawBoundingBoxes(screenshotBuffer, boxes, savePath) {
    let overlayImages = [];

    for (let boxData of boxes) {
        const box = boxData.boundingBox;

        const svgBuffer = Buffer.from(`<svg width="${box.x1 - box.x0}" height="${box.y1 - box.y0}">
            <rect x="0" y="0" width="${box.x1 - box.x0}" height="${box.y1 - box.y0}" fill="none" stroke="red" stroke-width="2"/>
        </svg>`);

        overlayImages.push({
            input: svgBuffer,
            top: box.y0,
            left: box.x0
        });
    }

    await sharp(screenshotBuffer)
        .composite(overlayImages)
        .toFile(savePath);
}



const saveImagePath = 'screenshot_with_boxes.png';
const websiteURL = 'https://demo.odoo.com/web#cids=1&menu_id=403&action=643&active_id=2&model=stock.picking&view_type=form';
captureScreenshot(websiteURL)
    .then(async screenshotBuffer => ({ boxes: await getLabelPositions(screenshotBuffer), screenshotBuffer }))
    .then(({ boxes, screenshotBuffer }) => drawBoundingBoxes(screenshotBuffer, boxes, saveImagePath))
    .then(positions => {
        console.log(positions);
    })
    .catch(err => {
        console.error(err);
    });
