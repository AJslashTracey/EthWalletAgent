import axios from "axios";
import { Agent } from '@openserv-labs/sdk';
import { z } from 'zod';
import { Scraper } from '@the-convocation/twitter-scraper';
import dotenv from 'dotenv';
import OpenAI from 'openai';
export default summarizeTokenTransactions;





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
    apiKey: "0f1490d7300a4dc59b9d033db16ed761"
});





//AI Summary of most up to date transactions from a Wallet Addresse 
summarizeTokenTransactions(walletAddress)
  .then(response => console.log(response))
  .catch(error => console.error(error));





agent.addCapabilities([
    {
      name: 'getLatestTokenTransactions',
      description: 'Fetches and analyzes token transactions from Etherscan for a given wallet to determine inflow/outflow summary.',
      schema: z.object({
        walletAddress: z.string().min(1, "A valid wallet address is required"),
        limit: z.number().optional()
      }),
      async run({ args, action }) {
        try {
          // Validate task context
          if (!action?.workspace?.id || !action?.task?.id) {
            throw new Error('Task context required');
          }
  
          // Update task status and log
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
            body: `Fetching up to ${args.limit || 20} transactions for wallet: ${args.walletAddress}`
          });
  
          // Fetch the latest token transactions
          const tokenTransactions = await getLatestTokenTransactions(args.walletAddress, args.limit || 20);
  
          if (!tokenTransactions || tokenTransactions.length === 0) {
            throw new Error('No token transactions found for this address.');
          }
  
          // Summarize inflow/outflow
          const tokenSummary = calculateTokenSummary(tokenTransactions);
  
          // Build final result
          const analysis = {
            success: true,
            walletAddress: args.walletAddress,
            transactionCount: tokenTransactions.length,
            tokenSummary,
            timestamp: new Date().toISOString()
          };
  
          // Complete task with required fields
          await agent.completeTask({
            workspaceId: action.workspace.id,
            taskId: action.task.id,
            output: JSON.stringify({
              newMessages: [
                `Successfully analyzed ${tokenTransactions.length} transactions for ${args.walletAddress}`
              ],
              outputToolCallId: action.task.id,
              result: analysis
            })
          });
  
          // Return final response
          return JSON.stringify({
            newMessages: [
              `Successfully analyzed ${tokenTransactions.length} transactions for ${args.walletAddress}`
            ],
            outputToolCallId: action.task.id,
            result: analysis
          });
        } catch (error) {
          const errorResponse = {
            newMessages: [error.message || 'An unknown error occurred'],
            outputToolCallId: action.task.id,
            error: error.message || 'Failed to analyze token transactions'
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

// Start the agent on the specified port
agent.start({ port: process.env.PORT || 7378 })
    .then(() => {
        console.log(`Agent running on port ${process.env.PORT || 7378}`);
    })
    .catch(error => console.error("Error starting agent:", error.message));
