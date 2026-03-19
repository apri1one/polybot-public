# Poly-Bot

Polymarket 多钱包交易系统，支持体育赛事实时行情、多钱包对冲、自动任务管理。

## 快速启动

```bash
cp .env.example .env   # 编辑填入凭证
npm install
npm start              # 或 npm run dev (watch 模式)
```

服务默认监听 `0.0.0.0:3020`，前端页面 `http://localhost:3020/`。

## 项目结构

```
src/
  server.ts                  # HTTP 入口 + SSE + 静态文件服务
  core/                      # 核心业务逻辑
    wallet-manager.ts        # 多钱包 CRUD + 凭证缓存
    pairing-service.ts       # 钱包配对 (master ↔ hedge)
    order-service.ts         # 路由下单到指定钱包
    task-service.ts          # 任务生命周期管理
    multi-hedge-executor.ts  # 多账户对冲执行
    crypto-utils.ts          # AES-256-GCM 加密模块
    db.ts                    # SQLite schema + DAO
    api-routes.ts            # /api/poly-multi/* 路由
  polymarket/                # Polymarket API 客户端
    polymarket-trader.ts     # 交易主类
    rest-client.ts           # CLOB REST API
    user-ws-client.ts        # User WebSocket
  sports/                    # 体育赛事行情
  logger/                    # 任务日志
  notification/              # Telegram 通知
  frontend/                  # 前端页面 (JSX + HTML)
tools/
  get-pm-apikey.py           # Python: 从私钥派生 API 凭证
  setup-polymarket-env.py    # Python: 一键配置 .env + 远端部署
  test-redeem.ts             # 赎回测试脚本
```

## 技术栈

- **Runtime**: Node.js + tsx (TypeScript 直接执行)
- **Database**: SQLite (better-sqlite3), WAL 模式
- **Chain**: Polygon (ethers.js)
- **Module**: ESM (`"type": "module"`)
- **Target**: ES2022, NodeNext

## 开发约定

- TypeScript strict 模式，`npm run typecheck` 检查类型
- 文件扩展名使用 `.js` 后缀 (ESM import)
- 钱包私钥通过 AES-256-GCM 加密存储在 SQLite，运行时解密到内存缓存
- 前端通过 SSE (`/api/events`) 接收实时数据推送
- PM2 部署使用 `ecosystem.config.cjs`

## 环境变量

见 `.env.example`。关键变量：

- `POLY_MULTI_MASTER_PASSWORD` — 钱包加密主密码，留空使用默认值
- `POLY_MULTI_PORT` — HTTP 端口 (默认 3020)
- `POLY_MULTI_DATA_DIR` — 数据目录 (默认 ./data)
- `POLYMARKET_TRADER_PRIVATE_KEY` — 单钱包模式私钥
