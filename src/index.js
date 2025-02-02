import { Agent } from '@openserv-labs/sdk';
import { z } from 'zod';
import dotenv from 'dotenv';
import { summarizeTokenTransactions } from './ETHWalletScanFunction.js';

// Load environment variables
dotenv.config();

const requiredEnvVars = ['OPENSERV_API_KEY', 'ETHERSCAN_API_KEY', 'OPENAI_API_KEY'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        throw new Error(`${envVar} environment variable is required`);
    }
}

class EthWalletAgent extends Agent {
    constructor(options) {
        super(options);
    }

    async doTask(action) {
        if (!action.task) return;

        try {
            // (1) Extract wallet address from task input or description
            const match = action.task.input?.match(/0x[a-fA-F0-9]{40}/) ||
                          action.task.description?.match(/0x[a-fA-F0-9]{40}/);
            
            if (!match) {
                await this.requestHumanAssistance({
                    workspaceId: action.workspace.id,
                    taskId: action.task.id,
                    type: 'text',
                    question: 'Please provide a valid Ethereum wallet address.'
                });
                return;
            }

            const walletAddress = match[0];

            const result = await summarizeTokenTransactions(walletAddress);

            const response = {
                newMessages: [`Successfully analyzed transactions for ${walletAddress}`],
                outputToolCallId: action.task.id,
                result: {
                    success: true,
                    walletAddress,
                    summary: result.chatGPTResponse,
                    // Use the correct property name from summarizeTokenTransactions
                    link: result.overviewURL,
                    timestamp: new Date().toISOString()
                }
            };

            // Mark the task complete
            await this.completeTask({
                workspaceId: action.workspace.id,
                taskId: action.task.id,
                output: JSON.stringify(response)
            });

        } catch (error) {
            await this.requestHumanAssistance({
                workspaceId: action.workspace.id,
                taskId: action.task.id,
                type: 'text',
                question: `Error analyzing wallet: ${error.message}`
            });
        }
    }

   
    async respondToChat(action) {
        const userMessage = action.messages?.find(msg => msg.author === 'user')?.message || '';

        // (2) Look for an Ethereum address in the user’s message
        const match = userMessage.match(/0x[a-fA-F0-9]{40}/);

        if (!match) {
            await this.sendChatMessage({
                workspaceId: action.workspace.id,
                agentId: action.me.id,
                message:
                  "I can help analyze Ethereum wallet transactions. Please provide a valid address (0x...)."
            });
            return;
        }

        const walletAddress = match[0];

        try {
            // (3) Summarize the token transactions for this address
            const result = await summarizeTokenTransactions(walletAddress);

            const responseMessage = [
                `**Successfully analyzed:** \`${walletAddress}\``,
                `**Summary:** ${result.chatGPTResponse}`,
                // Use Markdown link format here:
                `[View more](${result.overviewURL})`
              ].join('\n');

            await this.sendChatMessage({
                workspaceId: action.workspace.id,
                agentId: action.me.id,
                message: responseMessage
            });

        } catch (error) {
            await this.sendChatMessage({
                workspaceId: action.workspace.id,
                agentId: action.me.id,
                message: `Error analyzing wallet: ${error.message}`
            });
        }
    }
}

const agent = new EthWalletAgent({
    systemPrompt: `You are a specialized crypto market analysis agent that:
    1. Analyzes token transactions fetched from wallet addresses using the API.
       - Identifies inflow and outflow transactions for tokens.
       - Summarizes token movement details, including:
         - Token names
         - Total transferred amounts
         - Inflow or outflow classification
    2. Provides insights based on the transaction data, such as:
       - Major wallet activity
       - Significant token transfers
    3. Prepares concise and formatted summaries suitable for reporting or sharing.`,
    apiKey: process.env.OPENSERV_API_KEY,
    port: parseInt(process.env.PORT || '8080'),
    openaiApiKey: process.env.OPENAI_API_KEY,
    onError: (error, context) => {
        console.error('Agent error:', error.message, context);
    }
});

// Register the summarizeTokenTransactions capability
agent.addCapability({
    name: 'summarizeTokenTransactions',
    description: 'Summarizes inflow and outflow token transactions for a specified wallet address.',
    schema: z.object({
        walletAddress: z.string()
            .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
            .transform(addr => addr.toLowerCase())
    }),
    async run({ args, action }) {
        const result = await summarizeTokenTransactions(args.walletAddress);
        return JSON.stringify({
            newMessages: [`Successfully analyzed wallet ${args.walletAddress}`],
            outputToolCallId: action?.task?.id || 'direct_call',
            result: {
                success: true,
                walletAddress: args.walletAddress,
                summary: result.chatGPTResponse,
                link: result.overviewURL, // Use the property name from summarizeTokenTransactions
                timestamp: new Date().toISOString()
            }
        });
    }
});

agent.start()
    .then(() => {
        console.log(`Agent running on port ${process.env.PORT || 8080}`);
    })
    .catch(error => {
        console.error("Error starting agent:", error.message);
        process.exit(1); // Exit on startup error
    });
