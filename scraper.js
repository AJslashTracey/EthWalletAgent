import { Agent } from '@openserv-labs/sdk';
import { z } from 'zod';
import { Scraper } from '@the-convocation/twitter-scraper';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

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
    apiKey: process.env.OPENSERV_API_KEY
});


const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function scrapeTweets() {
    const scraper = new Scraper();
    const tweets = [];
    const numberOfTweets = 20;
    const username = "lookonchain";

    console.log(`Starting tweet scraping for username: ${username}`);

    try {
        for await (const tweet of scraper.getTweets(username, numberOfTweets)) {
            tweets.push({
                id: tweet.id,
                text: tweet.text,
                createdAt: tweet.createdAt,
                likes: tweet.likes,
                retweets: tweet.retweets,
            });

            console.log(`Fetched tweet with ID: ${tweet.id}`);

            if (tweets.length >= numberOfTweets) {
                console.log(`Reached the desired number of tweets: ${numberOfTweets}`);
                break;
            }
        }

        console.log("Finished scraping tweets.");

        const tweetTexts = tweets.map(tweet => `- ${tweet.text}`).join("\n");
        const prompt = `You are an AI assistant. Summarize the following tweets in a concise and human-readable format, highlighting any important details or trends, focusing especially on smart money wallet movements. Avoid mentioning the Twitter account name in the response.\n\n${tweetTexts}`;

        const response = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: prompt },
            ],
            max_tokens: 1000,
            temperature: 0.7,
        });

        const summary = response.choices[0].message.content;
        console.log("Summary of Tweets:", summary);
        return summary;
    } catch (error) {
        console.error('Error occurred:', error.message);
        return "Failed to scrape and summarize tweets. Please try again.";
    }
}

// Add capabilities following OpenServ patterns
agent.addCapabilities([
    {
        name: 'scrapeTweets',
        description: 'Scrapes and analyzes 25 tweets from the "spotonchain" account for smart money movements',
        schema: z.object({
            analysisType: z.enum(['whale_trades', 'market_sentiment', 'token_info'])
        }),
        async run({ args, action }) {
            try {
                if (!action?.workspace?.id || !action?.task?.id) {
                    throw new Error('Task context required');
                }

                await agent.updateTaskStatus({
                    workspaceId: action.workspace.id,
                    taskId: action.task.id,
                    status: 'in-progress'
                });

                await agent.addLogToTask({
                    workspaceId: action.workspace.id,
                    taskId: action.task.id,
                    severity: 'info',
                    type: 'text',
                    body: `Starting analysis of 25 tweets from spotonchain`
                });

                const tweets = await scrapeTweets();

                if (typeof tweets !== 'string') {
                    throw new Error('Unexpected response while scraping tweets');
                }

                const analysis = {
                    success: true,
                    source: "spotonchain",
                    tweetCount: 25,
                    analysisType: args.analysisType,
                    tweets,
                    summary: `Analysis of 25 tweets from spotonchain for ${args.analysisType}`,
                    timestamp: new Date().toISOString()
                };

                await agent.completeTask({
                    workspaceId: action.workspace.id,
                    taskId: action.task.id,
                    output: JSON.stringify({
                        newMessages: [`Successfully analyzed 25 tweets from spotonchain`],
                        outputToolCallId: action.task.id,
                        result: analysis
                    })
                });

                return JSON.stringify({
                    newMessages: [`Successfully analyzed 25 tweets from spotonchain`],
                    outputToolCallId: action.task.id,
                    result: analysis
                });
            } catch (error) {
                const errorResponse = {
                    newMessages: [error.message || 'An unknown error occurred'],
                    outputToolCallId: action.task.id,
                    error: error.message || 'Failed to analyze tweets'
                };

                if (action?.workspace?.id && action?.task?.id) {
                    await agent.updateTaskStatus({
                        workspaceId: action.workspace.id,
                        taskId: action.task.id,
                        status: 'error'
                    });

                    await agent.addLogToTask({
                        workspaceId: action.workspace.id,
                        taskId: action.task.id,
                        severity: 'error',
                        type: 'text',
                        body: error.message
                    });
                }

                return JSON.stringify(errorResponse);
            }
        }
    }
]);

agent.start({ port: process.env.PORT || 7378 })
    .then(() => {
        console.log(`Agent running on port ${process.env.PORT || 7378}`);
    })
    .catch(error => console.error("Error starting agent:", error.message));
