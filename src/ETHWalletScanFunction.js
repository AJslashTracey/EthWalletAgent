import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
export { summarizeTokenTransactions };

dotenv.config();

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getTokenBalance(walletAddress, contractAddress, apiKey) {
  const url = `https://api.etherscan.io/api?module=account&action=tokenbalance&contractaddress=${contractAddress}&address=${walletAddress}&tag=latest&apikey=${apiKey}`;
  try {
    await delay(5000); 
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
    const apiKey = process.env.ETHERSCAN_API_KEY;
    if (!apiKey) {
      throw new Error("ETHERSCAN_API_KEY is required");
    }

    if (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      throw new Error("Invalid Ethereum address format");
    }

    // Normalize the address for consistency
    const normalizedAddress = walletAddress.toLowerCase();
    const etherscanUrl = `https://api.etherscan.io/api?module=account&action=tokentx&address=${normalizedAddress}&page=1&offset=50&sort=desc&apikey=${apiKey}`;
    const overviewURL = `https://platform.spotonchain.ai/en/profile?address=${normalizedAddress}`;

    const response = await axios.get(etherscanUrl, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });

    if (response.data.status !== "1" || response.data.message === "NOTOK") {
      const errorMsg = response.data.result || response.data.message;
      throw new Error(`Etherscan API error: ${errorMsg}`);
    }

    const transactions = response.data.result;
    if (!transactions || transactions.length === 0) {
      return { chatGPTResponse: "No recent token transactions found.", overviewURL };
    }

    const simplifiedTx = transactions.map(tx => ({
      flow: tx.from.toLowerCase() === normalizedAddress ? 'outflow' : 'inflow',
      tokenName: tx.tokenName,
      timestamp: new Date(parseInt(tx.timeStamp) * 1000).toLocaleString(),
      transactionHash: tx.hash,
      contractAddress: tx.contractAddress
    })).slice(0, 10);

    const updatedTransaction = [];
    for (const tx of simplifiedTx) {
      const balance = await getTokenBalance(normalizedAddress, tx.contractAddress, apiKey);
      if (balance !== '0') {
        updatedTransaction.push(tx);
      }
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("Updated transactions:", updatedTransaction);
    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "Summarize token transactions in 3-5 bullet points. Include flow directions, main tokens, and timing patterns."
        },
        {
          role: "user",
          content: `Analyze these transactions: ${JSON.stringify(updatedTransaction)}`
        }
      ],
      max_tokens: 300,
      temperature: 0.3
    });

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
