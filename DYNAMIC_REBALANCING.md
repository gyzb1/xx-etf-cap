# 动态调仓回测功能说明

## 功能概述

动态调仓回测功能实现了真实模拟512890红利低波ETF的持仓变化过程，并在每次持仓披露时使用双因子模型（股息率+ROCE）重新计算权重。

## 核心特点

### 1. 跟随ETF持仓变化
- 自动获取512890的所有历史持仓数据（中报/年报）
- 识别回测期间内的所有调仓时点
- 每次持仓披露时自动调整组合

### 2. 双因子权重优化
- **股息率（Dividend Yield）**：反映分红回报能力
- **ROCE（资本回报率）**：反映资本使用效率
- 每个持仓期独立计算双因子权重

### 3. 连续净值曲线
- 从用户指定的开始日期开始计算
- 跨越多个持仓期生成连续净值
- 与512890 ETF基准进行对比

## 使用方法

### 方式1：Web界面（推荐）

1. 访问 `http://localhost:3001/dynamic.html`
2. 选择开始日期和结束日期
3. 点击"开始动态回测"
4. 查看结果：
   - 收益率对比
   - 净值曲线图
   - 各调仓周期详情

### 方式2：API调用

```bash
curl -X POST http://localhost:3001/api/backtest-dynamic \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "20240101",
    "endDate": "20241207"
  }'
```

### 方式3：测试脚本

```bash
node test-dynamic.js
```

## 回测示例

### 2024年全年回测

**输入参数：**
- 开始日期：2024-01-01
- 结束日期：2024-12-07

**回测结果：**
- 组合收益率：9.48%
- ETF收益率：20.54%
- 调仓次数：2次
- 涉及股票：171只（去重）

**调仓周期：**

#### 周期1：2023年报持仓
- 报告期：2023-12-31
- 生效期间：2024-01-01 ~ 2024-06-30
- 持仓数量：140只
- 前5大权重：
  1. 600295.SH: 1.46%
  2. 601088.SH: 1.34%
  3. 601866.SH: 1.24%
  4. 600057.SH: 1.20%
  5. 600028.SH: 1.19%

#### 周期2：2024中报持仓
- 报告期：2024-06-30
- 生效期间：2024-06-30 ~ 2024-12-07
- 持仓数量：82只
- 前5大权重：
  1. 600188.SH: 2.18%
  2. 600273.SH: 1.99%
  3. 600057.SH: 1.89%
  4. 600755.SH: 1.71%
  5. 600039.SH: 1.69%

## 技术实现

### 1. 持仓数据获取
```javascript
// 获取所有历史持仓
const allPortfolioData = await callTushareAPI('fund_portfolio', {
  ts_code: '512890.SH'
});

// 筛选中报和年报（完整持仓）
const fullReportDates = allEndDates.filter(date => 
  date.endsWith('0630') || date.endsWith('1231')
);
```

### 2. 权重计算
每个持仓期独立计算：
```javascript
for (let period of portfolioPeriods) {
  // 获取该期持仓的财务数据
  const stocksFactors = await batchProcess(period.stockCodes, async (code) => {
    // 获取股息率和ROCE
    const [dailyBasicInfo, incomeData, balanceData] = await Promise.all([...]);
    return { code, dividendYield, roce };
  });
  
  // 计算双因子权重
  period.weights = calculateDualFactorWeights(stocksFactors);
}
```

### 3. 净值计算
```javascript
for (const date of sortedDates) {
  // 找到当前日期所属的持仓期
  const currentPeriod = portfolioPeriods.find(p => 
    date >= p.startDate && date <= p.endDate
  );
  
  // 使用该期的权重计算收益
  let dailyReturn = 0;
  for (const [code, weight] of Object.entries(currentPeriod.weights)) {
    dailyReturn += weight * (stockPctChg / 100);
  }
  
  // 累积净值
  currentNetValue = currentNetValue * (1 + dailyReturn);
}
```

## 数据说明

### 持仓披露时间
- **年报（1231）**：次年4月底前披露
- **中报（0630）**：当年8月底前披露
- **季报（0331/0930）**：通常只披露前10大持仓，不使用

### 调仓逻辑
1. 使用最近一次完整持仓（中报/年报）
2. 从回测开始日期就应用该持仓
3. 新持仓披露时立即调仓
4. 持仓期内权重保持不变

### 数据时效性
- 持仓数据：季度更新
- 财务数据：使用最新可用数据
- 价格数据：每日更新

## 注意事项

1. **回测局限性**
   - 不考虑交易成本和税费
   - 不考虑流动性约束
   - 假设可以完美复制持仓
   - 历史表现不代表未来收益

2. **数据要求**
   - 需要有效的Tushare Pro Token
   - 需要足够的API积分权限
   - 建议使用2000积分以上账号

3. **性能考虑**
   - 回测时间较长（需获取大量数据）
   - 建议选择合理的回测区间
   - 避免频繁调用API

## 与静态回测的区别

| 特性 | 静态回测 (`/api/backtest-etf`) | 动态调仓 (`/api/backtest-dynamic`) |
|------|-------------------------------|-----------------------------------|
| 持仓变化 | ❌ 使用单一持仓 | ✅ 跟随ETF持仓变化 |
| 调仓次数 | 0次 | 根据报告期自动调仓 |
| 真实性 | 较低 | 高 |
| 计算时间 | 快 | 较慢 |
| 适用场景 | 快速测试 | 真实回测 |

## 未来优化方向

- [ ] 支持自定义调仓频率
- [ ] 添加交易成本模拟
- [ ] 支持更多因子组合
- [ ] 添加风险指标（夏普比率、最大回撤等）
- [ ] 支持多ETF对比
- [ ] 导出详细回测报告

## 相关文件

- `server.js` - 后端API实现
- `public/dynamic.html` - 前端界面
- `test-dynamic.js` - 测试脚本
- `README.md` - 项目总文档

## 技术支持

如有问题，请查看：
1. 控制台日志（`npm start`输出）
2. 浏览器开发者工具
3. Tushare API文档

---

**版本**: v1.3.0-dynamic  
**更新日期**: 2024-12-08  
**作者**: ETF回测系统
