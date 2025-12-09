const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Tushare API configuration
const TUSHARE_TOKEN = process.env.TUSHARE_TOKEN;
const TUSHARE_API = 'http://api.tushare.pro';

// Helper function to add delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to call Tushare API with rate limiting
async function callTushareAPI(apiName, params) {
  try {
    // Add small delay to avoid hitting rate limits
    await delay(100);
    
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

// Batch process array with concurrency limit
async function batchProcess(items, processor, batchSize = 10) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)} (${i + batch.length}/${items.length})`);
    const batchResults = await Promise.all(batch.map((item, batchIndex) => processor(item, i + batchIndex)));
    results.push(...batchResults);
    // Add delay between batches to avoid rate limit
    if (i + batchSize < items.length) {
      console.log(`Waiting 800ms before next batch...`);
      await delay(800); // Increased from 500ms to 800ms
    }
  }
  return results;
}

// Get daily stock data
async function getDailyData(tsCode, startDate, endDate) {
  const data = await callTushareAPI('daily', {
    ts_code: tsCode,
    start_date: startDate,
    end_date: endDate
  });
  return data;
}

// Get fund daily data
async function getFundDailyData(tsCode, startDate, endDate) {
  const data = await callTushareAPI('fund_daily', {
    ts_code: tsCode,
    start_date: startDate,
    end_date: endDate
  });
  return data;
}

// Get stock basic information
async function getStockBasicInfo(tsCode) {
  try {
    const data = await callTushareAPI('stock_basic', {
      ts_code: tsCode
    });
    return data;
  } catch (error) {
    console.error(`Error fetching basic info for ${tsCode}:`, error.message);
    return null;
  }
}

// Get stock company information (for industry)
async function getStockCompanyInfo(tsCode) {
  try {
    const data = await callTushareAPI('stock_company', {
      ts_code: tsCode
    });
    return data;
  } catch (error) {
    console.error(`Error fetching company info for ${tsCode}:`, error.message);
    return null;
  }
}

// Get daily basic data (for market cap and dividend yield)
async function getDailyBasic(tsCode, endDate) {
  try {
    // Get data for a date range to ensure we get data even if endDate is not a trading day
    const startDate = endDate.substring(0, 6) + '01'; // First day of the month
    const data = await callTushareAPI('daily_basic', {
      ts_code: tsCode,
      start_date: startDate,
      end_date: endDate
    });
    
    // Return the latest available data
    if (data && data.items && data.items.length > 0) {
      // Sort by trade_date descending and return the latest
      const fields = data.fields;
      const dateIdx = fields.indexOf('trade_date');
      const sortedItems = data.items.sort((a, b) => b[dateIdx].localeCompare(a[dateIdx]));
      return {
        fields: data.fields,
        items: [sortedItems[0]] // Return only the latest item
      };
    }
    
    return data;
  } catch (error) {
    console.error(`Error fetching daily basic for ${tsCode}:`, error.message);
    return null;
  }
}

// Get fund portfolio holdings (latest period only)
async function getFundPortfolio(tsCode, endDate) {
  try {
    // Get all portfolio data
    const data = await callTushareAPI('fund_portfolio', {
      ts_code: tsCode
    });
    
    if (!data || !data.items || data.items.length === 0) {
      return null;
    }
    
    // Find the latest end_date (报告期)
    const fields = data.fields;
    const endDateIdx = fields.indexOf('end_date');
    
    if (endDateIdx < 0) {
      return data;
    }
    
    // Group by end_date and get the latest one (excluding future dates)
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const endDates = [...new Set(data.items.map(item => item[endDateIdx]))]
      .filter(date => date <= today) // Filter out future dates
      .sort((a, b) => b.localeCompare(a)); // Sort descending
    
    if (endDates.length === 0) {
      console.error('No valid reporting periods found');
      return null;
    }
    
    // Prefer Q2 (0630) and Q4 (1231) as they have full holdings
    // Q1 (0331) and Q3 (0930) often only show top 10 holdings
    const fullReportDates = endDates.filter(date => 
      date.endsWith('0630') || date.endsWith('1231')
    );
    
    const latestEndDate = fullReportDates.length > 0 ? fullReportDates[0] : endDates[0];
    
    console.log(`Found ${endDates.length} reporting periods`);
    console.log(`Full report periods (Q2/Q4):`, fullReportDates.slice(0, 3));
    console.log(`Using: ${latestEndDate}`);
    
    // Filter to only include items from the latest period
    const latestItems = data.items.filter(item => item[endDateIdx] === latestEndDate);
    
    return {
      fields: data.fields,
      items: latestItems
    };
  } catch (error) {
    console.error(`Error fetching fund portfolio for ${tsCode}:`, error.message);
    return null;
  }
}

// Get financial indicator data (for ROCE calculation)
async function getFinancialIndicator(tsCode, endDate) {
  try {
    // Get the latest financial report
    const data = await callTushareAPI('fina_indicator', {
      ts_code: tsCode,
      end_date: endDate,
      fields: 'ts_code,end_date,ebit,total_assets,total_cur_liab,roe,roa'
    });
    return data;
  } catch (error) {
    console.error(`Error fetching financial indicator for ${tsCode}:`, error.message);
    return null;
  }
}

// Get balance sheet data (for total assets and current liabilities)
async function getBalanceSheet(tsCode) {
  try {
    // Get the latest available balance sheet data (don't specify end_date)
    const data = await callTushareAPI('balancesheet', {
      ts_code: tsCode,
      fields: 'ts_code,end_date,total_assets,total_cur_liab,total_hldr_eqy_exc_min_int'
    });
    
    // Return only the latest record
    if (data && data.items && data.items.length > 0) {
      const fields = data.fields;
      const endDateIdx = fields.indexOf('end_date');
      // Sort by end_date descending
      const sortedItems = data.items.sort((a, b) => b[endDateIdx].localeCompare(a[endDateIdx]));
      return {
        fields: data.fields,
        items: [sortedItems[0]] // Return only the latest
      };
    }
    
    return data;
  } catch (error) {
    console.error(`Error fetching balance sheet for ${tsCode}:`, error.message);
    return null;
  }
}

// Get cashflow statement data (for FCF calculation)
async function getCashflowStatement(tsCode) {
  try {
    // Get the latest available cashflow statement data
    const data = await callTushareAPI('cashflow', {
      ts_code: tsCode,
      fields: 'ts_code,end_date,n_cashflow_act,fix_intan_other_asset_dispo_cash'
    });
    
    // Return only the latest record
    if (data && data.items && data.items.length > 0) {
      const fields = data.fields;
      const endDateIdx = fields.indexOf('end_date');
      // Sort by end_date descending
      const sortedItems = data.items.sort((a, b) => b[endDateIdx].localeCompare(a[endDateIdx]));
      return {
        fields: data.fields,
        items: [sortedItems[0]] // Return only the latest
      };
    }
    
    return data;
  } catch (error) {
    console.error(`Error fetching cashflow for ${tsCode}:`, error.message);
    return null;
  }
}

// Get income statement data (for EBIT)
async function getIncomeStatement(tsCode) {
  try {
    // Get the latest available income statement data (don't specify end_date)
    const data = await callTushareAPI('income', {
      ts_code: tsCode,
      fields: 'ts_code,end_date,ebit,operate_profit,total_profit'
    });
    
    // Return only the latest record
    if (data && data.items && data.items.length > 0) {
      const fields = data.fields;
      const endDateIdx = fields.indexOf('end_date');
      // Sort by end_date descending
      const sortedItems = data.items.sort((a, b) => b[endDateIdx].localeCompare(a[endDateIdx]));
      return {
        fields: data.fields,
        items: [sortedItems[0]] // Return only the latest
      };
    }
    
    return data;
  } catch (error) {
    console.error(`Error fetching income statement for ${tsCode}:`, error.message);
    return null;
  }
}

// Get dividend data
async function getDividend(tsCode) {
  try {
    const data = await callTushareAPI('dividend', {
      ts_code: tsCode
    });
    return data;
  } catch (error) {
    console.error(`Error fetching dividend for ${tsCode}:`, error.message);
    return null;
  }
}

// Calculate portfolio net value with weights
function calculatePortfolioNetValue(stocksData, weights) {
  const dateMap = new Map();
  
  // Process each stock's data
  stocksData.forEach((stock, index) => {
    if (!stock.data || stock.data.items.length === 0) return;
    
    const items = stock.data.items;
    const fields = stock.data.fields;
    const dateIdx = fields.indexOf('trade_date');
    const closeIdx = fields.indexOf('close');
    const weight = weights[stock.code] || 0;
    
    if (weight === 0) return;
    
    // Find initial price
    const sortedItems = items.sort((a, b) => a[dateIdx] - b[dateIdx]);
    const initialPrice = sortedItems[0][closeIdx];
    
    // Calculate daily returns for this stock
    sortedItems.forEach(item => {
      const date = item[dateIdx];
      const close = item[closeIdx];
      const dailyValue = (close / initialPrice) * weight;
      
      if (!dateMap.has(date)) {
        dateMap.set(date, { count: 0, sum: 0 });
      }
      
      const dayData = dateMap.get(date);
      dayData.count += 1;
      dayData.sum += dailyValue;
    });
  });
  
  // Convert to array and calculate net value
  const netValueData = Array.from(dateMap.entries())
    .map(([date, data]) => ({
      date: date,
      netValue: data.sum
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  // Normalize to start at 1.0
  if (netValueData.length > 0) {
    const initialValue = netValueData[0].netValue;
    if (initialValue > 0) {
      netValueData.forEach(item => {
        item.netValue = item.netValue / initialValue;
      });
    }
  }
  
  return netValueData;
}

// Calculate market cap weights (市值加权)
function calculateDualFactorWeights(stocksFactors) {
  console.log(`\nCalculating weights for ${stocksFactors.length} stocks...`);
  
  // Count stocks by data availability
  const validStocks = stocksFactors.filter(s => 
    s.marketCap !== null && !isNaN(s.marketCap) && s.marketCap > 0
  );
  
  console.log(`  Valid stocks with market cap data: ${validStocks.length}`);
  console.log(`  Missing data: ${stocksFactors.length - validStocks.length}`);
  
  if (validStocks.length === 0) {
    console.warn('No valid stocks with market cap data');
    // Return equal weights for all stocks
    const equalWeight = 1 / stocksFactors.length;
    const weights = {};
    stocksFactors.forEach(s => {
      weights[s.code] = equalWeight;
    });
    return {
      weights: weights,
      processedFactors: stocksFactors
    };
  }
  
  // Calculate weights directly proportional to market cap
  const totalMarketCap = validStocks.reduce((sum, s) => sum + s.marketCap, 0);
  const weights = {};
  
  validStocks.forEach(s => {
    weights[s.code] = totalMarketCap > 0 ? s.marketCap / totalMarketCap : 1 / validStocks.length;
  });
  
  console.log(`Calculated weights for ${Object.keys(weights).length} stocks`);
  
  // Return both weights and processed factors
  return {
    weights: weights,
    processedFactors: validStocks
  };
}

// Calculate ETF net value
function calculateETFNetValue(etfData) {
  if (!etfData || !etfData.items || etfData.items.length === 0) {
    return [];
  }
  
  const items = etfData.items;
  const fields = etfData.fields;
  const dateIdx = fields.indexOf('trade_date');
  const navIdx = fields.indexOf('nav');
  const closeIdx = fields.indexOf('close');
  
  const sortedItems = items.sort((a, b) => a[dateIdx] - b[dateIdx]);
  const initialValue = sortedItems[0][navIdx] || sortedItems[0][closeIdx] || 1;
  
  return sortedItems.map(item => ({
    date: item[dateIdx],
    netValue: (item[navIdx] || item[closeIdx]) / initialValue
  }));
}

// API endpoint for ETF holdings replication with dual-factor weighting
app.post('/api/backtest-etf', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    console.log(`Fetching 512890 ETF holdings and calculating dual-factor weights from ${startDate} to ${endDate}`);
    console.log(`Tushare token configured: ${!!TUSHARE_TOKEN}`);
    
    // Step 1: Get ETF portfolio holdings
    const etfPortfolio = await getFundPortfolio('512890.SH', endDate);
    
    if (!etfPortfolio || !etfPortfolio.items || etfPortfolio.items.length === 0) {
      console.error('Failed to fetch ETF portfolio data');
      console.error('etfPortfolio:', etfPortfolio);
      return res.status(404).json({ 
        error: 'ETF portfolio data not available',
        message: '无法获取512890的持仓数据，请检查日期或稍后重试。请确保已配置TUSHARE_TOKEN环境变量。',
        hasToken: !!TUSHARE_TOKEN
      });
    }
    
    // Extract stock codes from ETF holdings
    const fields = etfPortfolio.fields;
    console.log('ETF Portfolio fields:', fields);
    
    const symbolIdx = fields.indexOf('symbol');
    
    // Get all stock codes
    const symbols = etfPortfolio.items.map(item => item[symbolIdx]).filter(s => s);
    
    console.log(`Found ${symbols.length} symbols in ETF portfolio`);
    console.log('First 10 symbols:', symbols.slice(0, 10));
    console.log('Sample portfolio item:', etfPortfolio.items[0]);
    
    // Convert symbols to ts_code format using rule-based approach (avoid excessive API calls)
    const stockCodes = symbols.map(symbol => {
      // Check if symbol already has exchange suffix
      if (symbol.includes('.')) {
        return symbol; // Already in ts_code format
      }
      
      const code = parseInt(symbol);
      
      // Shanghai Stock Exchange
      if (code >= 600000 && code <= 609999) {
        return `${symbol}.SH`;
      }
      // Shanghai A-shares (60xxxx, 68xxxx)
      else if (code >= 600000 && code <= 699999) {
        return `${symbol}.SH`;
      }
      // Shenzhen Stock Exchange (Main Board 000xxx)
      else if (code >= 0 && code <= 3999) {
        return `${symbol.padStart(6, '0')}.SZ`;
      }
      // ChiNext (创业板 300xxx)
      else if (code >= 300000 && code <= 309999) {
        return `${symbol}.SZ`;
      }
      // Shenzhen 002xxx
      else if (code >= 2000 && code <= 2999) {
        return `${symbol.padStart(6, '0')}.SZ`;
      }
      // Default to Shenzhen for others
      else {
        return `${symbol.padStart(6, '0')}.SZ`;
      }
    }).filter(code => code);
    
    // Remove duplicates
    const uniqueStockCodes = [...new Set(stockCodes)];
    
    console.log(`Converted to ${uniqueStockCodes.length} unique ts_codes. First 10:`, uniqueStockCodes.slice(0, 10));
    
    // Step 2: Fetch historical price data for all stocks (with batch processing)
    console.log('Fetching historical price data...');
    const stocksData = await batchProcess(uniqueStockCodes, async (code) => {
      try {
        const data = await getDailyData(code, startDate, endDate);
        return {
          code: code,
          data: data
        };
      } catch (error) {
        console.error(`Error fetching data for ${code}:`, error.message);
        return {
          code: code,
          data: null,
          error: error.message
        };
      }
    }, 10); // Process 10 stocks at a time
    
    // Step 3: Fetch factor data (dividend yield and ROCE) for all stocks
    console.log(`\nFetching factor data for ${uniqueStockCodes.length} stocks...`);
    console.log('Using latest available financial reports (no date restriction)');
    
    const stocksFactors = await batchProcess(uniqueStockCodes, async (code, index) => {
      try {
        console.log(`\n[${index + 1}/${uniqueStockCodes.length}] Processing ${code}...`);
        
        // 获取市净率PB
        const dailyBasicInfo = await getDailyBasic(code, endDate);
        
        let pb = null;
        let marketCap = null;
        
        // 从daily_basic获取PB和市值
        if (dailyBasicInfo && dailyBasicInfo.items && dailyBasicInfo.items.length > 0) {
          const fields = dailyBasicInfo.fields;
          const pbIdx = fields.indexOf('pb');
          const totalMvIdx = fields.indexOf('total_mv');
          
          if (pbIdx >= 0 && dailyBasicInfo.items[0][pbIdx]) {
            pb = dailyBasicInfo.items[0][pbIdx];
          }
          
          if (totalMvIdx >= 0 && dailyBasicInfo.items[0][totalMvIdx]) {
            marketCap = dailyBasicInfo.items[0][totalMvIdx];
          }
          
          console.log(`${code} PB: ${pb}, Market Cap: ${marketCap}`);
        } else {
          console.log(`${code} no daily basic data`);
        }
        
        return {
          code: code,
          pb: pb,
          marketCap: marketCap
        };
      } catch (error) {
        console.error(`Error fetching factors for ${code}:`, error.message);
        return {
          code: code,
          pb: null,
          marketCap: null
        };
      }
    }, 5); // Process 5 stocks at a time for factor data (reduced to avoid rate limits)
    
    // Fetch ETF data
    console.log('Fetching ETF data...');
    const etfData = await getFundDailyData('512890.SH', startDate, endDate);
    
    // Step 4: Calculate dual-factor weights
    const { weights, processedFactors } = calculateDualFactorWeights(stocksFactors);
    
    console.log(`Calculated weights for ${Object.keys(weights).length} stocks`);
    
    // Step 5: Fetch stock information for display
    const stockInfoPromises = uniqueStockCodes.map(async (code) => {
      try {
        const [basicInfo, companyInfo] = await Promise.all([
          getStockBasicInfo(code),
          getStockCompanyInfo(code)
        ]);
        
        let name = code;
        let industry = '-';
        let marketCap = '-';
        const weight = weights[code] || 0;
        
        // Get original factors (for market cap)
        const originalFactors = stocksFactors.find(f => f.code === code);
        // Get processed factors (with filled ROCE values)
        const processedFactor = processedFactors.find(f => f.code === code);
        
        // Get market cap from original factors data (already fetched)
        if (originalFactors && originalFactors.marketCap) {
          marketCap = (originalFactors.marketCap / 10000).toFixed(2); // Convert to 亿元
        }
        
        if (basicInfo && basicInfo.items && basicInfo.items.length > 0) {
          const fields = basicInfo.fields;
          const nameIdx = fields.indexOf('name');
          const industryIdx = fields.indexOf('industry');
          if (nameIdx >= 0) name = basicInfo.items[0][nameIdx];
          if (industryIdx >= 0 && basicInfo.items[0][industryIdx]) {
            industry = basicInfo.items[0][industryIdx];
          }
        }
        
        if (companyInfo && companyInfo.items && companyInfo.items.length > 0) {
          const fields = companyInfo.fields;
          const industryIdx = fields.indexOf('industry');
          if (industryIdx >= 0 && companyInfo.items[0][industryIdx]) {
            industry = companyInfo.items[0][industryIdx];
          }
        }
        
        return {
          code: code,
          name: name,
          industry: industry,
          marketCap: marketCap,
          weight: (weight * 100).toFixed(2), // Convert to percentage
          pb: originalFactors && originalFactors.pb ? originalFactors.pb.toFixed(2) : '-'
        };
      } catch (error) {
        console.error(`Error fetching info for ${code}:`, error.message);
        return {
          code: code,
          name: code,
          industry: '-',
          marketCap: '-',
          weight: '0.00',
          pb: '-'
        };
      }
    });
    
    const stocksInfo = await Promise.all(stockInfoPromises);
    
    // Step 6: Calculate portfolio net value with weights
    const portfolioNetValue = calculatePortfolioNetValue(stocksData, weights);
    
    // Calculate ETF net value
    const etfNetValue = calculateETFNetValue(etfData);
    
    // Calculate statistics
    const portfolioReturn = portfolioNetValue.length > 0 
      ? ((portfolioNetValue[portfolioNetValue.length - 1].netValue - 1) * 100).toFixed(2)
      : 0;
    
    const etfReturn = etfNetValue.length > 0
      ? ((etfNetValue[etfNetValue.length - 1].netValue - 1) * 100).toFixed(2)
      : 0;
    
    const validStocks = stocksData.filter(s => s.data && s.data.items && s.data.items.length > 0).length;
    
    res.json({
      success: true,
      data: {
        portfolio: portfolioNetValue,
        etf: etfNetValue,
        stocksInfo: stocksInfo.sort((a, b) => parseFloat(b.weight) - parseFloat(a.weight)), // Sort by weight descending
        statistics: {
          portfolioReturn: portfolioReturn,
          etfReturn: etfReturn,
          stockCount: stockCodes.length,
          validStocks: validStocks,
          strategy: 'Dual-Factor (Dividend Yield + ROCE)'
        }
      }
    });
    
  } catch (error) {
    console.error('ETF backtest error:', error);
    res.status(500).json({ 
      error: 'Failed to perform ETF backtest',
      message: error.message 
    });
  }
});

// API endpoint for backtesting with dual-factor strategy
app.post('/api/backtest', async (req, res) => {
  try {
    const { stockCodes, startDate, endDate, useETFHoldings } = req.body;
    
    if (!stockCodes || !Array.isArray(stockCodes) || stockCodes.length === 0) {
      return res.status(400).json({ error: 'Stock codes are required' });
    }
    
    console.log(`Fetching data for ${stockCodes.length} stocks from ${startDate} to ${endDate}`);
    
    // Fetch data for all stocks
    const stockPromises = stockCodes.map(async (code) => {
      try {
        const data = await getDailyData(code, startDate, endDate);
        return {
          code: code,
          data: data
        };
      } catch (error) {
        console.error(`Error fetching data for ${code}:`, error.message);
        return {
          code: code,
          data: null,
          error: error.message
        };
      }
    });
    
    // Fetch ETF data (512890.SH)
    const etfPromise = getFundDailyData('512890.SH', startDate, endDate);
    
    const [stocksData, etfData] = await Promise.all([
      Promise.all(stockPromises),
      etfPromise
    ]);
    
    // Fetch stock information (name, industry, market cap)
    const stockInfoPromises = stockCodes.map(async (code) => {
      try {
        const [basicInfo, companyInfo, dailyBasicInfo] = await Promise.all([
          getStockBasicInfo(code),
          getStockCompanyInfo(code),
          getDailyBasic(code, endDate)
        ]);
        
        let name = code;
        let industry = '-';
        let marketCap = '-';
        
        if (basicInfo && basicInfo.items && basicInfo.items.length > 0) {
          const fields = basicInfo.fields;
          const nameIdx = fields.indexOf('name');
          const industryIdx = fields.indexOf('industry');
          if (nameIdx >= 0) name = basicInfo.items[0][nameIdx];
          if (industryIdx >= 0 && basicInfo.items[0][industryIdx]) {
            industry = basicInfo.items[0][industryIdx];
          }
        }
        
        if (companyInfo && companyInfo.items && companyInfo.items.length > 0) {
          const fields = companyInfo.fields;
          const industryIdx = fields.indexOf('industry');
          if (industryIdx >= 0 && companyInfo.items[0][industryIdx]) {
            industry = companyInfo.items[0][industryIdx];
          }
        }
        
        if (dailyBasicInfo && dailyBasicInfo.items && dailyBasicInfo.items.length > 0) {
          const fields = dailyBasicInfo.fields;
          const totalMvIdx = fields.indexOf('total_mv');
          if (totalMvIdx >= 0 && dailyBasicInfo.items[0][totalMvIdx]) {
            const mv = dailyBasicInfo.items[0][totalMvIdx];
            marketCap = (mv / 10000).toFixed(2); // Convert to 亿元
          }
        }
        
        return {
          code: code,
          name: name,
          industry: industry,
          marketCap: marketCap
        };
      } catch (error) {
        console.error(`Error fetching info for ${code}:`, error.message);
        return {
          code: code,
          name: code,
          industry: '-',
          marketCap: '-'
        };
      }
    });
    
    const stocksInfo = await Promise.all(stockInfoPromises);
    
    // Calculate equal weights for custom portfolio
    const equalWeights = {};
    const equalWeight = 1 / stockCodes.length;
    stockCodes.forEach(code => {
      equalWeights[code] = equalWeight;
    });
    
    // Calculate portfolio net value with equal weights
    const portfolioNetValue = calculatePortfolioNetValue(stocksData, equalWeights);
    
    // Calculate ETF net value
    const etfNetValue = calculateETFNetValue(etfData);
    
    // Calculate statistics
    const portfolioReturn = portfolioNetValue.length > 0 
      ? ((portfolioNetValue[portfolioNetValue.length - 1].netValue - 1) * 100).toFixed(2)
      : 0;
    
    const etfReturn = etfNetValue.length > 0
      ? ((etfNetValue[etfNetValue.length - 1].netValue - 1) * 100).toFixed(2)
      : 0;
    
    res.json({
      success: true,
      data: {
        portfolio: portfolioNetValue,
        etf: etfNetValue,
        stocksInfo: stocksInfo,
        statistics: {
          portfolioReturn: portfolioReturn,
          etfReturn: etfReturn,
          stockCount: stockCodes.length,
          validStocks: stocksData.filter(s => s.data && s.data.items && s.data.items.length > 0).length
        }
      }
    });
    
  } catch (error) {
    console.error('Backtest error:', error);
    res.status(500).json({ 
      error: 'Failed to perform backtest',
      message: error.message 
    });
  }
});

// Dynamic rebalancing backtest - follows ETF holdings changes
app.post('/api/backtest-dynamic', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    
    console.log(`\n=== Dynamic Rebalancing Backtest ===`);
    console.log(`Period: ${startDate} to ${endDate}`);
    
    // Step 1: Get ALL portfolio holdings data for 512890
    console.log('\nStep 1: Fetching all historical holdings...');
    const allPortfolioData = await callTushareAPI('fund_portfolio', {
      ts_code: '512890.SH'
    });
    
    if (!allPortfolioData || !allPortfolioData.items || allPortfolioData.items.length === 0) {
      return res.status(404).json({ 
        error: 'No portfolio data available',
        message: '无法获取512890的历史持仓数据'
      });
    }
    
    // Step 2: Group holdings by end_date (reporting period)
    const fields = allPortfolioData.fields;
    const endDateIdx = fields.indexOf('end_date');
    const symbolIdx = fields.indexOf('symbol');
    
    // Get all unique reporting periods and sort them
    const allEndDates = [...new Set(allPortfolioData.items.map(item => item[endDateIdx]))]
      .sort((a, b) => a.localeCompare(b));
    
    console.log(`All available reporting periods:`, allEndDates);
    
    // Filter out future dates (reports that haven't been disclosed yet)
    const today = new Date();
    const currentDate = today.toISOString().slice(0, 10).replace(/-/g, '');
    
    // A report is considered "disclosed" if it's at least 4 months old
    // (e.g., 2024 Q2 report on 20240630 is disclosed after 20241031)
    const disclosedDates = allEndDates.filter(date => {
      const reportDate = new Date(date.slice(0, 4), parseInt(date.slice(4, 6)) - 1, parseInt(date.slice(6, 8)));
      const disclosureDate = new Date(reportDate);
      disclosureDate.setMonth(disclosureDate.getMonth() + 4); // Add 4 months for disclosure
      return disclosureDate <= today;
    });
    
    console.log(`Disclosed reporting periods (excluding future):`, disclosedDates);
    
    // Prefer Q2 (0630) and Q4 (1231) as they have full holdings
    const fullReportDates = disclosedDates.filter(date => 
      date.endsWith('0630') || date.endsWith('1231')
    );
    
    // Find the reporting period that is active at startDate
    // Use the latest report before or at startDate
    const relevantDates = fullReportDates.filter(date => date <= endDate);
    
    if (relevantDates.length === 0) {
      return res.status(404).json({ 
        error: 'No reporting periods available',
        message: `没有找到${endDate}之前的持仓数据`
      });
    }
    
    // Find which report was active at startDate
    const startReportIdx = relevantDates.findIndex(date => date >= startDate);
    const reportingPeriods = startReportIdx === -1 
      ? [relevantDates[relevantDates.length - 1]] // Use the latest if startDate is after all reports
      : relevantDates.slice(Math.max(0, startReportIdx - 1)); // Include the report before startDate
    
    console.log(`Using ${reportingPeriods.length} reporting periods:`, reportingPeriods);
    
    if (reportingPeriods.length === 0) {
      return res.status(404).json({ 
        error: 'No reporting periods in date range',
        message: `在${startDate}到${endDate}期间没有找到持仓数据`
      });
    }
    
    // Step 3: For each reporting period, get holdings and calculate weights
    const portfolioPeriods = [];
    
    for (let i = 0; i < reportingPeriods.length; i++) {
      const reportDate = reportingPeriods[i];
      const nextReportDate = i < reportingPeriods.length - 1 ? reportingPeriods[i + 1] : endDate;
      
      // For the first period, use startDate as the period start
      // For subsequent periods, use the report date
      const periodStart = i === 0 ? startDate : reportDate;
      
      console.log(`\n--- Period ${i + 1}/${reportingPeriods.length}: Report ${reportDate}, Active ${periodStart} to ${nextReportDate} ---`);
      
      // Get holdings for this period
      const periodHoldings = allPortfolioData.items.filter(item => item[endDateIdx] === reportDate);
      const symbols = periodHoldings.map(item => item[symbolIdx]).filter(s => s);
      
      // Convert to ts_code format
      const stockCodes = symbols.map(symbol => {
        if (symbol.includes('.')) return symbol;
        const code = parseInt(symbol);
        if (code >= 600000 && code <= 699999) return `${symbol}.SH`;
        else if (code >= 0 && code <= 3999) return `${symbol.padStart(6, '0')}.SZ`;
        else if (code >= 300000 && code <= 309999) return `${symbol}.SZ`;
        else if (code >= 2000 && code <= 2999) return `${symbol.padStart(6, '0')}.SZ`;
        else return `${symbol.padStart(6, '0')}.SZ`;
      }).filter(code => code);
      
      const uniqueStockCodes = [...new Set(stockCodes)];
      console.log(`Holdings: ${uniqueStockCodes.length} stocks`);
      
      portfolioPeriods.push({
        reportDate: reportDate,
        startDate: periodStart,
        endDate: nextReportDate,
        stockCodes: uniqueStockCodes
      });
    }
    
    // Step 4: Calculate dual-factor weights for each period
    console.log('\n=== Calculating dual-factor weights for each period ===');
    
    for (let period of portfolioPeriods) {
      console.log(`\nPeriod: ${period.reportDate}`);
      
      // Fetch factor data for this period's stocks (market cap for weighting)
      const stocksFactors = await batchProcess(period.stockCodes, async (code, index) => {
        try {
          const dailyBasicInfo = await getDailyBasic(code, period.reportDate);
          
          let pb = null;
          let marketCap = null;
          
          // 从daily_basic获取PB和市值
          if (dailyBasicInfo && dailyBasicInfo.items && dailyBasicInfo.items.length > 0) {
            const fields = dailyBasicInfo.fields;
            const pbIdx = fields.indexOf('pb');
            const totalMvIdx = fields.indexOf('total_mv');
            
            if (pbIdx >= 0 && dailyBasicInfo.items[0][pbIdx]) {
              pb = dailyBasicInfo.items[0][pbIdx];
            }
            
            if (totalMvIdx >= 0 && dailyBasicInfo.items[0][totalMvIdx]) {
              marketCap = dailyBasicInfo.items[0][totalMvIdx];
            }
            
            console.log(`${code} Market Cap: ${marketCap}`);
          }
          
          return {
            code: code,
            pb: pb,
            marketCap: marketCap
          };
        } catch (error) {
          console.error(`Error fetching factors for ${code}:`, error.message);
          return {
            code: code,
            pb: null,
            marketCap: null
          };
        }
      }, 8);
      
      // Calculate dual-factor weights
      const result = calculateDualFactorWeights(stocksFactors);
      period.weights = result.weights;
      period.factorsData = result.processedFactors;
      
      console.log(`Calculated weights for ${Object.keys(period.weights).length} stocks`);
    }
    
    // Step 5: Fetch price data for all unique stocks across all periods
    console.log('\n=== Fetching price data ===');
    const allStockCodes = [...new Set(portfolioPeriods.flatMap(p => p.stockCodes))];
    console.log(`Total unique stocks: ${allStockCodes.length}`);
    
    const stocksData = await batchProcess(allStockCodes, async (code) => {
      try {
        const data = await getDailyData(code, startDate, endDate);
        return {
          code: code,
          data: data
        };
      } catch (error) {
        console.error(`Error fetching data for ${code}:`, error.message);
        return {
          code: code,
          data: null,
          error: error.message
        };
      }
    }, 10);
    
    // Step 6: Calculate continuous net value with dynamic rebalancing
    console.log('\n=== Calculating dynamic portfolio net value ===');
    
    const portfolioNetValue = [];
    let currentNetValue = 1.0;
    
    // Create a map of stock data for quick lookup
    const stockDataMap = new Map();
    stocksData.forEach(stock => {
      if (stock.data && stock.data.items) {
        const dateMap = new Map();
        const fields = stock.data.fields;
        const dateIdx = fields.indexOf('trade_date');
        const closeIdx = fields.indexOf('close');
        const pctChgIdx = fields.indexOf('pct_chg');
        
        stock.data.items.forEach(item => {
          dateMap.set(item[dateIdx], {
            close: item[closeIdx],
            pctChg: item[pctChgIdx]
          });
        });
        
        stockDataMap.set(stock.code, dateMap);
      }
    });
    
    // Get all trading dates
    const allDates = new Set();
    stockDataMap.forEach(dateMap => {
      dateMap.forEach((_, date) => allDates.add(date));
    });
    const sortedDates = Array.from(allDates).sort();
    
    // Process each date
    for (const date of sortedDates) {
      // Find which period this date belongs to
      const currentPeriod = portfolioPeriods.find(p => 
        date >= p.startDate && date <= p.endDate
      );
      
      if (!currentPeriod) continue;
      
      // Calculate daily return based on current period's weights
      let dailyReturn = 0;
      let validStocks = 0;
      
      for (const [code, weight] of Object.entries(currentPeriod.weights)) {
        const stockData = stockDataMap.get(code);
        if (stockData && stockData.has(date)) {
          const pctChg = stockData.get(date).pctChg;
          if (pctChg !== null && pctChg !== undefined) {
            dailyReturn += weight * (pctChg / 100);
            validStocks++;
          }
        }
      }
      
      // Update net value
      currentNetValue = currentNetValue * (1 + dailyReturn);
      
      portfolioNetValue.push({
        date: date,
        netValue: currentNetValue
      });
    }
    
    console.log(`Generated ${portfolioNetValue.length} net value points`);
    
    // Step 7: Get ETF benchmark data
    console.log('\n=== Fetching ETF benchmark ===');
    const etfData = await getFundDailyData('512890.SH', startDate, endDate);
    const etfNetValue = calculateETFNetValue(etfData);
    
    // Step 8: Calculate statistics
    const portfolioReturn = portfolioNetValue.length > 0 
      ? ((portfolioNetValue[portfolioNetValue.length - 1].netValue - 1) * 100).toFixed(2)
      : 0;
    
    const etfReturn = etfNetValue.length > 0
      ? ((etfNetValue[etfNetValue.length - 1].netValue - 1) * 100).toFixed(2)
      : 0;
    
    console.log(`\n=== Results ===`);
    console.log(`Portfolio Return: ${portfolioReturn}%`);
    console.log(`ETF Return: ${etfReturn}%`);
    console.log(`Rebalancing periods: ${portfolioPeriods.length}`);
    
    // Step 9: Get stock names for all stocks
    console.log('\n=== Fetching stock names ===');
    const stockNamesMap = new Map();
    
    await batchProcess(allStockCodes, async (code) => {
      try {
        const basicInfo = await getStockBasicInfo(code);
        if (basicInfo && basicInfo.items && basicInfo.items.length > 0) {
          const fields = basicInfo.fields;
          const nameIdx = fields.indexOf('name');
          if (nameIdx >= 0) {
            stockNamesMap.set(code, basicInfo.items[0][nameIdx]);
          }
        }
      } catch (error) {
        console.error(`Error fetching name for ${code}:`, error.message);
      }
    }, 10);
    
    console.log(`Fetched names for ${stockNamesMap.size} stocks`);
    
    // Step 10: Calculate holdings changes between periods
    const periodsWithChanges = portfolioPeriods.map((p, index) => {
      const allHoldings = Object.entries(p.weights)
        .sort((a, b) => b[1] - a[1])
        .map(([code, weight]) => ({
          code,
          name: stockNamesMap.get(code) || code,
          weight: (weight * 100).toFixed(2),
          weightNum: weight
        }));
      
      let changes = null;
      if (index > 0) {
        const prevPeriod = portfolioPeriods[index - 1];
        const prevCodes = new Set(prevPeriod.stockCodes);
        const currCodes = new Set(p.stockCodes);
        
        // Calculate added and removed stocks
        const added = p.stockCodes.filter(code => !prevCodes.has(code));
        const removed = prevPeriod.stockCodes.filter(code => !currCodes.has(code));
        const unchanged = p.stockCodes.filter(code => prevCodes.has(code));
        
        changes = {
          added: added.map(code => ({
            code,
            name: stockNamesMap.get(code) || code,
            weight: (p.weights[code] * 100).toFixed(2)
          })),
          removed: removed.map(code => ({
            code,
            name: stockNamesMap.get(code) || code,
            weight: (prevPeriod.weights[code] * 100).toFixed(2)
          })),
          unchanged: unchanged.length,
          addedCount: added.length,
          removedCount: removed.length
        };
      }
      
      return {
        reportDate: p.reportDate,
        startDate: p.startDate,
        endDate: p.endDate,
        stockCount: p.stockCodes.length,
        allHoldings: allHoldings,
        topHoldings: allHoldings.slice(0, 10),
        changes: changes
      };
    });
    
    res.json({
      success: true,
      data: {
        portfolio: portfolioNetValue,
        etf: etfNetValue,
        periods: periodsWithChanges,
        statistics: {
          portfolioReturn: portfolioReturn,
          etfReturn: etfReturn,
          rebalancingCount: portfolioPeriods.length,
          totalStocks: allStockCodes.length
        }
      }
    });
    
  } catch (error) {
    console.error('Dynamic backtest error:', error);
    res.status(500).json({ 
      error: 'Failed to perform dynamic backtest',
      message: error.message 
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    hasToken: !!TUSHARE_TOKEN
  });
});

// Root path - serve index.html (unified backtest page)
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Tushare token configured: ${!!TUSHARE_TOKEN}`);
});
