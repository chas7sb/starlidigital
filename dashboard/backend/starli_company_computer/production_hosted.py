"""Build an enrollment-specific hosted runner without changing process-wide environment."""
import hashlib
from pathlib import Path
import re
from uuid import UUID

from company_bot_runtime import NodeRunner


PROFILE_SHA = "22f0e365a11f9e557fbb06ff1629d710ded0da8e8e7bd7595dcf7a3e23933054"


def hosted_runner(*, enrolled_company, endpoint, sdk, node, worker, profile, key=None):
    if str(UUID(enrolled_company)) != enrolled_company:
        raise ValueError("Invalid registered company")
    validated_base = endpoint.strip().rstrip("/")
    if not re.fullmatch(r"https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com(?:/v1)?", validated_base):
        raise ValueError("Invalid company Hosted endpoint")
    if not validated_base.endswith("/v1"):
        validated_base += "/v1"
    installed_sdk = Path(sdk).resolve(strict=True)
    for package in ("pi-ai", "pi-coding-agent"):
        if not (installed_sdk / package / "package.json").is_file():
            raise RuntimeError("The company Pi SDK installation is unavailable")
    profile = Path(profile).resolve(strict=True)
    if hashlib.sha256(profile.read_bytes()).hexdigest() != PROFILE_SHA:
        raise RuntimeError("Unrecognized Hosted provider profile")
    env = {"STARLI_COMPANY_HOSTED_BASE": validated_base, "STARLI_COMPANY_ENROLLMENT_ID": enrolled_company,
           "STARLI_COMPANY_PI_SDK": str(installed_sdk)}
    if key:
        env["STARLI_COMPANY_HOSTED_API_KEY"] = key
    return NodeRunner(str(node), str(worker), str(profile), PROFILE_SHA, timeout_seconds=21605,
                      child_environment=env)
