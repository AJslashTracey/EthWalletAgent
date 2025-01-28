import { Agent } from '@openserv-labs/sdk';
import { z } from 'zod';
import dotenv from 'dotenv';
import { summarizeTokenTransactions } from './ETHWalletScanFunction.js';

// Load environment variables
dotenv.config();

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
});

agent.addCapability({
    name: 'summarizeEthTransactions',
    description: 'Summarizes inflow and outflow token transactions for a specified wallet address.',
    schema: z.object({
        walletAddress: z.string().min(1, "A valid wallet address is required")
    }),
    async run({ args, action }) {
        try {
            // Validate task context
            if (action?.workspace?.id && action?.task?.id) {
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
                    body: `Starting analysis for wallet: ${args.walletAddress}`
                });
            }

            // Get the transaction data
            const { chatGPTResponse, UrlToAccount } = await summarizeTokenTransactions(args.walletAddress);

            // Build the analysis result
            const analysis = {
                success: true,
                walletAddress: args.walletAddress,
                summary: chatGPTResponse,
                link: UrlToAccount,
                timestamp: new Date().toISOString()
            };

            // If we have task context, complete the task
            if (action?.workspace?.id && action?.task?.id) {
                await agent.completeTask({
                    workspaceId: action.workspace.id,
                    taskId: action.task.id,
                    output: JSON.stringify(analysis)
                });
            }

            return JSON.stringify(analysis);
        } catch (error) {
            // If we have task context, handle the error appropriately
            if (action?.workspace?.id && action?.task?.id) {
                await agent.requestHumanAssistance({
                    workspaceId: action.workspace.id,
                    taskId: action.task.id,
                    type: 'text',
                    question: `Error analyzing wallet ${args.walletAddress}: ${error.message}. Please verify the wallet address and try again.`
                });
            }
            throw new Error(`Failed to summarize token transactions: ${error.message}`);
        }
    }
});

// Finally, start the agent
agent.start()
    .then(() => {
        console.log(`Agent running on port ${process.env.PORT || 7378}`);
    })
    .catch(error => {
        console.error("Error starting agent:", error.message);
    });