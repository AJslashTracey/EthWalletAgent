import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
export { summarizeTokenTransactions };

dotenv.config();


//checking if the wallet owns the token which was involved in the transaction
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getTokenBalance(walletAddress, contractAddress, apiKey) {
    const url = `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${contractAddress}&address=${walletAddress}&tag=latest&apikey=${apiKey}`;
    try {
        await delay(5000); // Wait 5 seconds before each API request
        const response = await axios.get(url);
        console.log(response.data)
        return response.data.result || '0';
    } catch (error) {
        console.log("Token amount couldn't be determined", error);
        return '0';
    }
}

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
        if (response.data.message === 'NOTOK' && response.data.result.includes('Max rate limit reached')) {
            throw new Error('Etherscan API rate limit reached. Please try again later.');
        }
        
        if (response.data.status !== "1") {
            throw new Error(`Etherscan API error: ${response.data.message}`);
        }

        const transactions = response.data.result;
        if (!transactions || transactions.length === 0) return { chatGPTResponse: "No transactions found.", UrlToAccount: urlToWallet };
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
                contractAddress: tx.contractAddress,
                tokenName: tx.tokenName // Added tokenName here
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
        return { chatGPTResponse: chatGPTResponse.choices[0].message.content };
    } catch (error) {
        if (error.response?.status === 429) {
            throw new Error('Etherscan API rate limit reached. Please try again later.');
        }
        console.error("Error in summarizeTokenTransactions:", error);
        throw error; // Propagate error to be handled by the agent
    }
}


(async () => {
    const result = await summarizeTokenTransactions("0x6dd63e4dd6201b20bc754b93b07de351ba053fd2");
    console.log(result);
})();