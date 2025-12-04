# 版本历史

## v1.0.0 - 稳定版本 (2024-12-04)

**这是一个功能完整、测试通过的稳定版本**

### 主要功能
- ✅ 双因子加权模型（股息率 + ROCE）
- ✅ 自动获取512890 ETF持仓（约84只股票）
- ✅ 智能数据处理和缺失值填充
- ✅ 净值曲线归一化对比（初始值都是1.0）
- ✅ 完整的README文档，详细说明计算规则
- ✅ 简化的Web界面（仅保留ETF策略）

### 如何回到这个版本

如果后续修改出现问题，可以使用以下命令回到这个稳定版本：

#### 方法1：使用Git标签（推荐）
```bash
# 查看所有标签
git tag -l

# 回到v1.0.0版本
git checkout v1.0.0

# 如果要基于这个版本创建新分支继续开发
git checkout -b fix-from-v1.0.0 v1.0.0

# 如果要完全重置到这个版本（谨慎使用，会丢失后续修改）
git reset --hard v1.0.0
```

#### 方法2：使用提交哈希
```bash
# 查看提交历史
git log --oneline

# 回到特定提交
git checkout 14017ad

# 或者重置到这个提交
git reset --hard 14017ad
```

#### 方法3：从GitHub恢复
```bash
# 从远程仓库重新拉取v1.0.0版本
git fetch origin
git checkout tags/v1.0.0
```

### 核心文件列表
- `server.js` - 后端服务器（870行）
- `public/index.html` - 前端页面（完整版）
- `README.md` - 详细文档（约300行）
- `package.json` - 依赖配置
- `.gitignore` - Git忽略规则

### 技术细节
- Node.js + Express
- Tushare Pro API
- Chart.js 可视化
- 批量处理：历史数据10只/批，财务数据8只/批
- 批次延迟：500ms

### 已知问题
- 部分股票的股息率可能为0（真实情况，未分红）
- 部分股票的ROCE可能缺失（使用平均值填充）
- API频率限制可能导致回测时间较长（1-2分钟）

---

## v1.1.0 - 修复金融企业ROCE计算 (2024-12-04)

**重要更新：修复了银行等金融企业的ROCE计算问题**

### 主要改进

#### 1. 金融企业ROCE计算修复 ✅
- **问题**：银行、保险等金融企业的资产负债表中 `total_cur_liab`（流动负债）为 null
- **原因**：金融企业的资产负债表结构与普通企业不同，没有"流动负债"概念
- **解决方案**：
  ```
  普通企业：资本使用 = 总资产 - 流动负债
  金融企业：资本使用 = 股东权益 (total_hldr_eqy_exc_min_int)
  ```
- **结果**：所有84只股票（包括银行股）都能正确计算ROCE

#### 2. 利润指标三级回退机制 ✅
- **优先级**：`ebit` → `operate_profit` → `total_profit`
- **适用场景**：
  - 普通企业：使用EBIT（息税前利润）
  - 金融企业：EBIT通常为null，自动使用营业利润或利润总额
- **日志提示**：会显示使用了哪个利润指标

#### 3. API调用优化 ✅
- 移除固定报告期限制，自动获取最新财报数据
- 优化批处理大小：
  - 历史数据：10只/批
  - 因子数据：5只/批（降低以避免API限流）
- 批次间延迟增加到800ms

#### 4. 数据处理改进 ✅
- 移除ROCE填充逻辑：缺失数据显示为"-"，不参与权重计算
- 只有同时具备股息率和ROCE的股票才参与双因子加权
- 添加详细日志输出，便于调试

#### 5. 文档完善 ✅
- README中详细说明金融企业特殊处理逻辑
- 列出所有使用的Tushare字段名
- 说明ROCE计算的三级回退机制

### 新增文件
- `test-bank.js` - 银行股数据获取测试工具
- `VERSION_HISTORY.md` - 版本历史记录

### 技术细节
```javascript
// 资产负债表字段
fields: 'ts_code,end_date,total_assets,total_cur_liab,total_hldr_eqy_exc_min_int'

// 金融企业判断逻辑
if (!currentLiab && equityIdx >= 0) {
  const totalEquity = balanceData.items[0][equityIdx];
  if (totalEquity) {
    currentLiab = totalAssets - totalEquity;
    console.log(`${code} using total equity method (financial company)`);
  }
}
```

### 如何从v1.0.0升级
```bash
git pull origin main
npm install  # 如果有依赖更新
```

### 已知改进
- 所有股票都能正确显示ROCE（除非真的没有财报数据）
- 银行股不再显示"-"
- 权重分配更加合理

---
