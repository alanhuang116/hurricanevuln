# HurricaneVuln

Building-level hurricane vulnerability for insurers and lenders.

**Site:** https://alanhuang116.github.io/hurricanevuln/ (built into `docs/` by `scripts/build_site.py`)

Two models, each tested on data it was not fitted to:

| Model | Question | Calibration data | Test |
|---|---|---|---|
| Fragility | Will this building be damaged or destroyed at this wind? | 130,744 buildings in Hurricane Michael's FEMA-assessed footprint (FEMA remote sensing + USACE NSI + Florida parcel roll) | 5-fold spatial tiles; leave-one-county-out |
| Household loss | What does FEMA verify as the repair cost when a home is damaged? | 888,168 inspected owner-occupied homes, 19 storms 2016–2024 (OpenFEMA IHP) | Leave-one-storm-out |

Wind at every building and household comes from a Holland profile scaled to the
NOAA HURDAT2 best track (`hurricanevuln/windfield.py`); the website runs the
same formula, and `tests/test_js_parity.js` checks the two agree.

## Results

- **Fragility, new map tiles in assessed counties:** damage AUC 0.709 (gradient boosting 0.675, construction-class curves 0.671), lowest Brier score and share error; destroyed AUC 0.785 (boosting 0.786).
- **Fragility, new counties:** the 80% range covered 6 of 11 counties. FEMA's imagery coverage differs by county (Gulf County: 61% expected, 10.5% recorded), so county is modelled as the assessment unit.
- **Household loss:** CRPS $2,859 against $2,775 for gradient boosting (10 of 19 storms to boosting, 7 to HurricaneVuln); the storm-level 80% range covered 15 of 19 storms; best probability of any verified loss (AUC 0.687).

## Findings that shaped the model

1. FEMA's remote-sensing assessments record only damaged buildings; undamaged buildings come from the inventory.
2. NSI construction type is often imputed and its year built is a block median; the Florida parcel roll gives each building's own year built and use.
3. The parcel roll is post-storm: rebuilt homes carry post-storm attributes. Buildings built 2019+ are removed unless a damage point marks them as rebuilds (attributes set to unknown).
4. FEMA verified losses roughly quadruple from 2019 at similar winds, and the roof-damage flag stops being recorded; an inspection-regime covariate absorbs this.
5. Only 2010–2018 construction (Florida Building Code 2010) shows a supported protective effect; 2002–2009 does not separate from 1970–1993 in Michael's data.

## Reproducing

```
python scripts/fetch_public.py
python scripts/fetch_nsi.py
python scripts/fetch_parcels.py
python scripts/fetch_ihp.py
python scripts/build_fragility.py
python scripts/build_loss.py
python experiments/run_fragility.py
python experiments/run_loss_validation.py
python scripts/export_to_web.py
python scripts/build_site.py
python tests/test_core.py
node tests/test_js_parity.js
```

`data/raw/manifest.json` records the URL, retrieval time and SHA-256 of every input.

## Limits

Fragility rests on one storm and the Florida Panhandle / south-west Georgia building stock. Puerto Rico is absent from fragility because NSI has no Puerto Rico inventory. Verified losses measure repairs for safety and habitability, below full insured losses. Storm surge is represented by exposure indicators, not modelled as a peril. Contents and business interruption are out of scope.

Independent analysis; not endorsed by NOAA, FEMA, USACE, the Florida Department of Revenue or the Census Bureau.
