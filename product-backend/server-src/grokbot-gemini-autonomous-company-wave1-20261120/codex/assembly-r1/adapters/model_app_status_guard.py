"""Read-only current runtime availability projection, outside frozen model artifact."""
from pathlib import Path
def start(pid):
    try:return Path("/proc/"+str(pid)+"/stat").read_text().split(") ",1)[1].split()[19]
    except FileNotFoundError:return None
def install_model_status_guard(authority,builds,lifecycle):
    previous=authority.read_build_status
    def current(snapshot):
        value=previous(snapshot)
        if not value or value.get("status")!="READY":return value
        instance=lifecycle.apps.get(value["buildId"])
        live=bool(instance and instance["proc"].returncode is None and start(instance["proc"].pid)==instance["startTicks"] and instance["ready"]["buildId"]==value["buildId"] and instance["ready"]["artifactDigest"]==value["artifactDigest"])
        if live:return value
        return {k:v for k,v in value.items() if k!="preview"}|{"status":"INTERRUPTED","runtimeState":"UNAVAILABLE","artifactState":"SUCCEEDED","errorCode":"APP_PROCESS_RESTART_REVIEW_REQUIRED"}
    authority.read_build_status=current
