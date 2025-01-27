import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv"

dotenv.config()

async function getLatestTokenTransactions(walletAddress, limit = 20) {
    const apiKey = 'UVV9W98IGNG6DWGTV4DDWJBUWQX6644EM9';
    const url = `https://api.etherscan.io/api?module=account&action=tokentx&address=${walletAddress}&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`;

    try {
        const response = await axios.get(url);
        const tokenTransactions = response.data.result;

        if (!tokenTransactions || tokenTransactions.length === 0) {
            console.log('No token transactions found for this address.');
            return;
        }

        // Filter, sort, and summarize the most recent inflows and outflows
        const filteredTransactions = filterAndSummarizeTransactions(tokenTransactions, walletAddress, limit);

        // Output the filtered summary as JSON
        console.log("Filtered Token Summary:");
        console.log(JSON.stringify(filteredTransactions, null, 2));
    } catch (error) {
        console.error('Error fetching token transactions:', error.message, error.response?.data);
    }
}

function filterAndSummarizeTransactions(transactions, walletAddress, limit) {
    const recentTransactions = transactions
        .map(tx => ({
            tokenName: tx.tokenName,
            value: parseFloat(tx.value) / Math.pow(10, tx.tokenDecimal), // Adjust for decimals
            direction: tx.from.toLowerCase() === walletAddress.toLowerCase() ? 'Outflow' : 'Inflow',
            timestamp: new Date(parseInt(tx.timeStamp) * 1000).toLocaleString(), // Convert timestamp to human-readable date
            contractAddress: tx.contractAddress, // Include contract address
            hash: tx.hash // Include transaction hash for reference
        }))
        .sort((a, b) => b.timestamp - a.timestamp) // Sort by most recent transactions
        .slice(0, limit); // Limit the number of transactions

    // Summarize the most recent inflows and outflows
    const summary = {
        inflows: [],
        outflows: []
    };

    recentTransactions.forEach(tx => {
        if (tx.direction === 'Inflow') {
            summary.inflows.push({
                name: tx.tokenName,
                totalMove: tx.value,
                outInflow: tx.direction,
                timestamp: tx.timestamp,
                contractAddress: tx.contractAddress
            });
        } else {
            summary.outflows.push({
                name: tx.tokenName,
                totalMove: tx.value,
                outInflow: tx.direction,
                timestamp: tx.timestamp,
                contractAddress: tx.contractAddress
            });
        }
    });
    const url = `https://platform.spotonchain.ai/en/profile?address=${walletAddress}`
    return {summary: summary, UrlToAccount: url};
}

let data

(async () => {
    const walletAddress = "0x6dd63e4dd6201b20bc754b93b07de351ba053fd2";
     data = await getLatestTokenTransactions(walletAddress, 20);
})();




const openai = new OpenAI({
    apiKey: "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"
});


const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
        { role: "system", content: "You are a helpful assistan who sums up buys and sells from crypto tokens." },
        { role: "user", JSON.stringify(data, null, 2)},
    ],
    max_tokens: 10000,
    temperature: 1
})


console.log(response)