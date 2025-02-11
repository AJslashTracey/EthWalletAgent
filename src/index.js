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
    systemPrompt: `Ethereum wallet analysis expert. Validate addresses and attach Markdown reports.`
});

const generateMarkdownReport = (address, result) => {
    return `# Ethereum Wallet Analysis Report
**Address:** [${address}](${result.overviewURL})
**Generated at:** ${new Date().toISOString()}

## Summary
${result.chatGPTResponse}

## Transaction Statistics
- Total transactions: ${result.totalTransactions || 'N/A'}
- Unique tokens: ${result.uniqueTokens || 'N/A'}
- First transaction: ${result.firstTxDate || 'N/A'}
- Last transaction: ${result.lastTxDate || 'N/A'}

[View full transaction history](${result.overviewURL})`;
};

agent.addCapability({
    name: 'analyzeWallet',
    description: 'Analyze Ethereum wallet transactions and generate report',
    schema: z.object({
        address: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
    }),
    async run({ args }) {
        try {
            const { address } = args;
            const result = await summarizeTokenTransactions(address);
            const markdownContent = generateMarkdownReport(address, result);

            // According to SDK docs: Return files array with content
            return {
                message: `Analysis complete for ${address}`,
                files: [{
                    name: `wallet-analysis-${address}.md`,
                    content: markdownContent,
                    mimeType: 'text/markdown'
                }]
            };
        } catch (error) {
            return {
                message: `Error: ${error.message}`,
                files: [] // Maintain consistent response structure
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

        // Address extraction logic
        const extractAddress = () => {
            const sources = [
                task.input,
                ...(task.humanAssistanceRequests || []).map(r => r.humanResponse)
            ];

            for (const text of sources) {
                const match = text?.match(/0x[a-fA-F0-9]{40}/i);
                if (match) return match[0];
            }
            return null;
        };

        const address = extractAddress();

        if (address) {
            const result = await summarizeTokenTransactions(address);
            const markdownContent = generateMarkdownReport(address, result);

            // Complete task with file attachment
            await this.completeTask({
                workspaceId: action.workspace.id,
                taskId: task.id,
                output: `**Analysis completed for ${address}**`,
                files: [{
                    name: `task-report-${address}.md`,
                    content: markdownContent,
                    mimeType: 'text/markdown'
                }]
            });
        } else {
            await this.requestHumanAssistance({
                workspaceId: action.workspace.id,
                taskId: task.id,
                type: 'text',
                question: "Please provide a valid Ethereum address (0x...)",
                agentDump: {
                    validationPattern: "^0x[a-fA-F0-9]{40}$"
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

// Updated chat handler with proper file attachment
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
            message: "Please provide a valid Ethereum address (format: 0x...)",
            files: [] // Maintain consistent response structure
        });
    }
};

agent.start()
    .then(() => console.log(`Agent running on port ${process.env.PORT || 8080}`))
    .catch(error => {
        console.error("Agent startup failed:", error);
        process.exit(1);
    });