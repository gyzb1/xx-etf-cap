const axios = require('axios');

async function testDynamicBacktest() {
  try {
    console.log('Testing dynamic rebalancing backtest...\n');
    
    const response = await axios.post('http://localhost:3001/api/backtest-dynamic', {
      startDate: '20240101',
      endDate: '20241207'
    });
    
    if (response.data.success) {
      const { portfolio, etf, periods, statistics } = response.data.data;
      
      console.log('=== Backtest Results ===\n');
      console.log(`Portfolio Return: ${statistics.portfolioReturn}%`);
      console.log(`ETF Return: ${statistics.etfReturn}%`);
      console.log(`Outperformance: ${(parseFloat(statistics.portfolioReturn) - parseFloat(statistics.etfReturn)).toFixed(2)}%`);
      console.log(`\nRebalancing Count: ${statistics.rebalancingCount}`);
      console.log(`Total Unique Stocks: ${statistics.totalStocks}`);
      
      console.log('\n=== Rebalancing Periods ===\n');
      periods.forEach((period, index) => {
        console.log(`Period ${index + 1}: ${period.reportDate}`);
        console.log(`  Duration: ${period.startDate} to ${period.endDate}`);
        console.log(`  Stock Count: ${period.stockCount}`);
        console.log(`  Top 5 Holdings:`);
        period.topHoldings.slice(0, 5).forEach((holding, i) => {
          console.log(`    ${i + 1}. ${holding.code}: ${holding.weight}%`);
        });
        console.log('');
      });
      
      console.log(`\n=== Net Value Points ===`);
      console.log(`Portfolio: ${portfolio.length} points`);
      console.log(`ETF: ${etf.length} points`);
      
      if (portfolio.length > 0) {
        console.log(`\nFirst point: ${portfolio[0].date} - ${portfolio[0].netValue.toFixed(4)}`);
        console.log(`Last point: ${portfolio[portfolio.length - 1].date} - ${portfolio[portfolio.length - 1].netValue.toFixed(4)}`);
      }
      
    } else {
      console.error('Backtest failed:', response.data);
    }
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testDynamicBacktest();
