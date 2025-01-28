import axios from 'axios';

const testWalletScan = async () => {
    try {
        const response = await axios.post('http://localhost:8080/tools/summarizeEthTransactions', {
            args: {
                walletAddress: '0xF214798A8aF12Ad98e173171ee2D8d7ea11CE75C'
            }
        });
        console.log('Success:', response.data);
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
    }
};

testWalletScan();
