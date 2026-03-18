/**
 * Redeem 测试脚本
 *
 * 使用钱包 1 测试赎回功能。先尝试一个小仓位验证流程。
 *
 * 用法: npx tsx tools/test-redeem.ts
 */

import { JsonRpcProvider } from 'ethers';
import Database from 'better-sqlite3';
import { decryptCredentials, DEFAULT_MASTER_PASSWORD } from '../src/core/crypto-utils.js';
import { redeemPosition, redeemAll } from '../src/core/redeem-service.js';
import type { RedeemRequest } from '../src/core/redeem-service.js';

const RPC_URLS = [
    'https://polygon.drpc.org',
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon-rpc.com',
];

// ============================================================================
// 钱包 1 可赎回仓位 (来自 Polymarket Data API)
// ============================================================================

const REDEEMABLE_POSITIONS: (RedeemRequest & { title: string; size: number })[] = [
    // 标准 CTF (negRisk=false) — 先测一个小的
    {
        conditionId: '0xe93c89c41d1bb08d3bb40066d8565df301a696563b2542256e6e8bbbb1ec490d',
        negRisk: false,
        title: 'No change in Fed interest rates after January 2026 meeting?',
        size: 0.000006,
    },
    {
        conditionId: '0x3c4b545b189b25c868f50f36c9efc21c0ca5eabcf6c733058dac137f3509f6c1',
        negRisk: false,
        title: 'Will Opensea launch a token by December 31?',
        size: 0.002224,
    },
    {
        conditionId: '0x42d812af0840d50685b0aaa0cc0a4b3c07a680cd12a85d88a377558f3621c78c',
        negRisk: false,
        title: 'Over $1.4B committed to the MegaETH public sale?',
        size: 0.003335,
    },
    {
        conditionId: '0x1eecefb21081705cb8b89061558098593f07793a42bd0e055a9a613f5fd70ed6',
        negRisk: false,
        title: 'Grokipedia released by October 31?',
        size: 0.003029,
    },
    {
        conditionId: '0x3d1ee76e9b5717aeb7b1b9e1875df927bc95e132adb86f077e2e6b1f11a09f07',
        negRisk: false,
        title: 'Will the price of Bitcoin be above $100,000 on November 7?',
        size: 0.00574,
    },
    {
        conditionId: '0xe64c5c3ec8605ada79f32897f171ea56245c56b1783f969553234419bf1a6184',
        negRisk: false,
        title: 'Will Meteora launch a token in 2025?',
        size: 0.0095,
    },
    {
        conditionId: '0x4eebc9c583241f209758d4c209946caff9b09dabe37938b242dee7062ee310e2',
        negRisk: false,
        title: 'Will Ethereum reach $4,400 September 22-28?',
        size: 0.030752,
    },
    {
        conditionId: '0x121c5c814478467a35d47c87febbf6e24861a5da0326e628d27bd820bef81029',
        negRisk: false,
        title: 'Bitcoin $114k-$116k on Sep 30?',
        size: 7,
    },
    {
        conditionId: '0xe40c6a429fe7a00bc682e6400bddd68e1a4455f0af681114d0fa557fbcc7efd1',
        negRisk: false,
        title: 'Heat vs. Hornets',
        size: 20,
    },
    {
        conditionId: '0xb7a9b158250741ce776aab626548094c1f95df13ee35f4920d232fe9c90a732a',
        negRisk: false,
        title: 'Warriors vs. Spurs',
        size: 400,
    },
    {
        conditionId: '0xa00d6ab9eac69755f01c4da18f92d6fd01a9ddeb7407c5add3bef45b719917cc',
        negRisk: false,
        title: 'Will Ethereum dip to $3,000 in November?',
        size: 1876.174545,
    },
    // negRisk=true
    // Chelsea FC — 暂时跳过 negRisk，先验证标准 CTF 流程
];

async function getProvider(): Promise<JsonRpcProvider> {
    for (const url of RPC_URLS) {
        try {
            const provider = new JsonRpcProvider(url, 137);
            await provider.getBlockNumber();
            console.log(`RPC connected: ${url}`);
            return provider;
        } catch {
            continue;
        }
    }
    throw new Error('All RPC endpoints failed');
}

function getWallet1Credentials(): { privateKey: string; proxyAddress: string } {
    const db = new Database('./data/poly-multi.db', { readonly: true });

    const row = db.prepare(
        'SELECT encrypted_credentials, salt, iv, auth_tag, proxy_address FROM wallets WHERE id = 1'
    ).get() as { encrypted_credentials: string; salt: string; iv: string; auth_tag: string; proxy_address: string };

    if (!row) throw new Error('Wallet 1 not found');

    const creds = decryptCredentials(
        { ciphertext: row.encrypted_credentials, salt: row.salt, iv: row.iv, authTag: row.auth_tag },
        DEFAULT_MASTER_PASSWORD,
    );

    const privateKey = creds.privateKey.toString('utf8');
    creds.privateKey.fill(0);
    db.close();

    return { privateKey, proxyAddress: row.proxy_address };
}

async function main() {
    const mode = process.argv[2] || 'single';  // 'single' | 'all'

    console.log('=== Polymarket CTF Redeem Test ===\n');

    // 1. 获取凭证
    const { privateKey, proxyAddress } = getWallet1Credentials();
    console.log(`Proxy wallet: ${proxyAddress}`);

    // 2. 连接 RPC
    const provider = await getProvider();

    // 3. 检查 EOA MATIC 余额 (需要 gas)
    const { Wallet } = await import('ethers');
    const wallet = new Wallet(privateKey, provider);
    const maticBalance = await provider.getBalance(wallet.address);
    console.log(`EOA: ${wallet.address}`);
    console.log(`MATIC balance: ${Number(maticBalance) / 1e18} MATIC\n`);

    if (maticBalance === 0n) {
        console.error('EOA 没有 MATIC，无法支付 gas 费用');
        process.exit(1);
    }

    if (mode === 'single') {
        // 单笔测试 — 用最小的仓位
        const testPosition = REDEEMABLE_POSITIONS[0];
        console.log(`Testing single redeem: "${testPosition.title}" (size=${testPosition.size})`);
        console.log(`conditionId: ${testPosition.conditionId}\n`);

        const result = await redeemPosition(provider, privateKey, proxyAddress, {
            conditionId: testPosition.conditionId,
            negRisk: testPosition.negRisk,
        });

        if (result.success) {
            console.log(`Redeem SUCCESS`);
            console.log(`TX: https://polygonscan.com/tx/${result.txHash}`);
            console.log(`Block: ${result.blockNumber}`);
        } else {
            console.error(`Redeem FAILED: ${result.error}`);
        }
    } else if (mode === 'all') {
        // 批量赎回所有标准 CTF 仓位
        console.log(`Redeeming all ${REDEEMABLE_POSITIONS.length} positions...\n`);

        const results = await redeemAll(
            provider,
            privateKey,
            proxyAddress,
            REDEEMABLE_POSITIONS,
            (result, index, total) => {
                const status = result.success ? 'OK' : 'FAIL';
                const tx = result.success ? `tx=${result.txHash.slice(0, 14)}...` : result.error;
                console.log(`[${index + 1}/${total}] ${status} — ${tx}`);
            },
        );

        const succeeded = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        console.log(`\nDone: ${succeeded} succeeded, ${failed} failed`);
    }
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
