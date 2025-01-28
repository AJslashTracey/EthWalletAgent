import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
export { summarizeTokenTransactions };

dotenv.config();

async function summarizeTokenTransactions(walletAddress) {
    try {
        const apiKey = process.env.ETHERSCAN_API_KEY;
        if (!apiKey) {
            throw new Error("ETHERSCAN_API_KEY is required");
        }

        // Validate wallet address format
        if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
            throw new Error("Invalid Ethereum address format");
        }

        // Normalize address to lowercase for consistent handling
        const normalizedAddress = walletAddress.toLowerCase();
        
        const etherscanUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${normalizedAddress}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`;
        const urlToWallet = `https://platform.spotonchain.ai/en/profile?address=${normalizedAddress}`;

        const response = await axios.get(etherscanUrl, {
            timeout: 10000, // Add timeout
            headers: {
                'Accept': 'application/json'
            }
        });

        // Handle rate limiting
        if (response.data.message === 'NOTOK' && response.data.result?.includes('Max rate limit reached')) {
            throw new Error('Etherscan API rate limit reached. Please try again later.');
        }
        
        // Handle "No transactions found" as a valid response, not an error
        if (response.data.status === "0" && response.data.message === "No transactions found") {
            return { 
                chatGPTResponse: "This wallet has no token transactions.", 
                UrlToAccount: urlToWallet 
            };
        }

        // Handle other API errors
        if (response.data.status !== "1" && response.data.message !== "No transactions found") {
            throw new Error(`Etherscan API error: ${response.data.message}`);
        }

        const transactions = response.data.result || [];
        if (transactions.length === 0) {
            return { 
                chatGPTResponse: "No token transactions found for this wallet.", 
                UrlToAccount: urlToWallet 
            };
        }

        const recentTransactions = transactions.map(tx => ({
            tokenName: tx.tokenName,
            value: parseFloat(tx.value) / Math.pow(10, tx.tokenDecimal),
            direction: tx.from.toLowerCase() === walletAddress.toLowerCase() ? 'Outflow' : 'Inflow',
            timestamp: new Date(parseInt(tx.timeStamp) * 1000).toLocaleString(),
            contractAddress: tx.contractAddress,
            hash: tx.hash
        })).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
        const summary = { inflows: [], outflows: [] };
        recentTransactions.forEach(tx => {
            const category = tx.direction === 'Inflow' ? 'inflows' : 'outflows';
            summary[category].push({
                name: tx.tokenName,
                totalMove: tx.value,
                outInflow: tx.direction,
                timestamp: tx.timestamp,
                contractAddress: tx.contractAddress
            });
        });
        const openai = new OpenAI({ 
            apiKey: process.env.OPENAI_API_KEY 
        });
        const chatGPTResponse = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: "You are a helpful assistant who summarizes inflow and outflow movements from crypto tokens." },
                { role: "user", content: `Here is the data: ${JSON.stringify({ summary, UrlToAccount: urlToWallet }, null, 2)}` }
            ],
            max_tokens: 1000,
            temperature: 1
        });
        return { chatGPTResponse: chatGPTResponse.choices[0].message.content, UrlToAccount: urlToWallet };
    } catch (error) {
        if (error.response?.status === 429) {
            throw new Error('Etherscan API rate limit reached. Please try again later.');
        }
        console.error("Error in summarizeTokenTransactions:", error);
        throw error; // Propagate error to be handled by the agent
    }
}

