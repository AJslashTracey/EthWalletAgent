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

//Agent config
const agent = new Agent({
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

// Simplify the capability definition to match SDK expectations
agent.addCapability({
    name: 'summarizeEthTransactions',
    description: 'Summarizes inflow and outflow token transactions for a specified wallet address.',
    schema: z.object({
        walletAddress: z.string().min(42, "Ethereum address must be 42 characters").max(42)
    }),
    async run({ args, action }) {
        try {
            // Log the start of analysis if we have task context
            if (action?.workspace?.id && action?.task?.id) {
                await this.addLogToTask({
                    workspaceId: action.workspace.id,
                    taskId: action.task.id,
                    severity: 'info',
                    type: 'text',
                    body: `Starting analysis for wallet: ${args.walletAddress}`
                });
            }

            const result = await summarizeTokenTransactions(args.walletAddress);
            
            // Update task if we have context
            if (action?.workspace?.id && action?.task?.id) {
                await this.updateTaskStatus({
                    workspaceId: action.workspace.id,
                    taskId: action.task.id,
                    status: 'done'
                });
            }

            return JSON.stringify({
                success: true,
                walletAddress: args.walletAddress,
                summary: result.chatGPTResponse,
                link: result.UrlToAccount,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            // Handle errors with proper task updates
            if (action?.workspace?.id && action?.task?.id) {
                await this.requestHumanAssistance({
                    workspaceId: action.workspace.id,
                    taskId: action.task.id,
                    type: 'text',
                    question: `Error analyzing wallet ${args.walletAddress}: ${error.message}`
                });
            }
            throw error;
        }
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