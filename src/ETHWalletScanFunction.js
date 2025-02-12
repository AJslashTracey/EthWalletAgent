import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
import Moralis from 'moralis';
import { EvmChain } from '@moralisweb3/common-evm-utils';
import fs from 'fs';

export { summarizeTokenTransactions };

dotenv.config(); // Load environment variables

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

// Initialize Moralis once
await Moralis.start({ apiKey: process.env.MORALIS_API_KEY });
console.log("Moralis initialized.");

async function getTokenBalance(walletAddress, contractAddress) {
  const apiKey = apiKeys[apiIndex];
  apiIndex = (apiIndex + 1) % apiKeys.length; 

  const url = `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${contractAddress}&address=${walletAddress}&tag=latest&apikey=${apiKey}`;
  
  console.log(`Using API Key ${apiIndex + 1}: ${url}`);

  try {
    await delay(200); // Prevent hitting rate limits
    const response = await axios.get(url);

    if (response.data.status !== "1") {
      console.log("API Error:", response.data.message);
      return '0';
    }

    return response.data.result || '0';
  } catch (error) {
    console.log("Token amount couldn't be determined", error);
    return '0';
  }
}

async function runApp(walletAddress) {
  try {
    const address = walletAddress.trim().toLowerCase();
    const chain = EvmChain.ETHEREUM;

    console.log("Fetching token balances...");

    const response = await Moralis.EvmApi.token.getWalletTokenBalances({
      address,
      chain,
    });

    console.log("Processing token data...");

    // Extract and normalize token data
    const tokenData = response.toJSON().map((token) => ({
      name: token.name ? token.name.trim().replace(/\s+/g, ' ').toLowerCase() : "unknown_token",
      balance: parseFloat(token.balance) / Math.pow(10, token.decimals),
      percentage_of_total_supply: token.percentage_relative_to_total_supply || 0,
      security_score: token.security_score || "Not Available", 
      contractAddress: token.token_address || "unknown_contract"
    }));

    console.log("Formatted Token Data:", tokenData);

    const outputPath = "./tokens.json"; 
    fs.writeFileSync(outputPath, JSON.stringify(tokenData, null, 2));
    console.log(`Token data saved to ${outputPath}!`);

    return tokenData;
  } catch (error) {
    console.error("Error fetching or processing token balances:", error);
    return [];
  }
}


async function summarizeTokenTransactions(walletAddress) {
  try {
    // Normalize wallet address
    walletAddress = walletAddress.trim().toLowerCase();
    
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      throw new Error("Invalid Ethereum address format: " + walletAddress);
    }

    const apiKey = apiKeys[apiIndex];
    apiIndex = (apiIndex + 1) % apiKeys.length; 

    const etherscanUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${walletAddress}&page=1&offset=50&sort=desc&apikey=${apiKey}`;
    console.log(etherscanUrl);
    const overviewURL = `https://platform.spotonchain.ai/en/profile?address=${walletAddress}`;

    const response = await axios.get(etherscanUrl, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });

    if (response.data.status !== "1" || response.data.message === "NOTOK") {
      throw new Error(`Etherscan API error: ${response.data.result || response.data.message}`);
    }

    const transactions = response.data.result;
    if (!transactions || transactions.length === 0) {
      return { chatGPTResponse: "No recent token transactions found.", overviewURL };
    }

    const simplifiedTx = transactions.slice(0, 10).map(tx => ({
      flow: tx.from.toLowerCase() === walletAddress ? 'outflow' : 'inflow',
      tokenName: tx.tokenName,
      timestamp: new Date(parseInt(tx.timeStamp) * 1000).toLocaleString(),
      transactionHash: tx.hash,
      contractAddress: tx.contractAddress
    }));

    const updatedTransaction = [];
    for (const tx of simplifiedTx) {
      const balance = await getTokenBalance(walletAddress, tx.contractAddress);
      if (balance !== '0') {
        updatedTransaction.push(tx);
      }
    }

    const tokenData = await runApp(walletAddress);

    // Ensure that only tokens in both transactions & holdings are included
    const heldTokens = new Set(tokenData.map(t => t.name));
    const filteredTransactions = updatedTransaction.filter(tx => heldTokens.has(tx.tokenName));

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("Updated transactions:", filteredTransactions);

    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Summarize token transactions: 1) Current token holdings 2) Tokens bought/sold in last 1/3/7 days. Use only tokens that appear in both holdings and transactions."
        },
        {
          role: "user",
          content: `Transactions: ${JSON.stringify(filteredTransactions, null, 2)}\nToken Data: ${JSON.stringify(tokenData, null, 2)}`
        }
      ],
      max_tokens: 500,
      temperature: 0.3
    });

    console.log(gptResponse.choices[0].message.content)

    return {
      chatGPTResponse: gptResponse.choices[0].message.content,
      overviewURL
    };

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
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error);
  }
  console.timeEnd("Total Execution Time");
})();
