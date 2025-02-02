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

// Handle tasks
aagent.doTask = async function(action) {
    const task = action.task;

    if (!task) return;

    try {
        await this.updateTaskStatus({
            workspaceId: action.workspace.id,
            taskId: task.id,
            status: 'in-progress'
        });

        console.log("Full Task Data:", task);

        // Step 1: Extract ETH address from task input
        let ethAddress = task.input?.match(/0x[a-fA-F0-9]{40}/i)?.[0];

        // Step 2: If missing, check human assistance responses
        if (!ethAddress && task.humanAssistanceRequests?.length > 0) {
            for (const request of task.humanAssistanceRequests) {
                const potentialAddress = request.response?.match(/0x[a-fA-F0-9]{40}/i)?.[0];
                if (potentialAddress) {
                    ethAddress = potentialAddress;
                    break;
                }
            }
        }

        // Step 3: If ETH address is STILL missing, notify the project manager again
        if (!ethAddress) {
            console.log("Project Manager did not update the input field. Sending another request.");
            await this.requestHumanAssistance({
                workspaceId: action.workspace.id,
                taskId: task.id,
                type: 'text',
                question: `🚨 **Attention Project Manager!**
                
                The Ethereum wallet address **must be added to the "input" field of this task**. 
                
                Right now, it is still missing, and the task cannot proceed.
                
                **Please enter the Ethereum address in the input field** in the correct format: **0x followed by 40 hexadecimal characters.**
                
                If the address is only sent as a chat reply, it will **not be processed correctly**.`
            });
            return;
        }

        console.log("ETH Address Found:", ethAddress);

        // Step 4: Store ETH address in task.input to persist
        task.input = ethAddress;

        // Step 5: Proceed with transaction analysis using the ETH address
        const result = await summarizeTokenTransactions(ethAddress);

        await this.completeTask({
            workspaceId: action.workspace.id,
            taskId: task.id,
            output: `Analysis Results:\n${result.chatGPTResponse}\n\nDetailed view: ${result.overviewURL}`
        });

    } catch (error) {
        console.error("Error in doTask:", error);
        await this.markTaskAsErrored({
            workspaceId: action.workspace.id,
            taskId: task.id,
            error: error.message
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
