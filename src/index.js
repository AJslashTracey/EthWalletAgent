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
        this.setupCustomRoutes();
    }

    setupCustomRoutes() {
        // Add middleware to handle both /tools and //tools paths
        this.app.use((req, res, next) => {
            if (req.path.startsWith('//')) {
                req.url = req.url.replace('//', '/');
            }
            next();
        });
    }
}

//Agent config
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

// Simplify the capability definition to match SDK expectations
agent.addCapability({
    name: 'summarizeTokenTransactions', // Changed to match function name
    description: 'Summarizes inflow and outflow token transactions for a specified wallet address.',
    schema: z.object({
        walletAddress: z.string()
            .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format")
            .transform(addr => addr.toLowerCase()) // Normalize address to lowercase
    }),
    async run({ args, action }) {
        try {
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
            
            const response = {
                newMessages: [
                    `Successfully analyzed transactions for ${args.walletAddress}`
                ],
                outputToolCallId: action?.task?.id || 'direct_call',
                result: {
                    success: true,
                    walletAddress: args.walletAddress,
                    summary: result.chatGPTResponse,
                    link: result.UrlToAccount,
                    timestamp: new Date().toISOString()
                }
            };

            if (action?.workspace?.id && action?.task?.id) {
                await this.completeTask({
                    workspaceId: action.workspace.id,
                    taskId: action.task.id,
                    output: JSON.stringify(response)
                });
            }

            return JSON.stringify(response);
        } catch (error) {
            const errorResponse = {
                newMessages: [error.message || 'An unknown error occurred'],
                outputToolCallId: action?.task?.id || 'direct_call',
                error: error.message || 'Failed to analyze transactions'
            };

            if (action?.workspace?.id && action?.task?.id) {
                await this.requestHumanAssistance({
                    workspaceId: action.workspace.id,
                    taskId: action.task.id,
                    type: 'text',
                    question: `Error analyzing wallet ${args.walletAddress}: ${error.message}`
                });
            }

            return JSON.stringify(errorResponse);
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