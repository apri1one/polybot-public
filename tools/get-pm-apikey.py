#!/usr/bin/env python3
"""
Polymarket 环境配置脚本

交互式输入私钥 → 自动派生钱包地址、API 凭证、代理地址 → 写入本地 .env

用法:
  python tools/get-pm-apikey.py                          # 交互式输入私钥
  python tools/get-pm-apikey.py <private_key>            # 命令行传入私钥
  python tools/get-pm-apikey.py --dry-run <private_key>  # 仅展示结果，不写入
  echo "0xKEY" | python tools/get-pm-apikey.py --json --stdin  # JSON 输出 + stdin 输入
"""

import sys
import re
import json
import argparse
from pathlib import Path

# ============ 依赖检查 ============
try:
    from eth_account import Account
    from eth_utils import to_checksum_address
except ImportError:
    print("ERROR: 缺少依赖 eth_account / eth_utils")
    print("  pip install eth-account eth-utils")
    sys.exit(1)

try:
    from py_clob_client.client import ClobClient
except ImportError:
    print("ERROR: 缺少依赖 py_clob_client")
    print("  pip install py-clob-client")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("ERROR: 缺少依赖 requests")
    print("  pip install requests")
    sys.exit(1)

# ============ 常量 ============
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
ENV_FILE = PROJECT_ROOT / ".env"

POLYMARKET_CLOB_HOST = "https://clob.polymarket.com"
POLYGON_CHAIN_ID = 137

SAFE_API_BASE = "https://safe-transaction-polygon.safe.global/api/v1"


def derive_address(private_key: str) -> str:
    """从私钥派生 EOA 地址"""
    if not private_key.startswith("0x"):
        private_key = "0x" + private_key
    account = Account.from_key(private_key)
    return account.address


def derive_api_creds(private_key: str, address: str) -> dict:
    """通过 CLOB API 派生 API 凭证"""
    client = ClobClient(
        host=POLYMARKET_CLOB_HOST,
        chain_id=POLYGON_CHAIN_ID,
        key=private_key,
        signature_type=0,  # EOA
        funder=address,
    )
    creds = client.create_or_derive_api_creds()
    if creds is None:
        raise RuntimeError("CLOB API 凭证派生失败")

    # 验证
    client.set_api_creds(creds)
    keys = client.get_api_keys()
    if not keys or not keys.get("apiKeys"):
        raise RuntimeError("API 凭证验证失败: get_api_keys 返回空")

    return {
        "api_key": creds.api_key,
        "api_secret": creds.api_secret,
        "api_passphrase": creds.api_passphrase,
    }


def derive_proxy_address(address: str, auto_select: bool = False) -> str:
    """通过 Gnosis Safe Transaction Service 查询代理钱包地址"""
    checksummed = to_checksum_address(address)
    url = f"{SAFE_API_BASE}/owners/{checksummed}/safes/"
    r = requests.get(url, headers={"Accept": "application/json"}, timeout=15)
    r.raise_for_status()
    data = r.json()
    safes = data.get("safes", [])
    if not safes:
        raise RuntimeError(
            f"Safe API 未找到 {checksummed} 的代理钱包。\n"
            "可能原因: 该地址尚未在 Polymarket 注册。\n"
            "请先在 Polymarket 网站完成账户激活。"
        )
    if len(safes) == 1:
        return safes[0]
    # JSON/自动模式: 选第一个，避免交互式 input() 阻塞
    if auto_select:
        return safes[0]
    # 多个 Safe 钱包，提示用户选择
    print(f"\n发现 {len(safes)} 个 Safe 钱包:")
    for i, s in enumerate(safes):
        print(f"  [{i}] {s}")
    while True:
        choice = input(f"请选择 Polymarket 代理钱包 (0-{len(safes)-1}): ").strip()
        if choice.isdigit() and 0 <= int(choice) < len(safes):
            return safes[int(choice)]
        print("无效选择，请重试")


