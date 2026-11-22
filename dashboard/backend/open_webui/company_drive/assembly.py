"""Same canonical authority database; uploads disabled until root explicitly enables."""
from open_webui.company_authority import Authority
from .quota import QuotaDrive, SafeBlobs, UploadPolicy
from .native_mount import create_router
from .native_channels import NativeChannels, ChannelDrive

def build_native_router(verified_user, db_path, blob_dir, draft_policy=None, bot_policy=None, upload_policy=None, storage=None, native_database=None):
    blobs=storage or SafeBlobs(blob_dir)
    policy=upload_policy if upload_policy is not None else UploadPolicy.from_env()
    channels=NativeChannels(native_database) if native_database is not None else None
    def factory():
        authority=Authority(str(db_path))
        authority.db.close()
        return ChannelDrive(str(db_path),Authority,blobs,policy,channels)
    return create_router(factory,verified_user,draft_policy or (lambda *a:False),bot_policy or (lambda *a:False))
