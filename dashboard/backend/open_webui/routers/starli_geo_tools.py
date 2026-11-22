"""Native chat schemas for local, permission-bound geo calculations."""
REF={"type":"string","minLength":1,"maxLength":150}
PLACE={"type":"object","properties":{"id":REF,"label":{"type":"string","minLength":1,"maxLength":200},"context":{"enum":["PUBLIC_PLACE"]},"latitude":{"type":"number","minimum":-90,"maximum":90},"longitude":{"type":"number","minimum":-180,"maximum":180}},"required":["id","label","context","latitude","longitude"],"additionalProperties":False}
PLACES={"type":"array","items":PLACE,"minItems":1,"maxItems":50}
MODE={"enum":["WALK","CYCLE","DRIVE"]}
def schema(name,description,properties=None,required=None):
 return {"name":name,"displayName":name.removeprefix("geo_").replace("_"," ").title(),"category":"Starli Geo","description":description+" Requires your fresh, explicitly AI-shared location reference. Does not start tracking or grant permission.","inputSchema":{"type":"object","properties":{"locationReference":REF,**(properties or {})},"required":["locationReference",*(required or [])],"additionalProperties":False}}
GEO_TOOL_SCHEMAS=[
 schema("geo_location_quality","Check location freshness, accuracy and precision without returning coordinates."),
 schema("geo_distance_to_place","Estimate straight-line distance to a supplied public place. No place lookup or verified route.",{"place":PLACE},["place"]),
 schema("geo_direction_to_place","Estimate compass direction to a supplied public place. Not turn-by-turn navigation.",{"place":PLACE},["place"]),
 schema("geo_nearest_places","Rank supplied public places by straight-line proximity. Does not search a places provider.",{"places":PLACES,"limit":{"type":"integer","minimum":1,"maximum":20}},["places"]),
 schema("geo_check_area","One-time rectangle check with uncertainty. Supports antimeridian bounds; not a background geofence alert.",{"bounds":{"type":"object","properties":{k:{"type":"number","minimum":-90 if k in ("south","north") else -180,"maximum":90 if k in ("south","north") else 180} for k in ("south","west","north","east")},"required":["south","west","north","east"],"additionalProperties":False}},["bounds"]),
 schema("geo_check_radius","One-time distance-radius check around a supplied public place. Reports uncertainty; no ongoing monitoring.",{"place":PLACE,"radiusMeters":{"type":"number","minimum":100,"maximum":500000}},["place","radiusMeters"]),
 schema("geo_travel_estimate","Rough straight-line planning time at a fixed stated speed. No roads, traffic, verified routing or accessibility claim.",{"place":PLACE,"mode":MODE},["place","mode"]),
 schema("geo_reachability","Filter supplied public places by a rough straight-line time budget and stated speed. Not verified reachability.",{"places":PLACES,"mode":MODE,"minutes":{"type":"number","minimum":1,"maximum":240}},["places","mode","minutes"])
]
