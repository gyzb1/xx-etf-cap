const axios = require('axios');
require('dotenv').config();

const TUSHARE_TOKEN = process.env.TUSHARE_TOKEN;
const TUSHARE_API = 'http://api.tushare.pro';

// Helper function to call Tushare API
async function callTushareAPI(apiName, params) {
  try {
    const response = await axios.post(TUSHARE_API, {
      api_name: apiName,
      token: TUSHARE_TOKEN,
      params: params,
      fields: ''
    });
    
    if (response.data.code !== 0) {
      throw new Error(response.data.msg || 'Tushare API error');
    }
    
    return response.data.data;
  } catch (error) {
    console.error('Tushare API error:', error.message);
    throw error;
  }
}

async function testBankData() {
  // 测试几只银行股
  const bankStocks = [
    '601009.SH', // 南京银行
    '601229.SH', // 上海银行
    '601398.SH', // 工商银行
    '601288.SH', // 农业银行
  ];
  
  console.log('='.repeat(80));
  console.log('测试银行股财务数据获取');
  console.log('='.repeat(80));
  
  for (const code of bankStocks) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`测试股票: ${code}`);
    console.log('='.repeat(80));
    
    try {
      // 1. 测试利润表数据
      console.log('\n【1. 利润表 (income) 数据】');
      const incomeData = await callTushareAPI('income', {
        ts_code: code,
        fields: 'ts_code,end_date,ebit,operate_profit,total_profit,revenue,n_income'
      });
      
      if (incomeData && incomeData.items && incomeData.items.length > 0) {
        console.log(`找到 ${incomeData.items.length} 条记录`);
        console.log('字段:', incomeData.fields);
        console.log('\n最近3期数据:');
        
        // 按日期排序
        const fields = incomeData.fields;
        const endDateIdx = fields.indexOf('end_date');
        const sortedItems = incomeData.items.sort((a, b) => b[endDateIdx].localeCompare(a[endDateIdx]));
        
        for (let i = 0; i < Math.min(3, sortedItems.length); i++) {
          const item = sortedItems[i];
          console.log(`\n  期间 ${i + 1}:`);
          fields.forEach((field, idx) => {
            console.log(`    ${field}: ${item[idx]}`);
          });
        }
      } else {
        console.log('❌ 没有利润表数据');
      }
      
      // 2. 测试资产负债表数据
      console.log('\n【2. 资产负债表 (balancesheet) 数据】');
      const balanceData = await callTushareAPI('balancesheet', {
        ts_code: code,
        fields: 'ts_code,end_date,total_assets,total_cur_liab,total_liab,total_hldr_eqy_exc_min_int'
      });
      
      if (balanceData && balanceData.items && balanceData.items.length > 0) {
        console.log(`找到 ${balanceData.items.length} 条记录`);
        console.log('字段:', balanceData.fields);
        console.log('\n最近3期数据:');
        
        const fields = balanceData.fields;
        const endDateIdx = fields.indexOf('end_date');
        const sortedItems = balanceData.items.sort((a, b) => b[endDateIdx].localeCompare(a[endDateIdx]));
        
        for (let i = 0; i < Math.min(3, sortedItems.length); i++) {
          const item = sortedItems[i];
          console.log(`\n  期间 ${i + 1}:`);
          fields.forEach((field, idx) => {
            console.log(`    ${field}: ${item[idx]}`);
          });
        }
      } else {
        console.log('❌ 没有资产负债表数据');
      }
      
      // 3. 测试财务指标数据
      console.log('\n【3. 财务指标 (fina_indicator) 数据】');
      const finaData = await callTushareAPI('fina_indicator', {
        ts_code: code,
        fields: 'ts_code,end_date,roe,roa,roic,profit_to_gr,op_of_gr_ps'
      });
      
      if (finaData && finaData.items && finaData.items.length > 0) {
        console.log(`找到 ${finaData.items.length} 条记录`);
        console.log('字段:', finaData.fields);
        console.log('\n最近3期数据:');
        
        const fields = finaData.fields;
        const endDateIdx = fields.indexOf('end_date');
        const sortedItems = finaData.items.sort((a, b) => b[endDateIdx].localeCompare(a[endDateIdx]));
        
        for (let i = 0; i < Math.min(3, sortedItems.length); i++) {
          const item = sortedItems[i];
          console.log(`\n  期间 ${i + 1}:`);
          fields.forEach((field, idx) => {
            console.log(`    ${field}: ${item[idx]}`);
          });
        }
      } else {
        console.log('❌ 没有财务指标数据');
      }
      
      // 4. 尝试计算ROCE
      console.log('\n【4. ROCE计算尝试】');
      if (incomeData && incomeData.items && incomeData.items.length > 0 &&
          balanceData && balanceData.items && balanceData.items.length > 0) {
        
        const incomeFields = incomeData.fields;
        const balanceFields = balanceData.fields;
        
        const incomeEndDateIdx = incomeFields.indexOf('end_date');
        const balanceEndDateIdx = balanceFields.indexOf('end_date');
        
        const latestIncome = incomeData.items.sort((a, b) => b[incomeEndDateIdx].localeCompare(a[incomeEndDateIdx]))[0];
        const latestBalance = balanceData.items.sort((a, b) => b[balanceEndDateIdx].localeCompare(a[balanceEndDateIdx]))[0];
        
        const ebitIdx = incomeFields.indexOf('ebit');
        const operateProfitIdx = incomeFields.indexOf('operate_profit');
        const totalProfitIdx = incomeFields.indexOf('total_profit');
        const nIncomeIdx = incomeFields.indexOf('n_income');
        
        const assetsIdx = balanceFields.indexOf('total_assets');
        const liabIdx = balanceFields.indexOf('total_cur_liab');
        
        console.log(`利润表期间: ${latestIncome[incomeEndDateIdx]}`);
        console.log(`资产负债表期间: ${latestBalance[balanceEndDateIdx]}`);
        
        let profit = null;
        let profitType = '';
        
        if (ebitIdx >= 0 && latestIncome[ebitIdx]) {
          profit = latestIncome[ebitIdx];
          profitType = 'EBIT';
        } else if (operateProfitIdx >= 0 && latestIncome[operateProfitIdx]) {
          profit = latestIncome[operateProfitIdx];
          profitType = 'operate_profit';
        } else if (totalProfitIdx >= 0 && latestIncome[totalProfitIdx]) {
          profit = latestIncome[totalProfitIdx];
          profitType = 'total_profit';
        } else if (nIncomeIdx >= 0 && latestIncome[nIncomeIdx]) {
          profit = latestIncome[nIncomeIdx];
          profitType = 'n_income (净利润)';
        }
        
        const totalAssets = assetsIdx >= 0 ? latestBalance[assetsIdx] : null;
        const currentLiab = liabIdx >= 0 ? latestBalance[liabIdx] : null;
        
        console.log(`\n可用利润指标: ${profitType} = ${profit}`);
        console.log(`总资产: ${totalAssets}`);
        console.log(`流动负债: ${currentLiab}`);
        
        if (profit && totalAssets && currentLiab) {
          const capitalEmployed = totalAssets - currentLiab;
          const roce = (profit / capitalEmployed) * 100;
          console.log(`\n✅ ROCE = ${profit} / (${totalAssets} - ${currentLiab}) = ${roce.toFixed(2)}%`);
        } else {
          console.log('\n❌ 无法计算ROCE - 缺少必要数据');
          if (!profit) console.log('  - 缺少利润数据');
          if (!totalAssets) console.log('  - 缺少总资产数据');
          if (!currentLiab) console.log('  - 缺少流动负债数据');
        }
      }
      
      // 延迟避免API限制
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`\n❌ 测试 ${code} 时出错:`, error.message);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('测试完成');
  console.log('='.repeat(80));
}

// 运行测试
testBankData().catch(console.error);
