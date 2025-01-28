import { Agent } from '@openserv-labs/sdk';
import { z } from 'zod';
import dotenv from 'dotenv';
import express from 'express';
import { summarizeTokenTransactions } from './ETHWalletScanFunction.js';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 7378;

// Create Express app instance
const app = express();

// Add middleware to normalize routes with double slashes
app.use((req, res, next) => {
    req.url = req.url.replace(/\/+/g, '/');
    next();
});

const agent = new Agent({
    port: PORT,
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

agent.addCapabilities([
    {
      name: 'summarizeEthTransactions',
      description: 'Summarizes inflow and outflow token transactions for a specified wallet address.',
      schema: z.object({
        walletAddress: z.string().min(1, "A valid wallet address is required")
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
            body: `Starting token transaction summary for wallet: ${args.walletAddress}`
          });
  
          const { chatGPTResponse, UrlToAccount } = await summarizeTokenTransactions(args.walletAddress);
  
          const analysis = {
            success: true,
            walletAddress: args.walletAddress,
            summary: chatGPTResponse,
            link: UrlToAccount,
            timestamp: new Date().toISOString()
          };
  
          await agent.completeTask({
            workspaceId: action.workspace.id,
            taskId: action.task.id,
            output: JSON.stringify({
              newMessages: [
                `Successfully analyzed transactions for ${args.walletAddress}`
              ],
              outputToolCallId: action.task.id,
              result: analysis
            })
          });
  
          return JSON.stringify({
            newMessages: [
              `Successfully analyzed transactions for ${args.walletAddress}`
            ],
            outputToolCallId: action.task.id,
            result: analysis
          });
        } catch (error) {
          const errorResponse = {
            newMessages: [error.message || 'An unknown error occurred'],
            outputToolCallId: action.task?.id,
            error: error.message || 'Failed to summarize token transactions'
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
  
// Explicitly define the route for the tool
app.post('/tools/summarizeEthTransactions', async (req, res) => {
    try {
        const result = await agent.handleToolRoute({
            params: { toolName: 'summarizeEthTransactions' },
            body: req.body
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Use the Express app in the agent
agent.app = app;

// Start the agent
agent.start()
    .then(() => {
        console.log(`Agent running on port ${PORT}`);
    })
    .catch(error => {
        console.error("Error starting agent:", error.message);
    });