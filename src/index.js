import { Agent } from '@openserv-labs/sdk';
import { z } from 'zod';
import dotenv from 'dotenv';
import { summarizeTokenTransactions } from './ETHWalletScanFunction.js';


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
    openaiApiKey: process.env.OPENAI_API_KEY,
    onError: (error, context) => {
        console.error('Agent error:', error.message, context);
    }
});

agent.addCapabilities([
    {
      name: 'summarizeEthTransactions',
      description: 'Summarizes inflow and outflow token transactions for a specified wallet address.',
      schema: z.object({
        walletAddress: z.string().min(42, "Ethereum address must be 42 characters").max(42)
      }),
      async run({ args, action }) {
        try {
          console.log('Received request for wallet:', args.walletAddress); // Add logging
          
          // Validate wallet address format before proceeding
          if (!/^0x[a-fA-F0-9]{40}$/.test(args.walletAddress)) {
            throw new Error('Invalid Ethereum address format');
          }

          // Validate task context if you’re using OpenServ's task-based system
          if (!action?.workspace?.id || !action?.task?.id) {
            throw new Error('Task context required');
          }
  
          // (Optional) Update task status and add logs for your own tracking
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
  
          // Call your imported function to summarize token transactions
          const { chatGPTResponse, UrlToAccount } = await summarizeTokenTransactions(args.walletAddress);
          console.log('API response received:', { chatGPTResponse, UrlToAccount }); // Add logging
  
          // Build final analysis object
          const analysis = {
            success: true,
            walletAddress: args.walletAddress,
            // The function returns a GPT summary (chatGPTResponse) and a link (UrlToAccount)
            summary: chatGPTResponse,
            link: UrlToAccount,
            timestamp: new Date().toISOString()
          };
  
          // Complete the task and include results (if using an OpenServ-like flow)
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
  
          // Also return the result
          return JSON.stringify({
            newMessages: [
              `Successfully analyzed transactions for ${args.walletAddress}`
            ],
            outputToolCallId: action.task.id,
            result: analysis
          });
        } catch (error) {
          console.error('Error in summarizeEthTransactions:', error); // Add detailed error logging
          // If something goes wrong, return the error
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

// Finally, start the agent
agent.start()  // The port will be handled by the default value (7378)
.then(() => {
    console.log(`Agent running on port ${process.env.PORT || 7378}`);
})
.catch(error => {
    console.error("Error starting agent:", error);
    process.exit(1);
});