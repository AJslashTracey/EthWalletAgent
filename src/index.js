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
    
    if (!task) {
        console.log("[doTask] No task found in action:", JSON.stringify(action));
        return;
    }
    
    console.log("[doTask] Processing task ID:", task.id);
    
    try {
        await this.updateTaskStatus({
            workspaceId: action.workspace.id,
            taskId: task.id,
            status: 'in-progress'
        });

        // Helper function to save analysis to file
        const saveAnalysisToFile = async (address, markdownContent) => {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `analysis_${address}_${timestamp}.md`;
            
            try {
                await this.uploadFile({
                    workspaceId: action.workspace.id,
                    path: `reports/${fileName}`,
                    file: markdownContent,
                    taskIds: [task.id],
                    skipSummarizer: true // Skip summarization since it's already formatted
                });
                
                console.log(`[doTask] Analysis saved to file: reports/${fileName}`);
                return fileName;
            } catch (error) {
                console.error('[doTask] Error saving analysis to file:', error);
                throw error;
            }
        };

        // First check for human assistance response with improved logging
        if (task.humanAssistanceRequests && task.humanAssistanceRequests.length > 0) {
            const lastRequest = task.humanAssistanceRequests[task.humanAssistanceRequests.length - 1];
            console.log("[doTask] Found last human assistance request:", {
                requestId: lastRequest?.id,
                status: lastRequest?.status,
                humanResponse: lastRequest?.humanResponse // This is where the response actually is
            });
            
            // The humanResponse is directly on the request object, not in response
            const responseText = lastRequest?.humanResponse;
            console.log("[doTask] Human assistance response text:", responseText);
            
            if (responseText) {
                const addressMatch = responseText.match(/0x[a-fA-F0-9]{40}/i);
                console.log("[doTask] Checking address from human assistance:", {
                    responseText,
                    matched: !!addressMatch,
                    address: addressMatch ? addressMatch[0] : null
                });
                
                if (addressMatch) {
                    console.log("[doTask] Processing address from human assistance:", addressMatch[0]);
                    const result = await summarizeTokenTransactions(addressMatch[0]);
                    
                    const timestamp = new Date().toISOString();
                    const markdownOutput = `# Wallet Analysis Report
## Overview
- **Wallet Address**: ${addressMatch[0]}
- **Analysis Date**: ${new Date().toLocaleString()}
- **Analysis Type**: Token Transaction Analysis

## Analysis Results
${result.chatGPTResponse}

## Additional Information
🔗 [View Detailed Transactions](${result.overviewURL})

---
*Generated by ETHWalletAgent at ${timestamp}*`;

                    // Save analysis to file
                    const fileName = await saveAnalysisToFile(addressMatch[0], markdownOutput);

                    await this.completeTask({
                        workspaceId: action.workspace.id,
                        taskId: task.id,
                        output: `${markdownOutput}\n\nAnalysis saved to file: ${fileName}`
                    });
                    return;
                }
            }
        }

        // Then check task input
        let addressMatch;
        if (task.input) {
            addressMatch = task.input.match(/0x[a-fA-F0-9]{40}/i);
            console.log("[doTask] Checking address from task input:", {
                input: task.input,
                matched: !!addressMatch,
                address: addressMatch ? addressMatch[0] : null
            });
        }

        if (addressMatch) {
            console.log("[doTask] Processing address from task input:", addressMatch[0]);
            const result = await summarizeTokenTransactions(addressMatch[0]);
            
            const timestamp = new Date().toISOString();
            const markdownOutput = `# Wallet Analysis Report
## Overview
- **Wallet Address**: ${addressMatch[0]}
- **Analysis Date**: ${new Date().toLocaleString()}
- **Analysis Type**: Token Transaction Analysis

## Analysis Results
${result.chatGPTResponse}

## Additional Information
🔗 [View Detailed Transactions](${result.overviewURL})

---
*Generated by ETHWalletAgent at ${timestamp}*`;

            // Save analysis to file
            const fileName = await saveAnalysisToFile(addressMatch[0], markdownOutput);

            await this.completeTask({
                workspaceId: action.workspace.id,
                taskId: task.id,
                output: `${markdownOutput}\n\nAnalysis saved to file: ${fileName}`
            });
        } else {
            console.log("[doTask] No valid address found, requesting human assistance");
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
            console.log("[doTask] Human assistance request sent for task:", {
                taskId: task.id,
                workspaceId: action.workspace.id
            });
        }
    } catch (error) {
        console.error("[doTask] Error processing task:", {
            taskId: task.id,
            error: error.message,
            stack: error.stack
        });
        
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
