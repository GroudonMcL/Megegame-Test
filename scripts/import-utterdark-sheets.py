"""Builds the Utterdark preset's data (src/presets/utterdark-data.json) from the
DM's spreadsheets: the Master Tracker (AUG tab: items) and the DM Sheet
(AUGMENTS tab: recipes; VALIDATION tab: races; TABLES tab: loot tables).

The spreadsheets hold player names and secrets, so they stay out of the
repository. Run it again whenever the DM updates them:

    python3 -I scripts/import-utterdark-sheets.py TRACKER.xlsx DM_SHEET.xlsx

Needs openpyxl. Unit stat blocks and abilities from the sheets are ignored on
purpose: units use full SRD 5.2 stat blocks.
"""

import json
import re
import sys
import warnings

import openpyxl

warnings.filterwarnings("ignore")
OUT = "src/presets/utterdark-data.json"


def rows(path, sheet):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    out = []
    for r in wb[sheet].iter_rows(values_only=True):
        out.append(["" if v is None else str(v).strip() for v in r])
    return out


def cell(r, i):
    return r[i] if i < len(r) else ""


def num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    return int(f) if f == int(f) else f


def slug(s):
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", s.lower().replace("+", "plus")))


def key(s):
    """Matching key that ignores case, punctuation and plurals ("Rare Metal." = "Rare Metals")."""
    s = s.lower().replace("chull", "chuul").replace("water walking", "waterwalking").replace("gemtones", "gemstones").replace("antennae", "antenna").replace("enfeelbement", "enfeeblement").replace("pickaces", "pickaxes").replace("elemetnal", "elemental").replace("foucs", "focus").replace("armour", "armor").replace("eath gliding", "earth gliding").replace("frost band", "frost brand").replace("gemtsones", "gemstones").replace("whisp", "wisp").replace("magial", "magical").replace("camoflage", "camouflage")
    words = re.findall(r"[a-z0-9+]+", s)
    return " ".join(w[:-1] if w.endswith("s") and len(w) > 3 else w for w in words)


tracker, dmsheet = sys.argv[1], sys.argv[2]

# ——— Items (tracker AUG) ———

CATEGORY = {
    "basic material": ("basic-material", None),
    "material": ("material", None),
    "trinket": ("trinket", None),
    "item": ("item", None),
    "structure": ("structure", None),
    "trap": ("structure", None),
    "armour": ("augment", "armour"),
    "shield": ("augment", "shield"),
    "weapon": ("augment", "weapon-tool"),
    "tool": ("augment", "weapon-tool"),
    "equipment": ("augment", "equipment"),
    "artefact": ("augment", "equipment"),
    "artefact/ equipment": ("augment", "equipment"),
    "artefact/ weapon": ("augment", "weapon-tool"),
    "consumable": ("augment", "consumable"),
    "basic material/consumable": ("augment", "consumable"),
    "basic material /consumable": ("augment", "consumable"),
}
ABILITY = {"str": "str", "dex": "dex", "con": "con", "int": "int", "wis": "wis", "cha": "cha"}


def modifier(target, value):
    return {"type": "modifier", "target": target, "value": value, "when": []}


def requirements(text):
    t = text.lower()
    tags, races, notes = [], [], []
    if "martial" in t:
        tags.append("Martial")
    if "spellcast" in t:
        tags.append("Spellcaster")
    if "hero" in t:
        tags.append("Hero")
    if "miner" in t:
        tags.append("Miner")
    if "drow" in t:
        races.append("drow")
    if "dwarven" in t:
        races += ["dwarf", "duergar"]
    if "elven" in t:
        races.append("drow")
    if "huge or large" in t:
        notes.append("Requires a Huge or Large unit.")
    if re.search(r"str \d+\+", t):
        notes.append(f"Requires {text.rstrip('.')}.")
    return tags, races, notes


SAVE_BOMB = re.compile(
    r"(?:instead of attacking|on the first turn of combat).*?(?:make an? )?DC ?(\d+) (str|dex|con|int|wis|cha)\w*(?:/(str|dex|con|int|wis|cha)\w*)? save,? or take (\d+(?:d\d+)?) (\w+ )?damage(?:,? (?:or )?half(?:ed)? on a success)?",
    re.I,
)
SAVE_BOMB2 = re.compile(r"make an? (str|dex|con|int|wis|cha)\w* save,? taking (\d+d\d+) damage on a fail(?:ure)? or half on a success", re.I)
SHIELD = re.compile(r"once per round when hit by an attack this unit may reduce the damage by (\d+)", re.I)