def update_env_file(env_path: Path, updates: dict) -> None:
    """更新 .env 文件中的指定 key，保留其余内容和注释"""
    if not env_path.exists():
        raise FileNotFoundError(f".env 文件不存在: {env_path}")

    lines = env_path.read_text(encoding="utf-8").splitlines()
    updated_keys = set()
    new_lines = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            new_lines.append(line)
            continue

        match = re.match(r'^([A-Za-z_][A-Za-z0-9_]*)=', stripped)
        if match:
            key = match.group(1)
            if key in updates:
                new_lines.append(f"{key}={updates[key]}")
                updated_keys.add(key)
                continue

        new_lines.append(line)

    # .env 中不存在的 key 追加到末尾
    missing = set(updates.keys()) - updated_keys
    if missing:
        new_lines.append("")
        new_lines.append("# === Polymarket (auto-generated) ===")
        for key in sorted(missing):
            new_lines.append(f"{key}={updates[key]}")

    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Polymarket 环境配置 (本地 .env)")
    parser.add_argument("private_key", nargs="?", help="交易私钥 (hex)")
    parser.add_argument("--dry-run", action="store_true", help="仅展示结果，不写入文件")
    parser.add_argument("--json", action="store_true", dest="json_mode", help="JSON 输出到 stdout (供程序调用)")
    parser.add_argument("--stdin", action="store_true", help="从 stdin 读取私钥 (安全模式，避免命令行泄露)")
    args = parser.parse_args()

    # JSON 模式: 静默运行，结果输出 JSON 到 stdout
    if args.json_mode:
        try:
            private_key = sys.stdin.readline().strip() if args.stdin else args.private_key
            if not private_key:
                json.dump({"error": "私钥不能为空"}, sys.stdout)
                sys.exit(1)
            if not private_key.startswith("0x"):
                private_key = "0x" + private_key
            address = derive_address(private_key)
            creds = derive_api_creds(private_key, address)
            proxy_address = derive_proxy_address(address, auto_select=True)
            json.dump({
                "address": address,
                "proxyAddress": proxy_address,
                "apiKey": creds["api_key"],
                "apiSecret": creds["api_secret"],
                "passphrase": creds["api_passphrase"],
            }, sys.stdout)
        except Exception as e:
            json.dump({"error": str(e)}, sys.stdout)
            sys.exit(1)
        return

    # 获取私钥
    private_key = args.private_key
    if args.stdin:
        private_key = sys.stdin.readline().strip()
    if not private_key:
        private_key = input("请输入 Polymarket 交易私钥 (hex): ").strip()
    if not private_key:
        print("ERROR: 私钥不能为空")
        sys.exit(1)

    if not private_key.startswith("0x"):
        private_key = "0x" + private_key

    # ---- Step 1: 派生钱包地址 ----
    print("\n[1/3] 派生钱包地址...")
    address = derive_address(private_key)
    print(f"  地址: {address}")

    # ---- Step 2: 派生 API 凭证 ----
    print("\n[2/3] 派生 API 凭证...")
    creds = derive_api_creds(private_key, address)
    print(f"  API Key:    {creds['api_key']}")
    print(f"  Secret:     {creds['api_secret'][:16]}...")
    print(f"  Passphrase: {creds['api_passphrase'][:16]}...")

    # ---- Step 3: 获取代理钱包地址 ----
    print("\n[3/3] 查询代理钱包地址...")
    proxy_address = derive_proxy_address(address)
    print(f"  代理地址: {proxy_address}")

    # ---- 汇总 ----
    updates = {
        "POLYMARKET_TRADER_ADDRESS": address,
        "POLYMARKET_TRADER_PRIVATE_KEY": private_key,
        "POLYMARKET_PROXY_ADDRESS": proxy_address,
        "POLYMARKET_API_KEY": creds["api_key"],
        "POLYMARKET_API_SECRET": creds["api_secret"],
        "POLYMARKET_PASSPHRASE": creds["api_passphrase"],
    }

    print("\n" + "=" * 55)
    print("  配置汇总")
    print("=" * 55)
    for k, v in updates.items():
        display = v if len(v) <= 50 else v[:20] + "..." + v[-10:]
        print(f"  {k} = {display}")
    print("=" * 55)

    if args.dry_run:
        print("\n[dry-run] 仅展示，未写入任何文件")
        return

    # ---- 确认写入 ----
    confirm = input(f"\n确认写入 {ENV_FILE}? (y/N): ").strip().lower()
    if confirm not in ("y", "yes"):
        print("已取消")
        return

    update_env_file(ENV_FILE, updates)
    print(f"\n本地 .env 已更新: {ENV_FILE}")
    print("完成!")


if __name__ == "__main__":
    main()
