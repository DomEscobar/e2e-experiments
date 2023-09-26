import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { CheerioWebBaseLoader } from "langchain/document_loaders/web/cheerio";
import { compile, convert } from "html-to-text";
import { RecursiveUrlLoader } from "langchain/document_loaders/web/recursive_url";
import { RetrievalQAChain, loadQAMapReduceChain, loadQARefineChain } from "langchain/chains";
import { OpenAI } from "langchain/llms/openai";
import puppeteer from "puppeteer";
import { Document } from "langchain/document";
import axios from "axios";
import { load } from "cheerio";
const openAIApiKey = "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"
const embeddings = new OpenAIEmbeddings({ openAIApiKey, maxConcurrency: 10 });
declare const document: any;
declare const fetch: any;
const model = new OpenAI({ openAIApiKey, streaming: true });

interface ITool {
    name: string;
    description: string;
    parameters?: any;
    output?: any;
}

async function getBodyContent(url: string) {
    try {
        const response = await axios.get(url);
        const $ = load(response.data);
        const bodyContent = $('body').html() ?? "";
        const text = convert(bodyContent, { wordwrap: 400 });
        return text;
    } catch (error) {
        console.error('Error fetching and parsing the webpage:', error);
        return "";
    }
}

async function google_search(query: string) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--no-zygote',
            '--disable-gpu',
            '--disable-translate'
        ]
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 3000 });

    let url = `https://google.com/search?q=${query}`;
    try {
        await page.goto(url);
    } catch (error) {
        console.error('Error navigating to page:', error);
    }

    // wait until the first link is visible
    await page.waitForSelector("div.yuRUbf a");

    const links = await page.evaluate(() => {
        const linkNodes = document.querySelectorAll("div.yuRUbf a");
        return Array.from(linkNodes)
            .filter((anchor: any) =>
                anchor.href != null &&
                !anchor.href?.includes("https://www.google") &&
                !anchor.href?.includes("https://translate.google"))
            .slice(0, 3)
            .map((anchor: any) => {
                const title = anchor.innerText.trim();
                const url = anchor.href;
                return { title, url };
            });
    });
    browser.close();
    return links;
}

const visitWebsiteTool: ITool = {
    name: "visit_website",
    description: "useful for visiting a single website and searching for a specific content",
    parameters: {
        url: "string",
        search_content: "string //specify what to search for"
    },
    output: {
        information: "string"
    }
};

async function visit_website(url: string, title: string, search_content: string) {
    const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000 });

    // get website conent
    const websiteContent = await getBodyContent(url);
    const docs = await textSplitter.createDocuments([websiteContent ?? ""]);

    const vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
    const result = await vectorStore.asRetriever().getRelevantDocuments(search_content);

    return result.map((d) => ({ ...d, metadata: { ...d.metadata, url, title } }));
}

const visitDocumentationTool: ITool = {
    name: "visit_documentation_website",
    description: "useful to  visit a single documentation website and extracting relevat informations by searching for a specific content",
    parameters: {
        url: "string",
        search_content: "string //specify what to search for"
    },
    output: {
        information: "string"
    }
};

async function visit_documentation_website(url: string, search_content: string) {
    const compiledConvert = compile({ wordwrap: 400 });

    const loader = new RecursiveUrlLoader(url, {
        extractor: (compiledConvert),
        maxDepth: 20,
        excludeDirs: ["**/*/api"],
    });
    const docs = await loader.load();
    const vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);

    const result = await vectorStore.similaritySearch(search_content);
    return result.map((r) => r.pageContent);
}

async function final_answer(query: string, docs: Document[], callback: (token: string) => void) {
    const vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
    const vectorStoreRetriever = vectorStore.asRetriever();

    console.log("============I will try to answer this=============");

    const chain = new RetrievalQAChain({
        combineDocumentsChain: loadQARefineChain(model),
        retriever: vectorStoreRetriever,
        returnSourceDocuments: true
    });

    // const chain = RetrievalQAChain.fromLLM(model, vectorStoreRetriever, {
    //     returnSourceDocuments: true,
    // });
    const response = await chain.call({ query: query + " response in markdown format" }, {
        callbacks: [
            {
                handleLLMNewToken(token: string) {
                    callback(token);
                },
            }
        ]
    });
    return response;
}

// const query = "Show me an code example to GenerativeQAPipeline with the haystack framework?";
const query = "What are the latest new about cryptocurrencies?";

const promptTemplate = `
Your an AI assistant that helps a user to answer to his query.
You have 2 options to response: <Information> and <Search>.
<Information> = provide information to the user query if you are 100% sure in markdown format.
<Search> = Return a clever better search query out of the users query.
Choose one of the options and response to the users query

User Query:
${query}

Response example 1:
<Information> ... </Information>

Response example 2:
<Search> Writing a engaging blogpost. </Search>

--- 

Response:

`;

function removeHtmlTags(inputString: string) {
    return inputString.replace(/<[^>]*>/g, "");
}

async function main() {
    console.time("main");
    const response = await model.call(promptTemplate);

    if (response.includes("Answering")) {
        console.log("finalResponse ==== ", removeHtmlTags(response));
    } else if (response.includes("Search")) {
        const gResponse = await google_search(removeHtmlTags(query));
        const informations: Document[] = [];

        const promises: Promise<any>[] = [];
        for (const link of gResponse) {
            promises.push(visit_website(link?.url, link?.title, response));
        }

        const promiseResult = await Promise.all(promises);
        const flattenResult = promiseResult.flat();
        informations.push(...flattenResult);
        console.log("informations ==== ", informations.length, informations);

        const finalResponse = await final_answer(removeHtmlTags(query), informations, (token) => {
            console.timeEnd("main");
        });
        console.log("finalResponse ==== ", finalResponse);
    }

}

main();
