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
    // Check if there's an ETH address in any message
    const ethAddressMatch = action.messages.some(msg => 
        msg.message?.toLowerCase().match(/0x[a-fA-F0-9]{40}/i)
    );
    
    if (ethAddressMatch) {
        const address = action.messages[action.messages.length - 1].message.match(/0x[a-fA-F0-9]{40}/i)[0];
        return this.handleToolRoute({
            params: { toolName: 'analyzeWallet' },
            body: { 
                args: { address },
                action,
                messages: action.messages
            }
        });
    }
    
    // Only ask for address if message suggests analysis intent
    const lastMessage = action.messages[action.messages.length - 1].message.toLowerCase();
    if (lastMessage.includes('analyze') || lastMessage.includes('check') || lastMessage.includes('wallet')) {
        await this.sendChatMessage({
            workspaceId: action.workspace.id,
            agentId: action.me.id,
            message: "Please provide an Ethereum wallet address (starting with 0x followed by 40 hex characters) to analyze."
        });
    }
};

agent.doTask = async function(action) {
    const task = action.task;
    if (!task) return;
    
    try {
        await this.updateTaskStatus({
            workspaceId: action.workspace.id,
            taskId: task.id,
            status: 'in-progress'
        });

        // Extract address from task input or last human assistance response
        let address = task.input?.match(/0x[a-fA-F0-9]{40}/i)?.[0];
        
        if (!address && task.humanAssistanceRequests?.length > 0) {
            const lastResponse = task.humanAssistanceRequests[task.humanAssistanceRequests.length - 1]?.response;
            address = lastResponse?.match(/0x[a-fA-F0-9]{40}/i)?.[0];
        }

        if (address) {
            const result = await summarizeTokenTransactions(address);
            await this.completeTask({
                workspaceId: action.workspace.id,
                taskId: task.id,
                output: `**Analysis Results:**\n\n${result.chatGPTResponse}\n\n🔗 [View Detailed Transactions](${result.overviewURL})`
            });
        } else {
            // Only request human assistance if we haven't already
            if (!task.humanAssistanceRequests?.length) {
                await this.requestHumanAssistance({
                    workspaceId: action.workspace.id,
                    taskId: task.id,
                    type: 'text',
                    question: "⚠️ I need a **valid Ethereum wallet address** to proceed.\n\n💡 Please provide one in this format:\n`0x` followed by **40 hexadecimal characters**.",
                    agentDump: {
                        conversationHistory: action.messages,
                        expectedFormat: "Ethereum address (0x followed by 40 hexadecimal characters).",
                        processResponse: true 
                    }
                });
            }
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
