import type { Page } from 'playwright';
const { chromium } = require('playwright');
const fs = require('fs');

interface EventData {
    id: number;
    name: string;
    date: string;
    results: CompetitionResult[];
}

interface CompetitionResult {
    lifter: string;
    bodyWeight: number;
    snatch1: number;
    snatch2: number;
    snatch3: number;
    snatch: number;
    cj1: number;
    cj2: number;
    cj3: number;
    cj: number;
    total: number;
}

async function scrapeWeightliftingData() {
    console.log('Launching browser...');
    const browser = await chromium.launch({
        headless: true
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    const allEvents: EventData[] = [];
    
    try {
        const START_ID = 6178;
        const END_ID = 5652;
        
        for (let eventId = START_ID; eventId >= END_ID; eventId--) {
            try {
                console.log(`Scraping event ID: ${eventId}`);
                const eventUrl = `https://usaweightlifting.sport80.com/public/rankings/results/${eventId}`;
                
                await page.goto(eventUrl, {
                    waitUntil: 'networkidle',
                    timeout: 30000
                });

                // Wait for either the table or an error message
                const hasContent = await Promise.race([
                    page.waitForSelector('table tbody tr', { timeout: 5000 }),
                    page.waitForSelector('.error-message', { timeout: 5000 })
                ]).catch(() => false);

                if (!hasContent) {
                    console.log(`No content found for event ${eventId}, skipping...`);
                    continue;
                }

                // Check if we have results
                const hasTable = await page.waitForSelector('table tbody tr', { 
                    timeout: 5000 
                }).catch(() => false);

                if (!hasTable) {
                    console.log(`No results table found for event ${eventId}, skipping...`);
                    continue;
                }

                // Try to get event name and date, use fallbacks if not found
                const eventName = await page.$eval('h1, .event-title, .page-title', 
                    (el: HTMLElement) => el.textContent?.trim() || ''
                ).catch(() => `Event ${eventId}`);

                const eventDate = await page.$eval('time, .event-date, .date', 
                    (el: HTMLElement) => el.textContent?.trim() || ''
                ).catch(() => new Date().toISOString().split('T')[0]);

                const results = await scrapeEventResults(page);
                
                if (results.length > 0) {
                    allEvents.push({
                        id: eventId,
                        name: eventName,
                        date: eventDate,
                        results: results
                    });

                    console.log(`Successfully scraped ${results.length} results for ${eventName}`);
                    saveData(allEvents);
                }

                // Add a longer delay between requests to avoid rate limiting
                await page.waitForTimeout(2000);

            } catch (error) {
                console.error(`Failed to scrape event ${eventId}:`, error);
                // Add a delay even on error to avoid hammering the server
                await page.waitForTimeout(2000);
                continue;
            }
        }

    } catch (error) {
        console.error('Error during scraping:', error);
        throw error;
    } finally {
        await context.close();
        await browser.close();
    }
}

async function scrapeEventResults(page: Page): Promise<CompetitionResult[]> {
    let allResults: CompetitionResult[] = [];
    let hasNextPage = true;
    
    while (hasNextPage) {
        // Wait for the table to load
        await page.waitForSelector('table tbody tr', { timeout: 30000 });
        
        // Scrape current page
        const pageResults = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('table tbody tr'));
            return rows.map(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                const getText = (cell: Element | undefined | null) => 
                    cell?.textContent ? cell.textContent.trim() : '';
                const getNumber = (cell: Element | undefined | null) => {
                    const text = cell?.textContent ? cell.textContent.trim() : '0';
                    return parseFloat(text) || 0;
                };

                return {
                    lifter: getText(cells[3]),
                    bodyWeight: getNumber(cells[4]),
                    snatch1: getNumber(cells[8]),
                    snatch2: getNumber(cells[9]),
                    snatch3: getNumber(cells[10]),
                    snatch: getNumber(cells[11]),
                    cj1: getNumber(cells[13]),
                    cj2: getNumber(cells[14]),
                    cj3: getNumber(cells[15]),
                    cj: getNumber(cells[12]),
                    total: getNumber(cells[13])
                };
            });
        });
        
        allResults = allResults.concat(pageResults);
        
        // Check for next page button that's not disabled
        const nextButton = await page.$('button[aria-label="Next page"]:not([disabled])');
        if (nextButton) {
            await nextButton.click();
            // Wait for table to update with new data
            await page.waitForTimeout(1000);
            await page.waitForSelector('table tbody tr', { timeout: 30000 });
        } else {
            hasNextPage = false;
        }
    }
    
    return allResults;
}

function saveData(data: EventData[]) {
    // Extract all results and sort by lifter name
    const allResults = data
        .flatMap(event => event.results)
        .sort((a, b) => a.lifter.localeCompare(b.lifter));
    
    // Format each result as a single line with one newline between entries
    const formattedResults = allResults
        .map(result => 
            `  { lifter: "${result.lifter}", bodyWeight: ${result.bodyWeight}, ` +
            `snatch1: ${result.snatch1}, snatch2: ${result.snatch2}, snatch3: ${result.snatch3}, snatch: ${result.snatch}, ` +
            `cj1: ${result.cj1}, cj2: ${result.cj2}, cj3: ${result.cj3}, cj: ${result.cj}, total: ${result.total} }`
        )
        .join(',\n');
    
    const tsContent = `// Generated by weightlifting scraper
// Last updated: ${new Date().toISOString()}

export interface LiftResult {
    lifter: string;
    bodyWeight: number;
    snatch1: number;
    snatch2: number;
    snatch3: number;
    snatch: number;
    cj1: number;
    cj2: number;
    cj3: number;
    cj: number;
    total: number;
}

export const liftingResults: LiftResult[] = [
${formattedResults}
];
`;

    fs.writeFileSync('2023_weightlifting_data.ts', tsContent);
    console.log(`Successfully saved ${allResults.length} total results`);
}

if (require.main === module) {
    console.log('Starting scraper...');
    scrapeWeightliftingData()
        .then(() => {
            console.log('Scraping completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('Scraping failed with error:', error);
            process.exit(1);
        });
}

module.exports = { scrapeWeightliftingData }; 