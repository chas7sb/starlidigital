"""Read-only credit preview. Owner is the authenticated binding, never a caller field."""
from fastapi import APIRouter, Depends

from open_webui.routers.starli_platform import connection, customer_principal as principal
from open_webui.utils.auth import get_verified_user

router = APIRouter()

LIMITATIONS = [
    "Credit units are not provider billing.",
    "Top-up/payment flows are not connected to this preview.",
]


@router.get("")
def billing(user=Depends(get_verified_user)):
    uid, binding = principal(user)
    owner = binding["v2UserId"]
    del uid
    with connection() as db:
        wallet_row = db.execute(
            "SELECT available, reserved, debt, total_granted, total_spent, updated_at "
            "FROM credit_wallets WHERE owner_id=?",
            (owner,),
        ).fetchone()
        ledger_rows = db.execute(
            "SELECT id, kind, amount, available_delta, reserved_delta, debt_delta, reason, created_at "
            "FROM credit_ledger WHERE owner_id=? ORDER BY created_at DESC LIMIT 50",
            (owner,),
        ).fetchall()
        reservation_rows = db.execute(
            "SELECT amount, action, status, created_at "
            "FROM credit_reservations WHERE owner_id=? ORDER BY created_at DESC LIMIT 30",
            (owner,),
        ).fetchall()
    wallet = None
    if wallet_row:
        wallet = {
            "available": wallet_row[0],
            "reserved": wallet_row[1],
            "debt": wallet_row[2],
            "totalGranted": wallet_row[3],
            "totalSpent": wallet_row[4],
            "updatedAt": wallet_row[5],
        }
    return {
        "available": wallet is not None,
        "wallet": wallet,
        "ledger": [
            {
                "id": row[0],
                "kind": row[1],
                "amount": row[2],
                "availableDelta": row[3],
                "reservedDelta": row[4],
                "debtDelta": row[5],
                "reason": row[6],
                "createdAt": row[7],
            }
            for row in ledger_rows
        ],
        "reservations": [
            {"amount": row[0], "action": row[1], "status": row[2], "createdAt": row[3]}
            for row in reservation_rows
        ],
        "unit": "credits",
        "paymentsEnabled": False,
        "limitations": LIMITATIONS,
    }
