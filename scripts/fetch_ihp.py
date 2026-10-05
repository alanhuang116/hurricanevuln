"""Download FEMA Individuals and Households Program registrations for the
hurricanes in STORMS, owner-occupied and inspected only.

Source: OpenFEMA IndividualsAndHouseholdsProgramValidRegistrations v2.
Each record is one household's registration, located to a Census block group,
with FEMA-verified real property loss from the inspection. Rows are taken in
id order (ids are random UUIDs), so a capped pull is a random sample.

    python scripts/fetch_ihp.py
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request

import pandas as pd

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "raw", "ihp_owners.csv")
CACHE = os.path.join(ROOT, "data", "raw", "ihp")
API = "https://www.fema.gov/api/open/v2/IndividualsAndHouseholdsProgramValidRegistrations"
CAP = int(os.environ.get("HV_IHP_CAP", 60000))   # per disaster number

STORMS = {
    "Matthew 2016": [4283, 4286], "Harvey 2017": [4332], "Irma 2017": [4337, 4338],
    "Maria 2017": [4339], "Florence 2018": [4393, 4394], "Michael 2018": [4399, 4400],
    "Laura 2020": [4559], "Sally 2020": [4563, 4564], "Delta 2020": [4570],
    "Zeta 2020": [4573, 4576, 4577], "Ida 2021": [4611, 4626], "Fiona 2022": [4671],
    "Ian 2022": [4673, 4677], "Nicole 2022": [4680], "Idalia 2023": [4734, 4738],
    "Beryl 2024": [4798], "Francine 2024": [4817], "Helene 2024": [4828, 4829, 4830],
    "Milton 2024": [4834],
}
FIELDS = ["id", "disasterNumber", "censusGeoid", "censusYear", "damagedStateAbbreviation",
          "residenceType", "primaryResidence", "homeOwnersInsurance", "floodInsurance",
          "habitabilityRepairsRequired", "rpfvl", "destroyed", "waterLevel", "floodDamage",
          "floodDamageAmount", "foundationDamage", "foundationDamageAmount", "roofDamage",
          "roofDamageAmount"]


def get(params, tries=6):
    url = API + "?" + urllib.parse.urlencode(params, safe="$',")
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            print("  retry", k + 1, e)
            time.sleep(5 * (k + 1))


def main():
    os.makedirs(CACHE, exist_ok=True)
    frames = []
    counts = {}
    for storm, nums in STORMS.items():
        for dn in nums:
            cache = os.path.join(CACHE, f"DR-{dn}.csv")
            if os.path.exists(cache):
                df = pd.read_csv(cache, low_memory=False)
                frames.append(df)
                counts[str(dn)] = {"storm": storm, "eligible": int(df.eligible_total.iloc[0]) if len(df) else 0,
                                   "pulled": len(df)}
                print(f"{storm:15s} DR-{dn}: cached {len(df):,}", flush=True)
                continue
            flt = f"disasterNumber eq {dn} and ownRent eq 'O' and inspnReturned eq true"
            meta = get({"$filter": flt, "$top": 1, "$select": "id", "$inlinecount": "allpages"})
            total = meta["metadata"]["count"]
            rows, skip = [], 0
            while skip < min(total, CAP):
                page = get({"$filter": flt, "$select": ",".join(FIELDS), "$orderby": "id",
                            "$top": 10000, "$skip": skip})
                recs = page["IndividualsAndHouseholdsProgramValidRegistrations"]
                if not recs:
                    break
                rows += recs
                skip += len(recs)
            df = pd.DataFrame(rows[:CAP])
            df["storm"] = storm
            df["eligible_total"] = total
            df.to_csv(cache, index=False)
            frames.append(df)
            counts[str(dn)] = {"storm": storm, "eligible": total, "pulled": len(df)}
            print(f"{storm:15s} DR-{dn}: {total:>8,} owner inspections, pulled {len(df):,}", flush=True)
    out = pd.concat(frames, ignore_index=True)
    out.to_csv(OUT, index=False)
    json.dump(counts, open(os.path.join(ROOT, "data", "raw", "ihp_counts.json"), "w"), indent=1)
    print("wrote", OUT, len(out))


if __name__ == "__main__":
    main()
