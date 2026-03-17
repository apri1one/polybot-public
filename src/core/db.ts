/**
 * poly-multi: SQLite 数据库 schema + DAO
 *
 * 数据库路径: data/poly-multi.db
 * 表: wallets, pairings, hedge_executions
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import type {
    WalletRecord,
    Pairing,
    PairingWithWallets,
    EncryptedData,
    HedgeDistribution,
    HedgeExecution,
} from './types.js';

const DEFAULT_DB_DIR = path.join(process.cwd(), 'data');

function resolveDbDir(): string {
    const configured = process.env.POLY_MULTI_DATA_DIR?.trim();
    return configured ? path.resolve(configured) : DEFAULT_DB_DIR;
}

export function getDataDir(): string {
    return resolveDbDir();
}

export function getDbPath(): string {
    return path.join(resolveDbDir(), 'poly-multi.db');
}

let db: Database.Database | null = null;

// ============================================================
// 初始化
// ============================================================

export function getDb(): Database.Database {
    if (db) return db;

    const dbDir = resolveDbDir();
    const dbPath = getDbPath();

    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    initSchema(db);

    // 尝试设置文件权限 (Linux/Mac)
    try {
        fs.chmodSync(dbPath, 0o600);
    } catch {
        // Windows 下 chmod 可能无效，忽略
    }

    return db;
}

function initSchema(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS wallets (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            label                 TEXT NOT NULL,
            address               TEXT NOT NULL UNIQUE,
            proxy_address         TEXT NOT NULL,
            encrypted_credentials TEXT NOT NULL,
            salt                  TEXT NOT NULL,
            iv                    TEXT NOT NULL,
            auth_tag              TEXT NOT NULL,
            is_active             INTEGER NOT NULL DEFAULT 1,
            created_at            TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS pairings (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            name              TEXT NOT NULL,
            master_wallet_id  INTEGER NOT NULL REFERENCES wallets(id),
            is_active         INTEGER NOT NULL DEFAULT 1,
            created_at        TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS pairing_hedgers (
            pairing_id  INTEGER NOT NULL REFERENCES pairings(id) ON DELETE CASCADE,
            wallet_id   INTEGER NOT NULL REFERENCES wallets(id),
            sort_order  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (pairing_id, wallet_id)
        );

        CREATE TABLE IF NOT EXISTS hedge_executions (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            pairing_id          INTEGER NOT NULL REFERENCES pairings(id),
            task_id             TEXT,
            predict_order_hash  TEXT,
            predict_fill_qty    REAL NOT NULL,
            predict_fill_price  REAL NOT NULL,
            distribution        TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'PENDING',
            created_at          TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at        TEXT
        );
    `);

    // === 迁移: 1:1 配对 ===
    const pairingCols = db.pragma('table_info(pairings)') as Array<{ name: string }>;
    if (!pairingCols.some(c => c.name === 'hedge_wallet_id')) {
        db.exec(`ALTER TABLE pairings ADD COLUMN hedge_wallet_id INTEGER REFERENCES wallets(id)`);
        // 迁移现有 pairing_hedgers 数据
        const rows = db.prepare(
            'SELECT pairing_id, wallet_id FROM pairing_hedgers ORDER BY pairing_id, sort_order'
        ).all() as Array<{ pairing_id: number; wallet_id: number }>;
        const migrated = new Set<number>();
        const updateStmt = db.prepare('UPDATE pairings SET hedge_wallet_id = ? WHERE id = ?');
        for (const row of rows) {
            if (!migrated.has(row.pairing_id)) {
                updateStmt.run(row.wallet_id, row.pairing_id);
                migrated.add(row.pairing_id);
            }
        }
    }

    // === 迁移: wallets 查询数据列 ===
    const walletCols = db.pragma('table_info(wallets)') as Array<{ name: string }>;
    const newWalletCols = [
        { name: 'cash', sql: 'ALTER TABLE wallets ADD COLUMN cash REAL' },
        { name: 'position_value', sql: 'ALTER TABLE wallets ADD COLUMN position_value REAL' },
        { name: 'volume', sql: 'ALTER TABLE wallets ADD COLUMN volume REAL' },
        { name: 'last_trade_time', sql: 'ALTER TABLE wallets ADD COLUMN last_trade_time INTEGER' },
        { name: 'last_queried_at', sql: "ALTER TABLE wallets ADD COLUMN last_queried_at TEXT" },
    ];
    for (const col of newWalletCols) {
        if (!walletCols.some(c => c.name === col.name)) {
            db.exec(col.sql);
        }
    }
}

export function closeDb(): void {
    if (db) {
        db.close();
        db = null;
    }
}

// ============================================================
// Wallet DAO
// ============================================================

interface WalletRow {
    id: number;
    label: string;
    address: string;
    proxy_address: string;
    encrypted_credentials: string;
    salt: string;
    iv: string;
    auth_tag: string;
    is_active: number;
    created_at: string;
    updated_at: string;
    cash: number | null;
    position_value: number | null;
    volume: number | null;
    last_trade_time: number | null;
    last_queried_at: string | null;
}

function rowToWalletRecord(row: WalletRow): WalletRecord {
    return {
        id: row.id,
        label: row.label,
        address: row.address,
        proxyAddress: row.proxy_address,
        isActive: row.is_active === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        cash: row.cash ?? undefined,
        positionValue: row.position_value ?? undefined,
        volume: row.volume ?? undefined,
        lastTradeTime: row.last_trade_time ?? undefined,
        lastQueriedAt: row.last_queried_at ?? undefined,
    };
}

export function insertWallet(
    label: string,
    address: string,
    proxyAddress: string,
    encrypted: EncryptedData,
): WalletRecord {
    const d = getDb();
    const stmt = d.prepare(`
        INSERT INTO wallets (label, address, proxy_address, encrypted_credentials, salt, iv, auth_tag)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
        label,
        address,
        proxyAddress,
        encrypted.ciphertext,
        encrypted.salt,
        encrypted.iv,
        encrypted.authTag,
    );
    return getWalletById(info.lastInsertRowid as number)!;
}

export function getWalletById(id: number): WalletRecord | null {
    const d = getDb();
    const row = d.prepare('SELECT * FROM wallets WHERE id = ?').get(id) as WalletRow | undefined;
    return row ? rowToWalletRecord(row) : null;
}

export function listWallets(): WalletRecord[] {
    const d = getDb();
    const rows = d.prepare('SELECT * FROM wallets ORDER BY id').all() as WalletRow[];
    return rows.map(rowToWalletRecord);
}

export function getWalletEncrypted(id: number): EncryptedData | null {
    const d = getDb();
    const row = d.prepare(
        'SELECT encrypted_credentials, salt, iv, auth_tag FROM wallets WHERE id = ?'
    ).get(id) as { encrypted_credentials: string; salt: string; iv: string; auth_tag: string } | undefined;
    if (!row) return null;
    return {
        ciphertext: row.encrypted_credentials,
        salt: row.salt,
        iv: row.iv,
        authTag: row.auth_tag,
    };
}

export function getAllWalletsEncrypted(): Array<{ id: number; encrypted: EncryptedData }> {
    const d = getDb();
    const rows = d.prepare(
        'SELECT id, encrypted_credentials, salt, iv, auth_tag FROM wallets'
    ).all() as Array<{ id: number; encrypted_credentials: string; salt: string; iv: string; auth_tag: string }>;
    return rows.map(row => ({
        id: row.id,
        encrypted: {
            ciphertext: row.encrypted_credentials,
            salt: row.salt,
            iv: row.iv,
            authTag: row.auth_tag,
        },
    }));
}

export function updateWalletLabel(id: number, label: string): void {
    const d = getDb();
    d.prepare("UPDATE wallets SET label = ?, updated_at = datetime('now') WHERE id = ?").run(label, id);
}

export function deleteWallet(id: number): void {
    const d = getDb();
    // 级联删除：先删关联的对冲记录和配对
    const pairingIds = d.prepare(
        'SELECT id FROM pairings WHERE master_wallet_id = ? OR hedge_wallet_id = ?'
    ).all(id, id) as Array<{ id: number }>;
    if (pairingIds.length > 0) {
        const ids = pairingIds.map(r => r.id);
        d.prepare(`DELETE FROM hedge_executions WHERE pairing_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
        d.prepare(`DELETE FROM pairings WHERE master_wallet_id = ? OR hedge_wallet_id = ?`).run(id, id);
    }
    d.prepare('DELETE FROM wallets WHERE id = ?').run(id);
}

export function updateWalletQueryData(id: number, data: {
    cash?: number | null;
    positionValue?: number | null;
    volume?: number | null;
    lastTradeTime?: number | null;
}): void {
    const d = getDb();
    d.prepare(`
        UPDATE wallets SET
            cash = ?, position_value = ?, volume = ?, last_trade_time = ?,
            last_queried_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
    `).run(
        data.cash ?? null,
        data.positionValue ?? null,
        data.volume ?? null,
        data.lastTradeTime ?? null,
        id,
    );
}

// ============================================================
// Pairing DAO
// ============================================================

export function insertPairing(name: string, masterWalletId: number, hedgeWalletId: number): Pairing {
    const d = getDb();
    const stmt = d.prepare(`
        INSERT INTO pairings (name, master_wallet_id, hedge_wallet_id) VALUES (?, ?, ?)
    `);
    const info = stmt.run(name, masterWalletId, hedgeWalletId);
    return getPairingById(info.lastInsertRowid as number)!;
}

export function getPairingById(id: number): Pairing | null {
    const d = getDb();
    const row = d.prepare('SELECT * FROM pairings WHERE id = ?').get(id) as {
        id: number; name: string; master_wallet_id: number; hedge_wallet_id: number | null;
        is_active: number; created_at: string; updated_at: string;
    } | undefined;
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        masterWalletId: row.master_wallet_id,
        hedgeWalletId: row.hedge_wallet_id ?? null,
        isActive: row.is_active === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export function getPairingWithWallets(id: number): PairingWithWallets | null {
    const pairing = getPairingById(id);
    if (!pairing) return null;

    const master = getWalletById(pairing.masterWalletId);
    if (!master) return null;

    const hedge = pairing.hedgeWalletId ? getWalletById(pairing.hedgeWalletId) : null;

    return {
        ...pairing,
        masterWallet: master,
        hedgeWallet: hedge,
    };
}

export function listPairings(): Pairing[] {
    const d = getDb();
    const rows = d.prepare('SELECT * FROM pairings ORDER BY id').all() as Array<{
        id: number; name: string; master_wallet_id: number; hedge_wallet_id: number | null;
        is_active: number; created_at: string; updated_at: string;
    }>;
    return rows.map(row => ({
        id: row.id,
        name: row.name,
        masterWalletId: row.master_wallet_id,
        hedgeWalletId: row.hedge_wallet_id ?? null,
        isActive: row.is_active === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
}

export function listPairingsWithWallets(): PairingWithWallets[] {
    const pairings = listPairings();
    return pairings
        .map(p => getPairingWithWallets(p.id))
        .filter((p): p is PairingWithWallets => p !== null);
}

export function listActivePairings(): Pairing[] {
    return listPairings().filter((pairing) => pairing.isActive);
}

export function listActivePairingsWithWallets(): PairingWithWallets[] {
    return listPairingsWithWallets().filter((pairing) => pairing.isActive);
}

export function updatePairing(
    id: number,
    updates: { name?: string; masterWalletId?: number; hedgeWalletId?: number },
): void {
    const d = getDb();
    if (updates.name !== undefined) {
        d.prepare("UPDATE pairings SET name = ?, updated_at = datetime('now') WHERE id = ?")
            .run(updates.name, id);
    }
    if (updates.masterWalletId !== undefined) {
        d.prepare("UPDATE pairings SET master_wallet_id = ?, updated_at = datetime('now') WHERE id = ?")
            .run(updates.masterWalletId, id);
    }
    if (updates.hedgeWalletId !== undefined) {
        d.prepare("UPDATE pairings SET hedge_wallet_id = ?, updated_at = datetime('now') WHERE id = ?")
            .run(updates.hedgeWalletId, id);
    }
}

export function getUsedWalletIds(): Set<number> {
    const d = getDb();
    const rows = d.prepare(`
        SELECT master_wallet_id, hedge_wallet_id FROM pairings
    `).all() as Array<{ master_wallet_id: number; hedge_wallet_id: number | null }>;
    const ids = new Set<number>();
    for (const row of rows) {
        ids.add(row.master_wallet_id);
        if (row.hedge_wallet_id) ids.add(row.hedge_wallet_id);
    }
    return ids;
}

export function deletePairing(id: number): void {
    const d = getDb();
    d.prepare('DELETE FROM pairings WHERE id = ?').run(id);
}

export function activatePairing(id: number): void {
    const d = getDb();
    const txn = d.transaction(() => {
        // 互斥: 关闭所有其他
        d.prepare("UPDATE pairings SET is_active = 0, updated_at = datetime('now')").run();
        d.prepare("UPDATE pairings SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(id);
    });
    txn();
}

export function deactivatePairing(id: number): void {
    const d = getDb();
    d.prepare("UPDATE pairings SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
}

export function activatePairingNonExclusive(id: number): void {
    const d = getDb();
    d.prepare("UPDATE pairings SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(id);
}

export function getActivePairing(): PairingWithWallets | null {
    const d = getDb();
    const row = d.prepare('SELECT id FROM pairings WHERE is_active = 1 LIMIT 1').get() as { id: number } | undefined;
    if (!row) return null;
    return getPairingWithWallets(row.id);
}

// ============================================================
// Hedge Execution DAO
// ============================================================

export function insertHedgeExecution(params: {
    pairingId: number;
    taskId?: string;
    predictOrderHash?: string;
    predictFillQty: number;
    predictFillPrice: number;
    distribution: HedgeDistribution[];
}): number {
    const d = getDb();
    const stmt = d.prepare(`
        INSERT INTO hedge_executions (pairing_id, task_id, predict_order_hash, predict_fill_qty, predict_fill_price, distribution)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
        params.pairingId,
        params.taskId ?? null,
        params.predictOrderHash ?? null,
        params.predictFillQty,
        params.predictFillPrice,
        JSON.stringify(params.distribution),
    );
    return info.lastInsertRowid as number;
}

export function updateHedgeExecution(
    id: number,
    status: string,
    distribution: HedgeDistribution[],
): void {
    const d = getDb();
    d.prepare(`
        UPDATE hedge_executions
        SET status = ?, distribution = ?, completed_at = datetime('now')
        WHERE id = ?
    `).run(status, JSON.stringify(distribution), id);
}

export function listHedgeExecutions(limit = 50): HedgeExecution[] {
    const d = getDb();
    const rows = d.prepare(
        'SELECT * FROM hedge_executions ORDER BY id DESC LIMIT ?'
    ).all(limit) as Array<{
        id: number; pairing_id: number; task_id: string | null;
        predict_order_hash: string | null; predict_fill_qty: number;
        predict_fill_price: number; distribution: string;
        status: string; created_at: string; completed_at: string | null;
    }>;
    return rows.map(row => ({
        id: row.id,
        pairingId: row.pairing_id,
        taskId: row.task_id ?? undefined,
        predictOrderHash: row.predict_order_hash ?? undefined,
        predictFillQty: row.predict_fill_qty,
        predictFillPrice: row.predict_fill_price,
        distribution: JSON.parse(row.distribution) as HedgeDistribution[],
        status: row.status as HedgeExecution['status'],
        createdAt: row.created_at,
        completedAt: row.completed_at ?? undefined,
    }));
}
