"""Native integration guards. Required on legacy routes AND socket delivery.

Do not mount company messaging until these have been installed at all native
channel/message/file mutation and read entry points. No global-admin bypass.
"""
from .authority import require


def company_for_channel(db,channel_id):
    row=db.execute('SELECT company FROM cm_rooms WHERE id=?',(channel_id,)).fetchone()
    return row[0] if row else None


def guard_legacy_channel(store,session,channel_id):
    with store.db() as db:
        company=company_for_channel(db,channel_id)
    if company is not None:
        # Company rows are available only through the typed messaging router.
        # Native generic editors cannot mutate ownership/ACL/data or bypass
        # per-sender revisions, invitations and audience-scoped delivery.
        require(False,404,'USE_COMPANY_MESSAGING')
    return True


def guard_legacy_message(store,session,message_id):
    with store.db() as db:
        row=db.execute('SELECT channel_id FROM message WHERE id=?',(message_id,)).fetchone()
    if row and row[0]:return guard_legacy_channel(store,session,row[0])
    return True


def filter_legacy_channels(store,rows):
    with store.db() as db:
        company_ids={r[0] for r in db.execute('SELECT id FROM cm_rooms')}
    return [row for row in rows if (row.get('id') if isinstance(row,dict) else row.id) not in company_ids]


def mount(app,store,native_session,*,legacy_guards_installed=False,atomic_authority=False):
    # Integration assertions are deliberately explicit and default false. A
    # candidate app/fixture may use make_router directly; production may not.
    require(legacy_guards_installed and atomic_authority,503,'COMPANY_INTEGRATION_GATES_REQUIRED')
    from .http import make_router
    app.include_router(make_router(store,native_session))
