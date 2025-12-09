const axios = require('axios');

async function testHoldingsChanges() {
  try {
    console.log('Testing holdings changes display...\n');
    
    const response = await axios.post('http://localhost:3001/api/backtest-dynamic', {
      startDate: '20240101',
      endDate: '20241207'
    });
    
    if (response.data.success) {
      const { periods } = response.data.data;
      
      console.log('=== Holdings Changes Analysis ===\n');
      
      periods.forEach((period, index) => {
        console.log(`\n📅 Period ${index + 1}: ${period.reportDate}`);
        console.log(`   Duration: ${period.startDate} ~ ${period.endDate}`);
        console.log(`   Total Holdings: ${period.stockCount} stocks`);
        
        if (period.changes) {
          const { addedCount, removedCount, unchanged, added, removed } = period.changes;
          
          console.log(`\n   🔄 Changes from previous period:`);
          console.log(`      ✅ Added: ${addedCount} stocks`);
          console.log(`      ❌ Removed: ${removedCount} stocks`);
          console.log(`      ➡️  Unchanged: ${unchanged} stocks`);
          
          if (addedCount > 0) {
            console.log(`\n      New stocks (showing first 5):`);
            added.slice(0, 5).forEach(s => {
              console.log(`         + ${s.code} (${s.weight}%)`);
            });
          }
          
          if (removedCount > 0) {
            console.log(`\n      Removed stocks (showing first 5):`);
            removed.slice(0, 5).forEach(s => {
              console.log(`         - ${s.code} (${s.weight}%)`);
            });
          }
        } else {
          console.log(`   (First period - no changes to compare)`);
        }
        
        console.log(`\n   Top 5 holdings by weight:`);
        period.topHoldings.slice(0, 5).forEach((h, i) => {
          console.log(`      ${i + 1}. ${h.code}: ${h.weight}%`);
        });
        
        console.log('\n' + '─'.repeat(60));
      });
      
      console.log('\n✅ Test completed successfully!');
      console.log('\nNow open http://localhost:3001/dynamic.html to see the visual display.');
      
    } else {
      console.error('Test failed:', response.data);
    }
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

testHoldingsChanges();