def ability_effects(name, text, consumable):
    """Effects the engine understands, from the ability text; plus whether text is left over."""
    effects = []
    t = text
    handled = False
    m = SHIELD.search(t)
    if m:
        effects.append({"type": "reduceDamage", "mode": "flat", "amount": int(m.group(1)), "times": 1, "per": "round"})
        handled = True
    m = SAVE_BOMB.search(t)
    m2 = None if m else SAVE_BOMB2.search(t)
    if m or m2:
        if m:
            dc, save, orsave, dmg, dtype, half = int(m.group(1)), m.group(2).lower(), (m.group(3) or "").lower(), m.group(4), (m.group(5) or "").strip().lower(), "half" in m.group(0).lower()
        else:
            dc_m = re.search(r"DC ?(\d+)", t)
            dc, save, orsave, dmg, dtype, half = int(dc_m.group(1)) if dc_m else 12, m2.group(1).lower(), "", m2.group(2), "", True
        types = {"fire", "cold", "acid", "lightning", "poison", "necrotic", "radiant", "thunder", "force", "psychic"}
        lower = (name + " " + t).lower()
        dtype = dtype if dtype in types else next((x for x in types if x in lower), "force")
        dc_obj = {"save": save, "ability": None, "flat": dc}
        if orsave:
            dc_obj["orSave"] = orsave
        effects.append(
            {
                "type": "grantAction",
                "action": {
                    "name": name,
                    "text": text,
                    "uses": {"type": "perCombat", "times": 1},
                    "profile": {"kind": "save", "dc": dc_obj, "damage": [{"dice": dmg, "ability": None, "flat": 0, "type": dtype}], "onSuccess": "half" if half else "none", "targets": 1},
                    "review": "needsReview",
                },
            }
        )
        handled = True
    for mode in ("advantage", "disadvantage"):
        m = re.search(rf"(?<!dis){mode} on (stealth and initiative|initiative)", t, re.I)
        if m:
            effects.append({"type": "advantage", "mode": mode, "on": "initiative", "when": []})
            if "stealth" in m.group(1).lower():
                effects.append({"type": "advantage", "mode": mode, "on": "check:stealth", "when": []})
    return effects, handled


STAT = re.compile(r"\bac\b|attack|damage|save dc|initiative|stealth|[+-]\d+ (str|dex|con|int|wis|cha)")
OTHER = re.compile(
    r"immune|resist|once|may |enemy|target|instead|summon|movement|travel|critical|poison|fire|cold|acid|lightning|psychic|"
    r"necrotic|radiant|thunder|halve|half|reduce|cannot|regain|heal|per |each|first|surprise|hit by|while|spell|ally|allies|other units"
)


def simple(text):
    """True if every part of the ability text is covered by the stat columns or the parsed effects."""
    for clause in re.split(r"\.|,|;| and | but ", text.lower()):
        c = clause.strip()
        if not c or c in ("additionally", "it", "also"):
            continue
        if not STAT.search(c) or OTHER.search(c):
            return False
    return True


