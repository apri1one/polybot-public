/**
 * Polymarket CTF Redeem Service
 *
 * 通过 Gnosis Safe execTransaction 路由 CTF redeemPositions 调用。
 * 支持标准 CTF 市场和 negRisk 市场的赎回。
 *
 * 架构：
 * EOA (签名) → Safe execTransaction → CTF.redeemPositions / NegRiskAdapter.redeemPositions
 */

import { Wallet, Contract, AbiCoder, keccak256, getBytes, zeroPadValue, solidityPacked } from 'ethers';
import type { JsonRpcProvider } from 'ethers';

// ============================================================================
// 合约地址 (Polygon Mainnet)
// ============================================================================

const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

// ============================================================================
// ABI 片段
// ============================================================================

const SAFE_ABI = [
    'function nonce() view returns (uint256)',
    'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes signatures) payable returns (bool success)',
    'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
];

const CTF_ABI = [
    'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)',
];

const NEG_RISK_ABI = [
    'function redeemPositions(bytes32 conditionId, uint256[] amounts)',
];

// ============================================================================
// 类型定义
// ============================================================================

export interface RedeemRequest {
    conditionId: string;        // 0x 前缀 bytes32
    negRisk: boolean;
    /** negRisk 市场需要提供每个 outcome 的数量 [yesAmount, noAmount] (原始单位, 6 位小数) */
    amounts?: bigint[];
}

export interface RedeemResult {
    conditionId: string;
    txHash: string;
    blockNumber: number;
    success: boolean;
    error?: string;
}

// ============================================================================
// Safe 签名构建
// ============================================================================

/**
 * 构建 1-of-1 Safe 的 execTransaction 签名
 *
 * Gnosis Safe 签名格式 (EIP-712):
 * domainSeparator 已内置于 Safe 合约的 getTransactionHash。
 * 对于 1-of-1 Safe, 只需单个 owner 签名。
 */
async function signSafeTransaction(
    safeContract: Contract,
    wallet: Wallet,
    to: string,
    data: string,
): Promise<{ signatures: string; nonce: bigint }> {
    const nonce = await safeContract.nonce() as bigint;

    // 获取 Safe 内部交易哈希
    const txHash = await safeContract.getTransactionHash(
        to,           // to
        0,            // value
        data,         // data
        0,            // operation (CALL)
        0,            // safeTxGas
        0,            // baseGas
        0,            // gasPrice
        '0x0000000000000000000000000000000000000000',  // gasToken
        '0x0000000000000000000000000000000000000000',  // refundReceiver
        nonce,        // nonce
    ) as string;

    // EOA 签名
    const sig = wallet.signingKey.sign(getBytes(txHash));
    // 打包为 r + s + v (65 bytes)
    const signatures = sig.r + sig.s.slice(2) + sig.v.toString(16).padStart(2, '0');

    return { signatures, nonce };
}

/**
 * 通过 Safe 执行交易
 */
async function execViaSafe(
    safeContract: Contract,
    wallet: Wallet,
    to: string,
    data: string,
): Promise<{ txHash: string; blockNumber: number }> {
    const { signatures } = await signSafeTransaction(safeContract, wallet, to, data);

    const tx = await safeContract.execTransaction(
        to,           // to
        0,            // value
        data,         // data
        0,            // operation (CALL)
        0,            // safeTxGas
        0,            // baseGas
        0,            // gasPrice
        '0x0000000000000000000000000000000000000000',  // gasToken
        '0x0000000000000000000000000000000000000000',  // refundReceiver
        signatures,   // signatures
    );

    const receipt = await tx.wait();
    return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
    };
}

// ============================================================================
// Redeem 实现
// ============================================================================

/**
 * 编码标准 CTF redeemPositions calldata
 */
function encodeCtfRedeem(conditionId: string): string {
    const ctfInterface = new Contract('0x0000000000000000000000000000000000000000', CTF_ABI).interface;
    return ctfInterface.encodeFunctionData('redeemPositions', [
        USDC_ADDRESS,
        '0x0000000000000000000000000000000000000000000000000000000000000000', // parentCollectionId
        conditionId,
        [1, 2],  // indexSets: [YES=0b01, NO=0b10]
    ]);
}

/**
 * 编码 negRisk redeemPositions calldata
 */
function encodeNegRiskRedeem(conditionId: string, amounts: bigint[]): string {
    const nrInterface = new Contract('0x0000000000000000000000000000000000000000', NEG_RISK_ABI).interface;
    return nrInterface.encodeFunctionData('redeemPositions', [
        conditionId,
        amounts,
    ]);
}

/**
 * 赎回单个仓位
 */
export async function redeemPosition(
    provider: JsonRpcProvider,
    privateKey: string,
    proxyAddress: string,
    request: RedeemRequest,
): Promise<RedeemResult> {
    const wallet = new Wallet(privateKey, provider);
    const safeContract = new Contract(proxyAddress, SAFE_ABI, wallet);

    let to: string;
    let data: string;

    if (request.negRisk) {
        if (!request.amounts || request.amounts.length === 0) {
            return {
                conditionId: request.conditionId,
                txHash: '',
                blockNumber: 0,
                success: false,
                error: 'negRisk redeem requires amounts',
            };
        }
        to = NEG_RISK_ADAPTER;
        data = encodeNegRiskRedeem(request.conditionId, request.amounts);
    } else {
        to = CTF_ADDRESS;
        data = encodeCtfRedeem(request.conditionId);
    }

    try {
        const result = await execViaSafe(safeContract, wallet, to, data);
        return {
            conditionId: request.conditionId,
            txHash: result.txHash,
            blockNumber: result.blockNumber,
            success: true,
        };
    } catch (error: any) {
        return {
            conditionId: request.conditionId,
            txHash: '',
            blockNumber: 0,
            success: false,
            error: error.message,
        };
    }
}

/**
 * 批量赎回多个仓位（串行执行，每笔等待确认后再发下一笔）
 */
export async function redeemAll(
    provider: JsonRpcProvider,
    privateKey: string,
    proxyAddress: string,
    requests: RedeemRequest[],
    onProgress?: (result: RedeemResult, index: number, total: number) => void,
): Promise<RedeemResult[]> {
    const results: RedeemResult[] = [];

    for (let i = 0; i < requests.length; i++) {
        const result = await redeemPosition(provider, privateKey, proxyAddress, requests[i]);
        results.push(result);
        onProgress?.(result, i, requests.length);
    }

    return results;
}
