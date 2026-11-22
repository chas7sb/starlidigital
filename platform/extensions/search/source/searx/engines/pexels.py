# SPDX-License-Identifier: AGPL-3.0-or-later
"""Pexels (images)"""

import typing as t

from urllib.parse import urlencode

from searx.result_types import EngineResults
from searx.exceptions import SearxEngineAccessDeniedException

if t.TYPE_CHECKING:
    from extended_types import SXNG_Response
    from search.processors.online import OnlineParams

about = {
    "website": "https://www.pexels.com",
    "wikidata_id": "Q101240504",
    "official_api_documentation": "https://www.pexels.com/api/",
    "use_official_api": False,
    "require_api_key": True,
    "results": "JSON",
}

base_url = "https://www.pexels.com"
categories = ["stock images"]

api_key = ""
"""
User-provided API key. This distribution never supplies or extracts a shared key.
"""
results_per_page = 20

paging = True
time_range_support = True
time_range_map = {"day": "last_24_hours", "week": "last_week", "month": "last_month", "year": "last_year"}

def setup(engine_settings: dict[str, t.Any]) -> bool:
    # Remain disabled unless the operator explicitly supplies their own key.
    return bool(api_key and api_key.strip())


def request(query: str, params: "OnlineParams"):
    args = {
        "query": query,
        "page": params["pageno"],
        "per_page": results_per_page,
    }
    if params["time_range"]:
        args["date_from"] = time_range_map[params["time_range"]]

    params["url"] = f"{base_url}/en-us/api/v3/search/photos?{urlencode(args)}"

    if not api_key or not api_key.strip():
        raise SearxEngineAccessDeniedException("Pexels requires a user-provided API key")
    params["headers"]["secret-key"] = api_key


def response(resp: "SXNG_Response") -> EngineResults:
    res = EngineResults()
    json_data = resp.json()

    for result in json_data.get("data", []):
        attrs = result["attributes"]
        res.add(
            res.types.Image(
                url=f"{base_url}/photo/{attrs['slug']}-{attrs['id']}/",
                title=attrs["title"],
                content=attrs["description"],
                thumbnail_src=attrs["image"]["small"],
                img_src=attrs["image"]["download_link"],
                resolution=f"{attrs['width']}x{attrs['height']}",
                author=f"{attrs['user']['username']}",
            )
        )

    return res
