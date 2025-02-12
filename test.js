import Moralis from 'moralis';
import { EvmChain } from '@moralisweb3/common-evm-utils';
import fs from 'fs'; 
import dotenv from "dotenv"

dotenv.config()


const address = "0x8db4ab33b7091d458f068a23a0be88cf6fcd00f6";


const runApp = async (walletAddress) => {
  try {
 
    await Moralis.start({
      apiKey: process.env.MORALIS_API_KEY
    });

    const chain = EvmChain.ETHEREUM;

    console.log("Fetching token balances...");

    
    const response = await Moralis.EvmApi.token.getWalletTokenBalances({
      walletAddress,
      chain,
    });

    console.log("Processing token data...");

    // Extract and format the relevant data
    const tokenData = response.toJSON().map((token) => ({
      name: token.name || "Unknown Token",
      balance: parseFloat(token.balance) / Math.pow(10, token.decimals),
      percentage_of_total_supply: token.percentage_relative_to_total_supply || 0,
      security_score: token.security_score || "Not Available", 
    }));

    console.log("Formatted Token Data:", tokenData);

    const outputPath = "./tokens.json"; 
    fs.writeFileSync(outputPath, JSON.stringify(tokenData, null, 2));
    console.log(`Token data saved to ${outputPath}!`);
  } catch (error) {
    console.error("Error fetching or processing token balances:", error);
  }
};

runApp(address);