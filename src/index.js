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

const agent = new Agent({
    systemPrompt: `You are an Ethereum wallet analysis agent specializing in token transaction analysis.
When asked to analyze a wallet or create a plan, follow these steps:
1. If no ETH address is provided, ask the user for one
2. Once address is provided, validate it's a proper ETH address (0x followed by 40 hex chars)
3. If valid, analyze the transactions
4. If invalid, explain the proper format and ask again

Always maintain context between messages and remember previously provided addresses.`
});

agent.addCapability({
    name: 'analyzeWallet',
    description: 'Analyze token transactions for an Ethereum wallet address',
    schema: z.object({
        address: z.string().describe('The Ethereum wallet address to analyze')
    }),
    async run({ args, action }, messages) {
        try {
            // Check if this is a direct wallet analysis request or part of a conversation
            const lastUserMessage = messages.findLast(m => m.role === 'user')?.content || '';
            const isValidAddress = args.address.match(/^0x[a-fA-F0-9]{40}$/);

            if (!isValidAddress) {
                return `The address "${args.address}" is not a valid Ethereum address. Please provide an address in the format 0x followed by 40 hexadecimal characters.`;
            }

            const result = await summarizeTokenTransactions(args.address);
            
            if (result.chatGPTResponse) {
                return `Analysis complete!\n\n${result.chatGPTResponse}\n\nFor a detailed view, check: ${result.overviewURL}`;
            } else {
                return 'No recent token transactions found for this address.';
            }
        } catch (error) {
            if (error.message.includes('ETHERSCAN_API_KEY')) {
                return 'Internal configuration error. Please contact support.';
            }
            return `Error analyzing wallet: ${error.message}`;
        }
    }
});

// Handle chat responses
agent.respondToChat = async function(action) {
    const lastMessage = action.messages[action.messages.length - 1].message.toLowerCase();
    
    // Check if the message contains an ETH address
    const addressMatch = lastMessage.match(/0x[a-fA-F0-9]{40}/i);
    
    if (addressMatch) {
        // If we found an ETH address, analyze it
        await this.handleToolRoute({
            params: { toolName: 'analyzeWallet' },
            body: { 
                args: { address: addressMatch[0] },
                action,
                messages: action.messages
            }
        });
    } else if (lastMessage.includes('plan') || lastMessage.includes('analyze')) {
        // If it's a planning request without an address
        await this.sendChatMessage({
            workspaceId: action.workspace.id,
            agentId: action.me.id,
            message: "I'll help you analyze Ethereum wallet transactions. Please provide the Ethereum wallet address you'd like to analyze (it should start with 0x followed by 40 characters)."
        });
    } else {
        // For any other message, ask for the address
        await this.sendChatMessage({
            workspaceId: action.workspace.id,
            agentId: action.me.id,
            message: "I need a valid Ethereum wallet address to analyze. Please provide one in the format 0x followed by 40 hexadecimal characters."
        });
    }
};

agent.doTask = async function(action) {
    const task = action.task;
    if (!task) return;
  
    try {
      // Mark task in progress
      await this.updateTaskStatus({
        workspaceId: action.workspace.id,
        taskId: task.id,
        status: 'in-progress'
      });
  
      // Figure out which tool is being called
      if (task.toolName === 'analyzeWallet') {
        // (your existing analyzeWallet logic goes here)
        // ...
      }
      else if (task.toolName === 'findTokenInformations') {
        let tokenInput;
  
        // 1) Attempt to use the task input
        if (task.input && typeof task.input === 'string') {
          tokenInput = task.input.trim();
        }
  
        // 2) If no valid input in the task, check last human assistance
        if (!tokenInput && task.humanAssistanceRequests && task.humanAssistanceRequests.length > 0) {
          const lastResponse = task.humanAssistanceRequests[task.humanAssistanceRequests.length - 1]?.response;
          if (lastResponse && typeof lastResponse === 'string') {
            tokenInput = lastResponse.trim();
            task.input = tokenInput; 
          }
        }
  
        // 3) If still no input, request HAR
        if (!tokenInput) {
          await this.requestHumanAssistance({
            workspaceId: action.workspace.id,
            taskId: task.id,
            type: 'text',
            question: "I need a **ticker symbol** or **token name** to fetch crypto details. Please provide something like `ETH`, `BTC`, or a token name.",
            agentDump: {
              conversationHistory: action.messages,
              expectedFormat: "Crypto ticker (like 'ETH' or 'BTC') or token name.",
              processResponse: true
            }
          });
          console.log("HAR request was sent");
          return;
        }
  
        // 4) We have a token symbol or name, so call your tool
        const result = await dexScreenerService.findTokenBySymbol(tokenInput);
        if (!result) {
          // If not found, optionally request HAR again or just complete with a message
          await this.completeTask({
            workspaceId: action.workspace.id,
            taskId: task.id,
            output: `No data found for "${tokenInput}". Please confirm the symbol or name.`
          });
        } else {
          // If found, mark the task as complete
          await this.completeTask({
            workspaceId: action.workspace.id,
            taskId: task.id,
            output: `Fetched data for ${result.name} (${result.symbol}). Details saved in JSON.`
          });
        }
      }
      else if (task.toolName === 'twitterPostMessage') {
        // (the same approach for posting a Tweet)
        // ...
      }
      else {
        // If you have multiple tools, you can handle them here or default
        console.log("No matching toolName. Doing nothing.");
      }
    } catch (error) {
      await this.markTaskAsErrored({
        workspaceId: action.workspace.id,
        taskId: task.id,
        error: `Error: ${error.message}`
      });
    }
  };
  


agent.start()
    .then(() => {
        console.log(`Agent running on port ${process.env.PORT || 8080}`);
    })
    .catch(error => {
        console.error("Error starting agent:", error.message);
        process.exit(1); // Exit on startup error
    });
