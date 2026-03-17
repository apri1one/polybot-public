import type {
    PairingResolution,
    PairingWithWallets,
    UpdatePairingRequest,
    WalletRecord,
} from './types.js';
import * as db from './db.js';

function normalizeAddress(value?: string | null): string | null {
    if (!value) return null;
    return value.trim().toLowerCase();
}

export class PairingService {
    createPairing(name: string, masterWalletId: number, hedgeWalletId?: number): PairingWithWallets {
        if (!name?.trim()) throw new Error('配对名称不能为空');
        if (!masterWalletId) throw new Error('必须指定 master 钱包');

        const usedIds = db.getUsedWalletIds();
        if (usedIds.has(masterWalletId)) {
            throw new Error(`钱包 #${masterWalletId} 已在其他配对中使用`);
        }

        let resolvedHedgeId: number;
        if (hedgeWalletId) {
            if (hedgeWalletId === masterWalletId) {
                throw new Error('Master 钱包不能同时作为对冲钱包');
            }
            if (usedIds.has(hedgeWalletId)) {
                throw new Error(`钱包 #${hedgeWalletId} 已在其他配对中使用`);
            }
            if (!db.getWalletById(hedgeWalletId)) {
                throw new Error(`钱包 #${hedgeWalletId} 不存在`);
            }
            resolvedHedgeId = hedgeWalletId;
        } else {
            resolvedHedgeId = this.pickRandomUnmatchedWallet(masterWalletId, usedIds);
        }

        if (!db.getWalletById(masterWalletId)) {
            throw new Error(`钱包 #${masterWalletId} 不存在`);
        }

        const pairing = db.insertPairing(name, masterWalletId, resolvedHedgeId);
        return db.getPairingWithWallets(pairing.id)!;
    }

    private pickRandomUnmatchedWallet(excludeId: number, usedIds: Set<number>): number {
        const allWallets = db.listWallets();
        const available = allWallets.filter(w => w.id !== excludeId && !usedIds.has(w.id));
        if (available.length === 0) {
            throw new Error('没有可用的未匹配钱包');
        }
        const picked = available[Math.floor(Math.random() * available.length)];
        return picked.id;
    }

    autoMatch(masterWalletId: number, hedgeWalletId?: number): PairingWithWallets {
        const wallet = db.getWalletById(masterWalletId);
        if (!wallet) throw new Error(`钱包 #${masterWalletId} 不存在`);
        const name = `${wallet.label} 配对`;
        return this.createPairing(name, masterWalletId, hedgeWalletId);
    }

    listUnmatchedWallets(): WalletRecord[] {
        const usedIds = db.getUsedWalletIds();
        return db.listWallets().filter(w => !usedIds.has(w.id));
    }

    updatePairing(pairingId: number, updates: UpdatePairingRequest): void {
        const existing = db.getPairingById(pairingId);
        if (!existing) throw new Error(`配对 #${pairingId} 不存在`);

        const newMaster = updates.masterWalletId ?? existing.masterWalletId;
        const newHedge = updates.hedgeWalletId ?? existing.hedgeWalletId;

        if (newHedge !== null && newHedge !== undefined && newHedge === newMaster) {
            throw new Error('Master 钱包不能同时作为对冲钱包');
        }

        if (updates.masterWalletId !== undefined) {
            const pairings = db.listPairings();
            for (const pairing of pairings) {
                if (pairing.id !== pairingId && pairing.masterWalletId === updates.masterWalletId) {
                    throw new Error(`钱包 #${updates.masterWalletId} 已是配对 "${pairing.name}" 的 master`);
                }
            }
        }

        db.updatePairing(pairingId, {
            name: updates.name,
            masterWalletId: updates.masterWalletId,
            hedgeWalletId: updates.hedgeWalletId,
        });
    }

    listPairings(): PairingWithWallets[] {
        return db.listPairingsWithWallets();
    }

    listActivePairings(): PairingWithWallets[] {
        return db.listActivePairingsWithWallets();
    }

    removePairing(pairingId: number): void {
        db.deletePairing(pairingId);
    }

    getActivePairing(): PairingWithWallets | null {
        return db.getActivePairing();
    }

    activatePairing(pairingId: number): void {
        const pairing = db.getPairingById(pairingId);
        if (!pairing) throw new Error(`配对 #${pairingId} 不存在`);
        db.activatePairingNonExclusive(pairingId);
    }

    deactivatePairing(pairingId: number): void {
        db.deactivatePairing(pairingId);
    }

    hasActivePairing(): boolean {
        return db.listActivePairings().length > 0;
    }

    getRuntimeMasterWallet(): WalletRecord | null {
        const runtimeProxy = normalizeAddress(process.env.POLYMARKET_PROXY_ADDRESS);
        const runtimeTrader = normalizeAddress(process.env.POLYMARKET_TRADER_ADDRESS);

        if (!runtimeProxy && !runtimeTrader) {
            return null;
        }

        for (const pairing of this.listPairings()) {
            const master = pairing.masterWallet;
            const masterProxy = normalizeAddress(master.proxyAddress);
            const masterAddress = normalizeAddress(master.address);
            if ((runtimeProxy && masterProxy === runtimeProxy) || (runtimeTrader && masterAddress === runtimeTrader)) {
                return master;
            }
        }

        return null;
    }

    resolvePairingForTask(task?: {
        polyMultiPairingId?: number;
        polyMultiMasterWalletId?: number;
    }): PairingResolution | null {
        const activePairings = this.listActivePairings();

        if (task?.polyMultiPairingId) {
            const pairing = activePairings.find((item) => item.id === task.polyMultiPairingId);
            if (pairing) {
                return { pairing, source: 'task_pairing_id' };
            }
        }

        if (task?.polyMultiMasterWalletId) {
            const pairing = activePairings.find((item) => item.masterWalletId === task.polyMultiMasterWalletId);
            if (pairing) {
                return { pairing, source: 'task_master_wallet_id' };
            }
        }

        const runtimeMaster = this.getRuntimeMasterWallet();
        if (runtimeMaster) {
            const pairing = activePairings.find((item) => item.masterWalletId === runtimeMaster.id);
            if (pairing) {
                return { pairing, source: 'runtime_master_wallet' };
            }
        }

        if (activePairings.length === 1) {
            return { pairing: activePairings[0], source: 'single_active_pairing' };
        }

        return null;
    }
}
