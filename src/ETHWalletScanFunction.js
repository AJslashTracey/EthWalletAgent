import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
export { summarizeTokenTransactions };


dotenv.config();

async function summarizeTokenTransactions(walletAddress) {
    const apiKey = 'UVV9W98IGNG6DWGTV4DDWJBUWQX6644EM9';
    const etherscanUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${walletAddress}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`;
    const urlToWallet = `https://platform.spotonchain.ai/en/profile?address=${walletAddress}`;
    try {
        const response = await axios.get(etherscanUrl);
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
                contractAddress: tx.contractAddress
            });
        });
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
        return { chatGPTResponse: `Error: ${error.message}`, UrlToAccount: urlToWallet };
    }
}

(async () => {
    const result = await summarizeTokenTransactions("0x6dd63e4dd6201b20bc754b93b07de351ba053fd2");
    console.log(result);
})();
