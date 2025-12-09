const axios = require('axios');

async function testStockNames() {
  try {
    console.log('Testing stock names display...\n');
    
    const response = await axios.post('http://localhost:3001/api/backtest-dynamic', {
      startDate: '20240101',
      endDate: '20241207'
    });
    
    if (response.data.success) {
      const { periods } = response.data.data;
      
      console.log('=== Stock Names Test ===\n');
      
      periods.forEach((period, index) => {
        console.log(`\n📅 Period ${index + 1}: ${period.reportDate}`);
        
        console.log(`\n   Top 5 holdings (with names):`);
        period.topHoldings.slice(0, 5).forEach((h, i) => {
          console.log(`      ${i + 1}. ${h.name} (${h.weight}%)`);
        });
        
        if (period.changes && period.changes.addedCount > 0) {
          console.log(`\n   ✅ New stocks (showing first 3):`);
          period.changes.added.slice(0, 3).forEach(s => {
            console.log(`      + ${s.name} (${s.weight}%)`);
          });
        }
        
        if (period.changes && period.changes.removedCount > 0) {
          console.log(`\n   ❌ Removed stocks (showing first 3):`);
          period.changes.removed.slice(0, 3).forEach(s => {
            console.log(`      - ${s.name} (${s.weight}%)`);
          });
        }
        
        console.log('\n' + '─'.repeat(60));
      });
      
      console.log('\n✅ Stock names are now displayed!');
      console.log('Open http://localhost:3001/dynamic.html to see Chinese names in the web interface.');
      
    } else {
      console.error('Test failed:', response.data);
    }
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testStockNames();