trk = rows(tracker, "AUG")
items = {}
seen_scroll_spells = []
for r in trk[1:]:
    name = cell(r, 0).rstrip(". ")
    if not name:
        continue
    rarity, typ, ability, desc = cell(r, 1), cell(r, 2).lower(), cell(r, 5), cell(r, 6)
    if name.lower().startswith("scroll of "):
        typ = "consumable"
    cat, slot = CATEGORY.get(typ, ("item", None))
    item = {
        "id": slug(name),
        "name": name,
        "categoryId": cat,
        "description": "\n\n".join(x for x in [ability, desc] if x and x != "-"),
        "rarity": (rarity or "common").lower(),
        "slotId": slot,
        "tags": [],
        "requiresUnitTags": [],
        "requiresRaces": [],
        "effects": [],
        "consumable": slot == "consumable",
    }
    tags, races, notes = requirements(cell(r, 4))
    item["requiresUnitTags"], item["requiresRaces"] = tags, races
    if slot or cat == "structure":
        e = item["effects"]
        for col, target in [(8, "ac"), (9, "toHit"), (10, "damage"), (11, "attacks"), (12, "saveDc")]:
            if num(cell(r, col)):
                e.append(modifier(target, num(cell(r, col))))
        if num(cell(r, 13)):
            # The old sheet counted movement in regions; one region is 15 ft of speed.
            e.append(modifier("speed", num(cell(r, 13)) * 15))
        for col, ab in zip(range(14, 20), ["str", "dex", "con", "int", "wis", "cha"]):
            if num(cell(r, col)):
                e.append(modifier(f"ability:{ab}", num(cell(r, col))))
        if "pickaxe" in name.lower():
            bonus = re.search(r"\+(\d+) to all rolls made to excavate", ability.lower())
            if bonus:
                e += [modifier("check:excavate", int(bonus.group(1))), modifier("check:extract", int(bonus.group(1)))]
                ability_rest = ""
        if name.lower().startswith("scroll of "):
            spell_id = slug(name[len("scroll of "):].replace("Enfeelbement", "Enfeeblement"))
            seen_scroll_spells.append(spell_id)
            e.append({"type": "spells", "spellIds": [spell_id], "uses": {"type": "perCombat", "times": 1}})
            item["description"] = item["description"] or f"Cast {name[len('Scroll of '):]} once. The scroll is used up."
        auto, handled = ability_effects(name, ability, item["consumable"])
        e += auto
        leftover = ability and ability != "-" and not handled and not simple(ability) and "pickaxe" not in name.lower()
        for n in notes:
            e.append({"type": "text", "text": n})
        if leftover:
            e.append({"type": "text", "text": f"{name}: {ability}"})
    if item["id"] in items:
        continue
    items[item["id"]] = item

by_key = {key(i["name"]): i["id"] for i in items.values()}


ALIASES = {"poison": "basic poison"}


def find_item(name):
    return by_key.get(key(ALIASES.get(name.strip().lower(), name)))


# ——— Recipes (DM sheet AUGMENTS "Crafted From") ———

dm_aug = rows(dmsheet, "AUGMENTS (DM)")
recipes = []
unmatched = set()
for r in dm_aug[2:]:
    out_name, src = cell(r, 0).rstrip(". "), cell(r, 6)
    if not out_name or not src or src == "-":
        continue
    out_id = find_item(out_name)
    if not out_id:
        unmatched.add(out_name)
        continue
    # "2x Silk, Rare Gemstones"; "A/B/C" means any one of them (a recipe per choice).
    options = [[]]
    for part in [p.strip().rstrip(".") for p in src.split(",") if p.strip()]:
        m = re.match(r"(\d+)\s*x\s*(.+)", part, re.I)
        qty, rest = (int(m.group(1)), m.group(2)) if m else (1, part)
        alts = []
        for alt in rest.split("/"):
            iid = find_item(alt.strip())
            if iid:
                alts.append(iid)
            else:
                unmatched.add(alt.strip())
        if not alts:
            options = []
            break
        options = [o + [(a, qty)] for o in options for a in alts]
    for n, combo in enumerate(options):
        inputs = {}
        for iid, q in combo:
            inputs[iid] = inputs.get(iid, 0) + q
        rid = out_id if len(options) == 1 else f"{out_id}-{n + 1}"
        if any(x["id"] == rid for x in recipes):
            continue
        recipes.append({"id": rid, "inputs": [{"itemId": k, "qty": v} for k, v in inputs.items()], "resources": {}, "outputs": [{"itemId": out_id, "qty": 1}], "knownAtStart": False})

# Which monster each material comes from (DM sheet "Source").
harvest = {}
for r in dm_aug[2:]:
    name, typ, source = cell(r, 0).rstrip(". "), cell(r, 1).lower(), cell(r, 5)
    iid = find_item(name)
    if not iid or not source or source.lower() in ("crafting", "-", "treasure"):
        continue
    for monster in source.split("/"):
        harvest.setdefault(monster.strip(), []).append(iid)

# ——— Races (DM sheet VALIDATION: STR DEX CON WIS INT CHA) ———

val = rows(dmsheet, "VALIDATION (DM)")
races = []
for r in val[2:]:
    name = cell(r, 36)
    if not name:
        continue
    name = {"Orcs": "Orc", "Myconids": "Myconid"}.get(name, name)
    bonus = {}
    for col, ab in zip(range(37, 43), ["str", "dex", "con", "wis", "int", "cha"]):
        if num(cell(r, col)):
            bonus[ab] = num(cell(r, col))
    races.append({"id": slug(name), "name": name, "description": "", "abilityBonuses": bonus, "effects": []})

