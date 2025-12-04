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

// Calculate dual-factor weights (Dividend Yield + ROCE)
function calculateDualFactorWeights(stocksFactors) {
  console.log(`\nCalculating weights for ${stocksFactors.length} stocks...`);
  
  // Count stocks by data availability
  const withBothFactors = stocksFactors.filter(s => s.dividendYield > 0 && s.roce !== null && !isNaN(s.roce));
  const withDivOnly = stocksFactors.filter(s => s.dividendYield > 0 && (s.roce === null || isNaN(s.roce)));
  const withRoceOnly = stocksFactors.filter(s => (s.dividendYield === 0 || !s.dividendYield) && s.roce !== null && !isNaN(s.roce));
  const withNeither = stocksFactors.filter(s => (s.dividendYield === 0 || !s.dividendYield) && (s.roce === null || isNaN(s.roce)));
  
  console.log(`  With both factors: ${withBothFactors.length}`);
  console.log(`  With dividend only: ${withDivOnly.length}`);
  console.log(`  With ROCE only: ${withRoceOnly.length}`);
  console.log(`  With neither: ${withNeither.length}`);
  
  // Only process stocks with valid ROCE data
  const validStocks = stocksFactors.filter(s => s.roce !== null && !isNaN(s.roce));
  
  console.log(`  Using ${validStocks.length} stocks with valid ROCE for weight calculation`);
  
  if (validStocks.length === 0) {
    console.warn('No valid stocks with ROCE data');
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
  
  const processedStocks = validStocks.map(s => {
    let dividendYield = s.dividendYield || 0;
    
    // If dividend yield is 0, use a small value to avoid complete exclusion
    if (dividendYield === 0) {
      dividendYield = 0.01; // Small positive value
    }
    
    return {
      code: s.code,
      dividendYield: dividendYield,
      roce: s.roce
    };
  });
  
  // Normalize factors to 0-1 range
  const divYields = processedStocks.map(s => s.dividendYield);
  const roces = processedStocks.map(s => s.roce);
  
  const minDiv = Math.min(...divYields);
  const maxDiv = Math.max(...divYields);
  const minRoce = Math.min(...roces);
  const maxRoce = Math.max(...roces);
  
  const rangeDiv = maxDiv - minDiv || 1;
  const rangeRoce = maxRoce - minRoce || 1;
  
  // Calculate composite score (equal weight for both factors)
  const scores = processedStocks.map(s => {
    const normDiv = (s.dividendYield - minDiv) / rangeDiv;
    const normRoce = (s.roce - minRoce) / rangeRoce;
    return {
      code: s.code,
      score: (normDiv + normRoce) / 2  // Average of both factors
    };
  });
  
  // Calculate weights proportional to scores
  const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
  const weights = {};
  
  scores.forEach(s => {
    weights[s.code] = totalScore > 0 ? s.score / totalScore : 1 / scores.length;
  });
  
  console.log(`Calculated weights for ${Object.keys(weights).length} stocks`);
  
  // Return both weights and processed factors (with filled values)
  return {
    weights: weights,
    processedFactors: processedStocks
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
    
    // Step 1: Get ETF portfolio holdings
    const etfPortfolio = await getFundPortfolio('512890.SH', endDate);
    
    if (!etfPortfolio || !etfPortfolio.items || etfPortfolio.items.length === 0) {
      return res.status(404).json({ 
        error: 'ETF portfolio data not available',
        message: '无法获取512890的持仓数据，请检查日期或稍后重试'
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
        
        const [dailyBasicInfo, incomeData, balanceData] = await Promise.all([
          getDailyBasic(code, endDate),
          getIncomeStatement(code),
          getBalanceSheet(code)
        ]);
        
        let dividendYield = 0;
        let roce = null;
        
        // Extract dividend yield and market cap from daily basic
        let marketCap = null;
        if (dailyBasicInfo && dailyBasicInfo.items && dailyBasicInfo.items.length > 0) {
          const fields = dailyBasicInfo.fields;
          const dvYieldIdx = fields.indexOf('dv_ratio');
          const dvTtmIdx = fields.indexOf('dv_ttm');
          const totalMvIdx = fields.indexOf('total_mv');
          
          // Try dv_ratio first, then dv_ttm
          if (dvYieldIdx >= 0 && dailyBasicInfo.items[0][dvYieldIdx]) {
            dividendYield = dailyBasicInfo.items[0][dvYieldIdx];
          } else if (dvTtmIdx >= 0 && dailyBasicInfo.items[0][dvTtmIdx]) {
            dividendYield = dailyBasicInfo.items[0][dvTtmIdx];
          }
          
          // Get market cap
          if (totalMvIdx >= 0 && dailyBasicInfo.items[0][totalMvIdx]) {
            marketCap = dailyBasicInfo.items[0][totalMvIdx];
          }
          
          console.log(`${code} dividend yield: ${dividendYield}, market cap: ${marketCap}`);
        } else {
          console.log(`${code} no daily basic data`);
        }
        
        // Calculate ROCE = EBIT / (Total Assets - Current Liabilities)
        let ebit = null;
        let totalAssets = null;
        let currentLiab = null;
        
        if (incomeData && incomeData.items && incomeData.items.length > 0) {
          const fields = incomeData.fields;
          const ebitIdx = fields.indexOf('ebit');
          const operateProfitIdx = fields.indexOf('operate_profit');
          const totalProfitIdx = fields.indexOf('total_profit');
          
          // Try EBIT first, then operate_profit, then total_profit (for financial companies)
          if (ebitIdx >= 0 && incomeData.items[0][ebitIdx]) {
            ebit = incomeData.items[0][ebitIdx];
          } else if (operateProfitIdx >= 0 && incomeData.items[0][operateProfitIdx]) {
            ebit = incomeData.items[0][operateProfitIdx]; // Use operating profit as fallback
            console.log(`${code} using operate_profit instead of EBIT`);
          } else if (totalProfitIdx >= 0 && incomeData.items[0][totalProfitIdx]) {
            ebit = incomeData.items[0][totalProfitIdx]; // Use total profit as last resort
            console.log(`${code} using total_profit instead of EBIT`);
          }
          
          console.log(`${code} EBIT/Profit: ${ebit}`);
        } else {
          console.log(`${code} no income data`);
        }
        
        if (balanceData && balanceData.items && balanceData.items.length > 0) {
          const fields = balanceData.fields;
          const assetsIdx = fields.indexOf('total_assets');
          const liabIdx = fields.indexOf('total_cur_liab');
          const totalLiabIdx = fields.indexOf('total_liab');
          const equityIdx = fields.indexOf('total_hldr_eqy_exc_min_int');
          
          if (assetsIdx >= 0) totalAssets = balanceData.items[0][assetsIdx];
          if (liabIdx >= 0) currentLiab = balanceData.items[0][liabIdx];
          
          // For financial companies (banks, insurance), current_liab is null
          // Use total equity as capital employed instead
          if (!currentLiab && equityIdx >= 0) {
            const totalEquity = balanceData.items[0][equityIdx];
            if (totalEquity) {
              currentLiab = totalAssets - totalEquity; // Calculate implied "non-equity" portion
              console.log(`${code} using total equity method (financial company)`);
            }
          }
          
          console.log(`${code} Assets: ${totalAssets}, Current Liab: ${currentLiab}`);
        } else {
          console.log(`${code} no balance data`);
        }
        
        if (ebit && totalAssets && currentLiab) {
          const capitalEmployed = totalAssets - currentLiab;
          if (capitalEmployed > 0) {
            roce = (ebit / capitalEmployed) * 100; // Convert to percentage
            console.log(`${code} ROCE: ${roce.toFixed(2)}%`);
          }
        } else {
          console.log(`${code} cannot calculate ROCE - missing data`);
        }
        
        return {
          code: code,
          dividendYield: dividendYield || 0,
          roce: roce,
          marketCap: marketCap
        };
      } catch (error) {
        console.error(`Error fetching factors for ${code}:`, error.message);
        return {
          code: code,
          dividendYield: 0,
          roce: null,
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
          dividendYield: originalFactors ? originalFactors.dividendYield.toFixed(2) : '-',
          roce: originalFactors && originalFactors.roce !== null ? originalFactors.roce.toFixed(2) : '-'
        };
      } catch (error) {
        console.error(`Error fetching info for ${code}:`, error.message);
        return {
          code: code,
          name: code,
          industry: '-',
          marketCap: '-',
          weight: '0.00',
          dividendYield: '-',
          roce: '-'
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    hasToken: !!TUSHARE_TOKEN
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Tushare token configured: ${!!TUSHARE_TOKEN}`);
});
