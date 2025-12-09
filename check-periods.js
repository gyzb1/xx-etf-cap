const axios = require('axios');
require('dotenv').config();

const TUSHARE_TOKEN = process.env.TUSHARE_TOKEN;
const TUSHARE_API = 'http://api.tushare.pro';

async function checkAllPeriods() {
  try {
    console.log('Checking all available reporting periods for 512890...\n');
    
    const response = await axios.post(TUSHARE_API, {
      api_name: 'fund_portfolio',
      token: TUSHARE_TOKEN,
      params: {
        ts_code: '512890.SH'
      },
      fields: ''
    });
    
    if (response.data.code !== 0) {
      throw new Error(response.data.msg || 'API error');
    }
    
    const data = response.data.data;
    const fields = data.fields;
    const endDateIdx = fields.indexOf('end_date');
    
    // Get all unique end dates
    const allEndDates = [...new Set(data.items.map(item => item[endDateIdx]))]
      .sort((a, b) => a.localeCompare(b));
    
    console.log('All reporting periods:');
    allEndDates.forEach((date, index) => {
      const isFullReport = date.endsWith('0630') || date.endsWith('1231');
      console.log(`  ${index + 1}. ${date} ${isFullReport ? '✓ (Full report)' : '(Partial)'}`);
    });
    
    console.log('\n Full reports (Q2/Q4 only):');
    const fullReports = allEndDates.filter(date => 
      date.endsWith('0630') || date.endsWith('1231')
    );
    fullReports.forEach((date, index) => {
      console.log(`  ${index + 1}. ${date}`);
    });
    
    console.log(`\nTotal periods: ${allEndDates.length}`);
    console.log(`Full reports: ${fullReports.length}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkAllPeriods();
