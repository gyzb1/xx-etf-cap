# 快速开始指南

## 5分钟上手动态调仓回测

### 步骤1：确认环境配置 ✅

确保已完成：
```bash
# 1. 安装依赖
npm install

# 2. 配置Tushare Token（在.env文件中）
TUSHARE_TOKEN=your_token_here
PORT=3001
```

### 步骤2：启动服务器 🚀

```bash
npm start
```

看到以下输出表示成功：
```
Server running on http://localhost:3001
Tushare token configured: true
```

### 步骤3：打开动态调仓页面 🌐

在浏览器中访问：
```
http://localhost:3001/dynamic.html
```

### 步骤4：运行回测 📊

1. **选择日期范围**
   - 开始日期：2024-01-01
   - 结束日期：2024-12-07（或今天）

2. **点击"开始动态回测"**

3. **等待结果**（约30-60秒）
   - 系统会自动获取历史持仓
   - 计算双因子权重
   - 生成净值曲线

### 步骤5：查看结果 📈

回测完成后，你会看到：

#### 1. 核心指标
- 组合收益率：9.48%
- ETF收益率：20.54%
- 超额收益：-11.06%
- 调仓次数：2次

#### 2. 净值曲线图
- 蓝线：双因子优化组合
- 橙线：512890 ETF基准

#### 3. 调仓周期详情
每个周期显示：
- 报告期和生效期间
- 持仓股票数量
- 前10大权重股票

## 命令行测试（可选）

如果你更喜欢命令行：

```bash
# 运行测试脚本
node test-dynamic.js
```

输出示例：
```
=== Backtest Results ===

Portfolio Return: 9.48%
ETF Return: 20.54%
Outperformance: -11.06%

Rebalancing Count: 2
Total Unique Stocks: 171

=== Rebalancing Periods ===

Period 1: 20231231
  Duration: 20240101 to 20240630
  Stock Count: 140
  Top 5 Holdings:
    1. 600295.SH: 1.46%
    2. 601088.SH: 1.34%
    ...
```

## API调用（开发者）

使用curl或任何HTTP客户端：

```bash
curl -X POST http://localhost:3001/api/backtest-dynamic \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "20240101",
    "endDate": "20241207"
  }'
```

## 常见问题

### Q1: 回测时间太长？
**A**: 正常现象。动态回测需要：
- 获取多个报告期的持仓数据
- 计算每个持仓期的双因子权重
- 获取所有股票的历史价格

建议：
- 选择合理的回测区间（不要太长）
- 确保网络连接稳定
- 避免频繁调用

### Q2: 提示"无法获取持仓数据"？
**A**: 检查：
1. Tushare Token是否正确配置
2. Token是否有足够的积分权限（建议2000+）
3. 日期范围是否合理

### Q3: 为什么组合收益低于ETF？
**A**: 可能原因：
- 双因子模型在该期间表现不佳
- 调仓时机不理想
- 权重分配策略需要优化

这是正常的回测结果，说明：
- 历史表现不代表未来
- 需要持续优化策略
- 可以尝试调整因子权重

### Q4: 如何修改因子权重？
**A**: 编辑 `server.js` 中的 `calculateDualFactorWeights` 函数：

```javascript
// 当前：等权重
score = (normDiv + normRoce) / 2

// 修改为：股息率70%，ROCE 30%
score = normDiv * 0.7 + normRoce * 0.3
```

## 下一步

- 📖 阅读[动态调仓详细文档](./DYNAMIC_REBALANCING.md)
- 🔧 查看[完整README](./README.md)了解策略细节
- 💡 尝试不同的日期范围和参数
- 📊 对比静态回测和动态回测的差异

## 技术支持

遇到问题？
1. 查看控制台输出日志
2. 检查浏览器开发者工具
3. 参考Tushare API文档
4. 提交Issue到项目仓库

---

**祝你回测愉快！** 🎉