# ——— Roll tables (tracker DM REFERENCE; encounters from the DM sheet TABLES) ———

TABLE_IDS = {
    "Divine Intervention": "divine-intervention",
    "Excavate": "excavate",
    "New Region": "new-region",
    "Extract": "extract",
    "Hunter's Post": "hunters-post",
    "Race": "race",
    "Search Region": "search-region",
    "Search Ruin": "search-ruin",
    "Spy": "spy",
    "Tavern": "tavern",
    "Teleport (Familiar)": "teleport-familiar",
    "Teleport (Not Familiar)": "teleport-unfamiliar",
    "Turn Event": "turn-event",
    "Gold": "deficit-gold",
    "Food": "deficit-food",
    "Common Treasure": "treasure-common",
    "Uncommon Treasure": "treasure-uncommon",
    "Rare Treasure": "treasure-rare",
    "Very Rare Treasure": "treasure-very-rare",
    "Legendary Treasure": "treasure-legendary",
    "Common Material": "material-common",
    "Uncommon Material": "material-uncommon",
    "Rare Material": "material-rare",
    "Very Rare Material": "material-very-rare",
}


def parse_range(v):
    v = v.replace(" ", "")
    if v.endswith("+"):
        return int(float(v[:-1])), None
    if "-" in v[1:]:
        a, b = v.split("-", 1)
        return int(float(a)), int(float(b))
    n = int(float(v))
    return n, n


ref = rows(tracker, "DM REFERENCE")
raw = {}
for r in ref[37:85]:
    name = cell(r, 1)
    if name not in TABLE_IDS:
        continue
    t = raw.setdefault(name, {"die": cell(r, 2).lower().replace("d", "1d", 1), "note": cell(r, 3) if cell(r, 3) != "-" else "", "bands": []})
    for c in range(4, len(r) - 1, 2):
        rng, text = cell(r, c), cell(r, c + 1)
        if not rng or rng == "-" or not text:
            continue
        lo, hi = parse_range(rng)
        t["bands"].append([lo, hi, text])

LOWER = {"uncommon": "treasure-uncommon", "rare": "treasure-rare", "common": "treasure-common"}


def results_for(tid, text, extras):
    """Structured results for an outcome's text, where the meaning is clear."""
    t = text.lower()
    iid = find_item(text)
    if iid and tid.startswith(("treasure", "material")):
        return [{"type": "gainItem", "itemId": iid, "qty": "1"}]
    if t.startswith("re-roll twice"):
        return [{"type": "rollTable", "tableId": tid, "times": 2, "ignore": extras}]
    m = re.search(r"bonus (uncommon|rare|common)", t)
    if tid.startswith("treasure") and ("reroll" in t or "re-roll" in t or "bonus" in t):
        out = [{"type": "rollTable", "tableId": tid, "times": 1, "ignore": extras}]
        if m:
            out.append({"type": "rollTable", "tableId": LOWER[m.group(1)], "times": 1, "ignore": []})
        return out
    if tid == "race":
        return [{"type": "gainRace", "raceId": slug({"Orcs": "Orc"}.get(text, text))}]
    out = []
    if "survivors" in t:
        out.append({"type": "rollTable", "tableId": "race", "times": 1, "ignore": []})
    if re.search(r"material table|basic material|gain a material", t):
        out.append({"type": "rollTable", "tableId": "material-common", "times": 1, "ignore": []})
    if "resource table" in t or "resource node" in t and "direction" not in t:
        out.append({"type": "addDeposit", "note": ""})
    if "common item table" in t:
        out.append({"type": "rollTable", "tableId": "treasure-common", "times": 1, "ignore": []})
    if "uncomon magic item" in t or "uncommon magic item" in t:
        out.append({"type": "rollTable", "tableId": "treasure-uncommon", "times": 1, "ignore": []})
    if "rare magic item" in t:
        out.append({"type": "rollTable", "tableId": "treasure-rare", "times": 1, "ignore": []})
    if "find magical item" in t:
        out.append({"type": "rollTable", "tableId": "treasure-common", "times": 1, "ignore": []})
    if "find ruin" in t:
        out.append({"type": "findStructure", "kind": "ruin"})
    m = re.search(r"(?:gain |^|\(|and )(\d+d\d+|\d+) gold", t)
    if m:
        out.append({"type": "gainResource", "resourceId": "gold", "amount": m.group(1)})
    m = re.search(r"(?:gain |^|\(|and )(\d+d\d+|\d+) food", t)
    if m:
        out.append({"type": "gainResource", "resourceId": "food", "amount": m.group(1)})
    m = re.search(r"takes (\d+d\d+) damage", t)
    if m:
        out.append({"type": "damageActor", "dice": m.group(1)})
    return out


