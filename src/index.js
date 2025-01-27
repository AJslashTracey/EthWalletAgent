import axios from "axios";
import { Agent } from '@openserv-labs/sdk';
import { z } from 'zod';
import { Scraper } from '@the-convocation/twitter-scraper';
import dotenv from 'dotenv';
import OpenAI from 'openai';


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





// Initialize the agent with proper system prompt




let dataResult;

// 1) Adjust the function to properly handle the walletAddress and limit args
async function getLatestTokenTransactions(walletAddress, limit = 20) {
  const apiKey = 'UVV9W98IGNG6DWGTV4DDWJBUWQX6644EM9';
  const url = `https://api.etherscan.io/api?module=account&action=tokentx&address=${walletAddress}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`;

  try {
    const response = await axios.get(url);
    let tokenTransactions = response.data.result;

    if (!tokenTransactions || tokenTransactions.length === 0) {
      console.log('No token transactions found for this address.');
      return [];
    }

    // Limit the number of returned transactions
    tokenTransactions = tokenTransactions.slice(0, limit);

    // Return only the transaction data; do not summarize here
    return tokenTransactions;
  } catch (error) {
    console.error('Error fetching token transactions:', error.message, error.response?.data);
    // Return empty array on error so caller can handle it
    return [];
  }
}

// 2) Accept walletAddress dynamically in calculateTokenSummary
function calculateTokenSummary(transactions, walletAddress) {
  const tokenSummary = {};
  const walletAddrLower = walletAddress.toLowerCase();

  transactions.forEach(tx => {
    const tokenName = tx.tokenName;
    // Adjust for decimals
    const value = parseFloat(tx.value) / Math.pow(10, tx.tokenDecimal);

    // Determine if outflow (from your wallet) or inflow (to your wallet)
    const isOutflow = tx.from.toLowerCase() === walletAddrLower;
    const direction = isOutflow ? 'Outflow' : 'Inflow';

    if (!tokenSummary[tokenName]) {
      tokenSummary[tokenName] = {
        name: tokenName,
        totalMove: 0,
        outInflow: ''
      };
    }
    
    tokenSummary[tokenName].totalMove += value;
    tokenSummary[tokenName].outInflow = direction;
  });

  // Convert summary object to an array of objects
  return Object.values(tokenSummary);
}

// 3) Update agent capability to use the above functions properly
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
        const tokenSummary = calculateTokenSummary(tokenTransactions, args.walletAddress);

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

// 4) Start the agent on the specified port
agent.start({ port: process.env.PORT || 7378 })
  .then(() => {
    console.log(`Agent running on port ${process.env.PORT || 7378}`);
  })
  .catch(error => console.error("Error starting agent:", error.message));
