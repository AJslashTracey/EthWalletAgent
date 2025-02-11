import { Agent } from '@openserv-labs/sdk';
import { z } from 'zod';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { chromium } from 'playwright';

dotenv.config();

//Local run test ==>
console.log(process.env.OPENSERV_API_KEY);

// Initialize the agent with error handling
const agent = new Agent({
    systemPrompt: `You are a specialized crypto market analysis agent that:
    1. Scrapes tweets from crypto analysis accounts and analyzes them for:
       - Whale wallet movements
       - Smart money transactions
       - Token buying patterns
    2. Provides formatted summaries with key information including:
       - Token details
       - Transaction patterns
       - Market sentiment
    3. Generates shareable insights for social media`,
    apiKey: process.env.OPENSERV_API_KEY,
    onError: (error, context) => {
        console.error('Agent error:', error, 'Context:', context);
    }
});

// Initialize OpenAI with proper API key
const openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY  // Note: changed from OPENAI_KEY to OPENAI_API_KEY
});

// Modify scrapeTweets to include OpenAI analysis
async function scrapeTweets() {
    const url = "https://platform.spotonchain.ai/en";
    const browser = await chromium.launch({ 
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });
    
    try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "networkidle" });
        
        const newsData = await page.evaluate(() => {
            const newsItems = document.querySelectorAll(
                'div.p-4.lg\\:p-6.bg-primary.cursor-pointer.rounded-lg'
            );
            return Array.from(newsItems)
                .slice(0, 10)
                .map(news => ({
                    title: news.innerText.trim(),
                    link: news.querySelector("a")?.href || "No link",
                }));
        });

        // Create prompt for OpenAI
        const tweetTexts = newsData.map(item => item.title).join('\n');
        const prompt = `Analyze these crypto market updates and create a detailed summary focusing on whale movements, smart money transactions, and significant market events:\n\n${tweetTexts}`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                { role: "system", content: "You are a crypto market analyst specializing in whale movements and smart money tracking." },
                { role: "user", content: prompt }
            ],
            max_tokens: 1000,
            temperature: 0.7,
        });

        const analysis = response.choices[0].message.content;
        return { raw: newsData, analysis };

    } catch (error) {
        console.error("Error:", error);
        return { raw: [], analysis: "Failed to analyze data" };
    } finally {
        await browser.close();
    }
}

// Run the scraper
scrapeTweets()

// Add capabilities following OpenServ patterns
// Modify the capabilities definition with proper file handling
agent.addCapabilities([
    {
        name: 'scrapeTweets',
        description: 'Scrapes and analyzes tweets from the "spotonchain" account for smart money movements',
        schema: z.object({
            analysisType: z.enum(['whale_trades', 'market_sentiment', 'token_info'])
        }),
        async run({ args, action }) {
            try {
                // Ensure we have proper workspace context
                const workspaceId = action?.workspace?.id;
                if (!workspaceId) {
                    throw new Error('Missing workspace context');
                }

                console.log('Processing in workspace:', workspaceId);

                // Start the analysis
                const results = await scrapeTweets();
                
                // Generate markdown content with proper formatting
                const markdownContent = `# SpotOnChain Analysis\n\n## ${args.analysisType}\n\n${results.analysis}\n\n---\nGenerated at: ${new Date().toISOString()}`;

                // Create the file path with timestamp
                const filePath = `${Date.now()}_spotonchain_analysis.md`;

                // Try to upload the file using the workspace API
                try {
                    console.log('Attempting to upload file to workspace:', workspaceId);
                    const uploadResult = await agent.uploadFile({
                        workspaceId: parseInt(workspaceId),
                        path: filePath,
                        file: markdownContent,
                        skipSummarizer: true,
                        taskIds: action?.task?.id ? [parseInt(action.task.id)] : undefined
                    });
                    console.log('File upload result:', uploadResult);
                } catch (uploadError) {
                    console.error('File upload error details:', {
                        error: uploadError.message,
                        workspaceId,
                        filePath
                    });
                    
                    // Add error log if we have a task
                    if (action?.task?.id) {
                        await agent.addLogToTask({
                            workspaceId: parseInt(workspaceId),
                            taskId: parseInt(action.task.id),
                            severity: 'error',
                            type: 'text',
                            body: `Failed to upload analysis file: ${uploadError.message}`
                        });
                    }
                }

                // Create analysis result
                const analysis = {
                    success: true,
                    source: "spotonchain",
                    tweetCount: results.raw.length,
                    analysisType: args.analysisType,
                    tweets: results.analysis,
                    summary: `Analysis complete for ${args.analysisType}`,
                    timestamp: new Date().toISOString()
                };

                // Complete task if we have one
                if (action?.task?.id) {
                    await agent.completeTask({
                        workspaceId: parseInt(workspaceId),
                        taskId: parseInt(action.task.id),
                        output: JSON.stringify(analysis)
                    });
                }

                // Return the result
                return JSON.stringify({
                    newMessages: [`Analysis complete with ${results.raw.length} items processed`],
                    outputToolCallId: action?.task?.id || 'direct',
                    result: analysis
                });

            } catch (error) {
                console.error('Error in scrapeTweets:', error);
                throw error;
            }
        }
    }
]);

// Start the agent
agent.start()
    .then(() => console.log(`Agent running on port ${process.env.PORT || 7378}`))
    .catch(error => console.error("Error starting agent:", error));
