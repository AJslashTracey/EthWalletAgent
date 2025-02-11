import { Agent } from '@openserv-labs/sdk';
import { z } from 'zod';
import dotenv from 'dotenv';
import { summarizeTokenTransactions } from './ETHWalletScanFunction.js';

dotenv.config();

// Validate environment variables
['OPENSERV_API_KEY_', 'ETHERSCAN_API_KEY', 'OPENAI_API_KEY'].forEach(envVar => {
    if (!process.env[envVar]) throw new Error(`${envVar} is required`);
});

const agent = new Agent({
    systemPrompt: `Ethereum wallet analysis expert. Always validate addresses and attach reports.`
});

// Unified Markdown generator
const generateMarkdownReport = (address, result) => {
    return `# Ethereum Wallet Analysis Report
**Address:** \`${address}\`  
**Date:** ${new Date().toLocaleDateString()}

## Summary
${result.chatGPTResponse}

## Quick Links
- [View on Etherscan](${result.overviewURL})
- [Raw Transaction Data](${result.rawDataURL || '#'})`;
};

agent.addCapability({
    name: 'analyzeWallet',
    description: 'Analyze Ethereum wallet transactions',
    schema: z.object({
        address: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
    }),
    async run({ args }) {
        try {
            const { address } = args;
            const result = await summarizeTokenTransactions(address);
            
            return {
                message: `✅ Analysis complete for ${address}\n${result.chatGPTResponse}`,
                files: [{
                    name: `report-${address}.md`,
                    content: generateMarkdownReport(address, result)
                }]
            };
        } catch (error) {
            return {
                message: `❌ Error: ${error.message}`,
                files: [] // Ensure files array exists even on error
            };
        }
    }
});

agent.doTask = async function(action) {
    const { task } = action;
    if (!task) return;

    try {
        await this.updateTaskStatus({
            workspaceId: action.workspace.id,
            taskId: task.id,
            status: 'in-progress'
        });

        // Address resolution logic
        const getAddress = () => {
            const sources = [
                task.humanAssistanceRequests?.[0]?.humanResponse,
                task.input
            ];
            
            for (const source of sources) {
                const match = source?.match(/0x[a-fA-F0-9]{40}/i);
                if (match) return match[0];
            }
            return null;
        };

        const address = getAddress();
        
        if (address) {
            const result = await summarizeTokenTransactions(address);
            
            await this.completeTask({
                workspaceId: action.workspace.id,
                taskId: task.id,
                output: `**Analysis Results for ${address}**\n${result.chatGPTResponse}`,
                files: [{
                    name: `task-report-${address}.md`,
                    content: generateMarkdownReport(address, result)
                }]
            });
        } else {
            await this.requestHumanAssistance({
                workspaceId: action.workspace.id,
                taskId: task.id,
                type: 'text',
                question: "Please provide a valid Ethereum address (0x...)",
                agentDump: {
                    validationPattern: "/^0x[a-fA-F0-9]{40}$/"
                }
            });
        }
    } catch (error) {
        await this.markTaskAsErrored({
            workspaceId: action.workspace.id,
            taskId: task.id,
            error: `Processing failed: ${error.message}`
        });
    }
};

// Chat handler
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
            message: "Please provide an Ethereum address to analyze (format: 0x...)",
            files: [] // Maintain consistent response structure
        });
    }
};

agent.start()
    .then(() => console.log(`Agent running on ${process.env.PORT || 3000}`))
    .catch(console.error);