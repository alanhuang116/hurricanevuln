"""Building-unit taxonomy shared by the fragility and loss models.

NSI (USACE National Structure Inventory) describes each structure; FEMA IHP
describes each registered household's dwelling. Both map onto the classes
below. 'unknown' collects missing and unmapped codes.
"""
from __future__ import annotations

import numpy as np

UNKNOWN = "unknown"

# NSI construction type
CONSTRUCTION = {"W": "wood", "M": "masonry", "C": "concrete", "S": "steel", "H": "manufactured"}
# NSI occupancy class prefix
def occupancy(occtype):
    if not isinstance(occtype, str):
        return UNKNOWN
    o = occtype.split("-")[0]
    if o == "RES1":
        return "single_family"
    if o == "RES2":
        return "manufactured"
    if o in ("RES3A", "RES3B", "RES3C", "RES3D", "RES3E", "RES3F", "RES3"):
        return "multi_family"
    if o.startswith("RES"):
        return "other_residential"
    if o.startswith("COM"):
        return "commercial"
    if o.startswith("IND"):
        return "industrial"
    return "public"           # AGR, REL, GOV, EDU


FOUNDATION = {"S": "slab", "C": "crawl", "B": "basement", "P": "pier", "I": "pile", "F": "fill",
              "W": "solid_wall"}


def storeys(n):
    try:
        n = float(n)
    except (TypeError, ValueError):
        return UNKNOWN
    if not np.isfinite(n) or n <= 0:
        return UNKNOWN
    return "1" if n < 1.5 else "2" if n < 2.5 else "3plus"


def design_era(year):
    """Wind design era from year built. 1994: post-Andrew South Florida code
    and HUD wind zones for manufactured homes; 2002: Florida Building Code
    statewide. NSI's year is the census-block median, so this is an area
    signal, not the building's own year."""
    try:
        y = int(year)
    except (TypeError, ValueError):
        return UNKNOWN
    if y < 1800:
        return UNKNOWN
    if y < 1970:
        return "pre1970"
    if y < 1994:
        return "1970_1993"
    if y < 2002:
        return "1994_2001"
    return "2002plus"


def parcel_era(year):
    """Design era from the property appraiser's actual year built."""
    try:
        y = int(year)
    except (TypeError, ValueError):
        return UNKNOWN
    if y < 1800:
        return UNKNOWN
    if y < 1970:
        return "pre1970"
    if y < 1994:
        return "1970_1993"
    if y < 2002:
        return "1994_2001"
    if y < 2010:
        return "2002_2009"
    return "2010_2018"


def parcel_use(dor_uc):
    """Florida DOR land-use code to a use class."""
    try:
        c = int(str(dor_uc).strip()[-3:] if str(dor_uc).strip() else -1)
    except ValueError:
        return UNKNOWN
    if c == 1:
        return "single_family"
    if c == 2:
        return "mobile_home"
    if c == 4:
        return "condo"
    if c in (3, 8):
        return "multi_family"
    if 10 <= c <= 39:
        return "commercial"
    if 40 <= c <= 49:
        return "industrial"
    if 70 <= c <= 89:
        return "institutional"
    return "other"


def parcel_quality(q):
    q = str(q).strip()
    return {"1": "low", "2": "low", "3": "average", "4": "high", "5": "high", "6": "high"}.get(q, UNKNOWN)


# FDOR construction class
PARCEL_CONSTRUCTION = {1: "steel", 2: "concrete", 3: "masonry", 4: "wood", 5: "steel"}


# FEMA IHP residence type codes (OpenFEMA data dictionary)
RESIDENCE = {"H": "house_duplex", "M": "mobile_home", "T": "townhouse", "C": "condo",
             "A": "apartment", "B": "boat", "O": "other", "TT": "travel_trailer",
             "MH": "mobile_home", "CD": "condo", "AP": "apartment", "TH": "townhouse",
             "HD": "house_duplex"}

DAMAGE_STATE = {"NOD": 0, "AFF": 1, "MIN": 1, "MAJ": 2, "DES": 2}

LEVEL_NAMES = {
    "construction": {"wood": "Wood frame", "masonry": "Masonry", "concrete": "Reinforced concrete",
                     "steel": "Steel", "manufactured": "Manufactured home"},
    "occupancy": {"single_family": "Single-family", "manufactured": "Manufactured housing",
                  "multi_family": "Multi-family", "other_residential": "Other residential",
                  "commercial": "Commercial", "industrial": "Industrial", "public": "Public / institutional"},
    "storeys": {"1": "One storey", "2": "Two storeys", "3plus": "Three or more"},
    "foundation": {"slab": "Slab on grade", "crawl": "Crawlspace", "basement": "Basement", "pier": "Piers",
                   "pile": "Piles", "fill": "Fill", "solid_wall": "Solid wall"},
    "era": {"pre1970": "Before 1970", "1970_1993": "1970–1993", "1994_2001": "1994–2001",
            "2002plus": "2002 or later (FBC)", "2002_2009": "2002–2009 (FBC)",
            "2010_2018": "2010–2018 (FBC 2010)"},
    "use": {"single_family": "Single-family", "mobile_home": "Mobile home", "condo": "Condominium",
            "multi_family": "Multi-family", "commercial": "Commercial", "industrial": "Industrial",
            "institutional": "Institutional / government", "other": "Other"},
    "quality": {"low": "Below average", "average": "Average", "high": "Above average"},
    "residence": {"house_duplex": "House / duplex", "mobile_home": "Mobile home", "townhouse": "Townhouse",
                  "condo": "Condominium", "apartment": "Apartment", "boat": "Boat", "other": "Other",
                  "travel_trailer": "Travel trailer"},
}