roll_tables = []
for name, t in raw.items():
    tid = TABLE_IDS[name]
    extras = [n for lo, hi, text in t["bands"] if re.search(r"re-?roll|bonus", text.lower()) for n in range(lo, (hi or lo) + 1)]
    if tid == "material-common":
        extras = [10]
    bands = [{"min": lo, "max": hi, "text": text, "results": results_for(tid, text, extras)} for lo, hi, text in t["bands"]]
    # The last band of a table covers everything above it.
    if bands and tid not in ("race",) and not tid.startswith(("treasure", "material")):
        bands[-1]["max"] = None
    category = "loot" if tid.startswith(("treasure", "material")) else "deficit" if tid.startswith("deficit") else "event" if tid == "turn-event" else "building" if tid in ("hunters-post", "tavern") else "other" if tid in ("race", "new-region") or tid.startswith("teleport") else "check"
    roll_tables.append({"id": tid, "name": {"Gold": "Gold Deficit", "Food": "Food Deficit"}.get(name, name), "category": category, "die": t["die"], "modifierNote": t["note"], "bands": bands})

# Encounter tables, side by side in pairs on the DM sheet.
tables = rows(dmsheet, "TABLES (DM)")
ENCOUNTER_IDS = {
    "Inconvenience": "encounter-inconvenience",
    "Low CR (1-3)": "encounter-low",
    "Medium CR (4-7)": "encounter-medium",
    "High CR (8+)": "encounter-high",
    "Demon Scouts": "encounter-demon-scouts",
    "Demon Incursion": "encounter-demon-incursion",
    "Cultist Scouts": "encounter-cultist-scouts",
    "Cultist Incursion": "encounter-cultist-incursion",
    "Encounter Table": "encounter",
}
encounters = {}
current = {}
for r in tables:
    for col in (1, 4):
        title = cell(r, col)
        if title in ENCOUNTER_IDS:
            current[col] = encounters.setdefault(ENCOUNTER_IDS[title], {"name": title, "die": "", "bands": []})
            continue
        if col not in current:
            continue
        outcome, die, note = cell(r, col), cell(r, col + 1), cell(r, col + 2)
        if outcome == "Outcome":
            current[col]["die"] = die.lower().replace("d", "1d", 1)
            continue
        if not outcome or not die or not re.match(r"^[\d. +-]+$", die):
            if not outcome and not die and current[col]["bands"]:
                current.pop(col, None)
            continue
        lo, hi = parse_range(die)
        current[col]["bands"].append({"min": lo, "max": hi, "text": f"{outcome}: {note}" if note else outcome, "monsters": note or outcome})
    if cell(r, 1) == "LOOT TABLES":
        break

data = {
    "items": sorted(items.values(), key=lambda i: i["name"].lower()),
    "recipes": recipes,
    "races": races,
    "harvest": harvest,
    "rollTables": roll_tables,
    "encounters": encounters,
    "scrollSpells": sorted(set(seen_scroll_spells)),
}
with open(OUT, "w") as f:
    json.dump(data, f, indent=1, ensure_ascii=False)
    f.write("\n")
print(f"{len(items)} items, {len(recipes)} recipes, {len(races)} races, {len(harvest)} monsters with materials")
print("unmatched recipe names:", sorted(unmatched))
print("tables:", ", ".join(f"{t['id']} ({len(t['bands'])})" for t in roll_tables))
print("encounters:", ", ".join(f"{k} ({len(v['bands'])})" for k, v in encounters.items()))
print("treasure/material outcomes not matched to an item:", [b["text"] for t in roll_tables if t["id"].startswith(("treasure", "material")) for b in t["bands"] if not b["results"]])
