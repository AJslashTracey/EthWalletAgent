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

    // Override the root route handler
    async handleRootRoute(req) {
        const { body } = req;
        
        // Handle the initial request
        if (body.type === 'do-task') {
            await this.doTask(body);
            return;
        }

        // Handle tool execution
        if (body.args && body.args.walletAddress) {
            try {
                const result = await summarizeTokenTransactions(body.args.walletAddress);
                
                const response = {
                    newMessages: [`Successfully analyzed transactions for ${body.args.walletAddress}`],
                    outputToolCallId: body.action?.task?.id || 'direct_call',
                    result: {
                        success: true,
                        walletAddress: body.args.walletAddress,
                        summary: result.chatGPTResponse,
                        link: result.UrlToAccount,
                        timestamp: new Date().toISOString()
                    }
                };

                if (body.action?.workspace?.id && body.action?.task?.id) {
                    await this.completeTask({
                        workspaceId: body.action.workspace.id,
                        taskId: body.action.task.id,
                        output: JSON.stringify(response)
                    });
                }

                return response;
            } catch (error) {
                const errorResponse = {
                    newMessages: [error.message || 'An unknown error occurred'],
                    outputToolCallId: body.action?.task?.id || 'direct_call',
                    error: error.message || 'Failed to analyze transactions'
                };

                if (body.action?.workspace?.id && body.action?.task?.id) {
                    await this.requestHumanAssistance({
                        workspaceId: body.action.workspace.id,
                        taskId: body.action.task.id,
                        type: 'text',
                        question: `Error analyzing wallet ${body.args.walletAddress}: ${error.message}`
                    });
                }

                throw new Error(JSON.stringify(errorResponse));
            }
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

agent.addCapability({
    name: 'summarizeTokenTransactions',
    description: 'Summarizes inflow and outflow token transactions for a specified wallet address.',
    schema: z.object({
        walletAddress: z.string()
            .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
            .transform(addr => addr.toLowerCase())
    }),
    async run({ args, action }) {
        return JSON.stringify({
            newMessages: [`Processing wallet ${args.walletAddress}`],
            outputToolCallId: action?.task?.id || 'direct_call',
        });
    }
});

// Start the agent with explicit error handling
agent.start()
    .then(() => {
        console.log(`Agent running on port ${process.env.PORT || 8080}`);
    })
    .catch(error => {
        console.error("Error starting agent:", error.message);
        process.exit(1); // Exit on startup error
    });