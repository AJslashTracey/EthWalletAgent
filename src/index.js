import { Agent } from '@openserv-labs/sdk';
import { z } from 'zod';
import dotenv from 'dotenv';
import { summarizeTokenTransactions } from './ETHWalletScanFunction.js';

dotenv.config();

const requiredEnvVars = ['OPENSERV_API_KEY_', 'ETHERSCAN_API_KEY', 'OPENAI_API_KEY'];
requiredEnvVars.forEach(envVar => {
    if (!process.env[envVar]) throw new Error(`${envVar} environment variable is required`);
});

const agent = new Agent({
    systemPrompt: `You are an Ethereum wallet analysis agent specializing in token transaction analysis.
Follow these steps:
1. Request ETH address if not provided
2. Validate address format
3. Analyze transactions
4. Provide report with file attachment`
});

// Enhanced Markdown generation function
const generateAnalysisReport = (address, analysisResult) => {
    return `# Ethereum Wallet Analysis Report

**Wallet Address:** [${address}](${analysisResult.overviewURL})  
**Analysis Date:** ${new Date().toISOString()}

## Summary
${analysisResult.chatGPTResponse}

## Key Statistics
- Total Transactions: ${analysisResult.totalTransactions || 'N/A'}
- Unique Tokens: ${analysisResult.uniqueTokens || 'N/A'}
- First Transaction: ${analysisResult.firstTxDate || 'N/A'}
- Last Transaction: ${analysisResult.lastTxDate || 'N/A'}

[View full transaction history](${analysisResult.overviewURL})`;
};

agent.addCapability({
    name: 'analyzeWallet',
    description: 'Analyze token transactions for an Ethereum wallet address',
    schema: z.object({
        address: z.string().describe('Valid Ethereum wallet address (0x...)')
    }),
    async run({ args, action }) {
        try {
            const addr = args.address.trim();
            if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
                return { message: `Invalid Ethereum address: ${addr}. Please provide a valid 0x-prefixed hexadecimal address.` };
            }

            const analysis = await summarizeTokenTransactions(addr);
            const markdownContent = generateAnalysisReport(addr, analysis);
            
            // Save to file system
            const fileUpload = await agent.files.upload({
                name: `wallet-analysis-${addr}.md`,
                content: markdownContent,
                mimeType: 'text/markdown'
            });

            return {
                message: `Analysis complete! 📊\n\n${analysis.chatGPTResponse}\n\n📎 [Download Full Report](file://${fileUpload.id})`,
                fileIds: [fileUpload.id]
            };
        } catch (error) {
            console.error('Analysis error:', error);
            return { message: `❌ Analysis failed: ${error.message}` };
        }
    }
});

agent.doTask = async function(action) {
    const { task } = action;
    if (!task) return console.error('No task in action:', action);

    try {
        await this.updateTaskStatus({
            workspaceId: action.workspace.id,
            taskId: task.id,
            status: 'in-progress'
        });

        const resolveAddress = async (input) => {
            const match = input.match(/0x[a-fA-F0-9]{40}/i);
            return match ? match[0] : null;
        };

        let address;
        // Check human assistance responses first
        if (task.humanAssistanceRequests?.length > 0) {
            const lastResponse = task.humanAssistanceRequests.slice(-1)[0]?.humanResponse;
            address = await resolveAddress(lastResponse);
        }

        // Then check original task input
        if (!address && task.input) address = await resolveAddress(task.input);

        if (address) {
            const analysis = await summarizeTokenTransactions(address);
            const markdownContent = generateAnalysisReport(address, analysis);
            
            // Upload report file
            const fileUpload = await this.files.upload({
                name: `wallet-analysis-${address}.md`,
                content: markdownContent,
                mimeType: 'text/markdown'
            });

            await this.completeTask({
                workspaceId: action.workspace.id,
                taskId: task.id,
                output: `**Analysis Complete**\n${analysis.chatGPTResponse}\n\n[Download Full Report](file://${fileUpload.id})`,
                fileIds: [fileUpload.id]
            });
        } else {
            await this.requestHumanAssistance({
                workspaceId: action.workspace.id,
                taskId: task.id,
                type: 'text',
                question: "🔍 Ethereum Address Required\n\nPlease provide a valid wallet address (format: 0x followed by 40 hex characters).",
                agentDump: {
                    expectedFormat: "Ethereum address: 0x...",
                    validationRegex: "^0x[a-fA-F0-9]{40}$"
                }
            });
        }
    } catch (error) {
        console.error('Task processing error:', error);
        await this.markTaskAsErrored({
            workspaceId: action.workspace.id,
            taskId: task.id,
            error: `🚨 Critical Error: ${error.message}`
        });
    }
};

agent.respondToChat = async function(action) {
    const lastMessage = action.messages.slice(-1)[0].message;
    const addressMatch = lastMessage.match(/0x[a-fA-F0-9]{40}/i);

    if (addressMatch) {
        await this.handleToolRoute({
            params: { toolName: 'analyzeWallet' },
            body: {
                args: { address: addressMatch[0] },
                action,
                messages: action.messages
            }
        });
    } else {
        await this.sendChatMessage({
            workspaceId: action.workspace.id,
            agentId: action.me.id,
            message: "To begin analysis, please provide an Ethereum wallet address (format: 0x followed by 40 hexadecimal characters)."
        });
    }
};

agent.start()
    .then(() => console.log(`🟢 Agent running on port ${process.env.PORT || 8080}`))
    .catch(error => {
        console.error("🔴 Agent startup failed:", error);
        process.exit(1);
    });