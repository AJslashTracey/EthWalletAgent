import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
export { summarizeTokenTransactions };

dotenv.config(); // Ensure environment variables are loaded

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const apiKeys = [
  process.env.ETHERSCAN_API_KEY1,
  process.env.ETHERSCAN_API_KEY2,
  process.env.ETHERSCAN_API_KEY3,
  process.env.ETHERSCAN_API_KEY4,
  process.env.ETHERSCAN_API_KEY5,
].filter(Boolean);

if (apiKeys.length === 0) {
  throw new Error("No Etherscan API keys found in environment variables!");
}

let apiIndex = 0;

async function getTokenBalance(walletAddress, contractAddress) {
  const apiKey = apiKeys[apiIndex]; // Get current API key
  apiIndex = (apiIndex + 1) % apiKeys.length; // Rotate API key

  const url = `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${contractAddress}&address=${walletAddress}&tag=latest&apikey=${apiKey}`;
  console.log(`Using API Key ${apiIndex + 1}: ${url}`);

  try {
    const response = await axios.get(url);
    console.log(response.data);
    return response.data.result || '0';
  } catch (error) {
    console.log("Token amount couldn't be determined", error);
    return '0';
  }
}

async function summarizeTokenTransactions(walletAddress) {
  try {
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      throw new Error("Invalid Ethereum address format");
    }

    const normalizedAddress = walletAddress.toLowerCase();
    const apiKey = apiKeys[apiIndex];
    apiIndex = (apiIndex + 1) % apiKeys.length; 

    const etherscanUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${normalizedAddress}&page=1&offset=50&sort=desc&apikey=${apiKey}`;
    console.log(etherscanUrl);
    const overviewURL = `https://platform.spotonchain.ai/en/profile?address=${normalizedAddress}`;

    const response = await axios.get(etherscanUrl, { timeout: 10000, headers: { 'Accept': 'application/json' } });

    if (response.data.status !== "1" || response.data.message === "NOTOK") {
      throw new Error(`Etherscan API error: ${response.data.result || response.data.message}`);
    }

    const transactions = response.data.result;
    if (!transactions || transactions.length === 0) {
      return { chatGPTResponse: "No recent token transactions found.", overviewURL };
    }

    const simplifiedTx = transactions.slice(0, 10).map(tx => ({
      flow: tx.from.toLowerCase() === normalizedAddress ? 'outflow' : 'inflow',
      tokenName: tx.tokenName,
      timestamp: new Date(parseInt(tx.timeStamp) * 1000).toLocaleString(),
      transactionHash: tx.hash,
      contractAddress: tx.contractAddress
    }));

    const updatedTransaction = [];
    for (const tx of simplifiedTx) {
      const balance = await getTokenBalance(normalizedAddress, tx.contractAddress);
      if (balance !== '0') {
        updatedTransaction.push(tx);
      }
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("Updated transactions:", updatedTransaction);
    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "Summarize token transactions in 3-5 bullet points. Include flow directions, main tokens, and timing patterns." },
        { role: "user", content: `Analyze these transactions: ${JSON.stringify(updatedTransaction)}` }
      ],
      max_tokens: 300,
      temperature: 0.3
    });

    return { chatGPTResponse: gptResponse.choices[0].message.content, overviewURL };

  } catch (error) {
    if (error.response?.status === 429) {
      throw new Error('Etherscan API rate limit reached. Please try again later.');
    }
    console.error("Error in summarizeTokenTransactions:", error);
    throw error;
  }
}

(async () => {
  console.time("Total Execution Time");
  try {
    const result = await summarizeTokenTransactions("0x8db4ab33b7091d458f068a23a0be88cf6fcd00f6");
    console.log(result);
  } catch (error) {
    console.error(error);
  }
  console.timeEnd("Total Execution Time");
})();